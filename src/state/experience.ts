/**
 * @file experience.ts
 * @brief Experience points: how many a level needs and how many a battle gives.
 *
 * Pure functions with no game data of their own. The growth curve and base
 * experience of a species come from `species_info.json` (`SpeciesInfo` in
 * src/data/schemas/engine.ts) and are passed in by the caller.
 */
import type { z } from 'zod';
import { STAT_IDS } from '../data/schemas/common.ts';
import type { GrowthRate as GrowthRateSchema } from '../data/schemas/engine.ts';
import { MAX_EV, MAX_TOTAL_EVS } from './schema.ts';
import type { EVSpread } from './schema.ts';

/** @brief Name of an experience growth curve, as in the species data. */
export type GrowthRate = z.infer<typeof GrowthRateSchema>;

/** @brief Highest level a Pokémon can reach. */
export const MAX_LEVEL = 100;

/** @brief What the Lucky Egg multiplies gained experience by. */
export const LUCKY_EGG_BONUS = 1.5;

/** @brief What gained experience is multiplied by for a Pokémon from another trainer. */
export const TRADED_BONUS = 1.5;

/**
 * @brief Total experience a Pokémon has when it has just reached a level.
 *
 * The six curves of the main series. In the species data they carry PokeAPI's
 * names: `slow-then-very-fast` is the curve usually called Erratic and
 * `fast-then-very-slow` the one called Fluctuating.
 *
 * @param growth The species' growth curve.
 * @param level The level, 1 to `MAX_LEVEL`. Values outside are clamped.
 * @return Total experience points; 0 at level 1.
 */
export function expForLevel (growth: GrowthRate, level: number): number
{
    const n = Math.min(Math.max(Math.floor(level), 1), MAX_LEVEL);
    if (n === 1) return 0;
    const cube = n ** 3;
    switch (growth)
    {
        case 'fast':
            return Math.floor(4 * cube / 5);
        case 'medium':
            return cube;
        case 'medium-slow':
            return Math.floor(6 * cube / 5) - 15 * n * n + 100 * n - 140;
        case 'slow':
            return Math.floor(5 * cube / 4);
        case 'slow-then-very-fast':
            if (n < 50) return Math.floor(cube * (100 - n) / 50);
            if (n < 68) return Math.floor(cube * (150 - n) / 100);
            if (n < 98) return Math.floor(cube * Math.floor((1911 - 10 * n) / 3) / 500);
            return Math.floor(cube * (160 - n) / 100);
        case 'fast-then-very-slow':
            if (n < 15) return Math.floor(cube * (Math.floor((n + 1) / 3) + 24) / 50);
            if (n < 36) return Math.floor(cube * (n + 14) / 50);
            return Math.floor(cube * (Math.floor(n / 2) + 32) / 50);
    }
}

/**
 * @brief The level a Pokémon with this much experience is at.
 * @param growth The species' growth curve.
 * @param exp Total experience points.
 * @return The level, 1 to `MAX_LEVEL`.
 */
export function levelForExp (growth: GrowthRate, exp: number): number
{
    let level = 1;
    while (level < MAX_LEVEL && exp >= expForLevel(growth, level + 1)) level++;
    return level;
}

/** @brief What `expGain()` needs to know about one defeated Pokémon and one receiver. */
export interface ExpGainInput
{
    /** Base experience of the defeated species (`SpeciesInfo.baseExp`). */
    baseExp: number;
    /** Level of the defeated Pokémon. */
    defeatedLevel: number;
    /** Level of the Pokémon receiving the experience. */
    level: number;
    /** `true` if the receiver was on the field against the defeated Pokémon. Others get half. */
    participated: boolean;
    /** `true` if the receiver holds a Lucky Egg. */
    luckyEgg?: boolean;
    /** `true` if the receiver came from another trainer (`GameState.isTraded()`). */
    traded?: boolean;
}

/**
 * @brief Experience one Pokémon gains when an opponent faints.
 *
 * The formula of Generation 7 onwards: the gain grows with the opponent's
 * level and shrinks the further the receiver is above it. As in Generation 9,
 * every party member that can still fight receives experience; those that
 * did not take part receive half. A traded Pokémon and one holding a Lucky
 * Egg each get 1.5 times as much.
 *
 * @param input See `ExpGainInput`.
 * @return Experience points, at least 1 (0 if `baseExp` is 0).
 */
export function expGain (input: ExpGainInput): number
{
    const { baseExp, defeatedLevel, level, participated, luckyEgg = false, traded = false } = input;
    if (baseExp <= 0) return 0;
    const base = Math.floor(baseExp * defeatedLevel / 5 / (participated ? 1 : 2));
    const scale = ((2 * defeatedLevel + 10) / (defeatedLevel + level + 10)) ** 2.5;
    let gain = Math.floor(base * scale) + 1;
    if (traded) gain = Math.floor(gain * TRADED_BONUS);
    if (luckyEgg) gain = Math.floor(gain * LUCKY_EGG_BONUS);
    return gain;
}

/**
 * @brief Add the effort values a defeated Pokémon gives.
 *
 * A stat stops at `MAX_EV` (252) and the six stats together at
 * `MAX_TOTAL_EVS` (510); what does not fit is lost.
 *
 * @param evs The receiver's effort values. Not changed.
 * @param gained The defeated species' yield (`SpeciesInfo.evYield`), e.g. `{ spe: 2 }`.
 * @return The new effort values, or `evs` itself if nothing could be added.
 */
export function addEvs (evs: EVSpread, gained: Partial<EVSpread>): EVSpread
{
    const next = { ...evs };
    let room = MAX_TOTAL_EVS - STAT_IDS.reduce((sum, stat) => sum + evs[stat], 0);
    let changed = false;
    for (const stat of STAT_IDS)
    {
        const add = Math.min(gained[stat] ?? 0, MAX_EV - next[stat], room);
        if (add <= 0) continue;
        next[stat] += add;
        room -= add;
        changed = true;
    }
    return changed ? next : evs;
}

/**
 * @brief The moves a species learns between two levels.
 *
 * Reads Showdown learn sources (`"9L15"` = level 15 in Generation 9). If the
 * species has no level-up moves in the generation asked for, the newest
 * generation that has some is used.
 *
 * @param learnset The species' learnset: move ID → sources (`LearnsetData.learnset`).
 * @param fromLevel Level before (not included).
 * @param toLevel Level after (included). `levelUpMoves(learnset, -1, 0)` gives the moves
 *                learned on evolving, which Showdown stores as level 0.
 * @param gen Generation whose level-up list to use. Default: 9.
 * @return Move IDs in the order they are learned.
 */
export function levelUpMoves (
    learnset: Readonly<Record<string, readonly string[]>> | undefined, fromLevel: number, toLevel: number, gen = 9,
): string[]
{
    /** Generation → [level, move] pairs. */
    const byGen = new Map<number, [number, string][]>();
    for (const [move, sources] of Object.entries(learnset ?? {}))
    {
        for (const source of sources)
        {
            const match = /^(\d+)L(\d+)$/.exec(source);
            if (!match) continue;
            const list = byGen.get(Number(match[1])) ?? [];
            list.push([Number(match[2]), move]);
            byGen.set(Number(match[1]), list);
        }
    }
    const use = byGen.has(gen) ? gen : Math.max(...byGen.keys());
    const learned = (byGen.get(use) ?? []).filter(([level]) => level > fromLevel && level <= toLevel);
    //  Stable sort: moves of the same level keep the learnset's order.
    learned.sort((a, b) => a[0] - b[0]);
    return [...new Set(learned.map(([, move]) => move))];
}
