/**
 * @file masuda.ts
 * @brief Pokémon languages in breeding: the Masuda method and shiny odds.
 *
 * Breeding two Pokémon from different languages gives the egg extra chances
 * to be shiny (the Masuda method). Dialects of one language
 * (`es-es`/`es-mx`, `pt-br`/`pt-pt`) count as the **same** language, so they
 * do not trigger it. Simplified and Traditional Chinese count as different
 * languages, as in the official games.
 *
 * The engine has no day care yet; it calls `eggShinyRolls()` and `rollShiny()`
 * when it hatches eggs.
 *
 * @code
 * const rolls = eggShinyRolls(mother.language, father.language, { shinyCharm: hasCharm });
 * const shiny = rollShiny(rolls);
 * @endcode
 */
import { sameLanguageFamily } from './languages.ts';

/** @brief Odds of one roll: 1 in `SHINY_ODDS`. */
export const SHINY_ODDS = 4096;

/** @brief Extra rolls the Masuda method gives (Generation 5 onwards: 6 rolls in total). */
export const MASUDA_EXTRA_ROLLS = 5;

/** @brief Extra rolls the Shiny Charm gives. */
export const SHINY_CHARM_EXTRA_ROLLS = 2;

/**
 * @brief Whether breeding these two parents uses the Masuda method.
 * @param a One parent's language.
 * @param b The other parent's language.
 * @return `true` if they are different languages (dialects of one language do not count).
 */
export function isMasuda (a: string, b: string): boolean
{
    return !sameLanguageFamily(a, b);
}

/** @brief Things that add shiny rolls. */
export interface ShinyBonuses
{
    /** The player has the Shiny Charm. */
    shinyCharm?: boolean;
}

/**
 * @brief How many times an egg rolls for being shiny.
 * @param a One parent's language.
 * @param b The other parent's language.
 * @param bonuses Shiny Charm and the like.
 * @return 1, plus `MASUDA_EXTRA_ROLLS` for the Masuda method, plus `SHINY_CHARM_EXTRA_ROLLS`.
 */
export function eggShinyRolls (a: string, b: string, bonuses: ShinyBonuses = {}): number
{
    return 1 + (isMasuda(a, b) ? MASUDA_EXTRA_ROLLS : 0) + (bonuses.shinyCharm ? SHINY_CHARM_EXTRA_ROLLS : 0);
}

/**
 * @brief Roll for a shiny.
 * @param rolls Number of rolls (see `eggShinyRolls()`).
 * @param random Source of random numbers from 0 (inclusive) to 1 (exclusive).
 * @param odds 1 in this many per roll. Default: `SHINY_ODDS`.
 * @return `true` if any roll hit.
 */
export function rollShiny (rolls: number, random: () => number = Math.random, odds = SHINY_ODDS): boolean
{
    for (let i = 0; i < rolls; i++) if (Math.floor(random() * odds) === 0) return true;
    return false;
}
