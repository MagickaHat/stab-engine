/**
 * @file pokedex.ts
 * @brief Schema for `pokedex.json`: species in Showdown's `Pokedex` format.
 *
 * One entry per battle-distinct species/forme, keyed by ID (`charizardmegax`).
 * Only fields the battle simulator understands live here; engine-only data
 * (catch rate, EV yield, growth rate…) is in `species_info.json`.
 *
 * @code
 * "bulbasaur": {
 *   "num": 1, "name": "Bulbasaur", "types": ["Grass", "Poison"],
 *   "genderRatio": { "M": 0.875, "F": 0.125 },
 *   "baseStats": { "hp": 45, "atk": 49, "def": 49, "spa": 65, "spd": 65, "spe": 45 },
 *   "abilities": { "0": "Overgrow", "H": "Chlorophyll" },
 *   "heightm": 0.7, "weightkg": 6.9, "color": "Green",
 *   "evos": ["Ivysaur"], "eggGroups": ["Monster", "Grass"], "gen": 1
 * }
 * @endcode
 */
import { z } from 'zod';
import { Gen, Nonstandard, StatsTable, TypeName, table } from './common.ts';

/** @brief Ability slots: `0` (first), `1` (second), `H` (hidden), `S` (special). */
export const SpeciesAbilities = z.object({
    0: z.string().min(1),
    1: z.string().min(1).optional(),
    H: z.string().min(1).optional(),
    S: z.string().min(1).optional(),
});

/** @brief Showdown evolution method codes. */
export const EvoType = z.enum([
    'trade', 'useItem', 'levelMove', 'levelExtra', 'levelFriendship', 'levelHold', 'other',
]);

/** @brief One species entry. Unknown extra keys are allowed (and reported as warnings). */
export const SpeciesData = z.looseObject({
    /** National Dex number. Use negative numbers for fan-made species. */
    num: z.number().int(),
    /** Display name in Showdown style, e.g. `"Charizard-Mega-X"`. */
    name: z.string().min(1),
    /** Name of the base species, when this is a forme. */
    baseSpecies: z.string().optional(),
    /** Forme suffix, e.g. `"Mega-X"`. */
    forme: z.string().optional(),
    /** Forme name of the base forme (shown in UIs), e.g. `"Altered"` for Giratina. */
    baseForme: z.string().optional(),
    types: z.array(TypeName).min(1).max(3),
    /** Fixed gender: `M`, `F` or `N` (genderless). */
    gender: z.enum(['M', 'F', 'N']).optional(),
    /** Gender chances. Omitted means 50/50. */
    genderRatio: z.object({ M: z.number().min(0).max(1), F: z.number().min(0).max(1) }).optional(),
    baseStats: StatsTable,
    abilities: SpeciesAbilities,
    heightm: z.number().min(0),
    weightkg: z.number().min(0),
    color: z.string(),
    prevo: z.string().optional(),
    evos: z.array(z.string()).optional(),
    evoType: EvoType.optional(),
    evoLevel: z.number().int().min(1).optional(),
    evoItem: z.string().optional(),
    evoMove: z.string().optional(),
    /** English description of an unusual evolution condition (Showdown displays it). */
    evoCondition: z.string().optional(),
    eggGroups: z.array(z.string()).min(1),
    otherFormes: z.array(z.string()).optional(),
    cosmeticFormes: z.array(z.string()).optional(),
    formeOrder: z.array(z.string()).optional(),
    /** For in-battle formes (Megas, Zen Mode…): the forme(s) it reverts to. */
    battleOnly: z.union([z.string(), z.array(z.string())]).optional(),
    /** Item needed for this forme, e.g. a Mega Stone. */
    requiredItem: z.string().optional(),
    requiredItems: z.array(z.string()).optional(),
    requiredMove: z.string().optional(),
    requiredAbility: z.string().optional(),
    changesFrom: z.string().optional(),
    canGigantamax: z.string().optional(),
    tags: z.array(z.enum(['Mythical', 'Restricted Legendary', 'Sub-Legendary', 'Paradox', 'Ultra Beast'])).optional(),
    gen: Gen.optional(),
    isNonstandard: Nonstandard.optional(),
});

/** @brief The whole `pokedex.json` table. */
export const PokedexTable = table(SpeciesData);

export type SpeciesData = z.infer<typeof SpeciesData>;
export type PokedexTable = z.infer<typeof PokedexTable>;
