/**
 * @file localizedTextures.ts
 * @brief Translated graphics in Phaser, under texture keys that never change.
 *
 * Phaser code names a graphic by its original path (`ui/battle/cursor_command`),
 * which is also its **texture key** in every language. Which file is loaded
 * for that key was decided at build time (src/i18n/graphics.ts); if the
 * graphic has a text overlay (`content/locales/overlays`), the translated words
 * are drawn into the texture under the same key. Sprites, animations and
 * code that use the key never need to know the language.
 *
 * The locale each key was made for is remembered: asking for the key again
 * in another locale (a save in another language was loaded) replaces the
 * texture, frames included, still under the same key.
 *
 * @code
 * await loadLocalizedTexture(this, 'ui/battle/cursor_command', { frameWidth: 65, frameHeight: 23 });
 * this.add.sprite(120, 150, 'ui/battle/cursor_command', 1);
 * @endcode
 */
import type { Scene, Textures } from 'phaser';
import { BASE_LOCALE, overlayApplies } from '../i18n';
import { renderOverlay } from '../ui/i18n/overlay';
import { getLocalizer, graphicFor, TEXT_OVERLAYS } from '../world/text';

/** @brief Locale each localized texture key was made for. */
const madeFor = new Map<string, string>();

/** @brief Cut a sprite sheet into equal frames. */
export interface SheetFrames
{
    frameWidth: number;
    frameHeight: number;
}

/**
 * @brief The locale a texture key was made for.
 * @param key Texture key (the graphic's path).
 * @return The locale, or `undefined` if the key was not made by `loadLocalizedTexture()`.
 */
export function localizedTextureLocale (key: string): string | undefined
{
    return madeFor.get(key);
}

/**
 * @brief Load a graphic in the game's language under its own path as texture key.
 * @param scene Scene whose loader and texture manager to use.
 * @param graphic Path under `assets/img/` without `.png`.
 * @param frames Frame size for a sprite sheet; frames are numbered from 0, row by row.
 * @param locale Locale. Default: the game's localizer's.
 * @return Resolves when the texture (with its overlay) is ready.
 */
export async function loadLocalizedTexture (scene: Scene, graphic: string, frames?: SheetFrames, locale?: string): Promise<void>
{
    const text = getLocalizer();
    const wanted = locale ?? text?.locale ?? BASE_LOCALE;
    const textures = scene.textures;
    if (textures.exists(graphic) && madeFor.get(graphic) === wanted) return;
    if (textures.exists(graphic)) textures.remove(graphic);

    const url = `assets/img/${graphicFor(graphic, wanted)}.png`;
    await new Promise<void>((resolve, reject) =>
    {
        const done = () => resolve();
        scene.load.once(`filecomplete-image-${graphic}`, done);
        scene.load.once(`filecomplete-spritesheet-${graphic}`, done);
        scene.load.once('loaderror', (file: { key: string }) => { if (file.key === graphic) reject(new Error(`could not load ${url}`)); });
        if (frames) scene.load.spritesheet(graphic, url, frames);
        else scene.load.image(graphic, url);
        if (!scene.load.isLoading()) scene.load.start();
    });

    const overlay = TEXT_OVERLAYS.get(graphic);
    if (overlay && text && overlayApplies(overlay, wanted))
    {
        await document.fonts.ready;
        const source = textures.get(graphic);
        const image = source.getSourceImage() as HTMLImageElement;
        const canvas = renderOverlay(image, overlay, (key) => text.format(key));
        replaceKeepingFrames(textures, graphic, source, canvas);
    }
    madeFor.set(graphic, wanted);
}

/**
 * @brief Replace a texture by a canvas under the same key, keeping its frames.
 * @param textures Texture manager.
 * @param key Texture key.
 * @param old The texture being replaced.
 * @param canvas The new pixels (same size).
 */
function replaceKeepingFrames (textures: Textures.TextureManager, key: string, old: Textures.Texture, canvas: HTMLCanvasElement): void
{
    const frames = old.getFrameNames().map((name) =>
    {
        const frame = old.get(name);
        return { name, x: frame.cutX, y: frame.cutY, width: frame.cutWidth, height: frame.cutHeight };
    });
    textures.remove(key);
    const texture = textures.addCanvas(key, canvas);
    if (!texture) return;
    for (const frame of frames) texture.add(frame.name, 0, frame.x, frame.y, frame.width, frame.height);
}
