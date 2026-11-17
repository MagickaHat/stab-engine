/**
 * @file convert.ts
 * @brief Turns Essentials' `PBAnimation` objects (from `PkmnAnimations.rxdata`)
 *        into the engine's animation format (src/battle/animation/format.ts).
 *
 * Essentials stores each cel as an array of 27 numbers and each timing as a
 * `PBAnimTiming` object; positions are on a 512×384 screen. The result has
 * named fields, leaves out defaults, and is in 256×192 game pixels.
 */
import { assetName } from '../assets/essentials.ts';
import { toID } from '../assets/resolve.ts';
import { ANIMATION_FORMAT, ANIMATION_FORMAT_VERSION, ANIMATION_FPS } from '../../src/battle/animation/format.ts';
import type {
    AnimationCel, AnimationFocus, AnimationFrame, AnimationKind, AnimationPriority, AnimationTiming, BattleAnimation,
} from '../../src/battle/animation/format.ts';
import { RubyObject, rgssColor } from './marshal.ts';

/** @brief Essentials screen (512×384) → engine screen (256×192). */
export const SCALE = 0.5;

/** @brief Index of each value in an Essentials cel array (`AnimFrame` in Essentials). */
export const CEL = {
    X: 0, Y: 1, ZOOMX: 2, ANGLE: 3, MIRROR: 4, BLENDTYPE: 5, VISIBLE: 6, PATTERN: 7, OPACITY: 8,
    ZOOMY: 11, COLORRED: 12, COLORGREEN: 13, COLORBLUE: 14, COLORALPHA: 15,
    TONERED: 16, TONEGREEN: 17, TONEBLUE: 18, TONEGRAY: 19, LOCKED: 20,
    FLASHRED: 21, FLASHGREEN: 22, FLASHBLUE: 23, FLASHALPHA: 24, PRIORITY: 25, FOCUS: 26,
} as const;

/** @brief Essentials focus numbers. */
const FOCUS: Record<number, AnimationFocus> = { 1: 'target', 2: 'user', 3: 'userAndTarget', 4: 'screen' };

/** @brief Essentials priority numbers. */
const PRIORITY: Record<number, AnimationPriority> = { 0: 'back', 1: 'front', 2: 'behindFocus', 3: 'aboveFocus' };

/** @brief Essentials timing types. */
const TIMING_TYPE = ['sound', 'background', 'backgroundMove', 'foreground', 'foregroundMove'] as const;

/** @brief Looks up the imported file for a name used in the animation data. */
export interface NameResolver
{
    /**
     * @brief Sheet referenced by an animation or a background/foreground timing.
     * @param name As written in Essentials, e.g. `'PRAS- Strike.png'` or `'PRAS- Strike'`.
     * @return Engine name without extension, and whether the pack has the file.
     */
    graphic (name: string): { name: string; found: boolean };
    /**
     * @brief Sound effect referenced by a timing.
     * @param name As written in Essentials, with or without extension.
     * @return Engine file name with extension, and whether the pack has the file.
     */
    sound (name: string): { file: string; found: boolean };
}

/** @brief Problems noticed while converting, as readable lines. */
export interface ConvertReport
{
    missingGraphics: string[];
    missingSounds: string[];
    unknownMoves: string[];
}

/** @brief Where an animation is filed. */
export interface AnimationPlace
{
    kind: AnimationKind;
    /** Showdown move ID / common animation ID; missing for `other`. */
    id?: string;
    opponent: boolean;
    /** Path inside the output folder without `.json`, e.g. `'moves/tackle_opp'`. */
    path: string;
}

/**
 * @brief Work out the kind, ID and file of an animation from its Essentials name.
 *
 * `Move:TACKLE` → `moves/tackle`, `OppMove:TACKLE` → `moves/tackle_opp`,
 * `Common:Burn` → `common/burn`, `OppCommon:Burn` → `common/burn_opp`,
 * anything else → `other/<name>` (`Barrage hit 2` → `other/barrage_hit_2`).
 *
 * @param name Essentials animation name.
 * @return Its place, or `null` for an empty slot or a `~ Section ~` divider.
 */
export function placeAnimation (name: string): AnimationPlace | null
{
    const trimmed = name.trim();
    if (!trimmed || /^~.*~$/.test(trimmed)) return null;
    const match = /^(Opp)?(Move|Common)\s*:\s*(.+)$/i.exec(trimmed);
    if (match)
    {
        const opponent = Boolean(match[1]);
        const kind: AnimationKind = match[2].toLowerCase() === 'move' ? 'move' : 'common';
        const id = kind === 'move' ? toID(match[3]) : assetName(match[3]);
        if (id) return { kind, id, opponent, path: `${kind === 'move' ? 'moves' : 'common'}/${id}${opponent ? '_opp' : ''}` };
    }
    const file = assetName(trimmed);
    return file ? { kind: 'other', opponent: false, path: `other/${file}` } : null;
}

/** @brief A number from Ruby data, or `fallback` for `nil`/anything else. */
function num (value: unknown, fallback = 0): number
{
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** @brief A coordinate converted to game pixels. */
function coord (value: unknown): number
{
    return num(value) * SCALE;
}

/**
 * @brief Convert one Essentials cel.
 * @param cel Array of 27 numbers (or `nil`).
 * @return The cel, or `null` for an empty slot.
 */
export function convertCel (cel: unknown): AnimationCel | null
{
    if (!Array.isArray(cel)) return null;
    const v = (i: number, fallback = 0) => num(cel[i], fallback);
    const pattern = v(CEL.PATTERN);
    const out: AnimationCel = {
        x: coord(cel[CEL.X]),
        y: coord(cel[CEL.Y]),
        pattern: pattern === -1 ? 'user' : pattern === -2 ? 'target' : pattern,
        focus: FOCUS[v(CEL.FOCUS, 4)] ?? v(CEL.FOCUS),
    };
    if (v(CEL.ZOOMX, 100) !== 100) out.zoomX = v(CEL.ZOOMX, 100);
    if (v(CEL.ZOOMY, 100) !== 100) out.zoomY = v(CEL.ZOOMY, 100);
    if (v(CEL.ANGLE)) out.angle = v(CEL.ANGLE);
    if (v(CEL.MIRROR)) out.mirror = true;
    if (v(CEL.BLENDTYPE) === 1) out.blend = 'add';
    if (v(CEL.BLENDTYPE) === 2) out.blend = 'subtract';
    if (v(CEL.OPACITY, 255) !== 255) out.opacity = v(CEL.OPACITY, 255);
    const quad = (a: number): [number, number, number, number] => [v(a), v(a + 1), v(a + 2), v(a + 3)];
    if (quad(CEL.COLORRED).some(Boolean)) out.color = quad(CEL.COLORRED);
    if (quad(CEL.TONERED).some(Boolean)) out.tone = quad(CEL.TONERED);
    if (quad(CEL.FLASHRED).some(Boolean)) out.flash = quad(CEL.FLASHRED);
    const priority = PRIORITY[v(CEL.PRIORITY, 1)] ?? v(CEL.PRIORITY, 1);
    if (priority !== 'front') out.priority = priority;
    if (cel[CEL.VISIBLE] !== undefined && cel[CEL.VISIBLE] !== null && !v(CEL.VISIBLE)) out.hidden = true;
    if (v(CEL.LOCKED)) out.locked = true;
    return out;
}

/**
 * @brief Convert one frame.
 * @param frame Array of cels (`nil` for empty slots), or `nil`.
 * @return The frame with trailing empty slots removed.
 */
export function convertFrame (frame: unknown): AnimationFrame
{
    const cels = Array.isArray(frame) ? frame.map(convertCel) : [];
    while (cels.length && cels[cels.length - 1] === null) cels.pop();
    return cels;
}

/**
 * @brief Convert one `PBAnimTiming`.
 * @param timing The Ruby object.
 * @param names Name lookup.
 * @param report Problems are added here.
 * @return The timing, or `null` if it does nothing (a sound timing with no sound).
 */
export function convertTiming (timing: unknown, names: NameResolver, report: ConvertReport): AnimationTiming | null
{
    if (!(timing instanceof RubyObject)) return null;
    const t = timing.ivars;
    const frame = num(t.frame);
    const type = TIMING_TYPE[num(t.timingType)] ?? 'sound';
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    if (type === 'sound')
    {
        const flashScope = num(t.flashScope);
        if (!name && !flashScope) return null;
        const out: AnimationTiming = { frame, type };
        if (name)
        {
            const sound = names.sound(name);
            if (!sound.found) report.missingSounds.push(name);
            out.sound = sound.file;
        }
        if (num(t.volume, 100) !== 100) out.volume = num(t.volume, 100);
        if (num(t.pitch, 100) !== 100) out.pitch = num(t.pitch, 100);
        if (flashScope)
        {
            out.flash = { scope: flashScope, color: rgssColor(t.flashColor) ?? [255, 255, 255, 255], duration: num(t.flashDuration, 5) };
        }
        return out;
    }
    // Background/foreground: nil fields mean "leave as it was", so they are left out.
    const fields: { x?: number; y?: number; opacity?: number; color?: (number | null)[] } = {};
    if (typeof t.bgX === 'number') fields.x = t.bgX * SCALE;
    if (typeof t.bgY === 'number') fields.y = t.bgY * SCALE;
    if (typeof t.opacity === 'number') fields.opacity = t.opacity;
    const color = [t.colorRed, t.colorGreen, t.colorBlue, t.colorAlpha].map((c) => (typeof c === 'number' ? c : null));
    if (color.some((c) => c !== null)) fields.color = color;
    if (type === 'background' || type === 'foreground')
    {
        const graphic = name ? names.graphic(name) : null;
        if (graphic && !graphic.found) report.missingGraphics.push(name);
        return { frame, type, ...(graphic ? { graphic: graphic.name } : {}), ...fields };
    }
    return { frame, type, duration: num(t.duration, 5), ...fields };
}

/**
 * @brief Convert one `PBAnimation`.
 * @param animation The Ruby object.
 * @param place Where it is filed (from `placeAnimation()`).
 * @param names Name lookup.
 * @param report Problems are added here.
 * @return The animation in the engine's format.
 */
export function convertAnimation (animation: RubyObject, place: AnimationPlace, names: NameResolver, report: ConvertReport): BattleAnimation
{
    const a = animation.ivars;
    const graphic = typeof a.graphic === 'string' ? a.graphic.trim() : '';
    const sheet = graphic ? names.graphic(graphic) : null;
    if (sheet && !sheet.found) report.missingGraphics.push(graphic);
    // Built field by field so the file reads top-down: identity, look, playback, data.
    const out: BattleAnimation = {
        format: ANIMATION_FORMAT,
        version: ANIMATION_FORMAT_VERSION,
        name: String(a.name ?? '').trim(),
        kind: place.kind,
        ...(place.id ? { id: place.id } : {}),
        ...(place.opponent ? { opponent: true } : {}),
        ...(sheet ? { graphic: sheet.name } : {}),
        ...(num(a.hue) ? { hue: num(a.hue) } : {}),
        defaultFocus: FOCUS[num(a.position, 4)] ?? num(a.position, 4),
        fps: ANIMATION_FPS,
        timings: [],
        frames: [],
    };
    // Frames live in @array (PBAnimation subclasses Array but keeps them there).
    const frames = Array.isArray(a.array) ? a.array : Array.isArray(animation.value) ? animation.value : [];
    out.frames = frames.map(convertFrame);
    const timings = Array.isArray(a.timing) ? a.timing : [];
    out.timings = timings
        .map((timing) => convertTiming(timing, names, report))
        .filter((timing): timing is AnimationTiming => timing !== null)
        .sort((x, y) => x.frame - y.frame);
    return out;
}

/**
 * @brief Write an animation as JSON that is easy to read and to diff:
 *        one cel per line, one timing per line.
 * @param animation The animation.
 * @param schema Value for `$schema` (path of the JSON Schema), or none.
 * @return File contents.
 */
export function formatAnimation (animation: BattleAnimation, schema?: string): string
{
    const { frames, timings, ...head } = animation;
    const lines = ['{'];
    if (schema) lines.push(`    "$schema": ${JSON.stringify(schema)},`);
    for (const [key, value] of Object.entries(head)) lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    const block = (key: string, items: string[], last: boolean) =>
    {
        lines.push(items.length ? `    ${JSON.stringify(key)}: [\n${items.join(',\n')}\n    ]${last ? '' : ','}` : `    ${JSON.stringify(key)}: []${last ? '' : ','}`);
    };
    block('timings', timings.map((timing) => `        ${JSON.stringify(timing)}`), false);
    block('frames', frames.map((frame) => (frame.length
        ? `        [\n${frame.map((cel) => `            ${JSON.stringify(cel)}`).join(',\n')}\n        ]`
        : '        []')), true);
    lines.push('}', '');
    return lines.join('\n');
}
