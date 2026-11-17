/**
 * @file engine.ts
 * @brief Schemas for engine-only tables Showdown has no place for:
 *        `species_info.json`, `item_info.json` and the locale string files.
 *
 * These are keyed by the same IDs as `pokedex.json` / `items.json` and are
 * never passed to the battle simulator.
 */
import { z } from 'zod';
import { STAT_IDS, table } from './common.ts';

/** @brief Experience growth curves (names from PokeAPI / the main series). */
export const GrowthRate = z.enum([
    'slow', 'medium', 'fast', 'medium-slow', 'slow-then-very-fast', 'fast-then-very-slow',
]);

/**
 * @brief One way a species evolves. Several entries mean several methods.
 *
 * Structured version of Showdown's `evoType`/`evoCondition` text, so the
 * overworld can actually check the conditions.
 */
export const EvolutionMethod = z.looseObject({
    /** ID of the species/forme evolved into. */
    into: z.string(),
    /** `level-up`, `trade`, `use-item`, `shed`, `spin`, `three-critical-hits`… */
    trigger: z.string(),
    minLevel: z.number().int().optional(),
    /** Item ID used on the Pokémon. */
    item: z.string().optional(),
    /** Item ID it must hold. */
    heldItem: z.string().optional(),
    gender: z.enum(['M', 'F']).optional(),
    /** PokeAPI location identifier. */
    location: z.string().optional(),
    timeOfDay: z.enum(['day', 'night', 'dusk', 'full-moon']).optional(),
    /** Move ID it must know. */
    knownMove: z.string().optional(),
    /** Type of a move it must know. */
    knownMoveType: z.string().optional(),
    minHappiness: z.number().int().optional(),
    minBeauty: z.number().int().optional(),
    minAffection: z.number().int().optional(),
    /** −1: Atk < Def, 0: Atk = Def, 1: Atk > Def. */
    relativePhysicalStats: z.number().int().optional(),
    /** Species ID that must be in the party. */
    partySpecies: z.string().optional(),
    /** Type that must be in the party. */
    partyType: z.string().optional(),
    /** Species ID it must be traded for. */
    tradeSpecies: z.string().optional(),
    needsOverworldRain: z.boolean().optional(),
    turnUpsideDown: z.boolean().optional(),
    /** Move ID it must use (`usedMove` + `minMoveCount` times). */
    usedMove: z.string().optional(),
    minMoveCount: z.number().int().optional(),
    minSteps: z.number().int().optional(),
    minDamageTaken: z.number().int().optional(),
});

/** @brief Engine-only data for one species (`species_info.json`). */
export const SpeciesInfo = z.looseObject({
    /** 3 (hardest) … 255 (easiest). */
    catchRate: z.number().int().min(0).max(255),
    baseExp: z.number().int().min(0).nullable(),
    /** EVs gained for defeating it. */
    evYield: z.partialRecord(z.enum(STAT_IDS), z.number().int().min(0).max(3)),
    growthRate: GrowthRate,
    /** Egg cycles until hatching. */
    hatchCycles: z.number().int().min(0).nullable(),
    baseFriendship: z.number().int().min(0).max(255).nullable(),
    hasGenderDifferences: z.boolean(),
    isBaby: z.boolean(),
    isLegendary: z.boolean(),
    isMythical: z.boolean(),
    /** Body shape (Pokédex search). */
    shape: z.string().nullable().optional(),
    habitat: z.string().nullable().optional(),
    /** Whether the player can switch formes outside battle. */
    formsSwitchable: z.boolean().optional(),
    /** Sort order for Pokédex lists. */
    order: z.number().int().optional(),
    evolutions: z.array(EvolutionMethod).optional(),
});
export const SpeciesInfoTable = table(SpeciesInfo);

/** @brief Bag pockets. */
export const ItemPocket = z.enum(['misc', 'medicine', 'pokeballs', 'machines', 'berries', 'mail', 'battle', 'key']);

/** @brief Engine-only data for one item (`item_info.json`). */
export const ItemInfo = z.looseObject({
    /** Shop price. 0 = cannot be bought/sold. */
    price: z.number().int().min(0),
    pocket: ItemPocket,
    /** Finer category from PokeAPI, e.g. `standard-balls`, `healing`, `evolution`. */
    category: z.string(),
    /** `countable`, `consumable`, `usable-overworld`, `usable-in-battle`, `holdable`… */
    flags: z.array(z.string()),
    /** For TMs/TRs/HMs: the move ID taught (in the newest game the machine exists). */
    teaches: z.string().optional(),
});
export const ItemInfoTable = table(ItemInfo);

/**
 * @brief A locale string file: `key → text`.
 *
 * Keys look like `moves.thunderbolt.name` (see `src/data/i18n.ts`).
 */
export const LocaleTable = z.record(z.string().regex(/^[a-z_]+\.[a-z0-9]+\.[a-zA-Z]+$/), z.string());

export type SpeciesInfo = z.infer<typeof SpeciesInfo>;
export type ItemInfo = z.infer<typeof ItemInfo>;
export type ItemPocket = z.infer<typeof ItemPocket>;
export type EvolutionMethod = z.infer<typeof EvolutionMethod>;
export type SpeciesInfoTable = z.infer<typeof SpeciesInfoTable>;
export type ItemInfoTable = z.infer<typeof ItemInfoTable>;
export type LocaleTable = z.infer<typeof LocaleTable>;
