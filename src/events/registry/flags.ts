/**
 * @file flags.ts
 * @brief Every flag the game uses, with what it means.
 *
 * Flags are yes/no facts stored in `SaveData.flags` (see src/state). Listing
 * them here gives one place to look them up, lets `npm run events:validate`
 * catch typos in event scripts, and lets `npm run events:sync-tiled` offer
 * them as a drop-down list in Tiled.
 *
 * Add a flag by adding a line. The key is the flag name used in scripts;
 * the value is a short description for people.
 *
 * Flags made by the engine itself need no entry: `trainer:<id>` (a trainer
 * was beaten) and `listener:<id>` (a `once` listener has run).
 */
export const FLAGS = {
    got_starter: 'The player has chosen their first Pokémon.',
    met_rival: 'The rival has introduced themself.',
    got_running_shoes: 'The player can run.',
} as const satisfies Record<string, string>;

/** @brief A flag name from the registry. */
export type FlagName = keyof typeof FLAGS;

/** @brief Start of the flags that remember beaten trainers: `trainer:<trainer id>`. */
export const TRAINER_FLAG_PREFIX = 'trainer:';

/** @brief Start of the flags that remember `once` listeners: `listener:<listener id>`. */
export const LISTENER_FLAG_PREFIX = 'listener:';

/**
 * @brief Whether a flag name is known: in `FLAGS` or made by the engine.
 * @param name Flag name.
 */
export function isKnownFlag (name: string): boolean
{
    return name in FLAGS || name.startsWith(TRAINER_FLAG_PREFIX) || name.startsWith(LISTENER_FLAG_PREFIX);
}
