/**
 * @file config.ts
 * @brief Base resolution of the game.
 *
 * This is the only place the resolution is written down. Scenes should read
 * the current size from `this.scale.width` / `this.scale.height`, and the
 * React UI gets it from `GameEvents.VIEWPORT_CHANGED` (see src/game/viewport.ts),
 * so changing these two numbers is enough to change the resolution.
 */

/** @brief Width of the game, in game pixels. */
export const GAME_WIDTH = 256;

/** @brief Height of the game, in game pixels. */
export const GAME_HEIGHT = 192;
