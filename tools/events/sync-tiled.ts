/**
 * @file sync-tiled.ts
 * @brief CLI: writes the registries and event classes into the Tiled project.
 *
 * @code
 * npm run events:sync-tiled                 # update src/tiled/stab.tiled-project
 * npm run events:sync-tiled -- --tile-size 32
 * npm run events:sync-tiled -- --check      # exit 1 if the project is out of date (CI)
 * @endcode
 *
 * Reads flags, variables, story milestones, emotes and natives from
 * src/events/registry; items, species and moves from content/pbs; trainers,
 * scripts and common events from the event files; ink stories and knots from
 * content/dialogue; text keys from content/locales; map IDs from
 * src/tiled/maps. Writes them as enums into `stab.tiled-project`, along with
 * the object classes (`Event`, `Npc`, `Sign`...), and writes one object
 * template per class to `src/tiled/events/`. Re-open the project in Tiled (or
 * use Project > Reload) to see the changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CLASS_SPECS } from '../../src/events/tiled.ts';
import { isMain, relative, TILED_DIR, TILED_PROJECT } from './content.ts';
import { collectRegistries } from './registries.ts';
import { formatTiledJson, objectTemplate, syncProject } from './tiledProject.ts';
import type { TiledProject } from './tiledProject.ts';

/**
 * @brief Update the project and the templates.
 * @param options `tileSize` for templates (default 16); `check` to only compare.
 * @return `true` if everything was (or, with `check`, already is) up to date.
 */
export function syncTiled (options: { tileSize?: number; check?: boolean; quiet?: boolean } = {}): boolean
{
    const project = JSON.parse(fs.readFileSync(TILED_PROJECT, 'utf-8')) as TiledProject;
    const registries = collectRegistries();
    const outputs = new Map<string, string>([[TILED_PROJECT, formatTiledJson(syncProject(project, registries))]]);
    const templates = path.join(TILED_DIR, 'events');
    for (const spec of CLASS_SPECS)
    {
        outputs.set(path.join(templates, `${spec.name}.tj`), formatTiledJson(objectTemplate(spec, options.tileSize ?? 16)));
    }

    let upToDate = true;
    for (const [file, text] of outputs)
    {
        if (fs.existsSync(file) && fs.readFileSync(file, 'utf-8') === text) continue;
        upToDate = false;
        if (options.check)
        {
            console.error(`✗ ${relative(file)} is out of date: run npm run events:sync-tiled`);
            continue;
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        if (!options.quiet) console.log(`✓ Wrote ${relative(file)}`);
    }
    if (!options.quiet)
    {
        const counts = Object.entries(registries).map(([name, values]) => `${name} ${values.length}`).join(', ');
        console.log(`${upToDate ? '✓ Already up to date' : options.check ? '' : '✓ Synced'}${upToDate || !options.check ? ` (${counts})` : ''}`);
    }
    return upToDate;
}

if (isMain(import.meta.url))
{
    const args = process.argv.slice(2);
    const sizeAt = args.indexOf('--tile-size');
    const tileSize = sizeAt >= 0 ? Number(args[sizeAt + 1]) : 16;
    if (!Number.isInteger(tileSize) || tileSize < 1)
    {
        console.error('--tile-size must be a whole number of pixels');
        process.exit(2);
    }
    const ok = syncTiled({ tileSize, check: args.includes('--check') });
    if (args.includes('--check') && !ok) process.exit(1);
}
