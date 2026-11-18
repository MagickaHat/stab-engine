/**
 * @file skins.ts
 * @brief The windowskin registry: which image a window is drawn from, and how.
 *
 * A skin names an image in `public/assets/img/windowskins/` and says how to
 * cut it up, where content goes inside it and which text colours suit it.
 * Components only ask for a skin by id (`<Window skin="speech_frlg">`), so the
 * look of every window can be changed in one place, or by the player in an
 * options menu.
 *
 * Two kinds of image are understood:
 *
 * - **`frame`**: an Essentials speech or choice frame (`speech_frlg.png`,
 *   `choice_1.png`, `speech_hgss_3.png`…). The whole image is one nine-slice.
 *   Unless `slice` is given, the centre is the middle 8×8 pixels.
 * - **`rmxp`**: an RPG Maker XP windowskin (`windowskin.png`), halved to 1× by
 *   the importer: a 64×64 background in the top-left (tiled inside the
 *   window), a 32×32 frame at (64, 0) drawn as a nine-slice with an empty
 *   centre, and a 16×16 cursor at (64, 32).
 *
 * Everything is in game pixels, at 1× (the importer halves Essentials' 2× art).
 */
import { windowskinUrl } from '../assets/paths.ts';
import { centredSlice, fitWindowSize, insets, planNineSlice, tile } from './nineSlice.ts';
import type { DrawOp, Insets, Rect } from './nineSlice.ts';

/** @brief How a skin image is laid out. */
export type SkinFormat = 'frame' | 'rmxp';

/** @brief A windowskin. */
export interface WindowSkin
{
    /** Id the skin is registered under. */
    id: string;
    /** URL of the image. */
    url: string;
    /** Layout of the image. */
    format: SkinFormat;
    /**
     * Corner sizes. `frame`: inside the whole image (default: an 8×8 centre).
     * `rmxp`: inside the 32×32 frame part (default: 8 on every side).
     */
    slice?: Insets;
    /** Where content starts, measured from the window's outer edges. */
    padding: Insets;
    /** Colour of text drawn on this skin. */
    textColor: string;
    /** Colour of that text's shadow, or `null` for none. */
    shadowColor: string | null;
}

/** @brief Where the parts of an RPG Maker XP skin are, at 1×. */
export const RMXP_LAYOUT = {
    /** Window background, tiled. */
    background: { x: 0, y: 0, w: 64, h: 64 } as Rect,
    /** Frame, drawn as a nine-slice with an empty centre. */
    frame: { x: 64, y: 0, w: 32, h: 32 } as Rect,
    /** Selection cursor (itself a nine-slice of 2 px corners). */
    cursor: { x: 64, y: 32, w: 16, h: 16 } as Rect,
    /** Gap between the window edge and its background. */
    backgroundInset: 1,
    /** Default corner size of the frame. */
    slice: 8,
} as const;

/** @brief Text colours of Essentials' dark-text skins. */
export const ESSENTIALS_DARK_TEXT = { textColor: 'rgb(80, 80, 88)', shadowColor: 'rgb(160, 160, 168)' } as const;

/** @brief Text colours of FireRed / LeafGreen message boxes. */
export const FRLG_TEXT = { textColor: 'rgb(96, 96, 96)', shadowColor: 'rgb(208, 208, 200)' } as const;

/** @brief Every registered skin, by id. */
const SKINS = new Map<string, WindowSkin>();

/**
 * @brief Adds a skin, or replaces one with the same id.
 *
 * @code
 * registerSkin({
 *     id: 'speech_hgss_3', url: windowskinUrl('speech_hgss_3'), format: 'frame',
 *     padding: { left: 12, top: 8, right: 12, bottom: 8 }, ...ESSENTIALS_DARK_TEXT,
 * });
 * @endcode
 *
 * @param skin The skin.
 */
export function registerSkin (skin: WindowSkin): void
{
    SKINS.set(skin.id, skin);
}

/**
 * @brief A registered skin.
 * @param id Skin id.
 * @return The skin.
 * @throws If no skin has that id.
 */
export function getSkin (id: string): WindowSkin
{
    const skin = SKINS.get(id);
    if (!skin) throw new Error(`Unknown windowskin "${id}". Register it with registerSkin() (src/ui/skins/skins.ts).`);
    return skin;
}

/**
 * @brief Every registered skin.
 * @return The skins, in the order they were registered.
 */
export function listSkins (): WindowSkin[]
{
    return [...SKINS.values()];
}

/**
 * @brief The corner sizes a skin uses, for an image of this size.
 * @param skin The skin.
 * @param imageWidth Width of its image.
 * @param imageHeight Height of its image.
 * @return The insets.
 */
export function skinSlice (skin: WindowSkin, imageWidth: number, imageHeight: number): Insets
{
    if (skin.slice) return skin.slice;
    if (skin.format === 'rmxp') return insets(RMXP_LAYOUT.slice);
    return centredSlice(imageWidth, imageHeight);
}

/** @brief Result of `planWindow()`. */
export interface WindowPlan
{
    /** Real width of the window (whole pixels, at least its corners). */
    width: number;
    /** Real height of the window. */
    height: number;
    /** Copies from the skin image, in drawing order. None of them is scaled. */
    ops: DrawOp[];
}

/**
 * @brief Works out how to draw a window of a given size with a skin.
 * @param skin The skin.
 * @param imageWidth Width of the skin's image.
 * @param imageHeight Height of the skin's image.
 * @param width Requested window width.
 * @param height Requested window height.
 * @return The real size and the copies to make.
 */
export function planWindow (skin: WindowSkin, imageWidth: number, imageHeight: number, width: number, height: number): WindowPlan
{
    const slice = skinSlice(skin, imageWidth, imageHeight);
    const size = fitWindowSize(slice, width, height);
    if (skin.format === 'frame')
    {
        const source = { x: 0, y: 0, w: imageWidth, h: imageHeight };
        return { ...size, ops: planNineSlice(source, slice, size.width, size.height) };
    }
    const ops: DrawOp[] = [];
    const inset = RMXP_LAYOUT.backgroundInset;
    tile(RMXP_LAYOUT.background, { x: inset, y: inset, w: size.width - inset * 2, h: size.height - inset * 2 }, ops);
    ops.push(...planNineSlice(RMXP_LAYOUT.frame, slice, size.width, size.height, false));
    return { ...size, ops };
}

// ------------------------------------------------------------ Built-in skins

/**
 * @brief Registers an Essentials message frame.
 * @param name File name without `.png` (also the skin id).
 * @param colours Text colours.
 * @param padding Content padding.
 */
function messageFrame (name: string, colours: { textColor: string; shadowColor: string | null }, padding: Insets): void
{
    registerSkin({ id: name, url: windowskinUrl(name), format: 'frame', padding, ...colours });
}

//  FRLG message frame (40×40): 5 px of transparent margin at the sides, 3 at top and bottom.
messageFrame('speech_frlg', FRLG_TEXT, { left: 14, top: 8, right: 14, bottom: 6 });
//  Other generations' message frames, ready to switch to.
messageFrame('speech_em', ESSENTIALS_DARK_TEXT, { left: 10, top: 6, right: 10, bottom: 6 });
messageFrame('speech_rs', ESSENTIALS_DARK_TEXT, { left: 10, top: 6, right: 10, bottom: 6 });
for (let i = 1; i <= 20; i++)
{
    messageFrame(`speech_hgss_${i}`, ESSENTIALS_DARK_TEXT, { left: 10, top: 6, right: 10, bottom: 6 });
    messageFrame(`speech_dp_${i}`, ESSENTIALS_DARK_TEXT, { left: 10, top: 6, right: 10, bottom: 6 });
    messageFrame(`speech_pl_${i}`, ESSENTIALS_DARK_TEXT, { left: 10, top: 6, right: 10, bottom: 6 });
}

//  Choice / menu frames (24×24, 6 px of border). The left padding leaves room for the cursor.
for (let i = 1; i <= 28; i++)
{
    messageFrame(`choice_${i}`, ESSENTIALS_DARK_TEXT, { left: 15, top: 7, right: 8, bottom: 7 });
}
messageFrame('choice_dp', ESSENTIALS_DARK_TEXT, { left: 15, top: 7, right: 8, bottom: 7 });

//  RPG Maker XP style skin.
registerSkin({
    id: 'windowskin', url: windowskinUrl('windowskin'), format: 'rmxp',
    padding: { left: 8, top: 8, right: 8, bottom: 8 }, ...ESSENTIALS_DARK_TEXT,
});

/** @brief Skins the default UI uses. Change these to restyle every window of that kind. */
export const DEFAULT_SKINS = {
    /** Message box and speaker name box. */
    message: 'speech_frlg',
    /** Choice lists and menus. */
    choice: 'choice_1',
};
