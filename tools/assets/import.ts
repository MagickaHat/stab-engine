/**
 * @file import.ts
 * @brief CLI: imports sprites, icons and cries from a Pokémon Essentials
 *        resource pack into `public/assets`, renamed to Showdown IDs and
 *        resized to the engine's 1× pixel scale.
 *
 * @code
 * npm run assets:import -- --pack ~/packs/Generation_9_Pack            # import everything
 * npm run assets:import -- --pack <dir> --dry-run                      # show the plan, write nothing
 * npm run assets:import -- --pack <dir> --only front,back,item,cry     # some kinds only
 * npm run assets:import -- --pack <dir> --pack <dir2>                  # layer packs (later wins)
 * npm run assets:import -- --pack <dir> --force                        # convert unchanged files again
 * npm run assets:import -- --manifest-only                             # just rebuild manifest.json
 * @endcode
 *
 * Steps: list the pack → resolve names against `content/pbs` → convert files
 * that are new or changed (in parallel) → remove outputs whose source is gone
 * → write `manifest.json`, the credits file and a report.
 *
 * Output layout (one folder per species, like pokeemerald-expansion):
 * @code
 * public/assets/pokemon/charizard/front.png          96×96
 * public/assets/pokemon/charizard/back_shiny.png     96×96
 * public/assets/pokemon/charizard/megax/front.png    formes are sub-folders
 * public/assets/pokemon/unfezant/frontf.png          female gender difference
 * public/assets/items/charizarditex.png              24×24
 * @endcode
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ASSETS_DIR, CACHE_DIR, PACKS, PBS_DIR, PIPELINE_VERSION, ROOT } from './config.ts';
import type { Job } from './convert.ts';
import { readFormNames } from './essentials.ts';
import type { ImageNote } from './image.ts';
import { writeManifest } from './manifest.ts';
import { planPack } from './plan.ts';
import type { PlanReport, PlannedFile } from './plan.ts';
import { runJobs } from './pool.ts';
import { loadDexIndex } from './resolve.ts';

/** @brief What the importer remembers about one output file. */
interface Remembered
{
    /** Fingerprint of the source file and the conversion settings. */
    sig: string;
    notes: ImageNote[];
}

/** @brief Importer memory: pack folder → output path → details. Lets later runs skip unchanged files. */
type State = Record<string, Record<string, Remembered>>;

const { values: args } = parseArgs({
    options: {
        'pack': { type: 'string', multiple: true },
        'format': { type: 'string', default: 'gen9' },
        'out': { type: 'string', default: ASSETS_DIR },
        'only': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'force': { type: 'boolean', default: false },
        'manifest-only': { type: 'boolean', default: false },
        'jobs': { type: 'string', default: '0' },
        'verbose': { type: 'boolean', short: 'v', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
    },
});

if (args.help || (!args.pack?.length && !args['manifest-only']))
{
    console.log([
        'Usage: npm run assets:import -- --pack <extracted pack folder> [options]',
        '',
        '  --pack <dir>       Pack to import. Repeat to layer packs; later ones win.',
        `  --format <name>    Pack layout: ${Object.keys(PACKS).join(', ')} (default gen9).`,
        '  --only <kinds>     Comma-separated kinds, e.g. front,back,icon,overworld,footprint,cry,item.',
        '  --out <dir>        Output folder (default public/assets).',
        '  --dry-run          Show what would happen; write nothing.',
        '  --force            Convert files again even if unchanged.',
        '  --manifest-only    Only rebuild manifest.json from the output folder.',
        '  --jobs <n>         Worker threads (default: one per CPU core).',
        '  -v, --verbose      Print every report line instead of the first few.',
    ].join('\n'));
    process.exit(args.help ? 0 : 1);
}

const started = Date.now();
const outDir = path.resolve(args.out!);
const shown = (file: string) => path.relative(process.cwd(), file) || '.';

if (args['manifest-only'])
{
    const manifest = writeManifest(outDir);
    console.log(`✓ ${shown(path.join(outDir, 'manifest.json'))}: ${Object.keys(manifest.pokemon).length} species, ${Object.keys(manifest.items).length} items`);
    process.exit(0);
}

const pack = PACKS[args.format!];
if (!pack)
{
    console.error(`✗ Unknown --format "${args.format}". Known: ${Object.keys(PACKS).join(', ')}`);
    process.exit(1);
}
const kinds = new Set(pack.rules.map((rule) => rule.kind));
const only = args.only ? new Set(args.only.split(',').map((kind) => kind.trim()).filter(Boolean)) : undefined;
for (const kind of only ?? [])
{
    if (!kinds.has(kind))
    {
        console.error(`✗ Unknown kind "${kind}" in --only. Known: ${[...kinds].join(', ')}`);
        process.exit(1);
    }
}

// ---- plan ------------------------------------------------------------------
const dex = loadDexIndex(PBS_DIR);
if (!Object.keys(dex.species).length)
{
    console.error('✗ content/pbs has no pokedex. Run `npm run pokeapi:import` first; it provides the Showdown IDs.');
    process.exit(1);
}

const stateFile = path.join(CACHE_DIR, `state-${crypto.createHash('sha1').update(outDir).digest('hex').slice(0, 10)}.json`);
const state: State = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) as State : {};
const planned = new Map<string, PlannedFile & { packDir: string; sig: string }>();
const reports: { packDir: string; report: PlanReport }[] = [];
let overridden = 0;

// Form names from every pack are shared, so an add-on pack without PBS files resolves like the main one.
const formNames = new Map<string, string>();
for (const given of args.pack!)
{
    if (fs.existsSync(given) && fs.statSync(given).isDirectory()) readFormNames(path.resolve(given), formNames);
}

for (const given of args.pack!)
{
    const packDir = path.resolve(given);
    if (!fs.existsSync(packDir) || !fs.statSync(packDir).isDirectory())
    {
        console.error(`✗ ${given} is not a folder. Extract the pack archive first and pass the folder that contains "Graphics".`);
        process.exit(1);
    }
    const { files, report } = planPack(packDir, pack, dex, formNames, only);
    if (!files.length)
    {
        console.error(`✗ Nothing to import from ${given}. Expected folders such as "${pack.rules[0].dir}" directly inside it.`);
        process.exit(1);
    }
    for (const file of files)
    {
        const stat = fs.statSync(file.src);
        const sig = [PIPELINE_VERSION, file.srcRel, stat.size, Math.round(stat.mtimeMs), JSON.stringify(file.image)].join('|');
        if (planned.has(file.dest)) overridden++;
        planned.set(file.dest, { ...file, packDir, sig });
    }
    reports.push({ packDir, report });
}

// ---- decide what needs doing -------------------------------------------------
const jobs: (Job & { key: string; packDir: string; sig: string })[] = [];
for (const [dest, file] of planned)
{
    const target = path.join(outDir, dest);
    const upToDate = !args.force && state[file.packDir]?.[dest]?.sig === file.sig && fs.existsSync(target);
    if (!upToDate) jobs.push({ src: file.src, dest: target, image: file.image, key: dest, packDir: file.packDir, sig: file.sig });
}

// Outputs this importer made earlier from these packs whose source is gone or renamed.
const stale: string[] = [];
if (!only)
{
    for (const { packDir } of reports)
    {
        for (const dest of Object.keys(state[packDir] ?? {}))
        {
            const owner = planned.get(dest);
            if (owner?.packDir === packDir) continue;
            const stillOwned = owner || Object.entries(state).some(([other, outputs]) => other !== packDir && dest in outputs);
            if (!stillOwned) stale.push(dest);
            if (!args['dry-run']) delete state[packDir][dest];
        }
    }
}

const byKind = new Map<string, number>();
for (const file of planned.values()) byKind.set(file.kind, (byKind.get(file.kind) ?? 0) + 1);
console.log(`${args['dry-run'] ? 'Plan' : 'Importing'}: ${planned.size} files → ${shown(outDir)}`);
console.log(`  ${[...byKind].map(([kind, count]) => `${kind} ${count}`).join(', ')}`);
console.log(`  ${jobs.length} to convert, ${planned.size - jobs.length} unchanged, ${stale.length} stale to remove${overridden ? `, ${overridden} replaced by a later pack` : ''}`);

// ---- convert -----------------------------------------------------------------
const errors: string[] = [];
if (!args['dry-run'])
{
    const byDest = new Map(jobs.map((job) => [job.dest, job]));
    const tty = process.stdout.isTTY;
    const results = await runJobs(jobs, Number(args.jobs) || 0, (done) =>
    {
        if (tty) process.stdout.write(`\r  converting ${done}/${jobs.length}`);
    });
    if (tty && jobs.length) process.stdout.write('\n');
    for (const result of results)
    {
        const job = byDest.get(result.dest)!;
        if (result.error)
        {
            errors.push(`${path.relative(job.packDir, job.src)}: ${result.error}`);
            continue;
        }
        (state[job.packDir] ??= {})[job.key] = { sig: job.sig, notes: result.notes };
    }

    for (const dest of stale)
    {
        const target = path.join(outDir, dest);
        fs.rmSync(target, { force: true });
        // Remove the forme/species folder if that left it empty.
        for (let dir = path.dirname(target); dir.startsWith(outDir + path.sep); dir = path.dirname(dir))
        {
            if (!fs.existsSync(dir) || fs.readdirSync(dir).length) break;
            fs.rmdirSync(dir);
        }
    }

    for (const { packDir } of reports)
    {
        const credits = pack.credits ? path.join(packDir, pack.credits) : null;
        if (credits && fs.existsSync(credits))
        {
            fs.mkdirSync(path.join(outDir, 'credits'), { recursive: true });
            fs.copyFileSync(credits, path.join(outDir, 'credits', `${path.basename(packDir).replace(/[^\w.-]+/g, '_')}.txt`));
        }
    }

    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state));
    writeManifest(outDir);
}

// ---- report ------------------------------------------------------------------
const noted: Record<ImageNote, string[]> = { 'resampled': [], 'padded': [], 'oversize': [], 'odd-size': [] };
for (const [dest, file] of planned)
{
    for (const note of state[file.packDir]?.[dest]?.notes ?? []) noted[note].push(`${dest} (from ${file.srcRel})`);
}
const sections: [title: string, lines: string[]][] = [
    ['Could not be converted', errors],
    ['Forms with no known name (imported as form<N>; add an alias in tools/assets/packs to name them)', reports.flatMap((r) => r.report.unresolved)],
    ['Species not in content/pbs', reports.flatMap((r) => r.report.unknownSpecies)],
    ['Items not in content/pbs (imported under the ID shown)', reports.flatMap((r) => r.report.unknownItems)],
    ['Not a clean upscale: reduced by dropping pixels, may look rough', noted.resampled],
    ['Smaller than the canvas: placed bottom-centre with padding', noted.padded],
    ['Larger than the canvas even at 1×: left at reduced size', noted.oversize],
    ['Size not divisible by the pack scale: left unchanged', noted['odd-size']],
    ['Same destination as another file: not imported', reports.flatMap((r) => r.report.duplicates)],
    ['File names not understood: skipped', reports.flatMap((r) => r.report.skipped)],
    ['Pack folders not found', reports.flatMap((r) => r.report.missingDirs)],
    ['Stale outputs removed', stale],
];

console.log('');
for (const section of sections)
{
    // Layered packs often report the same line twice.
    section[1] = [...new Set(section[1])];
    const [title, lines] = section;
    if (!lines.length) continue;
    console.log(`${title === sections[0][0] ? '✗' : '•'} ${title}: ${lines.length}`);
    const limit = args.verbose ? lines.length : 5;
    for (const line of lines.slice(0, limit)) console.log(`    ${line}`);
    if (lines.length > limit) console.log(`    … ${lines.length - limit} more (use --verbose, or see the report file)`);
}

if (!args['dry-run'])
{
    const reportFile = path.join(CACHE_DIR, 'report.json');
    fs.writeFileSync(reportFile, `${JSON.stringify({
        packs: reports.map((r) => r.packDir),
        output: path.relative(ROOT, outDir),
        files: planned.size,
        converted: jobs.length - errors.length,
        ...Object.fromEntries(sections.map(([title, lines]) => [title, lines])),
    }, null, 4)}\n`);
    console.log(`\n${errors.length ? '⚠' : '✓'} Done in ${((Date.now() - started) / 1000).toFixed(1)}s. Full report: ${shown(reportFile)}`);
}
if (errors.length) process.exitCode = 1;
