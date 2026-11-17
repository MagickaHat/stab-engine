/**
 * @file BattleBridge.ts
 * @brief Connects the battle simulator to whatever shows the battle.
 *
 * `BattleEngine` reports a whole turn at once, and its `state` is already at
 * the end of that turn. A game needs the opposite: one event at a time, with
 * HP bars and sprites that only change when the event is shown. The bridge
 * does that conversion:
 *
 * @code
 *  BattleEngine ──lines──▶ queue ──one step──▶ presenter (Phaser scene: animates, returns a Promise)
 *       ▲                    │
 *       │ choices            └─ after each step ─▶ snapshot ──▶ subscribers (React, via useBattle())
 *       └──────────────── chooseMove() / chooseSwitch() ◀──────────────┘
 * @endcode
 *
 * - The **presenter** is called for each step and may return a Promise. The
 *   next step waits for it, so animations play in order.
 * - The **snapshot** is the battle as plain data (see snapshot.ts). It is
 *   replaced after every step and whenever a choice becomes available.
 * - A choice is only offered once every queued step has been shown, so a menu
 *   never opens in the middle of a turn.
 *
 * The bridge does not import Phaser or React. It also runs in Node (tests).
 *
 * @code
 * const bridge = new BattleBridge({
 *     p1: { name: 'Player', team: importTeam(SAMPLE_TEAM_P1) },
 *     p2: { name: 'Rival', team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
 * });
 * bridge.setPresenter(async (step) => { if (step.kind === 'faint') await playFaint(step.pokemon); });
 * bridge.subscribe(() =>
 * {
 *     const snapshot = bridge.getSnapshot();
 *     if (snapshot.choice?.kind === 'team') bridge.chooseTeam();
 *     else if (snapshot.choice?.kind === 'move') bridge.chooseMove(1);
 * });
 * bridge.start();
 * @endcode
 */
import { BattleEngine } from '../BattleEngine.ts';
import type { BattleEngineOptions } from '../BattleEngine.ts';
import { BattleState } from '../BattleState.ts';
import type { BattleRequest, SideID } from '../types.ts';
import { buildSnapshot, viewChoice } from './snapshot.ts';
import type { BattlePhase, BattleSnapshot, ChoiceView } from './snapshot.ts';
import { toStep } from './steps.ts';
import type { BattleStep } from './steps.ts';

/**
 * @brief Shows one step.
 * @param step What happened.
 * @param snapshot The battle right after it happened.
 * @return Nothing, or a Promise that resolves when the step has been shown.
 */
export type BattlePresenter = (step: BattleStep, snapshot: BattleSnapshot) => void | Promise<void>;

/**
 * @brief Options for a bridged battle.
 *
 * The same options as `BattleEngine`. `perspective` selects the local player
 * (`'p1'` by default, or `'p2'`); spectator views are not supported here.
 */
export type BattleBridgeOptions = BattleEngineOptions;

/**
 * @brief Runs a battle and presents it step by step.
 *
 * Lifecycle: construct → `setPresenter()` / `subscribe()` → `start()` → answer
 * each choice → snapshot `phase` becomes `'ended'` → `destroy()`.
 */
export class BattleBridge
{
    /** @brief The simulator wrapper. Use it for anything the bridge does not cover. */
    readonly engine: BattleEngine;

    /** @brief The side the local player controls. */
    readonly player: SideID;

    /**
     * @brief Called when the other side must decide and no AI controls it.
     *
     * Answer with `bridge.engine.choose(side, ...)`. Use this for a scripted
     * opponent or your own AI. Called as soon as the simulator asks, without
     * waiting for the presentation.
     */
    onOpponentRequest: (side: SideID, request: BattleRequest) => void = () => {};

    /** The battle as far as it has been presented (the engine's own state runs ahead). */
    private readonly state: BattleState;
    private readonly queue: string[] = [];
    private readonly listeners = new Set<() => void>();
    private presenter: BattlePresenter | null = null;
    private snapshot: BattleSnapshot;

    private phase: BattlePhase = 'idle';
    private step: BattleStep | null = null;
    private error: string | null = null;
    private winner: string | null | undefined = undefined;
    /** The request waiting to be offered once the queue is empty. */
    private pending: BattleRequest | null = null;
    /** The request being offered right now. */
    private offered: BattleRequest | null = null;
    /** The request answered last, offered again if the simulator rejects the answer. */
    private answered: BattleRequest | null = null;
    private choice: ChoiceView | null = null;
    private playing = false;
    private destroyed = false;

    /**
     * @brief Create a battle (it does not start until `start()` is called).
     * @param options Format, teams, AI and other `BattleEngine` settings.
     * @throws Error if the format does not exist, or `perspective` is a spectator view.
     */
    constructor (options: BattleBridgeOptions)
    {
        const perspective = options.perspective ?? 'p1';
        if (perspective !== 'p1' && perspective !== 'p2')
        {
            throw new Error(`BattleBridge: perspective must be "p1" or "p2", not "${perspective}".`);
        }
        if (options[perspective].ai)
        {
            throw new Error(`BattleBridge: ${perspective} is the local player, so it cannot be controlled by an AI.`);
        }
        this.player = perspective;
        this.engine = new BattleEngine(options);
        this.state = new BattleState(perspective);
        this.snapshot = this.makeSnapshot();

        this.engine.onProtocol = (lines) =>
        {
            this.queue.push(...lines);
            void this.play();
        };
        this.engine.onRequest = (side, request) =>
        {
            if (side !== this.player)
            {
                this.onOpponentRequest(side, request);
                return;
            }
            this.pending = request;
            this.answered = null;
            if (!this.playing) this.settle();
        };
        this.engine.onError = (side, message) =>
        {
            if (side !== this.player)
            {
                console.warn(`[${side}] ${message}`);
                return;
            }
            this.error = message;
            //  The simulator keeps waiting for the same decision, so offer it again
            //  (unless it has already sent an updated request).
            this.pending ??= this.answered;
            this.answered = null;
            if (!this.playing) this.settle();
        };
    }

    /**
     * @brief Start the battle. Set the presenter and subscribe first.
     */
    start (): void
    {
        if (this.destroyed) throw new Error('BattleBridge: battle was destroyed');
        this.phase = 'waiting';
        this.publish();
        this.engine.start();
    }

    /**
     * @brief Set who shows the steps (usually the battle scene).
     *
     * Without a presenter, steps are applied immediately one after another.
     * @param presenter The presenter, or `null` to remove it.
     */
    setPresenter (presenter: BattlePresenter | null): void
    {
        this.presenter = presenter;
    }

    /**
     * @brief Be told whenever the snapshot changes.
     *
     * Has the shape React's `useSyncExternalStore` expects.
     * @param listener Called with no arguments; read `getSnapshot()` inside it.
     * @return A function that removes the listener.
     */
    subscribe = (listener: () => void): (() => void) =>
    {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    /**
     * @brief The battle right now.
     * @return The current snapshot. The same object is returned until something changes.
     */
    getSnapshot = (): BattleSnapshot => this.snapshot;

    /**
     * @brief Use a move. Only valid while `snapshot.choice.kind` is `'move'`.
     * @param slot Move slot from `snapshot.choice.moves`, starting at 1.
     * @param extra Optional modifier such as `"terastallize"` or `"mega"`.
     */
    chooseMove = (slot: number, extra?: string): void =>
    {
        this.choose(`move ${slot}${extra ? ' ' + extra : ''}`);
    };

    /**
     * @brief Switch to another party member.
     * @param slot Party slot from `snapshot.choice.switches`, starting at 1.
     */
    chooseSwitch = (slot: number): void =>
    {
        this.choose(`switch ${slot}`);
    };

    /**
     * @brief Answer Team Preview.
     * @param order Party slots in the order to bring them, e.g. `[3, 1, 2]`
     *              (the first one leads). Leave out to keep the party order.
     */
    chooseTeam = (order?: readonly number[]): void =>
    {
        this.choose(order?.length ? `team ${order.join(order.some((slot) => slot > 9) ? ',' : '')}` : 'default');
    };

    /**
     * @brief Send a raw choice in Showdown syntax, e.g. `"move 1 2, switch 3"` in doubles.
     *
     * Ignored unless a choice is being offered (`snapshot.phase === 'choosing'`).
     * @param choice The choice string.
     */
    choose = (choice: string): void =>
    {
        if (this.destroyed || this.phase !== 'choosing' || !this.offered) return;
        this.answered = this.offered;
        this.offered = null;
        this.choice = null;
        this.error = null;
        this.phase = 'waiting';
        this.publish();
        this.engine.choose(this.player, choice);
    };

    /**
     * @brief Give up. The opponent wins.
     */
    forfeit = (): void =>
    {
        if (this.destroyed || this.winner !== undefined) return;
        this.engine.forfeit(this.player);
    };

    /**
     * @brief Stop the battle and release everything. Call when leaving the battle.
     *
     * A presenter still showing a step is not interrupted, but nothing follows it.
     */
    destroy (): void
    {
        if (this.destroyed) return;
        this.destroyed = true;
        this.queue.length = 0;
        this.listeners.clear();
        this.presenter = null;
        this.engine.destroy();
        this.state.destroy();
    }

    /** @brief Show every queued line, one step at a time, then offer the pending choice. */
    private async play (): Promise<void>
    {
        if (this.playing) return;
        this.playing = true;
        while (this.queue.length && !this.destroyed)
        {
            const line = this.queue.shift()!;
            try
            {
                this.state.add(line);
            }
            catch (error)
            {
                //  The model could not follow this line; keep presenting the battle anyway.
                console.error(`BattleBridge: could not apply "${line}"`, error);
            }
            const step = toStep(line);
            if (!step) continue;

            if (this.choice)
            {
                //  More to show after all: take the menu away until it has been shown.
                this.pending ??= this.offered;
                this.offered = null;
                this.choice = null;
            }
            this.step = step;
            this.phase = 'presenting';
            if (step.kind === 'end') this.winner = step.winner;
            this.publish();

            if (this.presenter)
            {
                try
                {
                    await this.presenter(step, this.snapshot);
                }
                catch (error)
                {
                    //  A broken animation must not freeze the battle.
                    console.error('BattleBridge: presenter failed', error);
                }
            }
        }
        this.playing = false;
        if (!this.destroyed) this.settle();
    }

    /** @brief Everything has been shown: offer the pending choice, or wait, or finish. */
    private settle (): void
    {
        if (this.winner !== undefined)
        {
            this.phase = 'ended';
            this.pending = this.offered = this.choice = null;
        }
        else if (this.pending)
        {
            const request = this.pending;
            this.pending = null;
            //  The request holds exact data about the player's own team.
            this.state.addRequest(JSON.stringify(request));
            this.choice = viewChoice(request);
            this.offered = this.choice ? request : null;
            this.phase = this.choice ? 'choosing' : 'waiting';
        }
        else if (!this.choice)
        {
            this.phase = 'waiting';
        }
        this.publish();
    }

    /** @brief Build a snapshot of the current state. */
    private makeSnapshot (): BattleSnapshot
    {
        return buildSnapshot(this.state, {
            phase: this.phase, step: this.step, choice: this.choice, error: this.error, winner: this.winner,
        });
    }

    /** @brief Replace the snapshot and tell every subscriber. */
    private publish (): void
    {
        this.snapshot = this.makeSnapshot();
        for (const listener of [...this.listeners]) listener();
    }
}
