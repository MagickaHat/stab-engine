/**
 * @file timing.ts
 * @brief The maths of the title screen's animated layers, kept free of Phaser
 *        and React so both sides (and tests) share it.
 */

/**
 * @brief Whether a blinking layer is shown at a moment.
 * @param timeMs Milliseconds since the title screen appeared.
 * @param onMs Milliseconds shown per blink.
 * @param offMs Milliseconds hidden per blink.
 * @return `true` while shown. It starts shown.
 */
export function blinkVisible(timeMs: number, onMs: number, offMs: number): boolean
{
    if (!(onMs > 0)) return false;
    if (!(offMs > 0)) return true;
    return timeMs % (onMs + offMs) < onMs;
}

/**
 * @brief Vertical offset of a bobbing layer, in whole pixels.
 * @param timeMs Milliseconds since the title screen appeared.
 * @param amplitude Largest offset in pixels.
 * @param periodMs Milliseconds for one full up-and-down.
 * @return Offset from -`amplitude` to `amplitude`, rounded to a whole pixel.
 */
export function bobOffset(timeMs: number, amplitude: number, periodMs: number): number
{
    if (!(periodMs > 0)) return 0;
    //  `+ 0` turns -0 into 0.
    return Math.round(Math.sin((timeMs / periodMs) * Math.PI * 2) * amplitude) + 0;
}

/**
 * @brief Offset of a scrolling layer, in whole pixels, wrapped to one image.
 * @param timeMs Milliseconds since the title screen appeared.
 * @param speed Pixels per second (negative scrolls the other way).
 * @param size Width (or height) of the image, in pixels.
 * @return Offset from 0 to `size - 1`.
 */
export function scrollOffset(timeMs: number, speed: number, size: number): number
{
    if (!(size > 0)) return 0;
    const offset = Math.floor((timeMs * speed) / 1000) % size;
    return offset < 0 ? offset + size : offset;
}

/**
 * @brief Play time as the Continue panel shows it.
 * @param ms Milliseconds played.
 * @return `h:mm`, e.g. `0:05` or `12:34`. Hours are not capped.
 */
export function formatPlayTime(ms: number): string
{
    const minutes = Math.floor(Math.max(0, ms) / 60_000);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
