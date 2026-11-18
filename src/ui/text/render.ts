/**
 * @file render.ts
 * @brief Draws pixel text into a canvas, with no blurred or half pixels.
 *
 * Game text is never put in the page as DOM text: it is drawn into a 1×
 * `<canvas>` that is then scaled with the rest of the UI. That keeps it pixel
 * perfect at every scale, and it also means the player cannot select or copy
 * it.
 *
 * Each character is drawn on its own at a whole-pixel position, then every
 * pixel is forced fully on or fully off, so even a font drawn slightly off its
 * grid never shows soft edges. The shadow is the Essentials / GBA style: the
 * same text one pixel right, one down and one diagonally.
 */
import { chars } from './layout.ts';
import type { Advance } from './layout.ts';
import type { PixelFont } from './fonts.ts';

/** @brief How to draw a block of text. */
export interface PixelTextStyle
{
    /** The font. */
    font: PixelFont;
    /** Colour of the letters (any CSS colour). */
    color: string;
    /** Colour of the shadow, or `null` for none. */
    shadow: string | null;
}

/** @brief Advance functions, one per font family. */
const advances = new Map<string, Advance>();
/** @brief Canvas used to build letter masks. */
let scratch: HTMLCanvasElement | null = null;
/** @brief Context used only to measure characters. */
let measurer: CanvasRenderingContext2D | null = null;

/**
 * @brief Returns a reusable scratch canvas of at least this size.
 * @param width Minimum width.
 * @param height Minimum height.
 * @return The canvas, cleared.
 */
function scratchCanvas (width: number, height: number): HTMLCanvasElement
{
    scratch ??= document.createElement('canvas');
    if (scratch.width < width) scratch.width = width;
    if (scratch.height < height) scratch.height = height;
    const context = scratch.getContext('2d', { willReadFrequently: true })!;
    context.clearRect(0, 0, scratch.width, scratch.height);
    return scratch;
}

/**
 * @brief The canvas `font` shorthand for a pixel font.
 * @param font The font.
 * @return E.g. `14px "STAB FRLG"`.
 */
export function cssFont (font: PixelFont): string
{
    return `${font.size}px "${font.family}"`;
}

/**
 * @brief Character widths of a font, in whole pixels (measured once per character).
 *
 * Only call this after the font has loaded (see `loadFont()`), otherwise the
 * fallback font is measured and cached.
 *
 * @param font The font.
 * @return The advance function for `wrapText()` and friends.
 */
export function fontAdvance (font: PixelFont): Advance
{
    const known = advances.get(font.family);
    if (known) return known;
    const cache = new Map<string, number>();
    const advance: Advance = (char) =>
    {
        let width = cache.get(char);
        if (width === undefined)
        {
            measurer ??= document.createElement('canvas').getContext('2d')!;
            measurer.font = cssFont(font);
            width = Math.round(measurer.measureText(char).width) + font.letterSpacing;
            cache.set(char, width);
        }
        return width;
    };
    advances.set(font.family, advance);
    return advance;
}

/**
 * @brief Forgets measured widths (call after replacing a font file at run time).
 */
export function clearFontMetrics (): void
{
    advances.clear();
}

/**
 * @brief Size of the canvas needed for some lines.
 * @param lines The lines.
 * @param font The font.
 * @param shadow Whether a shadow is drawn (adds one pixel right and down).
 * @return Width and height in game pixels.
 */
export function measureLines (lines: string[], font: PixelFont, shadow: boolean): { width: number; height: number }
{
    const advance = fontAdvance(font);
    let width = 0;
    for (const line of lines)
    {
        let lineWidth = 0;
        for (const char of chars(line)) lineWidth += advance(char);
        width = Math.max(width, lineWidth);
    }
    const extra = shadow ? 1 : 0;
    return { width: width + extra, height: lines.length * font.lineHeight + extra };
}

/**
 * @brief Draws the letters of some lines as a hard-edged white mask.
 * @param lines The lines.
 * @param font The font.
 * @param maxChars Draw only this many characters (typewriter); `Infinity` for all.
 * @param width Mask width.
 * @param height Mask height.
 * @return The scratch canvas holding the mask (valid until the next call).
 */
function drawMask (lines: string[], font: PixelFont, maxChars: number, width: number, height: number): HTMLCanvasElement
{
    const canvas = scratchCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.font = cssFont(font);
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#ffffff';
    const advance = fontAdvance(font);
    let left = maxChars;
    for (let row = 0; row < lines.length && left > 0; row++)
    {
        let x = 0;
        const y = row * font.lineHeight + font.baseline;
        for (const char of chars(lines[row]))
        {
            if (left-- <= 0) break;
            if (char !== ' ') context.fillText(char, x, y);
            x += advance(char);
        }
    }
    //  Force every pixel fully on or off: no soft edges, whatever the browser's text rendering.
    const pixels = context.getImageData(0, 0, width, height);
    const data = pixels.data;
    for (let i = 3; i < data.length; i += 4)
    {
        const on = data[i] >= 128;
        data[i - 3] = 255;
        data[i - 2] = 255;
        data[i - 1] = 255;
        data[i] = on ? 255 : 0;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
}

/**
 * @brief Draws text into a canvas, resizing the canvas to fit.
 * @param target Canvas to draw into. Its size is set to `width` × `height`.
 * @param lines The lines.
 * @param style Font and colours.
 * @param maxChars Draw only this many characters (typewriter); `Infinity` for all.
 * @param width Canvas width (whole game pixels).
 * @param height Canvas height (whole game pixels).
 */
export function drawPixelText (
    target: HTMLCanvasElement, lines: string[], style: PixelTextStyle, maxChars: number, width: number, height: number,
): void
{
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (target.width !== w) target.width = w;
    if (target.height !== h) target.height = h;
    const out = target.getContext('2d')!;
    out.imageSmoothingEnabled = false;
    out.clearRect(0, 0, w, h);
    if (maxChars <= 0 || lines.length === 0) return;

    const mask = drawMask(lines, style.font, maxChars, w, h);
    const tint = (color: string, dx: number, dy: number) =>
    {
        //  Colour the mask on a layer of the output: draw it, then fill with source-in on a fresh layer.
        const layer = layerCanvas(w, h);
        const context = layer.getContext('2d')!;
        context.globalCompositeOperation = 'source-over';
        context.clearRect(0, 0, w, h);
        context.drawImage(mask, 0, 0, w, h, 0, 0, w, h);
        context.globalCompositeOperation = 'source-in';
        context.fillStyle = color;
        context.fillRect(0, 0, w, h);
        context.globalCompositeOperation = 'source-over';
        out.drawImage(layer, dx, dy);
    };
    if (style.shadow)
    {
        tint(style.shadow, 1, 0);
        tint(style.shadow, 0, 1);
        tint(style.shadow, 1, 1);
    }
    tint(style.color, 0, 0);
}

/** @brief Second scratch canvas used to colour masks. */
let layer: HTMLCanvasElement | null = null;

/**
 * @brief Returns a reusable canvas of exactly this size.
 * @param width Width.
 * @param height Height.
 * @return The canvas.
 */
function layerCanvas (width: number, height: number): HTMLCanvasElement
{
    layer ??= document.createElement('canvas');
    if (layer.width !== width) layer.width = width;
    if (layer.height !== height) layer.height = height;
    return layer;
}
