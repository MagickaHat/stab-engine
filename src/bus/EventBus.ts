/**
 * @file EventBus.ts
 * @brief Typed event bus: the only link between the Phaser game and the React UI.
 *
 * Neither side holds a reference to the other. Scenes publish plain data on
 * the bus and React listens (usually through the UI store, see
 * src/ui/store/uiStore.ts); React asks the game for things by emitting events
 * the scenes listen to.
 *
 * Every event name is listed in `GameEvents`, and the data it carries is
 * declared in `GameEventMap`, so a wrong payload is a type error on both sides:
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
 *
 * This file has no runtime dependency on Phaser or React, so it can be used
 * by either side and by Node tests.
 */
import type { Scene } from 'phaser';
import type { BattleBridge } from '../battle';
import type { BattleResultData } from '../game/scenes/Battle';
import type { InputDevice } from '../input/buttons';
import type { PendingEvolution } from '../state/evolution';
import type { ChoiceRequest, DialogueRequest, NameInputRequest } from '../world/dialogue';

/**
 * @brief Names of the events sent over the `EventBus`.
 *
 * Add new events here, and their payload to `GameEventMap`, so both sides use
 * the same string and the same data.
 */
export const GameEvents = {
    /**
     * Phaser → Phaser. A scene finished `create()`. Argument: the `Phaser.Scene`.
     * For game code only: React listens to `SCENE_CHANGED`, which carries plain data.
     * Emit both with `announceScene(this)` (src/game/announceScene.ts).
     */
    SCENE_READY: 'current-scene-ready',
    /** Phaser → React. A scene finished `create()`. Argument: `SceneInfo`. */
    SCENE_CHANGED: 'scene-changed',
    /**
     * Phaser → React. The game canvas moved or was scaled. Argument: `ViewportInfo`.
     * Emitted by src/game/viewport.ts; `<UiLayer>` follows it.
     */
    VIEWPORT_CHANGED: 'viewport-changed',
    /**
     * React → Phaser. A menu or message that takes the player's input opened
     * (`open: true`) or the last one closed (`open: false`). Argument: `UiModalInfo`.
     * Scenes stop moving the player while a modal UI is open.
     */
    UI_MODAL_CHANGED: 'ui-modal-changed',
    /**
     * React → Phaser. The UI asks for one of its sounds (cursor, select, cancel).
     * Argument: `UiSoundRequest`. Played by src/game/uiSounds.ts.
     */
    UI_SOUND: 'ui-sound',
    /**
     * Anyone → anyone. The text speed setting changed. Argument: `TextSpeedInfo`.
     * Send it with `setTextSpeed()` (src/ui/store/uiStore.ts).
     */
    TEXT_SPEED_CHANGED: 'text-speed-changed',
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
    /**
     * Input → anyone. The player switched between keyboard, gamepad, mouse and
     * touch. Argument: `InputDevice` (src/input/buttons.ts). Useful for button prompts.
     */
    INPUT_DEVICE_CHANGED: 'input-device-changed',
} as const;

/** @brief Any event name in `GameEvents`. */
export type GameEventName = typeof GameEvents[keyof typeof GameEvents];

/** @brief Payload of `GameEvents.SCENE_CHANGED`. */
export interface SceneInfo
{
    /** Key of the scene that is now active (e.g. `'Overworld'`). */
    key: string;
}

/** @brief Payload of `GameEvents.VIEWPORT_CHANGED`: where the game is drawn on the page. */
export interface ViewportInfo
{
    /** Width of the game, in game pixels (e.g. 256). */
    gameWidth: number;
    /** Height of the game, in game pixels (e.g. 192). */
    gameHeight: number;
    /** Left edge of the game, in CSS pixels from the left of the window (on a device pixel). */
    left: number;
    /** Top edge of the game, in CSS pixels from the top of the window (on a device pixel). */
    top: number;
    /** CSS pixels per game pixel. Always `deviceScale / devicePixelRatio`. */
    scale: number;
    /** Physical screen pixels per game pixel. Always a whole number, so pixels stay square. */
    deviceScale: number;
}

/** @brief Payload of `GameEvents.UI_MODAL_CHANGED`. */
export interface UiModalInfo
{
    /** `true` while at least one modal UI is open. */
    open: boolean;
}

/** @brief Names of the UI sound cues (see src/ui/sounds.ts). */
export type UiSoundCue = 'cursor' | 'select' | 'cancel';

/** @brief Payload of `GameEvents.UI_SOUND`. */
export interface UiSoundRequest
{
    /** Which cue to play. */
    cue: UiSoundCue;
    /** URL of the file, relative to the page (resolved by src/ui/sounds.ts). */
    url: string;
    /** Volume from 0 to 1. */
    volume: number;
}

/** @brief Text speed settings, slowest to fastest. */
export type TextSpeed = 'slow' | 'mid' | 'fast' | 'instant';

/** @brief Payload of `GameEvents.TEXT_SPEED_CHANGED`. */
export interface TextSpeedInfo
{
    /** The new speed. */
    speed: TextSpeed;
}

/**
 * @brief Payload of every event, by name.
 *
 * `void` means the event carries no data: `EventBus.emit(GameEvents.UI_SHAKE)`.
 */
export interface GameEventMap
{
    [GameEvents.SCENE_READY]: Scene;
    [GameEvents.SCENE_CHANGED]: SceneInfo;
    [GameEvents.VIEWPORT_CHANGED]: ViewportInfo;
    [GameEvents.UI_MODAL_CHANGED]: UiModalInfo;
    [GameEvents.UI_SOUND]: UiSoundRequest;
    [GameEvents.TEXT_SPEED_CHANGED]: TextSpeedInfo;
    [GameEvents.UI_SHAKE]: void;
    [GameEvents.BATTLE_START]: BattleBridge;
    [GameEvents.BATTLE_EVOLUTIONS]: PendingEvolution[];
    [GameEvents.BATTLE_RESULT]: BattleResultData;
    [GameEvents.BATTLE_END]: string | null;
    [GameEvents.DIALOGUE_MESSAGE]: DialogueRequest;
    [GameEvents.DIALOGUE_CHOICE]: ChoiceRequest;
    [GameEvents.DIALOGUE_NAME_INPUT]: NameInputRequest;
    [GameEvents.INPUT_DEVICE_CHANGED]: InputDevice;
}

/** @brief Arguments `emit()` takes after the event name: none for `void` events, else the payload. */
export type EventArgs<Payload> = [Payload] extends [void] ? [] : [payload: Payload];

/** @brief A listener for an event with this payload. */
export type EventListener<Payload> = (payload: Payload) => void;

/** @brief One registered listener. */
interface Entry
{
    fn: (payload: unknown) => void;
    context: unknown;
    once: boolean;
}

/**
 * @brief A small typed event emitter.
 *
 * The method names and the optional `context` argument match Phaser's
 * `EventEmitter`, so scenes can keep writing `EventBus.on(name, this.fn, this)`.
 *
 * @tparam Events Map of event name → payload type.
 */
export class TypedEventBus<Events extends object>
{
    /** Listeners by event name, in the order they were added. */
    private readonly listeners = new Map<keyof Events, Entry[]>();

    /**
     * @brief Calls `fn` every time `event` is emitted.
     * @param event Event name.
     * @param fn Listener; receives the payload.
     * @param context `this` for the listener (Phaser style), optional.
     * @return The bus, for chaining.
     */
    on<K extends keyof Events> (event: K, fn: EventListener<Events[K]>, context?: unknown): this
    {
        return this.add(event, fn, context, false);
    }

    /**
     * @brief Calls `fn` the next time `event` is emitted, then removes it.
     * @param event Event name.
     * @param fn Listener; receives the payload.
     * @param context `this` for the listener, optional.
     * @return The bus, for chaining.
     */
    once<K extends keyof Events> (event: K, fn: EventListener<Events[K]>, context?: unknown): this
    {
        return this.add(event, fn, context, true);
    }

    /**
     * @brief Removes a listener added with `on()` or `once()`.
     *
     * With `context`, only the listener added with that same context is removed.
     *
     * @param event Event name.
     * @param fn The listener to remove.
     * @param context The context it was added with, optional.
     * @return The bus, for chaining.
     */
    off<K extends keyof Events> (event: K, fn: EventListener<Events[K]>, context?: unknown): this
    {
        const list = this.listeners.get(event);
        if (!list) return this;
        const kept = list.filter((entry) => entry.fn !== fn || (context !== undefined && entry.context !== context));
        if (kept.length) this.listeners.set(event, kept);
        else this.listeners.delete(event);
        return this;
    }

    /**
     * @brief Sends an event to every listener, in the order they were added.
     * @param event Event name.
     * @param args The payload, or nothing for `void` events.
     * @return `true` if anyone was listening.
     */
    emit<K extends keyof Events> (event: K, ...args: EventArgs<Events[K]>): boolean
    {
        const list = this.listeners.get(event);
        if (!list || list.length === 0) return false;
        const payload = args[0];
        //  Copy first: listeners may add or remove listeners while running.
        for (const entry of [...list])
        {
            if (entry.once) this.removeEntry(event, entry);
            entry.fn.call(entry.context, payload);
        }
        return true;
    }

    /**
     * @brief Number of listeners for an event.
     * @param event Event name.
     * @return How many listeners are registered.
     */
    listenerCount (event: keyof Events): number
    {
        return this.listeners.get(event)?.length ?? 0;
    }

    /**
     * @brief Removes every listener of one event, or of all events.
     * @param event Event name, or nothing for all events.
     * @return The bus, for chaining.
     */
    removeAllListeners (event?: keyof Events): this
    {
        if (event === undefined) this.listeners.clear();
        else this.listeners.delete(event);
        return this;
    }

    /**
     * @brief Registers a listener.
     * @param event Event name.
     * @param fn Listener.
     * @param context `this` for the listener.
     * @param once Remove after the first call.
     * @return The bus.
     */
    private add (event: keyof Events, fn: (payload: never) => void, context: unknown, once: boolean): this
    {
        const list = this.listeners.get(event) ?? [];
        list.push({ fn: fn as (payload: unknown) => void, context, once });
        this.listeners.set(event, list);
        return this;
    }

    /**
     * @brief Removes one exact entry (used by `once` listeners).
     * @param event Event name.
     * @param entry The entry to remove.
     */
    private removeEntry (event: keyof Events, entry: Entry): void
    {
        const list = this.listeners.get(event);
        if (!list) return;
        const index = list.indexOf(entry);
        if (index >= 0) list.splice(index, 1);
        if (list.length === 0) this.listeners.delete(event);
    }
}

/** @brief The bus shared by the React UI and the Phaser scenes. */
export const EventBus = new TypedEventBus<GameEventMap>();
