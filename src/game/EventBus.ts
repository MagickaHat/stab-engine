/**
 * @file EventBus.ts
 * @brief Shared event emitter for messages between React and Phaser.
 *
 * React components and Phaser scenes do not hold references to each other.
 * Instead, both sides emit and listen on this one emitter:
 *
 * @code
 * // In a React component:
 * EventBus.emit(GameEvents.UI_SHAKE);
 *
 * // In a scene's create():
 * EventBus.on(GameEvents.UI_SHAKE, this.onShake, this);
 * this.events.once('shutdown', () => EventBus.off(GameEvents.UI_SHAKE, this.onShake, this));
 * @endcode
 *
 * Always remove listeners when the scene shuts down or the component
 * unmounts, otherwise they keep firing on dead objects.
 */
import { Events } from 'phaser';

/** @brief The emitter shared by the React UI and the Phaser scenes. */
export const EventBus = new Events.EventEmitter();

/**
 * @brief Names of the events sent over the `EventBus`.
 *
 * Add new events here so both sides use the same string.
 */
export const GameEvents = {
    /** Phaser → React. A scene finished `create()`. Argument: the `Phaser.Scene`. */
    SCENE_READY: 'current-scene-ready',
    /** React → Phaser. Sample event: asks the active scene to shake the camera. */
    UI_SHAKE: 'ui-shake',
    /** Phaser → React. A battle started. Argument: its `BattleBridge` (see src/battle/bridge). */
    BATTLE_START: 'battle-start',
    /** Phaser → React. A battle finished being shown. Argument: the winner's name, or `null` for a tie. */
    BATTLE_END: 'battle-end',
} as const;
