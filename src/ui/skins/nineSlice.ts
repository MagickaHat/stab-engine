/**
 * @file nineSlice.ts
 * @brief Plans how a windowskin is drawn at any size without stretching a pixel.
 *
 * A window is drawn from a small image cut into nine parts: four corners,
 * four edges and the centre. Most engines *stretch* the edges and centre to
 * the window's size; with pixel art at a size that is not a whole multiple,
 * that duplicates some columns and not others and produces uneven pixels
 * ("mixels"). Here the corners are copied once and the edges and centre are
 * **tiled**, repeating the part as it is and cutting the last copy short.
 * Every draw copies a rectangle at exactly its own size: nothing is ever
 * scaled.
 *
 * These functions only work out rectangles; src/ui/components/Window.tsx draws them.
 */

/** @brief A rectangle in pixels. */
export interface Rect
{
    x: number;
    y: number;
    w: number;
    h: number;
}

/** @brief Distances from each edge, in pixels. */
export interface Insets
{
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * @brief One copy from the skin image to the window.
 *
 * Source and destination have the same size (`w` × `h`): the skin is never scaled.
 */
export interface DrawOp
{
    /** Left of the part in the skin image. */
    sx: number;
    /** Top of the part in the skin image. */
    sy: number;
    /** Left in the window. */
    dx: number;
    /** Top in the window. */
    dy: number;
    /** Width of the copy. */
    w: number;
    /** Height of the copy. */
    h: number;
}

/**
 * @brief Same insets on every side.
 * @param size The inset.
 * @return The insets.
 */
export function insets (size: number): Insets
{
    return { left: size, top: size, right: size, bottom: size };
}

/**
 * @brief Default nine-slice of an Essentials message or choice frame: an 8×8 centre tile.
 *
 * Gives 16 px corners for a 40×40 FRLG frame, 8 px for a 24×24 choice frame
 * and 20 × 8 px for a 48×24 HGSS frame.
 *
 * @param width Image width.
 * @param height Image height.
 * @param centre Size of the centre tile.
 * @return The insets.
 */
export function centredSlice (width: number, height: number, centre = 8): Insets
{
    const cw = Math.min(centre, width);
    const ch = Math.min(centre, height);
    const left = Math.floor((width - cw) / 2);
    const top = Math.floor((height - ch) / 2);
    return { left, top, right: width - left - cw, bottom: height - top - ch };
}

/**
 * @brief Rounds a window size to whole pixels and makes it at least as big as its corners.
 * @param slice The skin's insets.
 * @param width Requested width.
 * @param height Requested height.
 * @return The size the window will really have.
 */
export function fitWindowSize (slice: Insets, width: number, height: number): { width: number; height: number }
{
    return {
        width: Math.max(Math.round(width), slice.left + slice.right),
        height: Math.max(Math.round(height), slice.top + slice.bottom),
    };
}

/**
 * @brief Fills a destination rectangle with copies of a source rectangle, cut short at the end.
 * @param source Part of the skin image.
 * @param dest Area of the window to fill.
 * @param ops List the copies are added to.
 */
export function tile (source: Rect, dest: Rect, ops: DrawOp[]): void
{
    if (source.w <= 0 || source.h <= 0 || dest.w <= 0 || dest.h <= 0) return;
    for (let y = 0; y < dest.h; y += source.h)
    {
        const h = Math.min(source.h, dest.h - y);
        for (let x = 0; x < dest.w; x += source.w)
        {
            const w = Math.min(source.w, dest.w - x);
            ops.push({ sx: source.x, sy: source.y, dx: dest.x + x, dy: dest.y + y, w, h });
        }
    }
}

/**
 * @brief Plans a nine-slice window.
 * @param source Part of the skin image holding the frame.
 * @param slice Insets of the corners inside `source`.
 * @param width Window width (whole pixels, at least `slice.left + slice.right`).
 * @param height Window height (whole pixels, at least `slice.top + slice.bottom`).
 * @param centre Whether to fill the centre (`false` for RPG Maker frames, whose centre is empty).
 * @param offset Where in the window the frame starts (default 0, 0).
 * @return The copies to make, in drawing order.
 */
export function planNineSlice (
    source: Rect, slice: Insets, width: number, height: number, centre = true, offset = { x: 0, y: 0 },
): DrawOp[]
{
    const { left, top, right, bottom } = slice;
    const sw = source.w - left - right;
    const sh = source.h - top - bottom;
    const dw = width - left - right;
    const dh = height - top - bottom;
    const sx = [source.x, source.x + left, source.x + source.w - right];
    const sy = [source.y, source.y + top, source.y + source.h - bottom];
    const dx = [offset.x, offset.x + left, offset.x + width - right];
    const dy = [offset.y, offset.y + top, offset.y + height - bottom];
    const cols = [left, sw, right];
    const rows = [top, sh, bottom];
    const destCols = [left, dw, right];
    const destRows = [top, dh, bottom];

    const ops: DrawOp[] = [];
    for (let row = 0; row < 3; row++)
    {
        for (let col = 0; col < 3; col++)
        {
            if (!centre && row === 1 && col === 1) continue;
            tile(
                { x: sx[col], y: sy[row], w: cols[col], h: rows[row] },
                { x: dx[col], y: dy[row], w: destCols[col], h: destRows[row] },
                ops,
            );
        }
    }
    return ops;
}
