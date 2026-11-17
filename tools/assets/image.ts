/**
 * @file image.ts
 * @brief Pixel-art resizing: undoing a pack's pre-applied upscale without
 *        blurring, and fitting sprites onto a fixed canvas.
 */
import type { Image } from './png.ts';

/**
 * @brief How a source that is not a clean upscale is reduced by `divide`.
 *
 * Every filter returns the image unchanged in content (lossless) when it is a
 * clean upscale; they only differ on blocks that are not one solid colour.
 *
 * - `nearest`: keep one fixed pixel of every block. Fast; may drop or
 *   double thin lines.
 * - `dominant`: keep the colour that covers most of the block. Never makes
 *   new colours, so pixel art stays on one clean pixel grid (no mixels).
 * - `average`: blend the block (alpha-aware). For soft art such as fogs,
 *   gradients and transition masks, where blending is what looks right.
 * - `auto`: `dominant` for pixel art, `average` for soft art (see `chooseFilter()`).
 */
export type ResizeFilter = 'nearest' | 'dominant' | 'average' | 'auto';

/**
 * @brief How a rule wants its images resized. Give `size` or `divide`.
 *
 * - `size: [96, 96]` — the output must be exactly this big. A source that is
 *   a whole multiple (192×192, 288×288) is reduced by that factor; any other
 *   source has its own upscale removed and is then placed bottom-centre on the canvas.
 * - `divide: 2` — the pack stores everything at 2×, so halve it.
 * - `divide: 'auto'` — detect the upscale of each image and remove it.
 * - neither — copy the pixels unchanged.
 *
 * `filter` only applies to `divide` with a number. When it is set, an image
 * whose size is not a multiple of `divide` is padded with transparent pixels
 * on the right/bottom and reduced (note `evened`) instead of being left alone.
 */
export interface ImageOp
{
    size?: [width: number, height: number];
    divide?: number | 'auto';
    /** Default `nearest`. */
    filter?: ResizeFilter;
}

/**
 * @brief Something worth telling the user about one converted image.
 *
 * - `resampled`: the source was not a clean upscale, so pixels were dropped
 *   (one pixel, or the main colour, kept per block). Right size, no new
 *   colours, but fine detail may be lost.
 * - `smoothed`: the source is soft art, not pixel art; blocks were blended.
 * - `padded`: the sprite was smaller than the canvas; it was placed bottom-centre.
 * - `oversize`: the sprite is larger than the canvas even at 1× and was left
 *   at its reduced size.
 * - `odd-size`: the size is not a multiple of `divide`; left unchanged.
 * - `evened`: the size was not a multiple of `divide`; transparent pixels
 *   were added on the right/bottom before reducing.
 */
export type ImageNote = 'resampled' | 'smoothed' | 'padded' | 'oversize' | 'odd-size' | 'evened';

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
 * @brief Read a whole image as packed pixels (see `pixel()`).
 * @param image Image.
 * @return One RGBA value per pixel; fully transparent pixels are 0.
 */
function packed (image: Image): Uint32Array
{
    const out = new Uint32Array(image.width * image.height);
    for (let i = 0; i < out.length; i++)
    {
        const o = i * 4;
        const d = image.data;
        out[i] = d[o + 3] === 0 ? 0 : ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
    }
    return out;
}

/**
 * @brief Perceived brightness of a packed pixel, used to break ties.
 * @param value Packed RGBA.
 * @return 0 (black) to 255 (white).
 */
function luma (value: number): number
{
    return ((value >>> 24) * 299 + ((value >>> 16) & 0xff) * 587 + ((value >>> 8) & 0xff) * 114) / 1000;
}

/**
 * @brief Reduce an image by a whole factor, keeping the main colour of each `k`×`k` block.
 *
 * Lossless when `isUpscaledBy(image, k)`. On mixed blocks the colour that
 * covers most of the block wins. On a tie, the colour that is rarer in the
 * blocks around it wins (so a thin outline or highlight survives instead of
 * being swallowed by the area next to it), then the more opaque, then the
 * darker one. No colour is ever invented, and every output pixel stands for
 * exactly one block, so the result sits on one clean pixel grid.
 *
 * @param image Image whose size is a multiple of `k`.
 * @param k Reduction factor (1 returns the image unchanged).
 * @return The reduced image.
 */
export function reduceDominant (image: Image, k: number): Image
{
    if (k <= 1) return image;
    const src = packed(image);
    const width = Math.floor(image.width / k);
    const height = Math.floor(image.height / k);
    const data = new Uint8Array(width * height * 4);
    const counts = new Map<number, number>();
    for (let by = 0; by < height; by++)
    {
        for (let bx = 0; bx < width; bx++)
        {
            counts.clear();
            let best = 0;
            for (let y = by * k; y < (by + 1) * k; y++)
            {
                for (let x = bx * k; x < (bx + 1) * k; x++)
                {
                    const value = src[y * image.width + x];
                    const count = (counts.get(value) ?? 0) + 1;
                    counts.set(value, count);
                    if (count > best) best = count;
                }
            }
            let tied = [...counts].filter(([, count]) => count === best).map(([value]) => value);
            if (tied.length > 1)
            {
                // How often each candidate appears in the ring of blocks around this one.
                const ring = new Map<number, number>(tied.map((value) => [value, 0]));
                const x0 = Math.max(0, (bx - 1) * k), x1 = Math.min(image.width, (bx + 2) * k);
                const y0 = Math.max(0, (by - 1) * k), y1 = Math.min(image.height, (by + 2) * k);
                for (let y = y0; y < y1; y++)
                {
                    const inBlockRow = y >= by * k && y < (by + 1) * k;
                    for (let x = x0; x < x1; x++)
                    {
                        if (inBlockRow && x >= bx * k && x < (bx + 1) * k) continue;
                        const value = src[y * image.width + x];
                        const seen = ring.get(value);
                        if (seen !== undefined) ring.set(value, seen + 1);
                    }
                }
                tied.sort((a, b) => ring.get(a)! - ring.get(b)! || (b & 0xff) - (a & 0xff) || luma(a) - luma(b) || a - b);
                tied = tied.slice(0, 1);
            }
            const value = tied[0];
            data.set([value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff], (by * width + bx) * 4);
        }
    }
    return { width, height, data };
}

/**
 * @brief Reduce an image by a whole factor, averaging each `k`×`k` block.
 *
 * Colours are weighted by alpha, so transparent pixels do not darken edges.
 * Meant for soft (non pixel-art) images; it makes new in-between colours.
 *
 * @param image Image whose size is a multiple of `k`.
 * @param k Reduction factor (1 returns the image unchanged).
 * @return The reduced image.
 */
export function reduceAverage (image: Image, k: number): Image
{
    if (k <= 1) return image;
    const width = Math.floor(image.width / k);
    const height = Math.floor(image.height / k);
    const data = new Uint8Array(width * height * 4);
    const area = k * k;
    for (let by = 0; by < height; by++)
    {
        for (let bx = 0; bx < width; bx++)
        {
            let r = 0, g = 0, b = 0, a = 0;
            for (let y = by * k; y < (by + 1) * k; y++)
            {
                for (let x = bx * k; x < (bx + 1) * k; x++)
                {
                    const o = (y * image.width + x) * 4;
                    const alpha = image.data[o + 3];
                    r += image.data[o] * alpha;
                    g += image.data[o + 1] * alpha;
                    b += image.data[o + 2] * alpha;
                    a += alpha;
                }
            }
            const o = (by * width + bx) * 4;
            if (a === 0) continue;
            data[o] = Math.round(r / a);
            data[o + 1] = Math.round(g / a);
            data[o + 2] = Math.round(b / a);
            data[o + 3] = Math.round(a / area);
        }
    }
    return { width, height, data };
}

/** @brief Result of `blockStats()`. */
export interface BlockStats
{
    /** Share (0–1) of the not fully transparent `k`×`k` blocks that are one solid colour. */
    solid: number;
    /** Number of distinct colours, counting stops at 257. */
    colors: number;
    /**
     * Share (0–1) of neighbouring pixels that differ only slightly (no
     * channel by more than 16), out of all neighbouring pixels that differ.
     * Gradients and soft shading score high; pixel art, whose colours step
     * in clear jumps, scores low (Essentials' art: at most about 0.1).
     */
    gentle: number;
}

/** @brief Largest per-channel step that still counts as a gentle (gradient) step. */
const GENTLE_STEP = 16;

/**
 * @brief Measure how much an image looks like upscaled pixel art.
 * @param image Image whose size is a multiple of `k`.
 * @param k Block size.
 * @return Solid-block share and colour count.
 */
export function blockStats (image: Image, k: number): BlockStats
{
    const src = packed(image);
    const colors = new Set<number>();
    for (let i = 0; i < src.length && colors.size <= 256; i++) colors.add(src[i]);
    let steps = 0, gentle = 0;
    const compare = (a: number, b: number) =>
    {
        if (src[a] === src[b]) return;
        steps++;
        const pa = a * 4, pb = b * 4;
        let most = 0;
        for (let c = 0; c < 4; c++) most = Math.max(most, Math.abs(image.data[pa + c] * (src[a] ? 1 : 0) - image.data[pb + c] * (src[b] ? 1 : 0)));
        if (most <= GENTLE_STEP) gentle++;
    };
    for (let y = 0; y < image.height; y++)
    {
        for (let x = 0; x < image.width; x++)
        {
            const i = y * image.width + x;
            if (x + 1 < image.width) compare(i, i + 1);
            if (y + 1 < image.height) compare(i, i + image.width);
        }
    }
    let blocks = 0, solid = 0;
    for (let by = 0; by + k <= image.height; by += k)
    {
        for (let bx = 0; bx + k <= image.width; bx += k)
        {
            const first = src[by * image.width + bx];
            let same = true, empty = true;
            for (let y = by; y < by + k; y++)
            {
                for (let x = bx; x < bx + k; x++)
                {
                    const value = src[y * image.width + x];
                    if (value !== first) same = false;
                    if (value !== 0) empty = false;
                }
            }
            if (empty) continue;
            blocks++;
            if (same) solid++;
        }
    }
    return { solid: blocks ? solid / blocks : 1, colors: colors.size, gentle: steps ? gentle / steps : 0 };
}

/**
 * @brief Pick the filter `auto` stands for.
 *
 * Soft art (gradients such as transition masks, translucent fogs) is
 * blended, because keeping one value per block would turn a smooth ramp
 * into noise. Pixel art keeps one colour per block, so it stays on a clean
 * pixel grid with its own palette.
 *
 * @param image Image whose size is a multiple of `k`.
 * @param k Reduction factor.
 * @return `average` when the image has over 64 colours and at least 30% of
 *         its colour steps are gentle, or under half its blocks are solid
 *         with over 256 colours; else `dominant`. (A small palette is pixel
 *         art even when its shades are close together.)
 */
export function chooseFilter (image: Image, k: number): 'dominant' | 'average'
{
    const { solid, colors, gentle } = blockStats(image, k);
    return (colors > 64 && gentle >= 0.3) || (solid < 0.5 && colors > 256) ? 'average' : 'dominant';
}

/**
 * @brief Grow an image with transparent pixels on the right and bottom.
 * @param image Image.
 * @param width New width (at least the current one).
 * @param height New height (at least the current one).
 * @return The larger image, or `image` itself if the size is unchanged.
 */
export function extend (image: Image, width: number, height: number): Image
{
    if (width === image.width && height === image.height) return image;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < image.height; y++)
    {
        data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), y * width * 4);
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
        const k = op.divide;
        if (image.width % k || image.height % k)
        {
            if (!op.filter) return { image, notes: ['odd-size'] };
            image = extend(image, Math.ceil(image.width / k) * k, Math.ceil(image.height / k) * k);
            notes.push('evened');
        }
        if (isUpscaledBy(image, k)) return { image: reduce(image, k), notes };
        const filter = op.filter === 'auto' ? chooseFilter(image, k) : op.filter ?? 'nearest';
        if (filter === 'average')
        {
            notes.push('smoothed');
            return { image: reduceAverage(image, k), notes };
        }
        notes.push('resampled');
        return { image: filter === 'dominant' ? reduceDominant(image, k) : reduce(image, k), notes };
    }

    return { image, notes };
}
