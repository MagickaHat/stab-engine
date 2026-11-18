/**
 * @file loader.ts
 * @brief Loads and caches the UI's images and fonts.
 *
 * Every image is requested once and shared: `loadImage(url)` returns the same
 * promise for the same URL, and `getLoadedImage(url)` gives it back
 * synchronously once it is there. Components use `useImage(url)`.
 *
 * Fonts are loaded with the CSS Font Loading API (`FontFace`), so canvas text
 * can be drawn as soon as `loadFont()` resolves.
 *
 * `preloadUi()` loads a list of both before the UI is shown;
 * `<UiAssetGate>` (src/ui/assets/UiAssetGate.tsx) does that for the default set.
 */
import { useEffect, useState } from 'react';

/** @brief Images being loaded or loaded, by URL. */
const imagePromises = new Map<string, Promise<HTMLImageElement>>();
/** @brief Images that finished loading, by URL. */
const images = new Map<string, HTMLImageElement>();
/** @brief Fonts being loaded or loaded, by family name. */
const fontPromises = new Map<string, Promise<FontFace>>();

/**
 * @brief Loads an image once and caches it.
 * @param url Image URL (see src/ui/assets/paths.ts).
 * @return Resolves with the decoded image; rejects if it cannot be loaded.
 */
export function loadImage (url: string): Promise<HTMLImageElement>
{
    let promise = imagePromises.get(url);
    if (promise) return promise;
    promise = new Promise<HTMLImageElement>((resolve, reject) =>
    {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () =>
        {
            images.set(url, image);
            resolve(image);
        };
        image.onerror = () =>
        {
            imagePromises.delete(url);
            reject(new Error(`UI image not found: ${url}`));
        };
        image.src = url;
    });
    imagePromises.set(url, promise);
    return promise;
}

/**
 * @brief An image that has already finished loading.
 * @param url Image URL.
 * @return The image, or `null` if it is not loaded (yet).
 */
export function getLoadedImage (url: string): HTMLImageElement | null
{
    return images.get(url) ?? null;
}

/**
 * @brief Loads an image and re-renders the component once it is there.
 *
 * @code
 * const arrow = useImage(uiImageUrl('sel_arrow'));
 * if (!arrow) return null;
 * @endcode
 *
 * @param url Image URL, or `null` for none.
 * @return The image, or `null` while it loads (or if it failed; the error is logged).
 */
export function useImage (url: string | null): HTMLImageElement | null
{
    const [image, setImage] = useState<HTMLImageElement | null>(() => (url ? getLoadedImage(url) : null));

    useEffect(() =>
    {
        if (!url)
        {
            setImage(null);
            return undefined;
        }
        const ready = getLoadedImage(url);
        setImage(ready);
        if (ready) return undefined;
        let live = true;
        loadImage(url).then(
            (loaded) => { if (live) setImage(loaded); },
            (error: Error) => console.warn(`[ui] ${error.message}`),
        );
        return () => { live = false; };
    }, [url]);

    return image;
}

/**
 * @brief Loads a font file and adds it to the page under `family`.
 * @param family Name to use in CSS and canvas, e.g. `"STAB FRLG"`.
 * @param url Font URL (see `fontUrl()`).
 * @return Resolves once the font can be drawn.
 */
export function loadFont (family: string, url: string): Promise<FontFace>
{
    let promise = fontPromises.get(family);
    if (promise) return promise;
    const face = new FontFace(family, `url("${url}")`);
    promise = face.load().then((loaded) =>
    {
        document.fonts.add(loaded);
        return loaded;
    });
    promise.catch(() => fontPromises.delete(family));
    fontPromises.set(family, promise);
    return promise;
}

/**
 * @brief Whether a font added with `loadFont()` is ready.
 * @param family Font family name.
 * @return `true` once it can be drawn.
 */
export function isFontLoaded (family: string): boolean
{
    for (const face of document.fonts) if (face.family.replace(/"/g, '') === family && face.status === 'loaded') return true;
    return false;
}

/** @brief A list of files for `preloadUi()`. */
export interface UiPreloadList
{
    /** Image URLs. */
    images?: string[];
    /** Fonts as `{ family, url }`. */
    fonts?: { family: string; url: string }[];
}

/**
 * @brief Loads several images and fonts at once.
 *
 * A file that fails is logged and skipped; the rest still load.
 *
 * @param list What to load.
 * @return Resolves when everything has finished (loaded or failed).
 */
export async function preloadUi (list: UiPreloadList): Promise<void>
{
    const jobs: Promise<unknown>[] = [
        ...(list.images ?? []).map((url) => loadImage(url)),
        ...(list.fonts ?? []).map(({ family, url }) => loadFont(family, url)),
    ];
    const results = await Promise.allSettled(jobs);
    for (const result of results)
    {
        if (result.status === 'rejected') console.warn('[ui] could not preload:', result.reason);
    }
}
