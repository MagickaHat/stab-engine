/**
 * @file compare.ts
 * @brief CLI: compares the PBS data with Pokémon Showdown's own data (`@pkmn/sim`).
 *
 * Useful after an import (to spot conversion problems) and to see exactly
 * where your custom data differs from the official games.
 *
 * @code
 * npm run pbs:compare                 # generated + custom vs Showdown
 * npm run pbs:compare -- --generated  # generated only
 * npm run pbs:compare -- --verbose    # list every difference
 * @endcode
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Dex } from '@pkmn/sim';
import { mergeTables, readCustomLayers, readTables } from './io.ts';
import { ROOT } from '../pokeapi/config.ts';

const { values: args } = parseArgs({
    options: {
        generated: { type: 'boolean', default: false },
        verbose: { type: 'boolean', short: 'v', default: false },
    },
});

const generated = readTables(path.join(ROOT, 'content/pbs/generated'));
const data = args.generated ? generated : mergeTables(generated, readCustomLayers(path.join(ROOT, 'content/pbs/custom')));

/** @brief Differences per table and field. */
const diffs = new Map<string, string[]>();
let missing = 0;
let compared = 0;

/**
 * @brief Record a difference if two values differ (compared as JSON).
 * @param table Table name.
 * @param id Entry ID.
 * @param field Field name.
 * @param ours Our value.
 * @param theirs Showdown's value.
 */
function check (table: string, id: string, field: string, ours: unknown, theirs: unknown): void
{
    const a = JSON.stringify(ours ?? null);
    const b = JSON.stringify(theirs ?? null);
    if (a === b) return;
    const key = `${table}.${field}`;
    const list = diffs.get(key) ?? [];
    list.push(`${id}: ours ${a} / showdown ${b}`);
    diffs.set(key, list);
}

/**
 * @brief Sort object keys so key order does not count as a difference.
 * @param value Object.
 * @return Same data with sorted keys.
 */
function sorted (value: unknown): unknown
{
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

for (const [id, ours] of Object.entries(data.pokedex ?? {}) as [string, Record<string, unknown>][])
{
    const sd = Dex.species.get(id);
    if (!sd.exists || sd.id !== id) { missing++; continue; }
    compared++;
    check('pokedex', id, 'types', ours.types, sd.types);
    check('pokedex', id, 'baseStats', ours.baseStats, sd.baseStats);
    check('pokedex', id, 'abilities', sorted(ours.abilities), sorted(Object.fromEntries(Object.entries(sd.abilities).filter(([k]) => k !== 'S'))));
    check('pokedex', id, 'weightkg', ours.weightkg, sd.weightkg);
    check('pokedex', id, 'prevo', ours.prevo ?? '', sd.prevo);
}

for (const [id, ours] of Object.entries(data.moves ?? {}) as [string, Record<string, unknown>][])
{
    const sd = Dex.moves.get(id);
    if (!sd.exists || sd.id !== id) { missing++; continue; }
    compared++;
    for (const field of ['type', 'category', 'basePower', 'accuracy', 'pp', 'priority', 'target'] as const)
    {
        check('moves', id, field, ours[field], sd[field]);
    }
    check('moves', id, 'status', ours.status, sd.status);
    check('moves', id, 'drain', ours.drain, sd.drain);
    check('moves', id, 'recoil', ours.recoil, sd.recoil);
    check('moves', id, 'secondary.chance', (ours.secondary as { chance?: number } | null)?.chance, sd.secondary?.chance);
}

for (const [id, ours] of Object.entries(data.typechart ?? {}) as [string, Record<string, Record<string, number>>][])
{
    const sd = Dex.types.get(id);
    if (!sd.exists) { missing++; continue; }
    compared++;
    for (const [attacker, code] of Object.entries(ours.damageTaken)) check('typechart', id, attacker, code, sd.damageTaken[attacker]);
}

console.log(`Compared ${compared} entries with @pkmn/sim (${missing} not in Showdown).`);
if (!diffs.size) console.log('No differences.');
for (const [key, list] of [...diffs].sort(([, a], [, b]) => b.length - a.length))
{
    console.log(`\n${key}: ${list.length} difference(s)`);
    for (const line of list.slice(0, args.verbose ? Infinity : 5)) console.log(`  ${line}`);
    if (!args.verbose && list.length > 5) console.log(`  … (--verbose for all)`);
}
