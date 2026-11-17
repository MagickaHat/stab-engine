/**
 * @file buttons.ts
 * @brief The buttons the game understands, whatever device they come from.
 *
 * Game code never asks about keys, gamepad indices or touches: it asks about
 * these twelve buttons. Keyboard keys, gamepad buttons, clicks, taps and the
 * on-screen pad are all turned into them (see InputManager.ts).
 */

/** @brief Every button, in display order. */
export const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'] as const;

/**
 * @brief One of the game's buttons.
 *
 * - `up`, `down`, `left`, `right`: the D-pad.
 * - `a`: confirm / interact. A left click or a tap on the game is also `a`.
 * - `b`: cancel / back / run. A right click is also `b`.
 * - `x`, `y`: extra face buttons.
 * - `l`, `r`: the left and right triggers (shoulder buttons).
 * - `start`, `select`: menu buttons.
 */
export type Button = typeof BUTTONS[number];

/** @brief The four D-pad directions. */
export const DPAD = ['up', 'down', 'left', 'right'] as const satisfies readonly Button[];

/** @brief A D-pad direction. */
export type DpadButton = typeof DPAD[number];

/**
 * @brief Kind of device a press came from.
 *
 * `touch` covers taps on the game and on the on-screen pad; `mouse` covers clicks.
 */
export type InputDevice = 'keyboard' | 'gamepad' | 'mouse' | 'touch';

/**
 * @brief Whether a value is the name of a button.
 * @param value Anything.
 * @return `true` for `'a'`, `'start'`...
 */
export function isButton (value: unknown): value is Button
{
    return typeof value === 'string' && (BUTTONS as readonly string[]).includes(value);
}
