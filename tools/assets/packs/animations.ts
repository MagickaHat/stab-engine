/**
 * @file animations.ts
 * @brief Layout for importing Essentials battle animation graphics and sound
 *        effects, e.g. from the "Gen 9 Move Animation Project" or any
 *        Essentials project.
 *
 * @code
 * Graphics/Animations/PRAS- Strike.png      → img/animations/pras_strike.png
 * Audio/SE/Anim/PRSFX- King's Shield1.wav   → sound/se/anim/prsfx_kings_shield1.wav
 * @endcode
 *
 * The animation data itself (`Data/PkmnAnimations.rxdata`) is converted by
 * `npm run animations:import` (see tools/animations), which uses the same
 * names, so the two always match.
 */
import type { PackDefinition } from '../pack.ts';

/** @brief Folder (inside the output folder) holding battle animation sheets. */
export const ANIM_IMG_DIR = 'img/animations';

/** @brief Folder (inside the output folder) holding battle animation sound effects. */
export const ANIM_SE_DIR = 'sound/se/anim';

/** @brief Size of one frame in an Essentials animation sheet (5 frames per row). */
export const ESSENTIALS_ANIM_FRAME = 192;

export const animations: PackDefinition = {
    name: 'animations',
    rules: [
        // Sheets of 192×192 frames drawn for a 512×384 screen → 96×96 frames for 256×192.
        // Frames pasted one pixel off the 2×2 grid are realigned so they still halve losslessly;
        // other imperfect pixel art keeps one colour per block (no mixels), soft effects are blended.
        {
            kind: 'images', target: 'tree', dir: 'Graphics/Animations', ext: '.png', extraExts: ['.bmp'], output: ANIM_IMG_DIR,
            image: { divide: 2, filter: 'auto', align: [ESSENTIALS_ANIM_FRAME, ESSENTIALS_ANIM_FRAME] },
        },
        // Sound effects are copied as they are (renamed only).
        { kind: 'sounds', target: 'tree', dir: 'Audio/SE/Anim', ext: '.ogg', extraExts: ['.wav', '.mp3', '.mid', '.midi'], output: ANIM_SE_DIR },
    ],
};
