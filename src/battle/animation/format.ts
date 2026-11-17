/**
 * @file format.ts
 * @brief The battle animation file format (`content/animations/**\/*.json`).
 *
 * Shared by the importer (tools/animations), and meant as the base of a
 * future animation player and in-engine animation editor. It is a readable
 * version of Pokémon Essentials' `PBAnimation`: the same frame-by-frame
 * model, with named fields and in the engine's 256×192 coordinates.
 *
 * See docs/ANIMATION_SYSTEM.md for the full description and how a player
 * should draw it.
 *
 * Nothing here imports Phaser or React, so tools and tests can use it.
 */

/** @brief Value of `BattleAnimation.format`. */
export const ANIMATION_FORMAT = 'stab-animation';

/** @brief Current version of the format. Bump on incompatible changes. */
export const ANIMATION_FORMAT_VERSION = 1;

/** @brief Frames per second animations are made for (Essentials and RPG Maker XP play 20). */
export const ANIMATION_FPS = 20;

/**
 * @brief Where the user and target battlers stand while an animation is
 *        designed, in game pixels (Essentials' editor positions, halved).
 *
 * Cel positions are relative to these: a cel focused on the target that is
 * 10 px right of `TARGET` is drawn 10 px right of wherever the real target is.
 */
export const ANIMATION_STAGE = {
    width: 256,
    height: 192,
    user: { x: 64, y: 112 },
    target: { x: 192, y: 48 },
} as const;

/** @brief Size of one frame (pattern) in an animation sheet, in game pixels. */
export const ANIMATION_CELL_SIZE = 96;

/** @brief Frames per row in an animation sheet. Pattern `n` is at column `n % 5`, row `floor(n / 5)`. */
export const ANIMATION_SHEET_COLUMNS = 5;

/** @brief Folder of animation sheets (relative to the assets folder): `img/animations/<graphic>.png`. */
export const ANIMATION_IMAGE_DIR = 'img/animations';

/** @brief Folder of animation sounds (relative to the assets folder): `sound/se/anim/<file>`. */
export const ANIMATION_SOUND_DIR = 'sound/se/anim';

/**
 * @brief What a cel's position is relative to.
 *
 * - `target` / `user`: moves with that battler.
 * - `userAndTarget`: placed along the line from user to target, so it
 *   stretches and turns with the distance between them (projectiles).
 * - `screen`: fixed on the screen.
 */
export type AnimationFocus = 'user' | 'target' | 'userAndTarget' | 'screen';

/**
 * @brief How a cel is layered.
 *
 * `back` (behind everything), `front` (in front of everything),
 * `behindFocus` / `aboveFocus` (just behind / in front of the focused battler).
 * A number is an Essentials value with no known meaning, kept as it was
 * (Essentials draws those like `front`).
 */
export type AnimationPriority = 'back' | 'front' | 'behindFocus' | 'aboveFocus' | number;

/** @brief Colour blending of a cel. Missing: normal. */
export type AnimationBlend = 'add' | 'subtract';

/**
 * @brief One sprite in one frame.
 *
 * Only `x`, `y`, `pattern` and `focus` are always present; every other field
 * is left out when it has its default value (shown in brackets).
 */
export interface AnimationCel
{
    /** Centre of the sprite, in game pixels, relative to the focus (see `ANIMATION_STAGE`). May be fractional. */
    x: number;
    y: number;
    /**
     * What is drawn: a frame of the animation's sheet (0, 1, 2…), or the
     * `user`'s / `target`'s battle sprite. Slot 0 of every frame is the user
     * battler and slot 1 the target battler.
     */
    pattern: number | 'user' | 'target';
    focus: AnimationFocus | number;
    /** Horizontal / vertical scale in percent [100]. */
    zoomX?: number;
    zoomY?: number;
    /** Rotation in degrees, anticlockwise [0]. */
    angle?: number;
    /** Flipped horizontally [false]. */
    mirror?: boolean;
    blend?: AnimationBlend;
    /** 0–255 [255]; values outside are clamped when drawn. */
    opacity?: number;
    /** Colour blended over the sprite: red, green, blue, strength (0–255) [none]. */
    color?: [number, number, number, number];
    /** Tone shift: red, green, blue (−255–255), grey (0–255) [none]. */
    tone?: [number, number, number, number];
    /** Essentials' per-cel flash colour (red, green, blue, alpha) [none]. */
    flash?: [number, number, number, number];
    priority?: AnimationPriority;
    /** Not drawn in this frame [false]. */
    hidden?: boolean;
    /** Essentials animation editor flag, kept so nothing is lost; players ignore it [false]. */
    locked?: boolean;
}

/**
 * @brief A frame: one entry per sprite slot, `null` where a slot is empty.
 *        Trailing empty slots are left out. A slot is the same sprite from
 *        frame to frame (an editor can tween between them).
 */
export type AnimationFrame = (AnimationCel | null)[];

/** @brief Something that happens on a frame. `frame` is 0-based. */
export type AnimationTiming =
    | {
        frame: number;
        type: 'sound';
        /** File in `sound/se/anim/`, with extension, e.g. `'prsfx_tackle.wav'`. Missing when the timing only flashes. */
        sound?: string;
        /** Percent [100]. */
        volume?: number;
        /** Percent [100]. */
        pitch?: number;
        /** Essentials' flash settings, when used. */
        flash?: { scope: number; color: [number, number, number, number]; duration: number };
    }
    | {
        frame: number;
        /** Show a picture behind (`background`) or over (`foreground`) the battle. */
        type: 'background' | 'foreground';
        /** Sheet in `img/animations/`, without extension; missing to only change the fields below. */
        graphic?: string;
        /** Offset in game pixels. Missing fields are left as they were. */
        x?: number;
        y?: number;
        opacity?: number;
        /** Colour over the picture; `null` entries are left as they were. */
        color?: (number | null)[];
    }
    | {
        frame: number;
        /** Move/fade the picture set earlier, over `duration` frames. */
        type: 'backgroundMove' | 'foregroundMove';
        duration: number;
        x?: number;
        y?: number;
        opacity?: number;
        color?: (number | null)[];
    };

/** @brief Which lookup an animation answers to. */
export type AnimationKind = 'move' | 'common' | 'other';

/** @brief One animation file. */
export interface BattleAnimation
{
    format: typeof ANIMATION_FORMAT;
    version: number;
    /**
     * Name in Essentials' convention, used to find animations:
     * `Move:TACKLE`, `OppMove:TACKLE` (played when the foe uses it),
     * `Common:Burn`, or anything else for custom lookups (`Barrage hit 2`).
     */
    name: string;
    kind: AnimationKind;
    /** Showdown move ID or common animation ID, e.g. `'tackle'`, `'burn'`. Missing for `other`. */
    id?: string;
    /** `true` for the version played when the opponent's side uses it (`OppMove:`). */
    opponent?: boolean;
    /** Sheet in `img/animations/`, without extension; missing when the animation uses no sheet. */
    graphic?: string;
    /** Hue rotation of the sheet in degrees [0]. */
    hue?: number;
    /** Focus new cels get in an editor. */
    defaultFocus: AnimationFocus | number;
    /** Frames per second (`ANIMATION_FPS`). */
    fps: number;
    frames: AnimationFrame[];
    timings: AnimationTiming[];
}

/**
 * @brief Path of a sheet, relative to the assets folder.
 * @param graphic `BattleAnimation.graphic`.
 * @return E.g. `'img/animations/pras_strike.png'`.
 */
export function animationImagePath (graphic: string): string
{
    return `${ANIMATION_IMAGE_DIR}/${graphic}.png`;
}

/**
 * @brief Where pattern `n` is in a sheet.
 * @param pattern Pattern index (≥ 0).
 * @return Source rectangle in sheet pixels.
 */
export function patternRect (pattern: number): { x: number; y: number; width: number; height: number }
{
    return {
        x: (pattern % ANIMATION_SHEET_COLUMNS) * ANIMATION_CELL_SIZE,
        y: Math.floor(pattern / ANIMATION_SHEET_COLUMNS) * ANIMATION_CELL_SIZE,
        width: ANIMATION_CELL_SIZE,
        height: ANIMATION_CELL_SIZE,
    };
}
