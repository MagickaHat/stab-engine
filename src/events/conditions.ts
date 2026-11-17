/**
 * @file conditions.ts
 * @brief Evaluates conditions and reads values (`{ "var": ... }`, `{ "random": ... }`).
 *
 * Conditions are data (see schema.ts), so evaluating one is a plain tree
 * walk: no code is ever generated or evaluated.
 */
import type { GameState } from '../state/GameState.ts';
import { MAX_ITEM_QUANTITY } from '../state/schema.ts';
import { TRAINER_FLAG_PREFIX } from './registry/flags.ts';
import { DEFAULT_STORY_TRACK, findMilestone } from './registry/story.ts';
import { BATTLE_RESULT_VAR } from './registry/variables.ts';
import type { CompareOp, Condition, Direction, ValueRef } from './schema.ts';

/** @brief An event as conditions see it. */
export interface EventRef
{
    /** Event ID on the map (the Tiled object ID). */
    id: number;
    tags: readonly string[];
}

/** @brief What conditions and values are evaluated against. */
export interface EvalContext
{
    state: GameState;
    /** Current map ID. */
    map: string;
    /** The event whose page or script is being evaluated, or `null` (listeners, hooks). */
    self: EventRef | null;
    /** The event that started the script, or `null` if the player did (or nobody). */
    trigger: EventRef | null;
    /** Which way the player faces. */
    playerFacing: Direction;
    /** Random numbers from 0 (inclusive) to 1 (exclusive). Default: `Math.random`. */
    random?: () => number;
}

/**
 * @brief Compare two values.
 *
 * Numbers compare as numbers. Anything else compares as text; `lt`/`gt`
 * and friends then use the text order.
 * @param left Left side (the stored value; `undefined` counts as 0).
 * @param op Operator.
 * @param right Right side.
 */
export function compare (left: number | string | undefined, op: CompareOp, right: number | string): boolean
{
    const a = left ?? 0;
    switch (op)
    {
        case 'eq': return a === right;
        case 'ne': return a !== right;
        case 'lt': return a < right;
        case 'le': return a <= right;
        case 'gt': return a > right;
        case 'ge': return a >= right;
    }
}

/**
 * @brief Read a value.
 * @param value A number, text, `{ var }` or `{ random: [min, max] }`.
 * @param ctx Where to read variables and random numbers from.
 * @return The value; an unset variable reads as 0.
 */
export function resolveValue (value: ValueRef, ctx: Pick<EvalContext, 'state' | 'random'>): number | string
{
    if (typeof value === 'number' || typeof value === 'string') return value;
    if ('var' in value) return ctx.state.getVar(value.var) ?? 0;
    const [min, max] = value.random;
    const low = Math.min(min, max);
    return low + Math.floor((ctx.random ?? Math.random)() * (Math.abs(max - min) + 1));
}

/**
 * @brief Read a value that must be a number.
 * @param value The value.
 * @param ctx Where to read it from.
 * @param what What it is, for the error message.
 * @return The number.
 * @throws Error if it is text that is not a number.
 */
export function resolveNumber (value: ValueRef, ctx: Pick<EvalContext, 'state' | 'random'>, what: string): number
{
    const resolved = resolveValue(value, ctx);
    const number = typeof resolved === 'number' ? resolved : Number(resolved);
    if (!Number.isFinite(number)) throw new Error(`[events] ${what} must be a number, got "${resolved}"`);
    return number;
}

/**
 * @brief Whether a condition passes.
 * @param condition The condition; `undefined` always passes.
 * @param ctx What to evaluate it against.
 * @return `true` if it passes.
 * @throws Error for a self switch condition with no event to read it from.
 */
export function evaluate (condition: Condition | undefined, ctx: EvalContext): boolean
{
    if (!condition) return true;
    const { state } = ctx;

    if ('all' in condition) return condition.all.every((c) => evaluate(c, ctx));
    if ('any' in condition) return condition.any.some((c) => evaluate(c, ctx));
    if ('not' in condition) return !evaluate(condition.not, ctx);

    if ('flag' in condition) return state.getFlag(condition.flag) === (condition.is ?? true);
    if ('selfSwitch' in condition)
    {
        const event = condition.event ?? ctx.self?.id;
        if (event === undefined) throw new Error('[events] a selfSwitch condition needs an event');
        return state.getSelfSwitch(ctx.map, event, condition.selfSwitch) === (condition.is ?? true);
    }
    if ('var' in condition)
    {
        return compare(state.getVar(condition.var), condition.op ?? 'eq', resolveValue(condition.value, ctx));
    }
    if ('story' in condition) return storyReached(state, condition.story, condition.op ?? 'reached', condition.track);
    if ('item' in condition) return compare(state.countItem(condition.item), condition.op ?? 'ge', condition.value ?? 1);
    if ('bagHasRoom' in condition)
    {
        return state.countItem(condition.bagHasRoom) + (condition.quantity ?? 1) <= MAX_ITEM_QUANTITY;
    }
    const data = state.getSnapshot();
    if ('money' in condition) return compare(data.player.money, condition.op ?? 'ge', condition.money);
    if ('partySize' in condition) return compare(data.party.length, condition.op ?? 'ge', condition.partySize);
    if ('hasSpecies' in condition) return data.party.some((pokemon) => pokemon.species === condition.hasSpecies);
    if ('trainerDefeated' in condition) return state.getFlag(TRAINER_FLAG_PREFIX + condition.trainerDefeated);
    if ('playerFacing' in condition) return ctx.playerFacing === condition.playerFacing;
    if ('eventId' in condition) return pick(ctx, condition.of)?.id === condition.eventId;
    if ('hasTag' in condition) return pick(ctx, condition.of)?.tags.includes(condition.hasTag) ?? false;
    if ('map' in condition) return ctx.map === condition.map;
    if ('battleResult' in condition) return state.getVar(BATTLE_RESULT_VAR) === condition.battleResult;
    return (ctx.random ?? Math.random)() < condition.random;
}

/** @brief The event a condition's `of` field means. */
function pick (ctx: EvalContext, of: 'self' | 'trigger' | undefined): EventRef | null
{
    return of === 'trigger' ? ctx.trigger : ctx.self;
}

/**
 * @brief Compare story progress with a milestone.
 * @param state The game.
 * @param milestone Milestone ID (from src/events/registry/story.ts).
 * @param op `reached`: at or past it; `before`: not reached yet; `at`: exactly there.
 * @param track Track. Default: the milestone's own track.
 * @return The result. An unregistered milestone is never reached.
 */
export function storyReached (state: GameState, milestone: string, op: 'reached' | 'before' | 'at', track?: string): boolean
{
    const target = findMilestone(milestone, track);
    if (!target) return op === 'before';
    const current = state.getStory(track ?? target.track ?? DEFAULT_STORY_TRACK);
    const index = current === undefined ? -1 : (findMilestone(current, target.track)?.index ?? -1);
    if (op === 'at') return index === target.index;
    const reached = index >= target.index;
    return op === 'reached' ? reached : !reached;
}
