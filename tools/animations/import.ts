/**
 * @file import.ts
 * @brief CLI: converts Essentials battle animations (`Data/PkmnAnimations.rxdata`)
 *        into editable JSON files in `content/animations`.
 *
 * @code
 * npm run animations:import -- --pack ~/packs/Gen_9_Move_Animation_Project
 * npm run animations:import -- --pack <dir> --dry-run          # show what would be written
 * npm run animations:import -- --pack <dir> --pack <add-on>    # layer packs; later ones win
 * npm run animations:import -- --file <path>.rxdata --pack <dir>
 * npm run animations:import -- --pack <dir> --force            # overwrite hand-edited files too
 * @endcode
 *
 * Run `npm run assets:animations` with the same packs to import the sheets
 * and sounds the animations use; both commands name files the same way.
 *
 * Files are written to `content/animations/{moves,common,other}/<name>.json`.
 * A file changed by hand since the last import is not overwritten (unless
 * `--force`), and files this importer wrote earlier that are no longer
 * produced are removed if they were not edited. Files you add yourself are
 * never touched.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assetName, findDir, listFiles } from '../assets/essentials.ts';
import { RubyObject, readMarshal } from './marshal.ts';
import { convertAnimation, formatAnimation, placeAnimation } from './convert.ts';
import type { ConvertReport, NameResolver } from './convert.ts';
import type { BattleAnimation } from '../../src/battle/animation/format.ts';

/** @brief Repository root. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @brief Default output folder. */
export const ANIMATIONS_DIR = path.join(ROOT, 'content/animations');

/** @brief Where the animation data sits in an Essentials project. */
const RXDATA = 'Data/PkmnAnimations.rxdata';

/** @brief Folders the sheets and sounds come from (same as the `animations` asset layout). */
const GRAPHICS_DIR = 'Graphics/Animations';
const SOUNDS_DIR = 'Audio/SE/Anim';

/** @brief Sound formats in the order they are picked when a name has no extension. */
const SOUND_EXTS = ['.ogg', '.wav', '.mp3', '.mid', '.midi'];

/** @brief Importer memory (gitignored): output file → hash of what was written. */
const STATE_FILE = path.join(ROOT, 'tools/animations/.cache/state.json');

/** @brief Hash of file contents. */
const hash = (text: string) => crypto.createHash('sha1').update(text).digest('hex');

/**
 * @brief Index the files of one folder in several packs, by lower-case name and stem.
 * @param packs Pack roots, later ones win.
 * @param dir Folder inside each pack.
 * @return Lower-case file name → real file name, and lower-case stem → real file names.
 */
function indexFolder (packs: string[], dir: string): { byName: Map<string, string>; byStem: Map<string, string[]> }
{
    const byName = new Map<string, string>();
    const byStem = new Map<string, string[]>();
    for (const pack of packs)
    {
        const found = findDir(pack, dir);
        if (!found) continue;
        for (const file of listFiles(found).filter((f) => !f.includes('/')))
        {
            byName.set(file.toLowerCase(), file);
            const stem = file.replace(/\.[^.]*$/, '').toLowerCase();
            byStem.set(stem, [...new Set([...(byStem.get(stem) ?? []), file])]);
        }
    }
    return { byName, byStem };
}

/**
 * @brief Name lookup over the packs' sheets and sounds, using the asset importer's names.
 * @param packs Pack roots.
 * @return The resolver.
 */
export function packResolver (packs: string[]): NameResolver
{
    const graphics = indexFolder(packs, GRAPHICS_DIR);
    const sounds = indexFolder(packs, SOUNDS_DIR);
    const stem = (name: string) => name.replace(/\.[^.\s]*$/, '');
    return {
        graphic (name)
        {
            const file = graphics.byName.get(name.toLowerCase()) ?? graphics.byName.get(`${name.toLowerCase()}.png`)
                ?? graphics.byStem.get(stem(name).toLowerCase())?.[0];
            return { name: assetName(stem(file ?? name)) ?? 'unnamed', found: Boolean(file) };
        },
        sound (name)
        {
            const ext = path.extname(name).toLowerCase();
            let file = SOUND_EXTS.includes(ext) ? sounds.byName.get(name.toLowerCase()) : undefined;
            if (!file)
            {
                // No extension (RPG Maker picks the format), or the named format is missing: take what exists.
                const options = sounds.byStem.get((SOUND_EXTS.includes(ext) ? stem(name) : name).toLowerCase()) ?? [];
                file = SOUND_EXTS.map((e) => options.find((o) => o.toLowerCase().endsWith(e))).find(Boolean);
            }
            const shown = file ?? name;
            const fileExt = SOUND_EXTS.includes(path.extname(shown).toLowerCase()) ? path.extname(shown).toLowerCase() : '';
            return { file: `${assetName(fileExt ? stem(shown) : shown) ?? 'unnamed'}${fileExt}`, found: Boolean(file) };
        },
    };
}

/** @brief Report of one run: the conversion problems plus animations that share a name. */
export type Report = ConvertReport & { duplicates: string[] };

/**
 * @brief Read and convert every animation of one `.rxdata` file.
 * @param file Path of `PkmnAnimations.rxdata`.
 * @param names Name lookup.
 * @param report Problems are added here.
 * @param skipped Names of entries that were left out are added here.
 * @return Output path (without `.json`) → animation, in file order.
 */
export function convertFile (file: string, names: NameResolver, report: Report, skipped: string[]): Map<string, BattleAnimation>
{
    const root = readMarshal(fs.readFileSync(file));
    const list = root instanceof RubyObject ? (Array.isArray(root.ivars.array) ? root.ivars.array : root.value) : root;
    if (!Array.isArray(list)) throw new Error(`${file} does not hold a list of animations`);
    const out = new Map<string, BattleAnimation>();
    const used = new Map<string, number>();
    // Essentials uses the last animation of a given name, so walk backwards: the last one gets the plain file name.
    for (let i = list.length - 1; i >= 0; i--)
    {
        const animation = list[i];
        if (!(animation instanceof RubyObject)) continue;
        const name = String(animation.ivars.name ?? '');
        const place = placeAnimation(name);
        if (!place)
        {
            skipped.push(name.trim() ? `#${i} ${name.trim()} (section divider)` : `#${i} (empty slot)`);
            continue;
        }
        const count = (used.get(place.path) ?? 0) + 1;
        used.set(place.path, count);
        const key = count === 1 ? place.path : `${place.path}_dup${count - 1}`;
        if (count > 1) report.duplicates.push(`${name.trim()} (#${i}) → ${key}.json (Essentials plays the last one, ${place.path}.json)`);
        out.set(key, convertAnimation(animation, place, names, report));
    }
    return new Map([...out].reverse());
}

/**
 * @brief Read the move IDs the engine knows (generated + custom PBS data).
 * @return Showdown move IDs, or `null` if there is no move data yet.
 */
function knownMoves (): Set<string> | null
{
    const ids = new Set<string>();
    for (const file of ['content/pbs/generated/moves.json', 'content/pbs/custom/moves.json'])
    {
        const full = path.join(ROOT, file);
        if (!fs.existsSync(full)) continue;
        for (const id of Object.keys(JSON.parse(fs.readFileSync(full, 'utf8')) as object)) if (!id.startsWith('$')) ids.add(id);
    }
    return ids.size ? ids : null;
}

/** @brief Run the CLI. */
function main (): void
{
    const { values: args } = parseArgs({
        options: {
            'pack': { type: 'string', multiple: true, default: [] },
            'file': { type: 'string', multiple: true, default: [] },
            'out': { type: 'string', default: ANIMATIONS_DIR },
            'dry-run': { type: 'boolean', default: false },
            'force': { type: 'boolean', default: false },
            'verbose': { type: 'boolean', short: 'v', default: false },
            'help': { type: 'boolean', short: 'h', default: false },
        },
    });
    if (args.help || (!args.pack.length && !args.file.length))
    {
        console.log([
            'Usage: npm run animations:import -- --pack <Essentials project or animation pack> [options]',
            '',
            `  --pack <dir>    Pack folder (reads ${RXDATA}; its ${GRAPHICS_DIR} and ${SOUNDS_DIR}`,
            '                  are used to name sheets and sounds). Repeat to layer packs; later ones win.',
            '  --file <path>   An .rxdata file to read instead of / besides the packs\' own.',
            '  --out <dir>     Output folder (default content/animations).',
            '  --dry-run       Show what would happen; write nothing.',
            '  --force         Also overwrite files edited by hand since the last import.',
            '  -v, --verbose   Print every report line.',
        ].join('\n'));
        process.exit(args.help ? 0 : 1);
    }

    const started = Date.now();
    const packs = args.pack.map((pack) => path.resolve(pack));
    for (const pack of packs)
    {
        if (!fs.existsSync(pack) || !fs.statSync(pack).isDirectory())
        {
            console.error(`✗ ${pack} is not a folder. Extract the pack first and pass the folder that contains "Data" and "Graphics".`);
            process.exit(1);
        }
    }
    const files: string[] = [];
    for (const pack of packs)
    {
        const dataDir = findDir(pack, 'Data');
        const found = dataDir && fs.readdirSync(dataDir).find((name) => name.toLowerCase() === 'pkmnanimations.rxdata');
        if (found) files.push(path.join(dataDir, found));
        else if (!args.file.length) console.warn(`• ${pack} has no ${RXDATA}; only its sheets and sounds are used for names.`);
    }
    files.push(...args.file.map((file) => path.resolve(file)));
    if (!files.length)
    {
        console.error(`✗ No ${RXDATA} found. Pass --file <path> to point at it.`);
        process.exit(1);
    }

    // ---- convert ---------------------------------------------------------------
    const names = packResolver(packs);
    const report: Report = { missingGraphics: [], missingSounds: [], unknownMoves: [], duplicates: [] };
    const skipped: string[] = [];
    const animations = new Map<string, BattleAnimation>();
    for (const file of files)
    {
        try
        {
            for (const [key, animation] of convertFile(file, names, report, skipped)) animations.set(key, animation);
        }
        catch (error)
        {
            console.error(`✗ ${file}: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        }
    }
    const moves = knownMoves();
    if (moves)
    {
        for (const animation of animations.values())
        {
            if (animation.kind === 'move' && animation.id && !moves.has(animation.id)) report.unknownMoves.push(`${animation.name} → ${animation.id}`);
        }
    }

    // ---- write -------------------------------------------------------------------
    const outDir = path.resolve(args.out);
    const schema = (key: string) => path.relative(path.dirname(path.join(outDir, key)), path.join(outDir, 'schema.json')).split(path.sep).join('/');
    const stateKey = (key: string) => path.relative(ROOT, path.join(outDir, `${key}.json`)).split(path.sep).join('/');
    const state: Record<string, string> = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Record<string, string> : {};
    const counts = { written: 0, unchanged: 0, removed: 0 };
    const edited: string[] = [];
    const ours = new Set<string>();
    for (const [key, animation] of animations)
    {
        const target = path.join(outDir, `${key}.json`);
        const text = formatAnimation(animation, schema(key));
        const id = stateKey(key);
        ours.add(id);
        const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
        if (current === text)
        {
            counts.unchanged++;
            if (!args['dry-run']) state[id] = hash(text);
            continue;
        }
        // Changed since we wrote it (or written by someone else): keep it unless forced.
        if (current !== null && !args.force && state[id] !== hash(current))
        {
            edited.push(path.relative(ROOT, target));
            continue;
        }
        counts.written++;
        if (args['dry-run']) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text);
        state[id] = hash(text);
    }
    // Files from an earlier import that this one no longer makes, if untouched.
    for (const [id, written] of Object.entries(state))
    {
        if (ours.has(id) || !id.startsWith(`${path.relative(ROOT, outDir).split(path.sep).join('/')}/`)) continue;
        const target = path.join(ROOT, id);
        const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
        if (current !== null && hash(current) !== written && !args.force) continue;
        counts.removed++;
        if (args['dry-run']) continue;
        fs.rmSync(target, { force: true });
        delete state[id];
        const dir = path.dirname(target);
        if (fs.existsSync(dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
    }
    if (!args['dry-run'])
    {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
    }

    // ---- report ------------------------------------------------------------------
    const byKind = new Map<string, number>();
    for (const animation of animations.values()) byKind.set(animation.kind, (byKind.get(animation.kind) ?? 0) + 1);
    const shown = path.relative(process.cwd(), outDir) || '.';
    console.log(`${args['dry-run'] ? 'Plan' : 'Animations'}: ${animations.size} → ${shown} (${[...byKind].map(([k, n]) => `${k} ${n}`).join(', ')})`);
    console.log(`  ${counts.written} ${args['dry-run'] ? 'to write' : 'written'}, ${counts.unchanged} unchanged, ${counts.removed} stale ${args['dry-run'] ? 'to remove' : 'removed'}`);
    const sections: [string, string[]][] = [
        ['Edited by hand since the last import: kept (use --force to overwrite)', edited],
        ['Sounds not in the packs\' Audio/SE/Anim (the reference is kept; add the file to sound/se/anim)', [...new Set(report.missingSounds)].sort()],
        ['Sheets not in the packs\' Graphics/Animations', [...new Set(report.missingGraphics)].sort()],
        ['Moves not in content/pbs (file written anyway)', report.unknownMoves.sort()],
        ['Same name as a later animation: kept under another file name', report.duplicates.reverse()],
        ['Empty slots and section dividers: skipped', skipped.reverse()],
    ];
    for (const [title, lines] of sections)
    {
        if (!lines.length) continue;
        console.log(`• ${title}: ${lines.length}`);
        const limit = args.verbose ? lines.length : 5;
        for (const line of lines.slice(0, limit)) console.log(`    ${line}`);
        if (lines.length > limit) console.log(`    … ${lines.length - limit} more (use --verbose)`);
    }
    console.log(`\n✓ Done in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
