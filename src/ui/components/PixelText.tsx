/**
 * @file PixelText.tsx
 * @brief Draws game text: pixel perfect, and impossible to select or copy.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { getSkin } from '../skins/skins';
import { measureLines, drawPixelText } from '../text/render';
import { usePixelFont } from '../text/usePixelText';
import { wrapText } from '../text/layout';

/** @brief Props of `<PixelText>`. */
export interface PixelTextProps
{
    /** The text. `\n` starts a new line. Ignored if `lines` is given. */
    text?: string;
    /** Lines already laid out (e.g. one page from `useTextPages()`). */
    lines?: string[];
    /** Wrap `text` to this many pixels. Without it, lines only break at `\n`. */
    wrap?: number;
    /** Left, in game pixels, inside the parent. */
    x?: number;
    /** Top, in game pixels, inside the parent. */
    y?: number;
    /** Font id (see src/ui/text/fonts.ts). */
    font?: string;
    /** Take the text colours from this windowskin (see src/ui/skins/skins.ts). */
    skin?: string;
    /** Letter colour; overrides the skin's. */
    color?: string;
    /** Shadow colour, or `null` for none; overrides the skin's. */
    shadow?: string | null;
    /** Typewriter: draw only this many characters. All of them if left out. */
    maxChars?: number;
    /** Extra styles for the canvas. */
    style?: CSSProperties;
    /** Extra class names for the canvas. */
    className?: string;
}

/** @brief Colours used when neither a skin nor colours are given. */
const DEFAULT_COLOURS = { color: '#ffffff', shadow: 'rgb(64, 64, 64)' as string | null };

/**
 * @brief Draws text with a pixel font into a canvas.
 *
 * All game text must go through this component (or `drawPixelText()`):
 * - the font is only ever drawn at its native size, on whole pixels, with
 *   every pixel fully on or off, so it stays sharp at every scale;
 * - the text is pixels in a canvas, not DOM text, so it cannot be
 *   highlighted or copied. Screen readers still get it through `aria-label`.
 *
 * @code
 * <Window skin="choice_1" x={8} y={8} width={80} height={30}>
 *     <PixelText text="POKéMON" skin="choice_1" />
 * </Window>
 * @endcode
 *
 * @param props See `PixelTextProps`.
 * @return The canvas, or nothing until the font has loaded.
 */
export function PixelText ({ text = '', lines, wrap, x = 0, y = 0, font: fontId, skin, color, shadow, maxChars, style, className }: PixelTextProps)
{
    const { font, advance, ready } = usePixelFont(fontId);
    const canvas = useRef<HTMLCanvasElement>(null);

    const skinColours = skin ? getSkin(skin) : null;
    const fill = color ?? skinColours?.textColor ?? DEFAULT_COLOURS.color;
    const shade = shadow !== undefined ? shadow : (skinColours ? skinColours.shadowColor : DEFAULT_COLOURS.shadow);

    const laidOut = useMemo(() =>
    {
        if (lines) return lines;
        if (!ready) return [];
        return wrap ? wrapText(text, wrap, advance) : text.split('\n');
    }, [lines, text, wrap, advance, ready]);

    const size = useMemo(() => (ready ? measureLines(laidOut, font, !!shade) : { width: 0, height: 0 }), [laidOut, font, shade, ready]);

    useLayoutEffect(() =>
    {
        if (!ready || !canvas.current) return;
        drawPixelText(canvas.current, laidOut, { font, color: fill, shadow: shade }, maxChars ?? Infinity, size.width, size.height);
    }, [ready, laidOut, font, fill, shade, maxChars, size]);

    if (!ready) return null;
    return (
        <canvas
            ref={canvas}
            role="img"
            aria-label={laidOut.join(' ')}
            className={className ? `pixel-text ${className}` : 'pixel-text'}
            width={Math.max(1, size.width)}
            height={Math.max(1, size.height)}
            style={{ left: x, top: y, width: Math.max(1, size.width), height: Math.max(1, size.height), ...style }}
        />
    );
}
