/**
 * @file useBattle.ts
 * @brief React hook for the battle in progress.
 */
import { useSyncExternalStore } from 'react';
import { getActiveBattle, subscribeActiveBattle } from '../battle';
import type { BattleBridge, BattleSnapshot } from '../battle';

/** @brief What `useBattle()` gives a component during a battle. */
export interface BattleControls
{
    /**
     * The battle as it is being shown right now: field, party, turn and, while
     * `snapshot.phase` is `'choosing'`, what can be chosen (`snapshot.choice`).
     */
    snapshot: BattleSnapshot;
    /** Use the move in this slot of `snapshot.choice.moves` (from 1). `extra`: `"terastallize"`, `"mega"`... */
    chooseMove: BattleBridge['chooseMove'];
    /** Switch to this slot of `snapshot.choice.switches` (from 1). */
    chooseSwitch: BattleBridge['chooseSwitch'];
    /** Answer Team Preview, optionally with the order to bring the party in. */
    chooseTeam: BattleBridge['chooseTeam'];
    /** Give up the battle. */
    forfeit: BattleBridge['forfeit'];
    /** The bridge itself, for anything else (raw choices, the simulator). */
    bridge: BattleBridge;
}

/** @brief `subscribe` for when there is no battle: nothing ever changes. */
const subscribeToNothing = () => () => {};

/**
 * @brief Follows the battle in progress.
 *
 * The component is rendered again whenever the battle changes: after every
 * step the battle scene shows, and when a choice becomes available. So a HP
 * bar drawn from `snapshot` moves when the hit is shown, not before.
 *
 * @code
 * function MoveMenu ()
 * {
 *     const battle = useBattle();
 *     if (battle?.snapshot.choice?.kind !== 'move') return null;
 *     return battle.snapshot.choice.moves.map((move) => (
 *         <button key={move.slot} className="ui-interactive" disabled={move.disabled}
 *             onClick={() => battle.chooseMove(move.slot)}>
 *             {move.name} {move.pp}/{move.maxpp}
 *         </button>
 *     ));
 * }
 * @endcode
 *
 * @return The snapshot and the actions, or `null` when no battle is running.
 */
export function useBattle (): BattleControls | null
{
    const bridge = useSyncExternalStore(subscribeActiveBattle, getActiveBattle);
    const snapshot = useSyncExternalStore(
        bridge ? bridge.subscribe : subscribeToNothing,
        () => (bridge ? bridge.getSnapshot() : null),
    );
    if (!bridge || !snapshot) return null;
    return {
        snapshot,
        chooseMove: bridge.chooseMove,
        chooseSwitch: bridge.chooseSwitch,
        chooseTeam: bridge.chooseTeam,
        forfeit: bridge.forfeit,
        bridge,
    };
}
