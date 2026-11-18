/**
 * @file overlays.ts
 * @brief Text drawn over graphics: the format of `content/locales/overlays/*.json`.
 *
 * Some graphics have English words painted into them (the battle command
 * buttons, the Trainer Card header). Instead of drawing one picture per
 * language, an overlay says where those words are: the engine paints over
 * them (`erase`) and writes the translated text in their place (`text`).
 * Graphics that are blank frames (move buttons, Pokédex panels) only need `text`.
 *
 * Coordinates are pixels of the graphic. A graphic made of equal cells (a
 * sprite sheet of buttons) sets `cells`: `erase` and `text` are then
 * relative to each cell and repeated for every cell, and a text slot's
 * `keys` gives one key per row (or column) of cells.
 *
 * @code
 * {
 *   "graphic": "ui/trainer_card/card",
 *   "erase": [{ "x": 28, "y": 16, "width": 76, "height": 12, "fill": "#78a8f0" }],
 *   "text": [{ "key": "ui.trainer_card.title", "x": 28, "y": 14, "width": 76, "color": "#f8f8f8", "shadow": "#5070b8" }]
 * }
 * @endcode
 */
import { z } from 'zod';

/** @brief A rectangle painted over before text is written. */
export const OverlayErase = z.strictObject({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    /**
     * A CSS colour, or `"row"`: paint each row with the colour the graphic has
     * at column `sampleX` of that row (keeps vertical gradients).
     */
    fill: z.string().min(1),
    /** Column to take each row's colour from when `fill` is `"row"`. Default: `x - 1`. */
    sampleX: z.number().int().min(0).optional(),
});
export type OverlayErase = z.infer<typeof OverlayErase>;

/** @brief A piece of translated text written on a graphic. */
export const OverlayText = z.strictObject({
    /** Text key. */
    key: z.string().min(1).optional(),
    /** One text key per row (`by: "row"`) or column of cells. */
    keys: z.array(z.string().min(1)).min(1).optional(),
    /** Which cell index picks from `keys`. Default: `row`. */
    by: z.enum(['row', 'col', 'cell']).optional(),
    x: z.number().int(),
    y: z.number().int(),
    /** Width of the text box; the text is aligned in it and must fit. */
    width: z.number().int().min(1),
    align: z.enum(['left', 'center', 'right']).optional(),
    /** Font id (src/ui/text/fonts.ts). Default: the UI font. */
    font: z.string().optional(),
    color: z.string().min(1),
    /** Shadow colour, or `null` for none. */
    shadow: z.string().min(1).nullable().optional(),
}).refine((slot) => !!slot.key !== !!slot.keys, { message: 'give either "key" or "keys"' });
export type OverlayText = z.infer<typeof OverlayText>;

/** @brief Text drawn over one graphic. */
export const TextOverlay = z.strictObject({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    /** Graphic path under `public/assets/img/`, without `.png`: `ui/battle/cursor_command`. */
    graphic: z.string().min(1),
    /** The graphic is a grid of equal cells. */
    cells: z.strictObject({
        width: z.number().int().min(1),
        height: z.number().int().min(1),
        cols: z.number().int().min(1),
        rows: z.number().int().min(1),
    }).optional(),
    erase: z.array(OverlayErase).default([]),
    text: z.array(OverlayText).default([]),
    /** Locales that need no overlay because the graphic already shows their words. Default: `["en"]`. */
    skip: z.array(z.string()).optional(),
});
export type TextOverlay = z.infer<typeof TextOverlay>;

/** @brief One text slot placed in the graphic's coordinates, with its key. */
export interface PlacedText
{
    key: string;
    x: number;
    y: number;
    width: number;
    align: 'left' | 'center' | 'right';
    font?: string;
    color: string;
    shadow: string | null;
}

/** @brief Every erase and text slot of an overlay, in the graphic's coordinates. */
export interface PlacedOverlay
{
    erase: OverlayErase[];
    text: PlacedText[];
}

/**
 * @brief Repeat an overlay's slots over its cells and pick each slot's key.
 * @param overlay The overlay.
 * @return Slots in the graphic's coordinates.
 */
export function placeOverlay (overlay: TextOverlay): PlacedOverlay
{
    const grid = overlay.cells ?? { width: 0, height: 0, cols: 1, rows: 1 };
    const out: PlacedOverlay = { erase: [], text: [] };
    for (let row = 0; row < grid.rows; row++)
    {
        for (let col = 0; col < grid.cols; col++)
        {
            const dx = col * grid.width;
            const dy = row * grid.height;
            for (const erase of overlay.erase)
            {
                out.erase.push({ ...erase, x: erase.x + dx, y: erase.y + dy, sampleX: erase.sampleX === undefined ? undefined : erase.sampleX + dx });
            }
            for (const slot of overlay.text)
            {
                const index = slot.by === 'col' ? col : slot.by === 'cell' ? row * grid.cols + col : row;
                const key = slot.key ?? slot.keys![index % slot.keys!.length];
                out.text.push({
                    key, x: slot.x + dx, y: slot.y + dy, width: slot.width, align: slot.align ?? 'left',
                    font: slot.font, color: slot.color, shadow: slot.shadow ?? null,
                });
            }
        }
    }
    return out;
}

/**
 * @brief Whether a locale needs the overlay drawn.
 * @param overlay The overlay.
 * @param locale The game's locale.
 */
export function overlayApplies (overlay: TextOverlay, locale: string): boolean
{
    return !(overlay.skip ?? ['en']).includes(locale);
}
