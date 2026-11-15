/**
 * @file ink.mjs
 * @brief Vite plugin that compiles `.ink` story files to ink JSON at build time.
 *
 * Importing an `.ink` file from game code gives you the compiled story JSON,
 * ready to pass to `new DialogueEngine(json)` (see src/dialogue):
 *
 * @code
 * import introStory from '../../content/dialogue/intro.ink';
 * const dialogue = new DialogueEngine(introStory);
 * @endcode
 *
 * The compiler comes from inkjs itself, so no external tool (Inky, inklecate)
 * is needed and the compiler never ends up in the game bundle. `INCLUDE`d
 * files are resolved relative to the importing file and are watched, so
 * editing any of them hot-reloads the story in `npm run dev`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Compiler, CompilerOptions } from 'inkjs/full';

/** @brief File extension handled by the plugin. */
const INK_EXTENSION = '.ink';

/**
 * @brief Compiles one ink source file.
 * @param source Contents of the root `.ink` file.
 * @param filename Absolute path of the root `.ink` file.
 * @return `{ json, errors, warnings, includes }` where `json` is the compiled
 *         story (a string, or `null` if compilation failed) and `includes`
 *         lists the absolute paths of every `INCLUDE`d file.
 */
export function compileInk(source, filename)
{
    const rootDir = path.dirname(filename);
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];
    /** @type {Set<string>} */
    const includes = new Set();

    const fileHandler = {
        ResolveInkFilename: (includeName) => path.resolve(rootDir, includeName),
        LoadInkFileContents: (fullPath) =>
        {
            includes.add(fullPath);
            return fs.readFileSync(fullPath, 'utf-8');
        },
    };

    // ErrorType: 0 = Author (TODO:), 1 = Warning, 2 = Error.
    const errorHandler = (message, type) =>
    {
        if (type === 2) errors.push(message);
        else warnings.push(message);
    };

    // countAllVisits = true so DialogueEngine.visitCount() works for every knot,
    // not only those the ink code itself reads (same as inklecate's -c flag).
    const options = new CompilerOptions(filename, [], true, errorHandler, fileHandler);
    let json = null;
    try
    {
        const story = new Compiler(source, options).Compile();
        if (errors.length === 0 && story) json = story.ToJson();
    }
    catch (e)
    {
        // The compiler throws if errors were reported without an error handler,
        // or on internal failures; make sure something is reported.
        if (errors.length === 0) errors.push(e instanceof Error ? e.message : String(e));
    }
    if (errors.length === 0 && !json) errors.push('ink compiler produced no output.');

    return { json, errors, warnings, includes: [...includes] };
}

/**
 * @brief Creates the Vite plugin.
 * @return A Vite plugin that turns `*.ink` imports into `export default <story JSON>`.
 */
export default function inkPlugin()
{
    return {
        name: 'stab-engine:ink',

        transform (code, id)
        {
            const file = id.split('?')[0];
            if (!file.endsWith(INK_EXTENSION)) return null;

            const { json, errors, warnings, includes } = compileInk(code, file);
            for (const inc of includes) this.addWatchFile(inc);
            for (const w of warnings) this.warn(`${path.basename(file)}: ${w}`);
            if (errors.length > 0)
            {
                this.error(`Failed to compile ${file}:\n  ${errors.join('\n  ')}`);
            }

            return { code: `export default ${json};`, map: { mappings: '' } };
        },
    };
}
