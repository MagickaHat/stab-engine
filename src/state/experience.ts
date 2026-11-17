/**
 * @file experience.ts
 * @brief Experience points: how many a level needs and how many a battle gives.
 *
 * Pure functions with no game data of their own. The growth curve and base
 * experience of a species come from `species_info.json` (`SpeciesInfo` in
 * src/data/schemas/engine.ts) and are passed in by the caller.
 */
import type { z } from 'zod';
import type { GrowthRate as GrowthRateSchema } from '../data/schemas/engine.ts';

/** @brief Name of an experience growth curve, as in the species data. */
export type GrowthRate = z.infer<typeof GrowthRateSchema>;

/** @brief Highest level a Pokémon can reach. */
export const MAX_LEVEL = 100;

/** @brief What the Lucky Egg multiplies gained experience by. */
export const LUCKY_EGG_BONUS = 1.5;

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
}

/**
 * @brief Experience one Pokémon gains when an opponent faints.
 *
 * The formula of Generation 7 onwards: the gain grows with the opponent's
 * level and shrinks the further the receiver is above it. As in Generation 9,
 * every party member that can still fight receives experience; those that
 * did not take part receive half.
 *
 * @param input See `ExpGainInput`.
 * @return Experience points, at least 1 (0 if `baseExp` is 0).
 */
export function expGain (input: ExpGainInput): number
{
    const { baseExp, defeatedLevel, level, participated, luckyEgg = false } = input;
    if (baseExp <= 0) return 0;
    const base = Math.floor(baseExp * defeatedLevel / 5 / (participated ? 1 : 2));
    const scale = ((2 * defeatedLevel + 10) / (defeatedLevel + level + 10)) ** 2.5;
    const gain = Math.floor(base * scale) + 1;
    return luckyEgg ? Math.floor(gain * LUCKY_EGG_BONUS) : gain;
}
