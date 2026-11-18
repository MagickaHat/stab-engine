/**
 * @file layout.ts
 * @brief Word wrapping and paging for pixel text (pure functions, no DOM).
 *
 * Text is laid out one character at a time with whole-pixel advances, so
 * every letter starts on a pixel and the text never shifts while it is being
 * typed out. The width of a character comes from an `Advance` function; the
 * renderer (src/ui/text/render.ts) measures it from the real font, and tests
 * can pass a fixed width.
 */

/** @brief Width of a character in whole game pixels, including letter spacing. */
export type Advance = (char: string) => number;

/**
 * @brief Splits a string into characters (code points), so letters outside the BMP are not cut in half.
 * @param text The text.
 * @return Its characters (code points).
 */
export function chars (text: string): string[]
{
    return Array.from(text);
}

/**
 * @brief Width of a line of text.
 * @param line The line.
 * @param advance Character widths.
 * @return The width in game pixels.
 */
export function textWidth (line: string, advance: Advance): number
{
    let width = 0;
    for (const char of chars(line)) width += advance(char);
    return width;
}

/**
 * @brief Breaks text into lines no wider than `maxWidth`.
 *
 * Lines break at spaces; `\n` always starts a new line. A word wider than
 * the whole line is broken between letters. Spaces at a break are dropped.
 *
 * @param text The text.
 * @param maxWidth Most pixels per line.
 * @param advance Character widths.
 * @return The lines.
 */
export function wrapText (text: string, maxWidth: number, advance: Advance): string[]
{
    const lines: string[] = [];
    for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n'))
    {
        let line = '';
        let width = 0;
        const spaceWidth = advance(' ');
        for (const word of paragraph.split(' '))
        {
            const wordWidth = textWidth(word, advance);
            const needed = line ? width + spaceWidth + wordWidth : wordWidth;
            if (needed <= maxWidth)
            {
                line = line ? `${line} ${word}` : word;
                width = needed;
                continue;
            }
            if (line) lines.push(line);
            line = '';
            width = 0;
            if (wordWidth <= maxWidth)
            {
                line = word;
                width = wordWidth;
                continue;
            }
            //  The word alone is too wide: break it between letters.
            for (const char of chars(word))
            {
                const charWidth = advance(char);
                if (line && width + charWidth > maxWidth)
                {
                    lines.push(line);
                    line = '';
                    width = 0;
                }
                line += char;
                width += charWidth;
            }
        }
        lines.push(line);
    }
    return lines;
}

/**
 * @brief Groups lines into pages.
 * @param lines The lines.
 * @param perPage Lines per page (at least 1).
 * @return The pages; at least one, even for no lines.
 */
export function paginate (lines: string[], perPage: number): string[][]
{
    const size = Math.max(1, Math.floor(perPage));
    const pages: string[][] = [];
    for (let i = 0; i < lines.length; i += size) pages.push(lines.slice(i, i + size));
    if (pages.length === 0) pages.push([]);
    return pages;
}

/**
 * @brief Number of characters on a page, as counted by the typewriter.
 * @param page Lines of the page.
 * @return Characters (code points) on all its lines.
 */
export function pageLength (page: string[]): number
{
    let count = 0;
    for (const line of page) count += chars(line).length;
    return count;
}
