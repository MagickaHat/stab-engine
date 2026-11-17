/**
 * @file session.ts
 * @brief Remembers which game is being played, so any part of the engine can find it.
 *
 * The title screen (or whatever starts or loads a game) registers the
 * `GameState` here. Scenes read it with `getGameState()`, and the React UI
 * follows it through `useGameState()` (src/ui/useGameState.ts).
 *
 * @code
 * setGameState(GameState.create({ name: 'Red' }));   // new game
 * setGameState(saves.load(0));                       // continue
 * setGameState(null);                                // back to the title screen
 * @endcode
 */
import type { GameState } from './GameState.ts';

let current: GameState | null = null;
const listeners = new Set<() => void>();

/**
 * @brief The game being played.
 * @return Its state, or `null` if no game has been started or loaded.
 */
export function getGameState (): GameState | null
{
    return current;
}

/**
 * @brief The game being played, for code that cannot run without one.
 * @return Its state.
 * @throws Error if no game has been started or loaded.
 */
export function requireGameState (): GameState
{
    if (!current) throw new Error('[state] no game in progress: call setGameState() first');
    return current;
}

/**
 * @brief Set or clear the game being played.
 * @param state A new or loaded game, or `null` when leaving it.
 */
export function setGameState (state: GameState | null): void
{
    if (current === state) return;
    current = state;
    for (const listener of [...listeners]) listener();
}

/**
 * @brief Be told when a different game becomes the one being played.
 *
 * Changes inside a game are reported by `GameState.subscribe()`, not here.
 * @param listener Called with no arguments; read `getGameState()` inside it.
 * @return A function that removes the listener.
 */
export function subscribeGameState (listener: () => void): () => void
{
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
