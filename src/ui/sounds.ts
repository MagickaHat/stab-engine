/**
 * @file sounds.ts
 * @brief UI sound cues: the text blip, cursor moves and cancel.
 *
 * Components call `playUiSound('select')` and so on. This only sends
 * `GameEvents.UI_SOUND` on the bus; the game plays the file
 * (src/game/uiSounds.ts), so React never touches Phaser's audio.
 *
 * | Cue | When | Essentials file it replaces |
 * |-----|------|-----------------------------|
 * | `select` | A advances or closes a message (the text blip), an option is picked | `GUI sel decision` |
 * | `cursor` | The cursor moves to another option | `GUI sel cursor` |
 * | `cancel` | B backs out of a menu or choice | `GUI sel cancel` |
 *
 * Put the files in `public/assets/sound/se/ui/` (`select.ogg`, `cursor.ogg`,
 * `cancel.ogg`), or point a cue elsewhere with `registerUiSound()`. Until a
 * file exists the cue is silent.
 */
import { EventBus, GameEvents } from '../bus/EventBus.ts';
import type { UiSoundCue } from '../bus/EventBus.ts';
import { uiSoundUrl } from './assets/paths.ts';

/** @brief File and volume of one cue. */
export interface UiSoundEntry
{
    /** URL of the file (see `uiSoundUrl()`). */
    url: string;
    /** Volume from 0 to 1. */
    volume: number;
}

/** @brief The sound of each cue. Change with `registerUiSound()`. */
const UI_SOUNDS: Record<UiSoundCue, UiSoundEntry> = {
    select: { url: uiSoundUrl('select.ogg'), volume: 1 },
    cursor: { url: uiSoundUrl('cursor.ogg'), volume: 1 },
    cancel: { url: uiSoundUrl('cancel.ogg'), volume: 1 },
};

/**
 * @brief Changes the file or volume of a cue.
 *
 * @code
 * registerUiSound('select', { url: uiSoundUrl('frlg_select.ogg'), volume: 0.8 });
 * @endcode
 *
 * @param cue The cue.
 * @param entry What to change; missing fields keep their value.
 */
export function registerUiSound (cue: UiSoundCue, entry: Partial<UiSoundEntry>): void
{
    UI_SOUNDS[cue] = { ...UI_SOUNDS[cue], ...entry };
}

/**
 * @brief The current sound of a cue.
 * @param cue The cue.
 * @return Its file and volume.
 */
export function getUiSound (cue: UiSoundCue): UiSoundEntry
{
    return UI_SOUNDS[cue];
}

/**
 * @brief Asks the game to play a UI sound.
 * @param cue Which sound.
 */
export function playUiSound (cue: UiSoundCue): void
{
    const { url, volume } = UI_SOUNDS[cue];
    EventBus.emit(GameEvents.UI_SOUND, { cue, url, volume });
}
