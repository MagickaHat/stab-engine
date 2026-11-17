/**
 * @file session.ts
 * @brief Remembers which battle is running, so any part of the game can find it.
 *
 * The battle scene registers its `BattleBridge` here when a battle starts and
 * clears it when the battle is left. The React UI reads it through
 * `useBattle()` (src/ui/useBattle.ts), which also works for components that
 * are mounted after the battle has started.
 */
import type { BattleBridge } from './BattleBridge.ts';

let active: BattleBridge | null = null;
const listeners = new Set<() => void>();

/**
 * @brief The battle in progress.
 * @return Its bridge, or `null` outside battles.
 */
export function getActiveBattle (): BattleBridge | null
{
    return active;
}

/**
 * @brief Set or clear the battle in progress. Called by the battle scene.
 * @param bridge The new battle's bridge, or `null` when the battle is left.
 */
export function setActiveBattle (bridge: BattleBridge | null): void
{
    if (active === bridge) return;
    active = bridge;
    for (const listener of [...listeners]) listener();
}

/**
 * @brief Be told when a battle starts or is left.
 * @param listener Called with no arguments; read `getActiveBattle()` inside it.
 * @return A function that removes the listener.
 */
export function subscribeActiveBattle (listener: () => void): () => void
{
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
