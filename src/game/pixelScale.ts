/**
 * @file pixelScale.ts
 * @brief Works out a pixel-perfect scale for the game (pure maths, no DOM).
 *
 * Pixel art only stays sharp and even when every game pixel covers the same
 * whole number of physical screen pixels. A scale of 2.37 makes some game
 * pixels 2 screen pixels wide and others 3, which reads as wobbly, uneven
 * pixels ("mixels"). So the game is scaled by the largest whole number of
 * *device* pixels that fits, and centred with the rest of the screen left as
 * a border. On a phone with a device pixel ratio of 2.75 this is often 5×,
 * which is 1.818… CSS pixels per game pixel.
 */

/** @brief Result of `computePixelScale()`. */
export interface PixelScale
{
    /** Physical screen pixels per game pixel. A whole number, at least 1. */
    deviceScale: number;
    /** CSS pixels per game pixel (`deviceScale / dpr`). */
    cssScale: number;
    /** Width of the game on the page, in CSS pixels. */
    width: number;
    /** Height of the game on the page, in CSS pixels. */
    height: number;
    /** Left edge of the game, in CSS pixels, on a whole device pixel. */
    left: number;
    /** Top edge of the game, in CSS pixels, on a whole device pixel. */
    top: number;
}

/**
 * @brief Rounds a CSS length to the nearest whole device pixel.
 * @param css Length in CSS pixels.
 * @param dpr Device pixel ratio.
 * @return The snapped length, in CSS pixels.
 */
export function snapToDevice (css: number, dpr: number): number
{
    return Math.round(css * dpr) / dpr;
}

/**
 * @brief Largest whole-device-pixel scale of the game that fits an area, centred in it.
 * @param areaLeft Left of the area, in CSS pixels from the window.
 * @param areaTop Top of the area, in CSS pixels from the window.
 * @param areaWidth Width of the area, in CSS pixels.
 * @param areaHeight Height of the area, in CSS pixels.
 * @param dpr `window.devicePixelRatio` (anything not above 0 counts as 1).
 * @param gameWidth Game width, in game pixels.
 * @param gameHeight Game height, in game pixels.
 * @return The scale and where the game goes.
 */
export function computePixelScale (
    areaLeft: number, areaTop: number, areaWidth: number, areaHeight: number,
    dpr: number, gameWidth: number, gameHeight: number,
): PixelScale
{
    const ratio = dpr > 0 ? dpr : 1;
    //  A tiny epsilon so 2.9999999 (float noise from zoomed browsers) still counts as 3.
    const fit = Math.min((areaWidth * ratio) / gameWidth, (areaHeight * ratio) / gameHeight);
    const deviceScale = Math.max(1, Math.floor(fit + 1e-6));
    const cssScale = deviceScale / ratio;
    const width = gameWidth * cssScale;
    const height = gameHeight * cssScale;
    return {
        deviceScale,
        cssScale,
        width,
        height,
        left: snapToDevice(areaLeft + (areaWidth - width) / 2, ratio),
        top: snapToDevice(areaTop + (areaHeight - height) / 2, ratio),
    };
}

/**
 * @brief CSS transform that places and scales a 1× element pixel-perfectly.
 *
 * Use it with `transform-origin: 0 0` on an element whose CSS size is the
 * game size. Unlike `left`/`top`/`width`, transforms are not rounded to
 * 1/64 px by the browser, so the element lands exactly on device pixels.
 *
 * @param x Offset from the element's normal position, in CSS pixels.
 * @param y Offset from the element's normal position, in CSS pixels.
 * @param scale CSS pixels per game pixel.
 * @return The `transform` value.
 */
export function pixelTransform (x: number, y: number, scale: number): string
{
    return `translate(${x}px, ${y}px) scale(${scale})`;
}
