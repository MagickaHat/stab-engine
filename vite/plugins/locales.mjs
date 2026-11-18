/**
 * @file locales.mjs
 * @brief Vite plugin for the localization system.
 *
 * - **Translated graphics, decided at build time.** `virtual:stab-locale-graphics`
 *   lists every file under `public/assets/img/locales/<locale>/`; the game
 *   turns it into a map of which file each locale shows (src/i18n/graphics.ts,
 *   src/world/text.ts). Adding or removing a translated image reloads the page.
 * - **Hot reload of locale CSVs.** Editing `content/locales/<category>/<locale>.csv`
 *   during `npm run dev` sends the new file to the game (`stab:locale-csv`),
 *   which replaces that file's text at once, without reloading the page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LOCALE_IMG_DIR, LOCALES_DIR, listLocaleGraphics } from '../../tools/locales/content.ts';

/** @brief The ID game code imports. */
const PUBLIC_ID = 'virtual:stab-locale-graphics';

/** @brief The ID Vite uses inside. */
const RESOLVED_ID = `\0${PUBLIC_ID}`;

/**
 * @brief The category and locale of a locale CSV, or `null` for any other file.
 * @param file Absolute path.
 */
function localeCsv (file)
{
    const relative = path.relative(LOCALES_DIR, path.resolve(file));
    const parts = relative.split(path.sep);
    if (relative.startsWith('..') || parts.length !== 2 || !parts[1].endsWith('.csv')) return null;
    return { category: parts[0], locale: parts[1].slice(0, -4) };
}

/**
 * @brief Creates the Vite plugin.
 * @return The plugin.
 */
export default function localesPlugin ()
{
    return {
        name: 'stab-engine:locales',

        resolveId (id)
        {
            return id === PUBLIC_ID ? RESOLVED_ID : null;
        },

        load (id)
        {
            if (id !== RESOLVED_ID) return null;
            if (fs.existsSync(LOCALE_IMG_DIR)) this.addWatchFile(LOCALE_IMG_DIR);
            return `export default ${JSON.stringify(listLocaleGraphics())};`;
        },

        configureServer (server)
        {
            //  A translated image added or removed: rebuild the list and reload.
            const refresh = (file) =>
            {
                if (!path.resolve(file).startsWith(LOCALE_IMG_DIR + path.sep)) return;
                const module = server.moduleGraph.getModuleById(RESOLVED_ID);
                if (module) server.moduleGraph.invalidateModule(module);
                server.ws.send({ type: 'full-reload' });
            };
            server.watcher.on('add', refresh);
            server.watcher.on('unlink', refresh);
        },

        handleHotUpdate ({ file, server })
        {
            const csv = localeCsv(file);
            if (!csv) return undefined;
            server.ws.send({ type: 'custom', event: 'stab:locale-csv', data: { ...csv, text: fs.readFileSync(file, 'utf-8') } });
            //  Handled: no module reload, the game swaps the text in place.
            return [];
        },
    };
}
