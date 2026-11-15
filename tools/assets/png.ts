/**
 * @file png.ts
 * @brief Minimal PNG reader/writer built on `node:zlib`, so the asset tools
 *        need no native image library.
 *
 * Reads every non-interlaced PNG (greyscale, RGB, palette, with or without
 * alpha, 1–16 bits). Writes palette PNGs when an image has at most 256
 * colours (the usual case for sprites) and RGBA PNGs otherwise.
 */
import zlib from 'node:zlib';

/** @brief A decoded image: 8-bit RGBA, rows top to bottom. */
export interface Image
{
    width: number;
    height: number;
    /** `width * height * 4` bytes. */
    data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @brief Channels per pixel for each PNG colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * @brief Read only the size of a PNG, without decoding it.
 * @param file File contents (the first 24 bytes are enough).
 * @return `[width, height]`, or `null` if this is not a PNG.
 */
export function pngSize (file: Uint8Array): [number, number] | null
{
    const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
    if (buf.length < 24 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

/**
 * @brief Undo PNG scanline filtering in place.
 * @param raw Inflated IDAT data (one filter byte followed by `stride` bytes, per row).
 * @param stride Bytes per row, without the filter byte.
 * @param bpp Bytes per complete pixel (at least 1).
 * @param height Number of rows.
 * @return The unfiltered rows, without filter bytes.
 */
function unfilter (raw: Buffer, stride: number, bpp: number, height: number): Buffer
{
    const out = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++)
    {
        const type = raw[y * (stride + 1)];
        const src = y * (stride + 1) + 1;
        const dst = y * stride;
        for (let x = 0; x < stride; x++)
        {
            const a = x >= bpp ? out[dst + x - bpp] : 0;
            const b = y > 0 ? out[dst + x - stride] : 0;
            const c = x >= bpp && y > 0 ? out[dst + x - stride - bpp] : 0;
            let value = raw[src + x];
            if (type === 1) value += a;
            else if (type === 2) value += b;
            else if (type === 3) value += (a + b) >> 1;
            else if (type === 4)
            {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            else if (type !== 0) throw new Error(`unknown PNG filter type ${type}`);
            out[dst + x] = value & 0xff;
        }
    }
    return out;
}

/**
 * @brief Decode a PNG file to 8-bit RGBA.
 * @param file File contents.
 * @return The image.
 * @throws Error if the file is not a PNG, is corrupt, or is interlaced.
 */
export function decodePng (file: Uint8Array): Image
{
    const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
    if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');

    let width = 0;
    let height = 0;
    let depth = 0;
    let colorType = 0;
    let palette: Buffer | null = null;
    let transparency: Buffer | null = null;
    const idat: Buffer[] = [];

    for (let pos = 8; pos + 8 <= buf.length;)
    {
        const length = buf.readUInt32BE(pos);
        const type = buf.toString('latin1', pos + 4, pos + 8);
        const body = buf.subarray(pos + 8, pos + 8 + length);
        if (type === 'IHDR')
        {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            depth = body[8];
            colorType = body[9];
            if (body[12] !== 0) throw new Error('interlaced PNGs are not supported');
        }
        else if (type === 'PLTE') palette = body;
        else if (type === 'tRNS') transparency = body;
        else if (type === 'IDAT') idat.push(body);
        else if (type === 'IEND') break;
        pos += 12 + length;
    }

    const channels = CHANNELS[colorType];
    if (!width || !height || !channels) throw new Error('corrupt PNG header');
    if (colorType === 3 && !palette) throw new Error('palette PNG without a palette');

    const stride = Math.ceil((width * channels * depth) / 8);
    const bpp = Math.max(1, (channels * depth) >> 3);
    const rows = unfilter(zlib.inflateSync(Buffer.concat(idat)), stride, bpp, height);
    const data = new Uint8Array(width * height * 4);

    /** Read sample `index` of row `y` scaled to 0–255 (palette indices are returned as-is). */
    const sample = (y: number, index: number): number =>
    {
        const row = y * stride;
        if (depth === 8) return rows[row + index];
        if (depth === 16) return rows[row + index * 2];
        const bit = index * depth;
        const value = (rows[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        return colorType === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1));
    };
    /** Read the raw (unscaled) sample, for comparing with a tRNS colour key. */
    const rawSample = (y: number, index: number): number =>
    {
        const row = y * stride;
        if (depth === 16) return rows.readUInt16BE(row + index * 2);
        if (depth === 8) return rows[row + index];
        const bit = index * depth;
        return (rows[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    };

    // Fast paths for the common 8-bit layouts; the general loop below handles the rest.
    if (depth === 8 && colorType === 6)
    {
        data.set(rows);
        return { width, height, data };
    }
    if (depth === 8 && colorType === 3)
    {
        for (let i = 0; i < width * height; i++)
        {
            const index = rows[i];
            data[i * 4] = palette![index * 3];
            data[i * 4 + 1] = palette![index * 3 + 1];
            data[i * 4 + 2] = palette![index * 3 + 2];
            data[i * 4 + 3] = transparency && index < transparency.length ? transparency[index] : 255;
        }
        return { width, height, data };
    }

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            const o = (y * width + x) * 4;
            if (colorType === 3)
            {
                const i = sample(y, x);
                data[o] = palette![i * 3];
                data[o + 1] = palette![i * 3 + 1];
                data[o + 2] = palette![i * 3 + 2];
                data[o + 3] = transparency && i < transparency.length ? transparency[i] : 255;
            }
            else if (colorType === 0 || colorType === 4)
            {
                const grey = sample(y, x * channels);
                data[o] = data[o + 1] = data[o + 2] = grey;
                data[o + 3] = colorType === 4 ? sample(y, x * 2 + 1) : 255;
                if (colorType === 0 && transparency && rawSample(y, x) === transparency.readUInt16BE(0)) data[o + 3] = 0;
            }
            else
            {
                data[o] = sample(y, x * channels);
                data[o + 1] = sample(y, x * channels + 1);
                data[o + 2] = sample(y, x * channels + 2);
                data[o + 3] = colorType === 6 ? sample(y, x * 4 + 3) : 255;
                if (colorType === 2 && transparency &&
                    rawSample(y, x * 3) === transparency.readUInt16BE(0) &&
                    rawSample(y, x * 3 + 1) === transparency.readUInt16BE(2) &&
                    rawSample(y, x * 3 + 2) === transparency.readUInt16BE(4)) data[o + 3] = 0;
            }
        }
    }
    return { width, height, data };
}

/**
 * @brief Build one PNG chunk (length, type, body, CRC).
 * @param type Four-letter chunk type.
 * @param body Chunk contents.
 * @return The encoded chunk.
 */
function chunk (type: string, body: Uint8Array): Buffer
{
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    out.set(body, 8);
    out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
}

/**
 * @brief Encode an image as a PNG file.
 *
 * Fully transparent pixels are stored as transparent black. Images with at
 * most 256 colours become palette PNGs (1, 2, 4 or 8 bits per pixel, with the
 * transparent colour first); others become 8-bit RGBA.
 *
 * @param image Image to write.
 * @return File contents.
 */
export function encodePng (image: Image): Buffer
{
    const { width, height, data } = image;
    const pixels = new Uint32Array(width * height);
    const colors = new Map<number, number>();
    for (let i = 0; i < pixels.length; i++)
    {
        const a = data[i * 4 + 3];
        const rgba = a === 0 ? 0 : ((data[i * 4] << 24) | (data[i * 4 + 1] << 16) | (data[i * 4 + 2] << 8) | a) >>> 0;
        pixels[i] = rgba;
        if (colors.size <= 256 && !colors.has(rgba)) colors.set(rgba, 0);
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    const chunks: Buffer[] = [];
    let raw: Buffer;

    if (colors.size <= 256)
    {
        // Transparent entries first so the tRNS chunk can stop early.
        const list = [...colors.keys()].sort((a, b) => (a & 0xff) - (b & 0xff) || a - b);
        list.forEach((rgba, index) => colors.set(rgba, index));
        const depth = list.length <= 2 ? 1 : list.length <= 4 ? 2 : list.length <= 16 ? 4 : 8;
        const stride = Math.ceil((width * depth) / 8);
        raw = Buffer.alloc((stride + 1) * height);
        for (let y = 0; y < height; y++)
        {
            const row = y * (stride + 1) + 1;
            for (let x = 0; x < width; x++)
            {
                const bit = x * depth;
                raw[row + (bit >> 3)] |= colors.get(pixels[y * width + x])! << (8 - depth - (bit & 7));
            }
        }
        const plte = Buffer.alloc(list.length * 3);
        const trns = Buffer.alloc(list.length, 255);
        let alphaEntries = 0;
        list.forEach((rgba, i) =>
        {
            plte[i * 3] = rgba >>> 24;
            plte[i * 3 + 1] = (rgba >>> 16) & 0xff;
            plte[i * 3 + 2] = (rgba >>> 8) & 0xff;
            trns[i] = rgba & 0xff;
            if (trns[i] !== 255) alphaEntries = i + 1;
        });
        header[8] = depth;
        header[9] = 3;
        chunks.push(chunk('PLTE', plte));
        if (alphaEntries) chunks.push(chunk('tRNS', trns.subarray(0, alphaEntries)));
    }
    else
    {
        const stride = width * 4;
        raw = Buffer.alloc((stride + 1) * height);
        for (let y = 0; y < height; y++)
        {
            for (let x = 0; x < width; x++) raw.writeUInt32BE(pixels[y * width + x], y * (stride + 1) + 1 + x * 4);
        }
        header[8] = 8;
        header[9] = 6;
    }

    return Buffer.concat([
        SIGNATURE,
        chunk('IHDR', header),
        ...chunks,
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', new Uint8Array(0)),
    ]);
}
