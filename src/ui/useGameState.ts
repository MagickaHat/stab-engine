/**
 * @file useGameState.ts
 * @brief React hook for the game in progress (party, bag, money, flags...).
 */
import { useSyncExternalStore } from 'react';
import { getGameState, subscribeGameState } from '../state';
import type { GameState, SaveData } from '../state';

/** @brief `subscribe` for when there is no game: nothing ever changes. */
const subscribeToNothing = () => () => {};

/**
 * @brief Follows the game in progress.
 *
 * The component is rendered again whenever the game state changes, and when
 * a different game is started or loaded. Read values from the returned data;
 * to change something, call the methods of `getGameState()`.
 *
 * @code
 * function MoneyCounter ()
 * {
 *     const game = useGameState();
 *     if (!game) return null;
 *     return <div style={{ position: 'absolute', right: 4, top: 4 }}>$ {game.player.money}</div>;
 * }
 * @endcode
 *
 * @return The current data (read-only), or `null` when no game has been started or loaded.
 */
export function useGameState (): SaveData | null
{
    const state: GameState | null = useSyncExternalStore(subscribeGameState, getGameState);
    return useSyncExternalStore(
        state ? state.subscribe : subscribeToNothing,
        () => (state ? state.getSnapshot() : null),
    );
}
