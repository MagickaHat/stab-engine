/**
 * @file uiSounds.ts
 * @brief Plays the UI's sound cues (cursor, select, cancel) for the React UI.
 *
 * The React UI never touches Phaser's audio. It emits
 * `GameEvents.UI_SOUND` (through `playUiSound()` in src/ui/sounds.ts) and this
 * file, attached to the game in src/game/main.ts, loads the file the first
 * time it is needed and plays it with the game's sound manager, so UI sounds
 * follow the game's volume and mute settings.
 *
 * A file that does not exist yet is reported once on the console and then
 * skipped, so the UI works before its sounds are added.
 */
import { Core, Loader } from 'phaser';
import type { Game, Scene } from 'phaser';
import { EventBus, GameEvents } from '../bus/EventBus';
import type { UiSoundRequest } from '../bus/EventBus';

/** @brief Prefix of the audio cache keys used for UI sounds. */
const KEY_PREFIX = 'ui-se:';

/**
 * @brief Checks that a sound file is really there before Phaser tries to decode it.
 *
 * A dev server answers a missing file with its HTML page, which Phaser would
 * fail to decode with an uncaught error.
 *
 * @param url File URL.
 * @return `true` if the server sent something that is not a web page.
 */
async function fileExists (url: string): Promise<boolean>
{
    try
    {
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok && !(response.headers.get('content-type') ?? '').includes('text/html');
    }
    catch
    {
        return false;
    }
}

/**
 * @brief Loads one audio file with a running scene's loader.
 * @param scene Any active scene (its loader is used).
 * @param key Audio cache key.
 * @param url File URL.
 * @return Resolves `true` once it is in the audio cache, `false` if it could not be loaded.
 */
function loadAudio (scene: Scene, key: string, url: string): Promise<boolean>
{
    return new Promise((resolve) =>
    {
        //  COMPLETE also fires for files that failed (a dev server answers a missing file with HTML).
        scene.load.once(Loader.Events.COMPLETE, () => resolve(scene.cache.audio.exists(key)));
        scene.load.audio(key, url);
        if (!scene.load.isLoading()) scene.load.start();
    });
}

/**
 * @brief Starts playing UI sounds requested on the `EventBus`.
 *
 * The listener is removed when the game is destroyed.
 *
 * @param game The running game.
 */
export function attachUiSounds (game: Game): void
{
    const loading = new Map<string, Promise<boolean>>();
    const missing = new Set<string>();

    const play = ({ cue, url, volume }: UiSoundRequest) =>
    {
        if (missing.has(url)) return;
        const key = KEY_PREFIX + url;
        if (game.cache.audio.exists(key))
        {
            game.sound.play(key, { volume });
            return;
        }
        const scene = game.scene.getScenes(true)[0];
        if (!scene) return;
        //  Requests made while the file is still loading are dropped, so holding a direction
        //  does not queue up a burst of cursor sounds.
        if (loading.has(key)) return;
        const pending = fileExists(url).then((exists) => (exists ? loadAudio(scene, key, url) : false));
        loading.set(key, pending);
        void pending.then((ok) =>
        {
            loading.delete(key);
            if (ok)
            {
                game.sound.play(key, { volume });
                return;
            }
            if (!missing.has(url))
            {
                missing.add(url);
                console.info(`[ui sound] "${cue}" has no sound file yet (${url}); see docs/UI_SYSTEM.md.`);
            }
        });
    };

    EventBus.on(GameEvents.UI_SOUND, play);
    game.events.once(Core.Events.DESTROY, () => EventBus.off(GameEvents.UI_SOUND, play));
}
