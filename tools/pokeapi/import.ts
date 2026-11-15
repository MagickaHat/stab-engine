/**
 * @file import.ts
 * @brief CLI: imports PokeAPI's CSV dump into Showdown-format JSON in `content/pbs/generated`.
 *
 * @code
 * npm run pokeapi:import                          # latest PokeAPI master (cached)
 * npm run pokeapi:import -- --ref <commit-sha>    # a fixed PokeAPI version
 * npm run pokeapi:import -- --refresh             # ignore the download cache
 * npm run pokeapi:import -- --csv-dir ../pokeapi/data/v2/csv   # a local clone
 * @endcode
 *
 * Steps: download CSVs → convert each table → validate with Zod (and check
 * that custom overrides still apply cleanly) → write JSON + locale files +
 * `_meta.json` report. Nothing is written if validation fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkData } from '../../src/data/integrity.ts';
import { LOCALE_CATEGORIES, TABLES } from '../../src/data/tables.ts';
import type { TableName } from '../../src/data/tables.ts';
import { mergeTables, readCustomLayers, writeJson } from '../pbs/io.ts';
import type { Json } from '../../src/data/merge.ts';
import { CUSTOM_DIR, DEFAULT_REF, GENERATED_DIR, POKEAPI_REPO } from './config.ts';
import { ImportContext } from './context.ts';
import { CSV_TABLES, CsvLoader, resolveCommit } from './fetch.ts';
import { convertAbilities, convertNatures, convertTypeChart } from './convert/basic.ts';
import { convertItems } from './convert/items.ts';
import { convertLearnsets } from './convert/learnsets.ts';
import { convertMoves } from './convert/moves.ts';
import { convertSpecies } from './convert/species.ts';

const { values: args } = parseArgs({
    options: {
        'ref': { type: 'string', default: DEFAULT_REF },
        'csv-dir': { type: 'string' },
        'refresh': { type: 'boolean', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
    },
});

if (args.help)
{
    console.log('Usage: npm run pokeapi:import -- [--ref <git ref>] [--csv-dir <folder>] [--refresh]');
    process.exit(0);
}

const started = Date.now();
const ref = args.ref!;
console.log(args['csv-dir'] ? `Reading PokeAPI CSVs from ${args['csv-dir']}` : `Fetching PokeAPI CSVs (${POKEAPI_REPO}@${ref})…`);
// Download by commit SHA when possible, so the files, the cache folder and _meta.json all agree.
const commit = args['csv-dir'] ? null : await resolveCommit(ref);
if (!args['csv-dir'] && !commit) console.warn(`⚠ Could not resolve "${ref}" to a commit; downloading "${ref}" directly.`);
const csv = new CsvLoader({ ref: commit ?? ref, localDir: args['csv-dir'], refresh: args.refresh });
await csv.preload(CSV_TABLES);

const ctx = new ImportContext(csv);
console.log('Converting…');
const typechart = convertTypeChart(ctx);
const natures = convertNatures(ctx);
const abilities = convertAbilities(ctx);
const moves = convertMoves(ctx);
const { items, itemInfo } = convertItems(ctx);
const { pokedex, speciesInfo } = convertSpecies(ctx);
const learnsets = convertLearnsets(ctx);

const tables: Record<TableName, unknown> = { pokedex, moves, abilities, items, natures, typechart, learnsets, speciesInfo, itemInfo };

// ---- validate --------------------------------------------------------------
console.log('Validating…');
const generatedCheck = checkData(tables);
const mergedCheck = checkData(mergeTables(tables as Record<TableName, Record<string, Json>>, readCustomLayers(CUSTOM_DIR)));

if (generatedCheck.errors.length)
{
    console.error(`\n✗ Generated data failed validation (${generatedCheck.errors.length} errors). Nothing was written.`);
    for (const line of generatedCheck.errors.slice(0, 50)) console.error(`  ${line}`);
    process.exit(1);
}

// ---- write -----------------------------------------------------------------
for (const [name, data] of Object.entries(tables) as [TableName, unknown][])
{
    writeJson(path.join(GENERATED_DIR, TABLES[name].file), data);
}

const localeDir = path.join(GENERATED_DIR, 'locales');
fs.rmSync(localeDir, { recursive: true, force: true });
const localeCounts: Record<string, number> = {};
for (const category of LOCALE_CATEGORIES)
{
    for (const [locale, strings] of ctx.text.get(category) ?? [])
    {
        const sorted = Object.fromEntries([...strings].sort(([a], [b]) => a.localeCompare(b)));
        writeJson(path.join(localeDir, locale, `${category}.json`), sorted);
        localeCounts[locale] = (localeCounts[locale] ?? 0) + strings.size;
    }
}

const counts = Object.fromEntries(Object.entries(tables).map(([name, data]) => [name, Object.keys(data as object).length]));
writeJson(path.join(GENERATED_DIR, '_meta.json'), {
    $comment: 'Written by `npm run pokeapi:import`. Do not edit files in this folder; put changes in content/pbs/custom.',
    source: { repository: POKEAPI_REPO, ref, commit, csvDir: args['csv-dir'] ?? null },
    license: 'PokeAPI data is BSD-3-Clause (https://github.com/PokeAPI/pokeapi/blob/master/LICENSE.md)',
    counts,
    localeStrings: localeCounts,
    warnings: [...ctx.warnings, ...generatedCheck.warnings],
});

// ---- report ----------------------------------------------------------------
console.log(`\n✓ Imported in ${((Date.now() - started) / 1000).toFixed(1)}s → ${path.relative(process.cwd(), GENERATED_DIR)}`);
for (const [name, count] of Object.entries(counts)) console.log(`  ${name.padEnd(12)} ${count}`);
console.log(`  locales      ${Object.entries(localeCounts).map(([l, n]) => `${l}: ${n}`).join(', ')}`);
console.log(`  ${ctx.warnings.length + generatedCheck.warnings.length} warnings (see _meta.json)`);

if (mergedCheck.errors.length)
{
    console.warn(`\n⚠ Your custom overrides no longer validate against the new data (${mergedCheck.errors.length} errors):`);
    for (const line of mergedCheck.errors.slice(0, 30)) console.warn(`  ${line}`);
    process.exitCode = 1;
}
