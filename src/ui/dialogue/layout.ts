/**
 * @file layout.ts
 * @brief Where the dialogue windows go on screen (game pixels).
 *
 * Everything is placed from the bottom and right edges, so it still fits if
 * the game resolution changes.
 */

/** @brief Height of the message box. Two lines of FRLG text plus the frame. */
export const MESSAGE_HEIGHT = 48;

/** @brief Lines of text shown at once in the message box (FRLG shows two). */
export const MESSAGE_LINES = 2;

/** @brief Gap between the right edge of the screen and the choice window. */
export const CHOICE_MARGIN_RIGHT = 4;

/** @brief How far the speaker name box sits in from the message box's left edge. */
export const NAME_BOX_INDENT = 4;

/** @brief A rectangle in game pixels. */
export interface Box
{
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * @brief The message box: the full width of the screen, along the bottom.
 * @param gameWidth Game width.
 * @param gameHeight Game height.
 * @return Its rectangle.
 */
export function messageBox (gameWidth: number, gameHeight: number): Box
{
    return { x: 0, y: gameHeight - MESSAGE_HEIGHT, width: gameWidth, height: MESSAGE_HEIGHT };
}

/**
 * @brief The speaker name box: just above the left of the message box.
 *
 * The FRLG frame has 3 transparent rows at its top and bottom, so the boxes
 * are placed by their visible edges: the name box's bottom border ends one
 * pixel above the message box's top border.
 *
 * @param message The message box.
 * @param width Width of the name box.
 * @param height Height of the name box.
 * @return Its rectangle.
 */
export function nameBox (message: Box, width: number, height: number): Box
{
    return { x: message.x + NAME_BOX_INDENT, y: message.y + 5 - height, width, height };
}

/**
 * @brief The choice window: right-aligned, sitting on top of the message box.
 * @param message The message box.
 * @param gameWidth Game width.
 * @param width Width of the choice window.
 * @param height Height of the choice window.
 * @return Its rectangle.
 */
export function choiceBox (message: Box, gameWidth: number, width: number, height: number): Box
{
    return { x: gameWidth - CHOICE_MARGIN_RIGHT - width, y: message.y + 4 - height, width, height };
}
