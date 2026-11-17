/**
 * @file bmp.ts
 * @brief Minimal Windows bitmap reader, for the odd `.bmp` that RPG Maker
 *        projects and resource packs still contain. Imported as PNG.
 *
 * Reads uncompressed bitmaps (1, 4, 8, 16, 24 and 32 bits per pixel,
 * including `BI_BITFIELDS` masks and alpha), bottom-up or top-down.
 * Run-length compressed bitmaps are refused.
 */
import type { Image } from './png.ts';

/** @brief Compression types this reader understands. */
const BI_RGB = 0;
const BI_BITFIELDS = 3;
const BI_ALPHABITFIELDS = 6;

/**
 * @brief Turn a bit mask into a function that reads that channel as 0–255.
 * @param mask Mask, e.g. `0x00ff0000`.
 * @return Reader, or `null` when the mask is empty.
 */
function channel (mask: number): ((value: number) => number) | null
{
    if (!mask) return null;
    let shift = 0;
    while (!((mask >>> shift) & 1)) shift++;
    const max = mask >>> shift;
    return (value) => Math.round((((value & mask) >>> shift) * 255) / max);
}

/**
 * @brief Decode a BMP file.
 * @param file File contents.
 * @return The image as 8-bit RGBA.
 * @throws Error if the file is not a bitmap this reader supports.
 */
export function decodeBmp (file: Uint8Array): Image
{
    const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
    if (buf.length < 26 || buf.toString('latin1', 0, 2) !== 'BM') throw new Error('not a BMP file');
    const dataOffset = buf.readUInt32LE(10);
    const headerSize = buf.readUInt32LE(14);
    if (headerSize < 40) throw new Error('old OS/2 bitmaps are not supported');
    const width = buf.readInt32LE(18);
    const rawHeight = buf.readInt32LE(22);
    const bits = buf.readUInt16LE(28);
    const compression = buf.readUInt32LE(30);
    const height = Math.abs(rawHeight);
    const topDown = rawHeight < 0;
    if (width <= 0 || height === 0) throw new Error('bitmap has no pixels');
    if (![BI_RGB, BI_BITFIELDS, BI_ALPHABITFIELDS].includes(compression)) throw new Error(`compressed bitmaps are not supported (type ${compression})`);
    if (![1, 4, 8, 16, 24, 32].includes(bits)) throw new Error(`${bits}-bit bitmaps are not supported`);

    // Channel masks: in the header (V4/V5, or right after a 40-byte header) or the defaults.
    let masks = bits === 16 ? [0x7c00, 0x03e0, 0x001f, 0] : [0x00ff0000, 0x0000ff00, 0x000000ff, 0];
    if (compression !== BI_RGB)
    {
        const at = 14 + 40;
        const count = compression === BI_ALPHABITFIELDS || headerSize >= 56 ? 4 : 3;
        masks = [0, 1, 2, 3].map((i) => (i < count ? buf.readUInt32LE(at + i * 4) : 0));
    }
    else if (bits === 32 && headerSize >= 56)
    {
        masks[3] = buf.readUInt32LE(14 + 52);
    }
    const [red, green, blue, alpha] = masks.map(channel);

    // Palette for 1/4/8-bit images (BGRx entries after the header).
    const palette: number[][] = [];
    if (bits <= 8)
    {
        const used = buf.readUInt32LE(46) || 1 << bits;
        const start = 14 + headerSize;
        for (let i = 0; i < used && start + i * 4 + 3 <= buf.length; i++)
        {
            palette.push([buf[start + i * 4 + 2], buf[start + i * 4 + 1], buf[start + i * 4], 255]);
        }
    }

    const stride = Math.ceil((width * bits) / 32) * 4;
    if (dataOffset + stride * height > buf.length) throw new Error('bitmap is truncated');
    const data = new Uint8Array(width * height * 4);
    let anyAlpha = false;
    for (let y = 0; y < height; y++)
    {
        const row = dataOffset + (topDown ? y : height - 1 - y) * stride;
        for (let x = 0; x < width; x++)
        {
            const o = (y * width + x) * 4;
            if (bits <= 8)
            {
                const bit = x * bits;
                const index = (buf[row + (bit >> 3)] >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
                data.set(palette[index] ?? [0, 0, 0, 255], o);
                continue;
            }
            const value = bits === 16 ? buf.readUInt16LE(row + x * 2)
                : bits === 24 ? buf[row + x * 3] | (buf[row + x * 3 + 1] << 8) | (buf[row + x * 3 + 2] << 16)
                    : buf.readUInt32LE(row + x * 4);
            data[o] = red?.(value) ?? 0;
            data[o + 1] = green?.(value) ?? 0;
            data[o + 2] = blue?.(value) ?? 0;
            data[o + 3] = alpha ? alpha(value) : 255;
            if (alpha && data[o + 3]) anyAlpha = true;
        }
    }
    // Many tools write 32-bit bitmaps with an alpha mask but leave it all zero: treat as opaque.
    if (alpha && !anyAlpha) for (let i = 3; i < data.length; i += 4) data[i] = 255;
    return { width, height, data };
}
