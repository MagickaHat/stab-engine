/**
 * @file EventBus.ts
 * @brief Re-export of the typed event bus for game code.
 *
 * The bus lives in src/bus/EventBus.ts so that it does not depend on Phaser
 * and can be shared with the React UI and Node tests. Existing imports of
 * `../game/EventBus` keep working through this file.
 */
export { EventBus, GameEvents, TypedEventBus } from '../bus/EventBus';
export type {
    EventArgs, EventListener, GameEventMap, GameEventName, SceneInfo, TextSpeed, TextSpeedInfo,
    UiModalInfo, UiSoundCue, UiSoundRequest, ViewportInfo,
} from '../bus/EventBus';
