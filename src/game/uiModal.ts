/**
 * @file uiModal.ts
 * @brief Game-side record of whether the React UI has the player's input.
 *
 * The UI announces this with `GameEvents.UI_MODAL_CHANGED`. Scenes listen to
 * the event while they run; this file also remembers the last value, so a
 * scene that starts while a menu is already open knows it straight away.
 */
import { EventBus, GameEvents } from '../bus/EventBus';

let open = false;
EventBus.on(GameEvents.UI_MODAL_CHANGED, (info) => { open = info.open; });

/**
 * @brief Whether a modal UI (message, menu) is open right now.
 * @return `true` while the UI takes the player's input.
 */
export function isUiModalOpen (): boolean
{
    return open;
}
