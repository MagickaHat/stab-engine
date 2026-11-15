/**
 * @file tables.ts
 * @brief The list of PBS data tables: file name, Zod schema and the matching
 *        Showdown data key.
 *
 * This is the single place to register a new table. The importer, the
 * validator, the JSON-schema generator, the runtime loader and the Showdown
 * bridge all read this list.
 */
import type { z } from 'zod';
import { PokedexTable } from './schemas/pokedex.ts';
import { MovesTable } from './schemas/moves.ts';
import { AbilitiesTable, ItemsTable, LearnsetsTable, NaturesTable, TypeChartTable } from './schemas/misc.ts';
import { ItemInfoTable, SpeciesInfoTable } from './schemas/engine.ts';

/** @brief Description of one table. */
export interface TableDef
{
    /** File name inside `content/pbs/generated` and `content/pbs/custom`. */
    file: string;
    /** Zod schema for the whole (merged) table. */
    schema: z.ZodType;
    /** Key in Showdown's `ModData`, or `null` for engine-only tables. */
    showdown: 'Pokedex' | 'Moves' | 'Abilities' | 'Items' | 'Natures' | 'TypeChart' | 'Learnsets' | null;
    /** Locale category that holds this table's text (`content/pbs/generated/locales/<locale>/<category>.json`). */
    locale?: string;
}

/** @brief Every table, keyed by its name in `PbsData`. */
export const TABLES = {
    pokedex: { file: 'pokedex.json', schema: PokedexTable, showdown: 'Pokedex', locale: 'pokemon' },
    moves: { file: 'moves.json', schema: MovesTable, showdown: 'Moves', locale: 'moves' },
    abilities: { file: 'abilities.json', schema: AbilitiesTable, showdown: 'Abilities', locale: 'abilities' },
    items: { file: 'items.json', schema: ItemsTable, showdown: 'Items', locale: 'items' },
    natures: { file: 'natures.json', schema: NaturesTable, showdown: 'Natures', locale: 'natures' },
    typechart: { file: 'typechart.json', schema: TypeChartTable, showdown: 'TypeChart', locale: 'types' },
    learnsets: { file: 'learnsets.json', schema: LearnsetsTable, showdown: 'Learnsets' },
    speciesInfo: { file: 'species_info.json', schema: SpeciesInfoTable, showdown: null },
    itemInfo: { file: 'item_info.json', schema: ItemInfoTable, showdown: null },
} as const satisfies Record<string, TableDef>;

/** @brief Name of a table, e.g. `'pokedex'`. */
export type TableName = keyof typeof TABLES;

/** @brief Every table name. */
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

/** @brief Fully typed data of every table. */
export type PbsData = { [K in TableName]: z.infer<(typeof TABLES)[K]['schema']> };

/**
 * @brief Locale categories the importer writes, and that a locale loader should read.
 * Matches the folder names already used in `content/locales/`.
 */
export const LOCALE_CATEGORIES = ['pokemon', 'moves', 'abilities', 'items', 'natures', 'types'] as const;
export type LocaleCategory = (typeof LOCALE_CATEGORIES)[number];
