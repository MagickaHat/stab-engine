/**
 * @file common.ts
 * @brief Zod building blocks shared by every PBS table schema.
 *
 * These schemas describe data in **Pokémon Showdown's** format, so that
 * `@pkmn/sim` can use it directly (see `src/data/showdown.ts`).
 *
 * Imports in `src/data` use explicit `.ts` extensions so that the Node tools
 * in `tools/` (which run TypeScript natively, without a bundler) can share
 * these files with the game.
 */
import { z } from 'zod';

/**
 * @brief A Showdown ID: lowercase letters and digits only.
 *
 * Every table is keyed by ID, e.g. `"Mr. Mime"` → `mrmime`,
 * `"U-turn"` → `uturn`. Use `toID()` to make one from a name.
 */
export const ID = z.string().regex(/^[a-z0-9]+$/, 'IDs must be lowercase letters/digits only (use toID())');

/**
 * @brief A type name as used in data, e.g. `"Fire"`.
 *
 * Not an enum: fan games may add types. `checkIntegrity()` verifies that
 * every type referenced exists in the type chart.
 */
export const TypeName = z.string().regex(/^[A-Z][A-Za-z?]*$/, 'Type names are capitalised, e.g. "Fire"');

/** @brief Keys of a stats table, in Showdown order. */
export const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;

/** @brief Stat that can be boosted in battle (no HP, plus accuracy/evasion). */
export const BoostID = z.enum(['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion']);

/** @brief A full six-stat table, e.g. base stats. */
export const StatsTable = z.object({
    hp: z.number().int().min(1),
    atk: z.number().int().min(1),
    def: z.number().int().min(1),
    spa: z.number().int().min(1),
    spd: z.number().int().min(1),
    spe: z.number().int().min(1),
});

/** @brief Stat stage changes, e.g. `{ atk: 2 }` for Swords Dance. */
export const BoostsTable = z.partialRecord(BoostID, z.number().int().min(-6).max(6));

/** @brief Non-volatile status condition IDs. */
export const StatusID = z.enum(['brn', 'par', 'slp', 'frz', 'psn', 'tox']);

/** @brief A fraction `[numerator, denominator]`, e.g. `[1, 2]` for 50% drain. */
export const Fraction = z.tuple([z.number().int(), z.number().int().min(1)]);

/** @brief Generation number. */
export const Gen = z.number().int().min(1).max(99);

/**
 * @brief Showdown's `isNonstandard` marker. `"Custom"` is what fan content should use.
 */
export const Nonstandard = z.enum([
    'Past', 'Future', 'Unobtainable', 'CAP', 'LGPE', 'Custom', 'Gigantamax', 'Thing',
]).nullable();

/**
 * @brief Make a table schema: an object keyed by ID.
 * @param entry Schema for one entry.
 * @return Zod schema for `{ [id]: entry }`.
 */
export function table<T extends z.ZodType> (entry: T)
{
    return z.record(ID, entry);
}
