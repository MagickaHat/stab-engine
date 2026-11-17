/**
 * @file emotes.ts
 * @brief Emote bubbles and their frame in the emote sheet.
 *
 * The overworld loads `assets/img/system/emotes.png` (not shipped: add your
 * own) as a sheet of square frames, one emote per frame, left to right then
 * top to bottom. `EMOTE_FRAME_SIZE` is the size of one frame in pixels.
 */
export const EMOTES = {
    exclamation: 0,
    question: 1,
    music: 2,
    heart: 3,
    anger: 4,
    sweat: 5,
    ellipsis: 6,
    idea: 7,
} as const satisfies Record<string, number>;

/** @brief An emote name. */
export type EmoteName = keyof typeof EMOTES;

/** @brief Width and height of one emote frame, in pixels. */
export const EMOTE_FRAME_SIZE = 16;
