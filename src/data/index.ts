/**
 * @file index.ts
 * @brief Public entry point of the game-data (PBS) system.
 *
 * Import from here in scenes: `import { loadPbs, registerStabMod } from '../../data';`
 * See docs/DATA_PIPELINE.md.
 */
export { loadPbs, loadGeneratedText, registerStabMod } from './loader.ts';
export type { LoadOptions } from './loader.ts';
export { buildModData, registerMod, defaultFormats } from './showdown.ts';
export type { RawTables, ShowdownModOptions } from './showdown.ts';
export { mergePatch, mergeTable } from './merge.ts';
export { checkData, toID } from './integrity.ts';
export type { CheckResult } from './integrity.ts';
export { TABLES, TABLE_NAMES, LOCALE_CATEGORIES } from './tables.ts';
export type { PbsData, TableName, LocaleCategory } from './tables.ts';
export { LOCALES, textKey } from './i18n.ts';
export type { Locale, TextField } from './i18n.ts';
export type { SpeciesData, PokedexTable } from './schemas/pokedex.ts';
export type { MoveData, MovesTable } from './schemas/moves.ts';
export type { AbilityData, ItemData, NatureData, TypeData, LearnsetData } from './schemas/misc.ts';
export type { SpeciesInfo, ItemInfo, ItemPocket, EvolutionMethod } from './schemas/engine.ts';
