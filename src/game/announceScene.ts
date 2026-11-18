/**
 * @file announceScene.ts
 * @brief Tells the rest of the game, and the UI, that a scene is ready.
 */
import type { Scene } from 'phaser';
import { EventBus, GameEvents } from '../bus/EventBus';

/**
 * @brief Announces that `scene` finished `create()`.
 *
 * Emits `GameEvents.SCENE_READY` with the scene itself, for game code, and
 * `GameEvents.SCENE_CHANGED` with plain data (`{ key }`), for the React UI.
 * Call it at the end of every scene's `create()`:
 *
 * @code
 * create ()
 * {
 *     // ... build the scene ...
 *     announceScene(this);
 * }
 * @endcode
 *
 * @param scene The scene that is now active.
 */
export function announceScene (scene: Scene): void
{
    EventBus.emit(GameEvents.SCENE_READY, scene);
    EventBus.emit(GameEvents.SCENE_CHANGED, { key: scene.scene.key });
}
