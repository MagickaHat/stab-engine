/**
 * @file moves.ts
 * @brief Schema for `moves.json`: moves in Showdown's `Moves` format.
 *
 * Only the JSON-expressible part of a Showdown move is stored. Behaviour that
 * needs code (e.g. `onHit` callbacks) comes from `@pkmn/sim` for official
 * moves, or from a Showdown mod you write for brand-new effects.
 *
 * @code
 * "thunderbolt": {
 *   "num": 85, "name": "Thunderbolt", "type": "Electric", "category": "Special",
 *   "basePower": 90, "accuracy": 100, "pp": 15, "priority": 0, "target": "normal",
 *   "flags": { "protect": 1, "mirror": 1 },
 *   "secondary": { "chance": 10, "status": "par" }
 * }
 * @endcode
 */
import { z } from 'zod';
import { BoostsTable, Fraction, Gen, Nonstandard, StatusID, TypeName, table } from './common.ts';

/** @brief Showdown move targets. */
export const MoveTarget = z.enum([
    'adjacentAlly', 'adjacentAllyOrSelf', 'adjacentFoe', 'all', 'allAdjacent', 'allAdjacentFoes',
    'allies', 'allySide', 'allyTeam', 'any', 'foeSide', 'normal', 'randomNormal', 'scripted', 'self',
]);

/** @brief Showdown move flags (value is always `1`). */
export const MoveFlag = z.enum([
    'allyanim', 'bypasssub', 'bite', 'bullet', 'cantusetwice', 'charge', 'contact', 'dance',
    'defrost', 'distance', 'failcopycat', 'failencore', 'failinstruct', 'failmefirst', 'failmimic',
    'futuremove', 'gravity', 'heal', 'metronome', 'mirror', 'mustpressure', 'noassist', 'nonsky',
    'noparentalbond', 'nosketch', 'nosleeptalk', 'pledgecombo', 'powder', 'protect', 'pulse',
    'punch', 'recharge', 'reflectable', 'slicing', 'snatch', 'sound', 'wind',
]);

/** @brief Effects applied to the user by a move or secondary effect. */
export const SelfEffect = z.looseObject({
    boosts: BoostsTable.optional(),
    volatileStatus: z.string().optional(),
    sideCondition: z.string().optional(),
    chance: z.number().optional(),
});

/** @brief A secondary (chance-based) effect. */
export const SecondaryEffect = z.looseObject({
    chance: z.number().min(1).max(100).optional(),
    status: StatusID.optional(),
    volatileStatus: z.string().optional(),
    boosts: BoostsTable.optional(),
    self: SelfEffect.optional(),
});

/** @brief One move entry. */
export const MoveData = z.looseObject({
    num: z.number().int(),
    name: z.string().min(1),
    type: TypeName,
    category: z.enum(['Physical', 'Special', 'Status']),
    basePower: z.number().int().min(0),
    /** A number (1-100), or `true` for moves that never miss. */
    accuracy: z.union([z.literal(true), z.number().int().min(1).max(100)]),
    pp: z.number().int().min(1),
    priority: z.number().int().min(-7).max(5),
    target: MoveTarget,
    flags: z.partialRecord(MoveFlag, z.literal(1)),
    secondary: SecondaryEffect.nullable().optional(),
    secondaries: z.array(SecondaryEffect).optional(),
    self: SelfEffect.optional(),
    status: StatusID.optional(),
    volatileStatus: z.string().optional(),
    boosts: BoostsTable.optional(),
    /** Fraction of damage dealt restored to the user. */
    drain: Fraction.optional(),
    /** Fraction of damage dealt taken as recoil. */
    recoil: Fraction.optional(),
    /** Fraction of max HP restored. */
    heal: Fraction.optional(),
    /** Critical hit stage: 1 is normal, 2 is "high crit ratio". */
    critRatio: z.number().int().min(1).optional(),
    /** Always lands a critical hit (Frost Breath, Storm Throw). */
    willCrit: z.boolean().optional(),
    /** Number of hits, or `[min, max]`. */
    multihit: z.union([z.number().int().min(2), z.tuple([z.number().int(), z.number().int()])]).optional(),
    ohko: z.union([z.boolean(), TypeName]).optional(),
    forceSwitch: z.boolean().optional(),
    selfSwitch: z.union([z.boolean(), z.string()]).optional(),
    weather: z.string().optional(),
    terrain: z.string().optional(),
    pseudoWeather: z.string().optional(),
    sideCondition: z.string().optional(),
    slotCondition: z.string().optional(),
    isZ: z.union([z.string(), z.literal(false)]).optional(),
    isMax: z.union([z.boolean(), z.string()]).optional(),
    gen: Gen.optional(),
    isNonstandard: Nonstandard.optional(),
});

/** @brief The whole `moves.json` table. */
export const MovesTable = table(MoveData);

export type MoveData = z.infer<typeof MoveData>;
export type MovesTable = z.infer<typeof MovesTable>;
