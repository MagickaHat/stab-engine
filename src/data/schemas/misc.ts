/**
 * @file misc.ts
 * @brief Schemas for the smaller Showdown tables: abilities, items, natures,
 *        type chart and learnsets.
 */
import { z } from 'zod';
import { Gen, Nonstandard, TypeName, table } from './common.ts';

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

/**
 * @brief One ability entry (`abilities.json`).
 *
 * Showdown abilities are almost entirely code; the JSON holds identity data.
 * `rating` (−1…5) is used by Showdown's random battles/AI.
 */
export const AbilityData = z.looseObject({
    num: z.number().int(),
    name: z.string().min(1),
    rating: z.number().min(-1).max(5).optional(),
    flags: z.record(z.string(), z.literal(1)).optional(),
    gen: Gen.optional(),
    isNonstandard: Nonstandard.optional(),
});
export const AbilitiesTable = table(AbilityData);

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * @brief One item entry (`items.json`), Showdown fields only.
 *
 * Shop price, bag pocket and similar are in `item_info.json`.
 */
export const ItemData = z.looseObject({
    num: z.number().int(),
    name: z.string().min(1),
    fling: z.object({ basePower: z.number().int().min(0), status: z.string().optional(), volatileStatus: z.string().optional() }).optional(),
    isBerry: z.boolean().optional(),
    naturalGift: z.object({ basePower: z.number().int().min(0), type: TypeName }).optional(),
    megaStone: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
    megaEvolves: z.union([z.string(), z.array(z.string())]).optional(),
    onPlate: TypeName.optional(),
    onMemory: TypeName.optional(),
    onDrive: TypeName.optional(),
    zMove: z.union([z.string(), z.literal(true)]).optional(),
    zMoveType: TypeName.optional(),
    itemUser: z.array(z.string()).optional(),
    isPokeball: z.boolean().optional(),
    isGem: z.boolean().optional(),
    gen: Gen.optional(),
    isNonstandard: Nonstandard.optional(),
});
export const ItemsTable = table(ItemData);

// ---------------------------------------------------------------------------
// Natures
// ---------------------------------------------------------------------------

/** @brief A stat a nature can raise or lower. */
const NatureStat = z.enum(['atk', 'def', 'spa', 'spd', 'spe']);

/** @brief One nature (`natures.json`). Neutral natures have no `plus`/`minus`. */
export const NatureData = z.looseObject({
    name: z.string().min(1),
    plus: NatureStat.optional(),
    minus: NatureStat.optional(),
});
export const NaturesTable = table(NatureData);

// ---------------------------------------------------------------------------
// Type chart
// ---------------------------------------------------------------------------

/**
 * @brief One defending type (`typechart.json`).
 *
 * `damageTaken[attackingType]`: 0 = normal, 1 = super effective,
 * 2 = not very effective, 3 = immune. This is Showdown's encoding.
 * Showdown also stores non-type immunities here (e.g. `"sandstorm": 3`);
 * any key is accepted.
 */
export const TypeData = z.looseObject({
    name: TypeName.optional(),
    damageTaken: z.record(z.string(), z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])),
    HPivs: z.record(z.string(), z.number()).optional(),
    HPdvs: z.record(z.string(), z.number()).optional(),
    isNonstandard: Nonstandard.optional(),
});
export const TypeChartTable = table(TypeData);

// ---------------------------------------------------------------------------
// Learnsets
// ---------------------------------------------------------------------------

/**
 * @brief A Showdown learn source, `<gen><method>[<detail>]`:
 * `9L15` (level 15 in gen 9), `8M` (TM/TR), `7T` (tutor), `6E` (egg),
 * `5S0` (event #0), `4D` (dream world), `7V` (virtual console), `8R` (restricted).
 */
export const MoveSource = z.string().regex(/^\d+[LMTESDVRC]\d*$/, 'Learn source must look like "9L15", "8M", "7E"…');

/** @brief Learnset of one species (`learnsets.json`): move ID → sources. */
export const LearnsetData = z.looseObject({
    learnset: z.record(z.string(), z.array(MoveSource)).optional(),
});
export const LearnsetsTable = table(LearnsetData);

export type AbilityData = z.infer<typeof AbilityData>;
export type ItemData = z.infer<typeof ItemData>;
export type NatureData = z.infer<typeof NatureData>;
export type TypeData = z.infer<typeof TypeData>;
export type LearnsetData = z.infer<typeof LearnsetData>;
export type AbilitiesTable = z.infer<typeof AbilitiesTable>;
export type ItemsTable = z.infer<typeof ItemsTable>;
export type NaturesTable = z.infer<typeof NaturesTable>;
export type TypeChartTable = z.infer<typeof TypeChartTable>;
export type LearnsetsTable = z.infer<typeof LearnsetsTable>;
