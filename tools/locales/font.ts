/**
 * @file font.ts
 * @brief Reads a WOFF2 or TrueType font: which characters it has and how wide they are.
 *
 * The validator uses this to check that every translated text can be drawn
 * (each character has a glyph) and fits its space, measured exactly like the
 * game measures it (`fontAdvance()` in src/ui/text/render.ts:
 * `round(advance / unitsPerEm × size) + letterSpacing`).
 *
 * Only the `cmap`, `head`, `hhea` and `hmtx` tables are read.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

/** @brief What the tools need from a font. */
export interface FontMetrics
{
    unitsPerEm: number;
    /** Code point → glyph index. */
    glyphs: Map<number, number>;
    /** Advance width of each glyph, in font units. */
    advances: number[];
}

/** @brief Tags of WOFF2's known-table index (section 5.1 of the WOFF2 specification). */
const KNOWN_TAGS = [
    'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG',
    'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
    'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc',
    'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
    'Gloc', 'Feat', 'Sill',
];

/** @brief A table's bytes, and whether it is stored in WOFF2's transformed form. */
interface RawTable
{
    data: Buffer;
    transformed: boolean;
}

/**
 * @brief Read the tables of a WOFF2 file.
 * @param buffer The file.
 * @return Tables by tag.
 */
function readWoff2 (buffer: Buffer): Map<string, RawTable>
{
    const numTables = buffer.readUInt16BE(12);
    let pos = 48;
    const base128 = (): number =>
    {
        let value = 0;
        for (let i = 0; i < 5; i++)
        {
            const byte = buffer[pos++];
            value = (value * 128) + (byte & 0x7f);
            if (!(byte & 0x80)) return value;
        }
        throw new Error('bad UIntBase128');
    };
    const entries: { tag: string; length: number; transformed: boolean }[] = [];
    for (let i = 0; i < numTables; i++)
    {
        const flags = buffer[pos++];
        let tag: string;
        if ((flags & 0x3f) === 63)
        {
            tag = buffer.toString('latin1', pos, pos + 4);
            pos += 4;
        }
        else tag = KNOWN_TAGS[flags & 0x3f];
        const version = (flags >> 6) & 3;
        const origLength = base128();
        const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
        const length = transformed ? base128() : origLength;
        entries.push({ tag, length, transformed });
    }
    const compressedSize = buffer.readUInt32BE(20);
    const stream = zlib.brotliDecompressSync(buffer.subarray(pos, pos + compressedSize));
    const tables = new Map<string, RawTable>();
    let offset = 0;
    for (const entry of entries)
    {
        tables.set(entry.tag, { data: stream.subarray(offset, offset + entry.length), transformed: entry.transformed });
        offset += entry.length;
    }
    return tables;
}

/**
 * @brief Read the tables of a TrueType/OpenType file.
 * @param buffer The file.
 * @return Tables by tag.
 */
function readSfnt (buffer: Buffer): Map<string, RawTable>
{
    const numTables = buffer.readUInt16BE(4);
    const tables = new Map<string, RawTable>();
    for (let i = 0; i < numTables; i++)
    {
        const at = 12 + i * 16;
        const tag = buffer.toString('latin1', at, at + 4);
        const offset = buffer.readUInt32BE(at + 8);
        const length = buffer.readUInt32BE(at + 12);
        tables.set(tag, { data: buffer.subarray(offset, offset + length), transformed: false });
    }
    return tables;
}

/**
 * @brief Read the character map (formats 4 and 12 of Unicode subtables).
 * @param cmap The `cmap` table.
 * @return Code point → glyph index.
 */
function readCmap (cmap: Buffer): Map<number, number>
{
    const glyphs = new Map<number, number>();
    const count = cmap.readUInt16BE(2);
    const subtables: number[] = [];
    for (let i = 0; i < count; i++)
    {
        const platform = cmap.readUInt16BE(4 + i * 8);
        const encoding = cmap.readUInt16BE(6 + i * 8);
        const offset = cmap.readUInt32BE(8 + i * 8);
        if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) subtables.push(offset);
    }
    for (const offset of subtables)
    {
        const format = cmap.readUInt16BE(offset);
        if (format === 4)
        {
            const segX2 = cmap.readUInt16BE(offset + 6);
            const ends = offset + 14;
            const starts = ends + segX2 + 2;
            const deltas = starts + segX2;
            const ranges = deltas + segX2;
            for (let s = 0; s < segX2 / 2; s++)
            {
                const end = cmap.readUInt16BE(ends + s * 2);
                const start = cmap.readUInt16BE(starts + s * 2);
                const delta = cmap.readInt16BE(deltas + s * 2);
                const rangeOffset = cmap.readUInt16BE(ranges + s * 2);
                for (let c = start; c <= end && c !== 0xffff; c++)
                {
                    let glyph: number;
                    if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
                    else
                    {
                        const at = ranges + s * 2 + rangeOffset + (c - start) * 2;
                        glyph = cmap.readUInt16BE(at);
                        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
                    }
                    if (glyph !== 0 && !glyphs.has(c)) glyphs.set(c, glyph);
                }
            }
        }
        else if (format === 12)
        {
            const groups = cmap.readUInt32BE(offset + 12);
            for (let g = 0; g < groups; g++)
            {
                const at = offset + 16 + g * 12;
                const start = cmap.readUInt32BE(at);
                const end = cmap.readUInt32BE(at + 4);
                const first = cmap.readUInt32BE(at + 8);
                for (let c = start; c <= end; c++) if (!glyphs.has(c)) glyphs.set(c, first + c - start);
            }
        }
    }
    return glyphs;
}

/**
 * @brief Read a font file's metrics.
 * @param file Path of a `.woff2`, `.ttf` or `.otf` file.
 * @return Character map and advances.
 * @throws Error if a needed table is missing.
 */
export function readFontMetrics (file: string): FontMetrics
{
    const buffer = fs.readFileSync(file);
    const tables = buffer.toString('latin1', 0, 4) === 'wOF2' ? readWoff2(buffer) : readSfnt(buffer);
    const need = (tag: string) =>
    {
        const table = tables.get(tag);
        if (!table) throw new Error(`${file}: no "${tag}" table`);
        return table;
    };
    const unitsPerEm = need('head').data.readUInt16BE(18);
    const numberOfHMetrics = need('hhea').data.readUInt16BE(34);
    const hmtx = need('hmtx');
    //  A transformed hmtx starts with one flags byte, then the advances as usual.
    const start = hmtx.transformed ? 1 : 0;
    const step = hmtx.transformed ? 2 : 4;
    const advances: number[] = [];
    for (let i = 0; i < numberOfHMetrics; i++) advances.push(hmtx.data.readUInt16BE(start + i * step));
    return { unitsPerEm, glyphs: readCmap(need('cmap').data), advances };
}

/**
 * @brief Width of each character in game pixels, as the game measures it.
 * @param metrics The font.
 * @param size Native size in pixels (`PixelFont.size`).
 * @param letterSpacing Extra pixels per character (`PixelFont.letterSpacing`).
 * @return `(char) => width`; characters without a glyph measure 0.
 */
export function pixelAdvance (metrics: FontMetrics, size: number, letterSpacing = 0): (char: string) => number
{
    const last = metrics.advances[metrics.advances.length - 1] ?? 0;
    return (char) =>
    {
        const glyph = metrics.glyphs.get(char.codePointAt(0) ?? 0);
        if (glyph === undefined) return 0;
        const units = metrics.advances[glyph] ?? last;
        return Math.round(units / metrics.unitsPerEm * size) + letterSpacing;
    };
}

/**
 * @brief Whether a font can draw a character. Spaces and line breaks always can.
 * @param metrics The font.
 * @param char One character.
 */
export function hasGlyph (metrics: FontMetrics, char: string): boolean
{
    return /\s/.test(char) || metrics.glyphs.has(char.codePointAt(0) ?? 0);
}
