/**
 * @file events.mjs
 * @brief Vite plugin that compiles the event files into one module at build time.
 *
 * Game code imports every compiled script, common event, listener, battle
 * hook and trainer with:
 *
 * @code
 * import bundle from 'virtual:stab-events';
 * const events = new EventManager({ bundle, ... });
 * @endcode
 *
 * The files (`content/events/**\/*.json`, `content/trainers/**\/*.json`) are
 * checked and compiled by src/events/compile.ts, the same code the
 * validator runs, so mistakes stop the build (and show in the browser during
 * `npm run dev`) instead of surfacing while playing. The result is plain
 * data: nothing is evaluated at run time.
 */
import path from 'node:path';
import { formatIssue } from '../../src/events/compile.ts';
import { EVENT_DIRS, eventFiles, loadEvents } from '../../tools/events/content.ts';

/** @brief The ID game code imports. */
const PUBLIC_ID = 'virtual:stab-events';

/** @brief The ID Vite uses inside (the `\0` keeps other plugins away from it). */
const RESOLVED_ID = `\0${PUBLIC_ID}`;

/**
 * @brief Whether a file is an event file.
 * @param file Absolute path.
 */
function isEventFile (file)
{
    const normal = path.resolve(file);
    return normal.endsWith('.json') && EVENT_DIRS.some((dir) => normal.startsWith(dir + path.sep));
}

/**
 * @brief Creates the Vite plugin.
 * @return A Vite plugin that serves `virtual:stab-events`.
 */
export default function eventsPlugin ()
{
    return {
        name: 'stab-engine:events',

        resolveId (id)
        {
            return id === PUBLIC_ID ? RESOLVED_ID : null;
        },

        load (id)
        {
            if (id !== RESOLVED_ID) return null;
            const { bundle, issues } = loadEvents();
            for (const file of eventFiles()) this.addWatchFile(file);
            if (issues.length > 0)
            {
                this.error(`Event files have errors (run npm run events:validate):\n  ${issues.map(formatIssue).join('\n  ')}`);
            }
            return { code: `export default ${JSON.stringify(bundle)};`, map: { mappings: '' } };
        },

        /** New or deleted files are not watched yet, so reload the bundle whenever one appears or changes. */
        handleHotUpdate ({ file, server })
        {
            if (!isEventFile(file)) return undefined;
            const module = server.moduleGraph.getModuleById(RESOLVED_ID);
            if (module) server.moduleGraph.invalidateModule(module);
            server.ws.send({ type: 'full-reload' });
            return [];
        },
    };
}
