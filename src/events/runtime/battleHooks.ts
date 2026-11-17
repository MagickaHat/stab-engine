/**
 * @file battleHooks.ts
 * @brief Runs battle hooks (schema.ts `BattleHook`) while a battle is shown.
 *
 * The host passes every battle step to `onStep()` and waits for it before
 * showing the next one, so a hook's message appears at the right moment:
 *
 * @code
 * "hooks": {
 *   "rival_last_pokemon": {
 *     "on": "faint", "trainer": "rival_lab", "side": "foe",
 *     "commands": [{ "cmd": "message", "key": "events.rival.dont_give_up" }]
 *   }
 * }
 * @endcode
 */
import type { BattleSnapshot, BattleStep, PokemonView } from '../../battle/bridge/index.ts';
import type { CompiledHook } from '../compile.ts';
import { evaluate } from '../conditions.ts';
import type { HookOn } from '../schema.ts';
import type { EventManager } from './EventManager.ts';
import { Interpreter } from './Interpreter.ts';

/** @brief One moment of a battle, as hooks see it. */
export interface HookMoment
{
    on: HookOn;
    turn?: number;
    side?: 'player' | 'foe';
    species?: string;
}

/**
 * @brief Which moments a battle step is.
 * @param step The step.
 * @param snapshot The battle after it.
 * @return The moments (none for most steps).
 */
export function momentsOf (step: BattleStep, snapshot: BattleSnapshot): HookMoment[]
{
    switch (step.kind)
    {
        case 'turn':
            return [{ on: 'turnStart', turn: step.turn }];
        case 'end':
            return [{ on: 'battleEnd' }];
        case 'faint':
        case 'switch':
        {
            const own = step.pokemon.side === snapshot.player;
            const side = own ? snapshot.me : snapshot.foe;
            const view: PokemonView | undefined = side.team.find((pokemon) => pokemon.ident === step.pokemon.ident)
                ?? side.active[step.pokemon.slot] ?? undefined;
            return [{ on: step.kind === 'faint' ? 'faint' : 'switchIn', side: own ? 'player' : 'foe', species: view?.speciesId }];
        }
        default:
            return [];
    }
}

/**
 * @brief Whether a hook matches a moment of a battle.
 * @param hook The hook.
 * @param moment What happened.
 * @param trainer The trainer being fought, if any.
 */
export function hookMatches (hook: CompiledHook, moment: HookMoment, trainer: string | undefined): boolean
{
    if (hook.on !== moment.on) return false;
    if (hook.trainer !== undefined && hook.trainer !== trainer) return false;
    if (hook.turn !== undefined && hook.turn !== moment.turn) return false;
    if (hook.side !== undefined && hook.side !== moment.side) return false;
    if (hook.species !== undefined && hook.species !== moment.species) return false;
    return true;
}

/** @brief Runs the hooks of one battle. */
export class BattleHookRunner
{
    private started = false;
    private readonly ran = new Set<string>();
    private readonly manager: EventManager;
    private readonly trainer: string | undefined;

    /**
     * @param manager The event manager.
     * @param trainer ID of the trainer being fought, or `undefined` for a wild battle.
     */
    constructor (manager: EventManager, trainer: string | undefined)
    {
        this.manager = manager;
        this.trainer = trainer;
    }

    /**
     * @brief Run the hooks for one step. The host awaits this before showing the next step.
     * @param step The step.
     * @param snapshot The battle after it.
     */
    async onStep (step: BattleStep, snapshot: BattleSnapshot): Promise<void>
    {
        const moments = momentsOf(step, snapshot);
        if (!this.started)
        {
            this.started = true;
            moments.unshift({ on: 'battleStart' });
        }
        for (const moment of moments) await this.run(moment);
    }

    /** @brief Run every hook that matches a moment, in ID order. */
    private async run (moment: HookMoment): Promise<void>
    {
        const { manager } = this;
        for (const [id, hook] of Object.entries(manager.bundle.hooks).sort(([a], [b]) => a.localeCompare(b)))
        {
            if (!hookMatches(hook, moment, this.trainer)) continue;
            if ((hook.once ?? true) && this.ran.has(id)) continue;
            const frame = { map: manager.map, self: null, trigger: null, mode: 'battle' as const };
            if (!evaluate(hook.conditions, manager.context(frame))) continue;
            this.ran.add(id);
            try
            {
                await new Interpreter(manager, hook.code, frame).run();
            }
            catch (error)
            {
                manager.warn(`battle hook "${id}" failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
}
