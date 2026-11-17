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
    /**
     * Phaser → anyone. After a battle with the saved party, some Pokémon can
     * evolve. Emitted just before `BATTLE_END`, and only if there are any.
     * Argument: `PendingEvolution[]` (see src/state/evolution.ts). The
     * evolution scene should listen for this, show each evolution and call
     * `evolvePokemon()`.
     */
    BATTLE_EVOLUTIONS: 'battle-evolutions',
    /**
     * Phaser → anyone. A battle ended. Emitted just before `BATTLE_END`.
     * Argument: `BattleResultData` (`win`, `lose` or `draw` for the local player).
     */
    BATTLE_RESULT: 'battle-result',
    /** Phaser → React. A battle finished being shown. Argument: the winner's name, or `null` for a tie. */
    BATTLE_END: 'battle-end',
    /**
     * Phaser → React. The event system shows a line of text. Argument: `DialogueRequest`
     * (src/world/dialogue.ts). Call its `done()` when the player has read it.
     */
    DIALOGUE_MESSAGE: 'dialogue-message',
    /**
     * Phaser → React. The event system asks the player to pick an option.
     * Argument: `ChoiceRequest` (src/world/dialogue.ts). Call its `pick(index)`.
     */
    DIALOGUE_CHOICE: 'dialogue-choice',
    /**
     * Phaser → React. The event system asks the player to type a name.
     * Argument: `NameInputRequest` (src/world/dialogue.ts). Call its `submit(name)`.
     */
    DIALOGUE_NAME_INPUT: 'dialogue-name-input',
} as const;
