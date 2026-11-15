/**
 * @file validate.ts
 * @brief CLI: validates `content/pbs` (generated data, custom overrides and
 *        the merged result) with the Zod schemas in `src/data/schemas`.
 *
 * @code
 * npm run pbs:validate
 * npm run pbs:validate -- --strict   # also fail on warnings (e.g. for CI)
 * @endcode
 *
 * Exit code 1 if anything is invalid.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { checkData } from '../../src/data/integrity.ts';
import { TABLES, TABLE_NAMES } from '../../src/data/tables.ts';
import { CUSTOM_DIR, GENERATED_DIR } from '../pokeapi/config.ts';
import { mergeTables, readCustomLayers, readTables } from './io.ts';

const { values: args } = parseArgs({
    options: { strict: { type: 'boolean', default: false } },
});

let generated, layers;
try
{
    generated = readTables(GENERATED_DIR);
    layers = readCustomLayers(CUSTOM_DIR);
}
catch (error)
{
    console.error(`✗ ${(error as Error).message}`);
    process.exit(1);
}

const missing = TABLE_NAMES.filter((name) => !generated[name]);
if (missing.length)
{
    console.warn(`⚠ No generated data for: ${missing.map((n) => TABLES[n].file).join(', ')}. Run \`npm run pokeapi:import\`.`);
}

const customCount = layers.flatMap((l) => Object.values(l.tables)).reduce((n, t) => n + Object.keys(t).filter((k) => !k.startsWith('$')).length, 0);
const packs = layers.map((l) => l.pack).filter(Boolean);
console.log(`Validating ${path.relative(process.cwd(), GENERATED_DIR)} + ${customCount} custom entr${customCount === 1 ? 'y' : 'ies'} from ${path.relative(process.cwd(), CUSTOM_DIR)}` +
    `${packs.length ? ` (packs: ${packs.join(', ')})` : ''}…`);

const result = checkData(mergeTables(generated, layers));

for (const warning of result.warnings) console.warn(`  ⚠ ${warning}`);
for (const error of result.errors) console.error(`  ✗ ${error}`);

if (result.errors.length || (args.strict && result.warnings.length))
{
    console.error(`\n✗ ${result.errors.length} error(s), ${result.warnings.length} warning(s).`);
    process.exit(1);
}
console.log(`✓ Valid (${result.warnings.length} warning(s)).`);
