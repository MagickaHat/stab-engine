/**
 * @file usePixelText.ts
 * @brief React hooks for laying out pixel text.
 */
import { useEffect, useMemo, useState } from 'react';
import { isFontLoaded, loadFont } from '../assets/loader';
import { getFont } from './fonts';
import type { PixelFont } from './fonts';
import { paginate, wrapText } from './layout';
import type { Advance } from './layout';
import { fontAdvance } from './render';

/**
 * @brief Loads a font and re-renders once it can be drawn.
 * @param id Font id (see src/ui/text/fonts.ts).
 * @return `true` once the font is ready.
 */
export function useFontReady (id?: string): boolean
{
    const font = getFont(id);
    const [ready, setReady] = useState(() => isFontLoaded(font.family));

    useEffect(() =>
    {
        if (isFontLoaded(font.family))
        {
            setReady(true);
            return undefined;
        }
        let live = true;
        loadFont(font.family, font.url).then(
            () => { if (live) setReady(true); },
            (error) => console.warn(`[ui] font "${font.family}" could not be loaded:`, error),
        );
        return () => { live = false; };
    }, [font.family, font.url]);

    return ready;
}

/**
 * @brief The font, its character widths, and whether it is ready.
 * @param id Font id; the default font if left out.
 * @return `font`, `advance` (only meaningful once `ready`) and `ready`.
 */
export function usePixelFont (id?: string): { font: PixelFont; advance: Advance; ready: boolean }
{
    const ready = useFontReady(id);
    const font = getFont(id);
    return { font, advance: fontAdvance(font), ready };
}

/**
 * @brief Wraps text to a width and splits it into pages, once the font is ready.
 *
 * @code
 * const pages = useTextPages(message, 224, 2);   // FRLG-style: two lines per box
 * @endcode
 *
 * @param text The text.
 * @param width Most pixels per line.
 * @param linesPerPage Lines per page (`Infinity` for one page).
 * @param fontId Font id.
 * @return The pages (each a list of lines); `[]` until the font is ready.
 */
export function useTextPages (text: string, width: number, linesPerPage: number, fontId?: string): string[][]
{
    const { advance, ready } = usePixelFont(fontId);
    return useMemo(() =>
    {
        if (!ready) return [];
        const lines = wrapText(text, width, advance);
        return Number.isFinite(linesPerPage) ? paginate(lines, linesPerPage) : [lines];
    }, [text, width, linesPerPage, advance, ready]);
}
