/**
 * @file uiStore.ts
 * @brief The UI's view of the game, built only from `EventBus` events.
 *
 * Phaser publishes plain data on the bus (the active scene, where the canvas
 * is, the text speed…). This store keeps the latest value of each, and React
 * components read it with `useUiStore()`. Components never hold Phaser
 * objects, and scenes never hold React ones.
 *
 * ```
 *  Phaser scene ──emit──▶ EventBus ──▶ uiStore ──useUiStore()──▶ React component
 *  Phaser scene ◀──on──── EventBus ◀──emit──────────────────────  React component
 * ```
 *
 * Game data that already lives outside Phaser has its own stores and hooks:
 * `useGameState()` (party, bag, flags) and `useBattle()` (the battle in progress).
 *
 * Call `connectUiStore()` once before the game starts (src/main.tsx does), so
 * no event is missed.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { EventBus, GameEvents } from '../../bus/EventBus.ts';
import type { SceneInfo, TextSpeed, TextSpeedInfo, ViewportInfo } from '../../bus/EventBus.ts';
import { GAME_HEIGHT, GAME_WIDTH } from '../../game/config.ts';

/** @brief Everything the store knows. Read-only: a new object is made for every change. */
export interface UiState
{
    /** Key of the active scene, or `null` before the first one is ready. */
    sceneKey: string | null;
    /** Where the game is on the page, or `null` before the canvas is laid out. */
    viewport: ViewportInfo | null;
    /** Text speed setting for message boxes. */
    textSpeed: TextSpeed;
    /** How many modal UIs (messages, menus) are open right now. */
    modalCount: number;
}

/** @brief The text speed used until a setting changes it (FRLG's default is "MID"). */
export const DEFAULT_TEXT_SPEED: TextSpeed = 'mid';

/** @brief Starting state. */
const INITIAL: UiState = { sceneKey: null, viewport: null, textSpeed: DEFAULT_TEXT_SPEED, modalCount: 0 };

let state: UiState = INITIAL;
const subscribers = new Set<() => void>();
let disconnect: (() => void) | null = null;

/**
 * @brief Replaces part of the state and tells subscribers.
 * @param patch Fields to change.
 */
function update (patch: Partial<UiState>): void
{
    const keys = Object.keys(patch) as (keyof UiState)[];
    if (keys.every((key) => Object.is(state[key], patch[key]))) return;
    state = { ...state, ...patch };
    for (const fn of [...subscribers]) fn();
}

/**
 * @brief Starts filling the store from the `EventBus`. Safe to call more than once.
 * @return Stops listening (mostly for tests and hot reload).
 */
export function connectUiStore (): () => void
{
    if (disconnect) return disconnect;
    const onScene = ({ key }: SceneInfo) => update({ sceneKey: key });
    const onViewport = (viewport: ViewportInfo) => update({ viewport });
    const onSpeed = ({ speed }: TextSpeedInfo) => update({ textSpeed: speed });
    EventBus.on(GameEvents.SCENE_CHANGED, onScene);
    EventBus.on(GameEvents.VIEWPORT_CHANGED, onViewport);
    EventBus.on(GameEvents.TEXT_SPEED_CHANGED, onSpeed);
    disconnect = () =>
    {
        EventBus.off(GameEvents.SCENE_CHANGED, onScene);
        EventBus.off(GameEvents.VIEWPORT_CHANGED, onViewport);
        EventBus.off(GameEvents.TEXT_SPEED_CHANGED, onSpeed);
        disconnect = null;
    };
    return disconnect;
}

/**
 * @brief The current state, for code outside React.
 * @return The state (do not modify it).
 */
export function getUiState (): UiState
{
    return state;
}

/**
 * @brief Calls `fn` after every change.
 * @param fn Callback.
 * @return Unsubscribes.
 */
export function subscribeUiState (fn: () => void): () => void
{
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
}

/**
 * @brief Changes the text speed. Sent on the bus so the game (and a future options menu) hear it too.
 * @param speed The new speed.
 */
export function setTextSpeed (speed: TextSpeed): void
{
    EventBus.emit(GameEvents.TEXT_SPEED_CHANGED, { speed });
}

/**
 * @brief Marks a modal UI as open. Sends `UI_MODAL_CHANGED` when the first one opens.
 * @return Call to mark it closed again (only the first call counts). Sends
 *         `UI_MODAL_CHANGED` when the last one closes.
 */
export function openModal (): () => void
{
    update({ modalCount: state.modalCount + 1 });
    if (state.modalCount === 1) EventBus.emit(GameEvents.UI_MODAL_CHANGED, { open: true });
    let closed = false;
    return () =>
    {
        if (closed) return;
        closed = true;
        update({ modalCount: Math.max(0, state.modalCount - 1) });
        if (state.modalCount === 0) EventBus.emit(GameEvents.UI_MODAL_CHANGED, { open: false });
    };
}

/**
 * @brief Reads part of the UI state and re-renders when that part changes.
 *
 * @code
 * const sceneKey = useUiStore((ui) => ui.sceneKey);
 * const speed = useUiStore((ui) => ui.textSpeed);
 * @endcode
 *
 * Return a value that stays the same (`===`) while nothing it depends on
 * changes: a field, or a primitive worked out from fields. Do not build a new
 * object or array in the selector.
 *
 * @param selector Picks the value from the state.
 * @return The selected value.
 */
export function useUiStore<T> (selector: (ui: UiState) => T): T
{
    return useSyncExternalStore(subscribeUiState, () => selector(state), () => selector(INITIAL));
}

/**
 * @brief Keeps a modal UI marked as open while `active` is `true` (see `openModal()`).
 *
 * Scenes stop moving the player while any modal UI is open.
 *
 * @code
 * function PauseMenu ({ open }: { open: boolean })
 * {
 *     useModal(open);
 *     ...
 * }
 * @endcode
 *
 * @param active Whether this UI currently takes the player's input.
 */
export function useModal (active: boolean): void
{
    useEffect(() => (active ? openModal() : undefined), [active]);
}

/**
 * @brief The game resolution, in game pixels, for laying out UI from the edges.
 *
 * Follows `game.scale.setGameSize()` through `VIEWPORT_CHANGED`; before the
 * first viewport it is the configured size (src/game/config.ts).
 *
 * @return `{ width, height }`.
 */
export function useGameSize (): { width: number; height: number }
{
    const width = useUiStore((ui) => ui.viewport?.gameWidth ?? GAME_WIDTH);
    const height = useUiStore((ui) => ui.viewport?.gameHeight ?? GAME_HEIGHT);
    return { width, height };
}
