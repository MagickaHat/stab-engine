/**
 * @file saves.ts
 * @brief The game's one `SaveManager`, shared by the title screen's Continue
 *        menu and anything that saves (a future pause menu, scripts...).
 *
 * @code
 * const saves = getSaveManager();
 * saves.list();          // the Continue menu's slots
 * saves.save(0, state);  // save the current game
 * @endcode
 */
import {MemoryStorage, SaveError, SaveManager} from './SaveManager.ts';
import type {SaveManagerOptions} from './SaveManager.ts';

let shared: SaveManager|null = null;

/**
 * @brief The shared save manager, created on first use.
 *
 * It keeps saves in the browser's `localStorage`. Where there is none
 * (blocked cookies, a sandboxed frame), saves are kept in memory for this
 * session only and a warning is logged, so the game still starts.
 *
 * @return The save manager.
 */
export function getSaveManager(): SaveManager
{
    if (shared) return shared;
    try
    {
        shared = new SaveManager();
    }
    catch (error)
    {
        if (!(error instanceof SaveError) || error.code !== 'storage') throw error;
        console.warn('[state] localStorage is not available: saves last only until the page is closed');
        shared = new SaveManager({ storage: new MemoryStorage() });
    }
    return shared;
}

/**
 * @brief Replace the shared save manager, e.g. with more slots or another
 *        storage (an Android app's file storage). Call it before the title screen.
 * @param options Settings for the new manager, or a manager to use as it is.
 * @return The new shared manager.
 */
export function setSaveManager(options: SaveManagerOptions|SaveManager): SaveManager
{
    shared = options instanceof SaveManager ? options : new SaveManager(options);
    return shared;
}
