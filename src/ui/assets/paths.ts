/**
 * @file paths.ts
 * @brief Where the UI's files live, and how to turn a path into a URL.
 *
 * Every UI file is under `public/assets/` and is served next to the page. Use
 * these helpers instead of writing URLs by hand, so the game still finds its
 * files when it is built with a different `base` (see vite/config.*.mjs) or
 * packaged in an Android WebView.
 */

/** @brief Base URL of the app (Vite's `BASE_URL`, `./` in this project). */
const BASE: string = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';

/**
 * @brief Turns a path under `public/` into a URL the page can load.
 * @param path Path relative to `public/`, e.g. `assets/img/ui/sel_arrow.png`.
 * @return The URL.
 */
export function assetUrl (path: string): string
{
    return BASE + path.replace(/^\.?\/+/, '');
}

/** @brief Folders and files used by the UI, relative to `public/`. */
export const UI_PATHS = {
    /** Essentials windowskins (message frames, choice frames, RPG Maker skins). */
    windowskins: 'assets/img/windowskins',
    /** Essentials UI graphics (arrows, menus, screens). */
    ui: 'assets/img/ui',
    /** Fonts. */
    fonts: 'assets/fonts',
    /** UI sound effects (cursor, select, cancel). */
    sounds: 'assets/sound/se/ui',
} as const;

/**
 * @brief URL of a windowskin image.
 * @param name File name without `.png`, e.g. `speech_frlg`.
 * @return The URL.
 */
export function windowskinUrl (name: string): string
{
    return assetUrl(`${UI_PATHS.windowskins}/${name}.png`);
}

/**
 * @brief URL of an image in `assets/img/ui`.
 * @param name File name without `.png`, e.g. `pause_arrow` or `party/bg`.
 * @return The URL.
 */
export function uiImageUrl (name: string): string
{
    return assetUrl(`${UI_PATHS.ui}/${name}.png`);
}

/**
 * @brief URL of a font file.
 * @param file File name with its extension, e.g. `pokemon-frlg.woff2`.
 * @return The URL.
 */
export function fontUrl (file: string): string
{
    return assetUrl(`${UI_PATHS.fonts}/${file}`);
}

/**
 * @brief URL of a UI sound.
 * @param file File name with its extension, e.g. `select.ogg`.
 * @return The URL.
 */
export function uiSoundUrl (file: string): string
{
    return assetUrl(`${UI_PATHS.sounds}/${file}`);
}
