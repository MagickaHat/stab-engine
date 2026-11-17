/**
 * @file new-script.ts
 * @brief CLI: adds an empty event script to an event file, then refreshes the Tiled project.
 *
 * @code
 * npm run events:new -- <script id> [file]
 * npm run events:new -- route1_old_man route1      # → content/events/route1.json
 * @endcode
 *
 * `file` is the event file's name under content/events, without `.json`
 * (default: the part of the script ID before the first `_`). The Tiled
 * extension (src/tiled/extensions/CreateEvent.js) runs this through
 * CreateEventSource.sh / .bat when you create an `Event` with a new script.
 */
import fs from 'node:fs';
import path from 'node:path';
import { formatTiledJson } from './tiledProject.ts';
import { isMain, loadEvents, relative, ROOT } from './content.ts';
import { syncTiled } from './sync-tiled.ts';

/** @brief Script IDs: lowercase letters, digits and `_`. */
const SCRIPT_ID = /^[a-z0-9_]+$/;

/**
 * @brief Add a script with one empty page.
 * @param id Script ID.
 * @param fileName Event file name without `.json` (may contain `/`).
 * @param root Folder of the event files. Default: content/events.
 * @return The file written.
 * @throws Error if the ID is invalid or already used, or the file is not valid JSON.
 */
export function addScript (id: string, fileName: string, root = path.join(ROOT, 'content/events')): string
{
    if (!SCRIPT_ID.test(id)) throw new Error(`"${id}" is not a valid script ID (lowercase letters, digits and _)`);
    if (!/^[a-z0-9_/-]+$/.test(fileName) || fileName.includes('..')) throw new Error(`"${fileName}" is not a valid file name`);
    if (loadEvents().bundle.scripts[id]) throw new Error(`a script named "${id}" already exists`);
    const file = path.join(root, `${fileName}.json`);
    const schema = path.relative(path.dirname(file), path.join(root, 'schema.json')).split(path.sep).join('/');
    const data: { $schema?: string; scripts?: Record<string, unknown> } = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf-8'))
        : { $schema: schema.startsWith('.') ? schema : `./${schema}` };
    data.scripts = { ...data.scripts, [id]: { pages: [{ trigger: 'action', commands: [] }] } };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, formatTiledJson(data));
    return file;
}

if (isMain(import.meta.url))
{
    const [id, fileName] = process.argv.slice(2);
    if (!id)
    {
        console.error('usage: npm run events:new -- <script id> [file]');
        process.exit(2);
    }
    try
    {
        const file = addScript(id, fileName || id.split('_')[0]);
        console.log(`✓ Added script "${id}" to ${relative(file)}`);
        syncTiled({ quiet: true });
        console.log('✓ Updated the Tiled project (reload it in Tiled to see the new script)');
    }
    catch (error)
    {
        console.error(`✗ ${(error as Error).message}`);
        process.exit(1);
    }
}
