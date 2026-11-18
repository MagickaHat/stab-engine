/**
 * @file fonts.ts
 * @brief The pixel fonts the UI draws with, and their exact pixel metrics.
 *
 * A pixel font only stays sharp at the size its outlines were designed on
 * (or a whole multiple of it). At that size every edge falls on a pixel
 * boundary and there are no half-covered pixels. Drawing it at any other
 * size blurs it, so each font is registered with that native size and the UI
 * never draws it at another one.
 *
 * The FRLG font ("Pokemon FRLG" by aztecwarrior28, CC BY-SA) has 2000 units
 * per em on a grid of 1/14 em, so its native size is 14 px: tested in
 * Chromium, it then draws with no partially covered pixels at all.
 */
import { fontUrl } from '../assets/paths.ts';

/** @brief A pixel font and its metrics, all in game pixels. */
export interface PixelFont
{
    /** Family name the font is registered under (also usable in CSS). */
    family: string;
    /** URL of the font file. */
    url: string;
    /** Native size: the `font-size` its glyphs line up with the pixel grid at. */
    size: number;
    /** Distance from one line to the next. */
    lineHeight: number;
    /** Distance from the top of a line to the baseline. */
    baseline: number;
    /** Extra space between letters (whole pixels, may be 0). */
    letterSpacing: number;
}

/** @brief Every font the UI can use, by id. Add more with `registerFont()`. */
const FONTS: Record<string, PixelFont> = {
    frlg: {
        family: 'STAB FRLG',
        url: fontUrl('pokemon-frlg.woff2'),
        size: 14,
        lineHeight: 16,
        baseline: 12,
        letterSpacing: 0,
    },
};

/** @brief Id of the font used when none is given. */
export const DEFAULT_FONT = 'frlg';

/**
 * @brief Adds a font, or replaces one.
 *
 * Find a new font's native size by drawing it at several sizes and looking for
 * the one with no half-transparent pixels (see docs/UI_SYSTEM.md, "Fonts").
 *
 * @param id Id to use it by.
 * @param font The font and its metrics.
 */
export function registerFont (id: string, font: PixelFont): void
{
    FONTS[id] = font;
}

/**
 * @brief A registered font.
 * @param id Font id; the default font if left out.
 * @return The font.
 * @throws If no font has that id.
 */
export function getFont (id: string = DEFAULT_FONT): PixelFont
{
    const font = FONTS[id];
    if (!font) throw new Error(`Unknown UI font "${id}". Register it with registerFont().`);
    return font;
}

/**
 * @brief Every registered font.
 * @return The fonts by id.
 */
export function listFonts (): Readonly<Record<string, PixelFont>>
{
    return FONTS;
}
