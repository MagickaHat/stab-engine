/**
 * @file image.ts
 * @brief Pixel-art resizing: undoing a pack's pre-applied upscale without
 *        blurring, and fitting sprites onto a fixed canvas.
 */
import type { Image } from './png.ts';

/**
 * @brief How a rule wants its images resized. Give `size` or `divide`.
 *
 * - `size: [96, 96]` — the output must be exactly this big. A source that is
 *   a whole multiple (192×192, 288×288) is reduced by that factor; any other
 *   source has its own upscale removed and is then placed bottom-centre on the canvas.
 * - `divide: 2` — the pack stores everything at 2×, so halve it.
 * - `divide: 'auto'` — detect the upscale of each image and remove it.
 * - neither — copy the pixels unchanged.
 */
export interface ImageOp
{
    size?: [width: number, height: number];
    divide?: number | 'auto';
}

/**
 * @brief Something worth telling the user about one converted image.
 *
 * - `resampled`: the source was not a clean upscale, so pixels were dropped
 *   (every Nth pixel kept). The result is the right size but may look rough.
 * - `padded`: the sprite was smaller than the canvas; it was placed bottom-centre.
 * - `oversize`: the sprite is larger than the canvas even at 1× and was left
 *   at its reduced size.
 * - `odd-size`: the size is not a multiple of `divide`; left unchanged.
 */
export type ImageNote = 'resampled' | 'padded' | 'oversize' | 'odd-size';

/** @brief Result of `transform()`. */
export interface TransformResult
{
    image: Image;
    notes: ImageNote[];
}

/**
 * @brief Read one pixel as a single number; all fully transparent pixels compare equal.
 * @param image Image.
 * @param x Column.
 * @param y Row.
 * @return RGBA packed into 32 bits, or 0 when alpha is 0.
 */
function pixel (image: Image, x: number, y: number): number
{
    const o = (y * image.width + x) * 4;
    const d = image.data;
    return d[o + 3] === 0 ? 0 : ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
}

/**
 * @brief Check whether an image is an exact `k`× nearest-neighbour upscale,
 *        i.e. made only of single-colour `k`×`k` blocks.
 * @param image Image.
 * @param k Block size.
 * @return `true` if reducing by `k` loses nothing.
 */
export function isUpscaledBy (image: Image, k: number): boolean
{
    if (k < 2 || image.width % k || image.height % k) return false;
    // Every pixel must equal the top-left pixel of its block.
    for (let y = 0; y < image.height; y++)
    {
        const blockY = y - (y % k);
        for (let x = 0; x < image.width; x++)
        {
            if (x % k === 0 && y === blockY) continue;
            if (pixel(image, x, y) !== pixel(image, x - (x % k), blockY)) return false;
        }
    }
    return true;
}

/**
 * @brief Find the largest factor an image was upscaled by.
 * @param image Image.
 * @param candidates Factors to try, largest first.
 * @return The factor, or 1 if the image is at its native resolution.
 */
export function detectScale (image: Image, candidates: number[] = [4, 3, 2]): number
{
    return candidates.find((k) => isUpscaledBy(image, k)) ?? 1;
}

/**
 * @brief Reduce an image by a whole factor, keeping one pixel per `k`×`k` block.
 *
 * Lossless when `isUpscaledBy(image, k)`; otherwise this is plain point
 * sampling, which keeps the palette intact (no blending) but drops detail.
 *
 * @param image Image.
 * @param k Reduction factor (1 returns the image unchanged).
 * @return The reduced image.
 */
export function reduce (image: Image, k: number): Image
{
    if (k <= 1) return image;
    const width = Math.floor(image.width / k);
    const height = Math.floor(image.height / k);
    const data = new Uint8Array(width * height * 4);
    const pick = k >> 1;
    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            const src = ((y * k + pick) * image.width + x * k + pick) * 4;
            data.set(image.data.subarray(src, src + 4), (y * width + x) * 4);
        }
    }
    return { width, height, data };
}

/**
 * @brief Place an image on a larger transparent canvas, centred horizontally
 *        and resting on the bottom edge (so battle sprites keep their feet,
 *        or the cut-off edge of a back sprite, on the baseline).
 * @param image Image no larger than the canvas.
 * @param width Canvas width.
 * @param height Canvas height.
 * @return The padded image.
 */
export function pad (image: Image, width: number, height: number): Image
{
    const data = new Uint8Array(width * height * 4);
    const left = (width - image.width) >> 1;
    const top = height - image.height;
    for (let y = 0; y < image.height; y++)
    {
        const row = image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4);
        data.set(row, ((y + top) * width + left) * 4);
    }
    return { width, height, data };
}

/**
 * @brief Resize an image as a rule asks.
 * @param image Decoded source image.
 * @param op What the rule wants (see `ImageOp`).
 * @return The new image plus notes about anything lossy or unusual.
 */
export function transform (image: Image, op: ImageOp): TransformResult
{
    const notes: ImageNote[] = [];

    if (op.size)
    {
        const [width, height] = op.size;
        if (image.width === width && image.height === height) return { image, notes };
        const factor = image.width / width;
        if (Number.isInteger(factor) && factor >= 2 && image.height === height * factor)
        {
            if (!isUpscaledBy(image, factor)) notes.push('resampled');
            return { image: reduce(image, factor), notes };
        }
        const native = reduce(image, detectScale(image));
        if (native.width > width || native.height > height) return { image: native, notes: ['oversize'] };
        return { image: pad(native, width, height), notes: ['padded'] };
    }

    if (op.divide === 'auto') return { image: reduce(image, detectScale(image)), notes };

    if (op.divide && op.divide > 1)
    {
        if (image.width % op.divide || image.height % op.divide) return { image, notes: ['odd-size'] };
        if (!isUpscaledBy(image, op.divide)) notes.push('resampled');
        return { image: reduce(image, op.divide), notes };
    }

    return { image, notes };
}
