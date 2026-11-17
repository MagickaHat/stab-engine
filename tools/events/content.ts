/**
 * @file content.ts
 * @brief Finds and reads the event content on disk, for the Node tools and the Vite plugin.
 *
 * - Event files: `content/events/**\/*.json` and `content/trainers/**\/*.json`
 *   (`schema.json` is the generated JSON Schema and is skipped);
 * - Locale files: `content/locales/<category>/<locale>.csv`;
 * - Maps: `src/tiled/maps/**\/*.tmj`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFiles } from '../../src/events/compile.ts';
import type { CompileIssue, EventBundle } from '../../src/events/compile.ts';
import { parseLocaleCsv } from '../../src/events/text.ts';

/** @brief Root of the repository. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @brief Folders holding event files. */
export const EVENT_DIRS = [path.join(ROOT, 'content/events'), path.join(ROOT, 'content/trainers')];

/** @brief Folder of the locale CSV files. */
export const LOCALES_DIR = path.join(ROOT, 'content/locales');

/** @brief Folder of the ink stories. */
export const DIALOGUE_DIR = path.join(ROOT, 'content/dialogue');

/** @brief Folder of the Tiled project. */
export const TILED_DIR = path.join(ROOT, 'src/tiled');

/** @brief The Tiled project file. */
export const TILED_PROJECT = path.join(TILED_DIR, 'stab.tiled-project');

/** @brief Folder of the Tiled maps. */
export const MAPS_DIR = path.join(TILED_DIR, 'maps');

/**
 * @brief Every file under a folder with one of some extensions.
 * @param dir Folder (may be missing).
 * @param extensions E.g. `['.json']`.
 * @return Absolute paths, sorted.
 */
export function listFiles (dir: string, extensions: readonly string[]): string[]
{
    if (!fs.existsSync(dir)) return [];
    return (fs.readdirSync(dir, { recursive: true }) as string[])
        .map((file) => path.join(dir, file))
        .filter((file) => extensions.some((ext) => file.endsWith(ext)) && fs.statSync(file).isFile())
        .sort();
}

/**
 * @brief Every event file.
 * @return Absolute paths.
 */
export function eventFiles (): string[]
{
    return EVENT_DIRS.flatMap((dir) => listFiles(dir, ['.json'])).filter((file) => path.basename(file) !== 'schema.json');
}

/**
 * @brief A path relative to the repository, with forward slashes, for messages.
 * @param file Absolute path.
 */
export function relative (file: string): string
{
    return path.relative(ROOT, file).split(path.sep).join('/');
}

/**
 * @brief Read and compile every event file.
 * @return The bundle, every problem, and the files read.
 */
export function loadEvents (): { bundle: EventBundle; issues: CompileIssue[]; files: string[] }
{
    const files = eventFiles();
    const parsed: [string, unknown][] = [];
    const issues: CompileIssue[] = [];
    for (const file of files)
    {
        try
        {
            parsed.push([relative(file), JSON.parse(fs.readFileSync(file, 'utf-8'))]);
        }
        catch (error)
        {
            issues.push({ file: relative(file), path: '', message: `not valid JSON: ${(error as Error).message}` });
        }
    }
    const compiled = compileFiles(parsed);
    return { bundle: compiled.bundle, issues: [...issues, ...compiled.issues], files };
}

/**
 * @brief Read every locale CSV file.
 * @return Locale → key → text, merged over all categories.
 */
export function loadLocales (): Record<string, Record<string, string>>
{
    const out: Record<string, Record<string, string>> = {};
    for (const file of listFiles(LOCALES_DIR, ['.csv']))
    {
        const locale = path.basename(file, '.csv');
        Object.assign(out[locale] ??= {}, parseLocaleCsv(fs.readFileSync(file, 'utf-8')));
    }
    return out;
}

/**
 * @brief The ID of a map file: its path under `src/tiled/maps` without the extension.
 * @param file Absolute path of a `.tmj` file.
 * @return E.g. `route1` or `towns/pallet`.
 */
export function mapId (file: string): string
{
    return path.relative(MAPS_DIR, file).split(path.sep).join('/').replace(/\.tmj$/, '');
}

/**
 * @brief Whether a module is the script Node was started with (and not imported).
 * @param url The module's `import.meta.url`.
 */
export function isMain (url: string): boolean
{
    return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(url);
}
