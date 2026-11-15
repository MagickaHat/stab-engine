/**
 * @file integrity.ts
 * @brief Validation of a complete PBS data set: Zod schemas plus cross-table checks.
 *
 * Used by `npm run pbs:validate`, by the importer before writing, and by the
 * runtime loader in development builds.
 */
import { z } from 'zod';
import { TABLES, TABLE_NAMES } from './tables.ts';
import type { PbsData, TableName } from './tables.ts';

/**
 * @brief Convert a name to a Showdown ID, exactly like Showdown's `toID()`.
 * @param text Any name, e.g. `"Mr. Mime"`.
 * @return Lowercase alphanumeric ID, e.g. `"mrmime"`.
 */
export function toID (text: unknown): string
{
    return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** @brief Result of `checkData()`. */
export interface CheckResult
{
    /** Problems that make the data unusable (schema errors, broken references). */
    errors: string[];
    /** Suspicious but allowed things (unknown keys, probable typos). */
    warnings: string[];
    /** Parsed tables (only set for tables that passed their schema). */
    data: Partial<PbsData>;
}

/**
 * @brief Format a Zod error as readable lines.
 * @param table Table name, used as prefix.
 * @param error Zod error.
 * @param limit Maximum number of issues to list.
 * @return One line per issue, e.g. `pokedex › pikachu.baseStats.spe: Expected number`.
 */
export function formatZodError (table: string, error: z.ZodError, limit = 50): string[]
{
    const lines = error.issues.slice(0, limit).map((issue) =>
        `${table} › ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
    if (error.issues.length > limit) lines.push(`${table} › … and ${error.issues.length - limit} more`);
    return lines;
}

/**
 * @brief Known keys of a table's entry schema (for unknown-key warnings).
 * @param name Table name.
 * @return Set of keys, or `null` if the entry schema is not an object.
 */
function knownKeys (name: TableName): Set<string> | null
{
    const record = TABLES[name].schema as unknown as z.ZodRecord;
    const entry = record.def?.valueType as unknown as z.ZodObject | undefined;
    return entry?.shape ? new Set(Object.keys(entry.shape)) : null;
}

/**
 * @brief Validate a full data set.
 *
 * Checks each table against its schema, then that references between tables
 * resolve: species types/abilities/evolutions, move types, learnset species
 * and moves, item info/species info keys.
 *
 * @param raw Tables to check, keyed by table name. Missing tables are skipped.
 * @return Errors, warnings and the parsed data.
 */
export function checkData (raw: Partial<Record<TableName, unknown>>): CheckResult
{
    const errors: string[] = [];
    const warnings: string[] = [];
    const data: Partial<PbsData> = {};

    for (const name of TABLE_NAMES)
    {
        if (raw[name] === undefined) continue;
        const result = TABLES[name].schema.safeParse(raw[name]);
        if (!result.success)
        {
            errors.push(...formatZodError(name, result.error));
            continue;
        }
        (data as Record<string, unknown>)[name] = result.data;

        const keys = knownKeys(name);
        if (keys)
        {
            for (const [id, entry] of Object.entries(result.data as Record<string, object>))
            {
                for (const key of Object.keys(entry))
                {
                    if (!keys.has(key)) warnings.push(`${name} › ${id}: unknown field "${key}" (typo?)`);
                }
            }
        }
    }

    const ref = (table: string, id: string, what: string, target: Record<string, unknown> | undefined, value: string) =>
    {
        if (target && !(toID(value) in target)) errors.push(`${table} › ${id}: ${what} "${value}" does not exist`);
    };

    const { pokedex, moves, abilities, items, typechart, learnsets, speciesInfo, itemInfo } = data;

    if (pokedex)
    {
        for (const [id, s] of Object.entries(pokedex))
        {
            for (const type of s.types) ref('pokedex', id, 'type', typechart, type);
            for (const ability of Object.values(s.abilities)) ref('pokedex', id, 'ability', abilities, ability as string);
            for (const evo of s.evos ?? []) ref('pokedex', id, 'evo', pokedex, evo);
            if (s.prevo) ref('pokedex', id, 'prevo', pokedex, s.prevo);
            if (s.evoItem) ref('pokedex', id, 'evoItem', items, s.evoItem);
            if (s.evoMove) ref('pokedex', id, 'evoMove', moves, s.evoMove);
            if (s.requiredItem) ref('pokedex', id, 'requiredItem', items, s.requiredItem);
            if (s.baseSpecies) ref('pokedex', id, 'baseSpecies', pokedex, s.baseSpecies);
            if (toID(s.name) !== id && !s.cosmeticFormes)
            {
                warnings.push(`pokedex › ${id}: name "${s.name}" does not match its ID (expected toID(name) === ID)`);
            }
        }
    }
    if (moves)
    {
        for (const [id, m] of Object.entries(moves))
        {
            ref('moves', id, 'type', typechart, m.type);
            if (toID(m.name) !== id) warnings.push(`moves › ${id}: name "${m.name}" does not match its ID`);
        }
    }
    if (items)
    {
        for (const [id, item] of Object.entries(items))
        {
            if (item.naturalGift) ref('items', id, 'naturalGift.type', typechart, item.naturalGift.type);
        }
    }
    if (learnsets)
    {
        for (const [id, entry] of Object.entries(learnsets))
        {
            if (pokedex && !(id in pokedex)) errors.push(`learnsets › ${id}: species does not exist in pokedex`);
            for (const move of Object.keys(entry.learnset ?? {})) ref('learnsets', id, 'move', moves, move);
        }
    }
    if (speciesInfo && pokedex)
    {
        for (const [id, info] of Object.entries(speciesInfo))
        {
            if (!(id in pokedex)) errors.push(`species_info › ${id}: species does not exist in pokedex`);
            for (const evo of info.evolutions ?? []) ref('species_info', id, 'evolution target', pokedex, evo.into);
        }
    }
    if (itemInfo && items)
    {
        for (const [id, info] of Object.entries(itemInfo))
        {
            if (!(id in items)) errors.push(`item_info › ${id}: item does not exist in items`);
            if (info.teaches) ref('item_info', id, 'taught move', moves, info.teaches);
        }
    }

    return { errors, warnings, data };
}
