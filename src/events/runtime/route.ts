/**
 * @file route.ts
 * @brief Plays a movement route on a character.
 */
import { DIRECTION_DELTA, directionTowards, OPPOSITE } from '../pathfinding.ts';
import type { Direction, RouteStep } from '../schema.ts';
import type { Actor } from './host.ts';

/** @brief What a route needs besides the character. */
export interface RouteContext
{
    /** The player, for `towardPlayer` and friends. */
    player: Actor;
    wait: (ms: number) => Promise<void>;
    playSe: (name: string) => void;
    random: () => number;
    /** Skip steps that are blocked instead of retrying them. */
    skipBlocked: boolean;
    /** Times to retry a blocked step (a frame apart) before skipping it. Default: 60. */
    retries?: number;
    /** Stop early when this returns `true` (map change, script stopped). */
    cancelled?: () => boolean;
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

/** @brief The four "turn" route words and the direction each one faces. */
const TURN_WORDS: Partial<Record<string, Direction>> = {
    turnUp: 'up', turnDown: 'down', turnLeft: 'left', turnRight: 'right',
};

/**
 * @brief Walk one step, retrying for a while if the way is blocked.
 * @return Whether the step was taken.
 */
async function walk (actor: Actor, dir: Direction, ctx: RouteContext): Promise<boolean>
{
    const retries = ctx.skipBlocked ? 0 : (ctx.retries ?? 60);
    for (let tries = 0; ; tries++)
    {
        if (await actor.step(dir)) return true;
        if (tries >= retries || ctx.cancelled?.()) return false;
        await ctx.wait(33);
    }
}

/**
 * @brief Play a route.
 * @param actor Who moves.
 * @param route The steps.
 * @param ctx The player, timers and options.
 */
export async function runRoute (actor: Actor, route: readonly RouteStep[], ctx: RouteContext): Promise<void>
{
    for (const step of route)
    {
        if (ctx.cancelled?.()) return;
        if (typeof step === 'string')
        {
            const player = ctx.player;
            const towardPlayer = directionTowards(actor.x, actor.y, player.x, player.y) ?? actor.facing;
            const randomDir = DIRECTIONS[Math.floor(ctx.random() * 4)];
            switch (step)
            {
                case 'up': case 'down': case 'left': case 'right':
                    await walk(actor, step, ctx);
                    break;
                case 'forward': await walk(actor, actor.facing, ctx); break;
                case 'backward':
                {
                    //  Keep facing the same way while stepping back.
                    const facing = actor.facing;
                    await walk(actor, OPPOSITE[facing], ctx);
                    actor.turn(facing);
                    break;
                }
                case 'towardPlayer': await walk(actor, towardPlayer, ctx); break;
                case 'awayFromPlayer': await walk(actor, OPPOSITE[towardPlayer], ctx); break;
                case 'random': await walk(actor, randomDir, ctx); break;
                case 'turnAround': actor.turn(OPPOSITE[actor.facing]); break;
                case 'turnTowardPlayer': actor.turn(towardPlayer); break;
                case 'turnAwayFromPlayer': actor.turn(OPPOSITE[towardPlayer]); break;
                case 'turnRandom': actor.turn(randomDir); break;
                default: actor.turn(TURN_WORDS[step]!);
            }
            continue;
        }
        if ('wait' in step) await ctx.wait(step.wait);
        else if ('jump' in step) await actor.jump(step.jump[0], step.jump[1]);
        else if ('speed' in step) actor.setSpeed(step.speed);
        else if ('through' in step) actor.setThrough(step.through);
        else if ('visible' in step) actor.setVisible(step.visible);
        else if ('graphic' in step) actor.setGraphic(step.graphic);
        else if ('face' in step) actor.turn(step.face);
        else if ('se' in step) ctx.playSe(step.se);
        else for (let i = 0; i < step.repeat && !ctx.cancelled?.(); i++) await runRoute(actor, step.steps, ctx);
    }
}

/**
 * @brief Turn a list of directions into a route.
 * @param path Directions, e.g. from `findPath()`.
 * @return The same steps as a route.
 */
export function pathToRoute (path: readonly Direction[]): RouteStep[]
{
    return [...path];
}

/**
 * @brief The tile next to another in a direction.
 * @return `[x, y]`.
 */
export function neighbour (x: number, y: number, dir: Direction): [number, number]
{
    const [dx, dy] = DIRECTION_DELTA[dir];
    return [x + dx, y + dy];
}
