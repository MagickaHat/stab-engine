/**
 * @file pathfinding.ts
 * @brief Finds a walking path between two tiles (A* search, four directions).
 */
import type { Direction } from './schema.ts';

/** @brief How far one step in each direction moves. */
export const DIRECTION_DELTA: Readonly<Record<Direction, readonly [number, number]>> = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
};

/** @brief The opposite of each direction. */
export const OPPOSITE: Readonly<Record<Direction, Direction>> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** @brief Options for `findPath()`. */
export interface PathOptions
{
    /**
     * Whether a character may step from a tile onto a neighbour. The goal
     * tile is always tested too (unless `adjacent`).
     */
    canStep: (fromX: number, fromY: number, dir: Direction) => boolean;
    /** Stop next to the goal instead of on it (to walk up to a character). */
    adjacent?: boolean;
    /** Give up after looking at this many tiles. Default: 4000. */
    maxNodes?: number;
}

/**
 * @brief Find the shortest walk from one tile to another.
 * @param fromX Start column.
 * @param fromY Start row.
 * @param toX Goal column.
 * @param toY Goal row.
 * @param options Walkability and limits.
 * @return The directions to walk, in order (empty if already there), or `null` if there is no way.
 */
export function findPath (fromX: number, fromY: number, toX: number, toY: number, options: PathOptions): Direction[] | null
{
    const goal = (x: number, y: number) => (options.adjacent
        ? Math.abs(x - toX) + Math.abs(y - toY) === 1
        : x === toX && y === toY);
    if (goal(fromX, fromY)) return [];
    if (options.adjacent && fromX === toX && fromY === toY)
    {
        //  Standing on the goal: step off it to any free side.
        for (const dir of Object.keys(DIRECTION_DELTA) as Direction[])
        {
            if (options.canStep(fromX, fromY, dir)) return [dir];
        }
        return null;
    }

    const key = (x: number, y: number) => `${x},${y}`;
    const heuristic = (x: number, y: number) => Math.abs(x - toX) + Math.abs(y - toY);
    const maxNodes = options.maxNodes ?? 4000;

    interface Node { x: number; y: number; g: number; f: number; parent: Node | null; dir: Direction | null }
    const open: Node[] = [{ x: fromX, y: fromY, g: 0, f: heuristic(fromX, fromY), parent: null, dir: null }];
    const best = new Map<string, number>([[key(fromX, fromY), 0]]);
    let visited = 0;

    while (open.length > 0 && visited++ < maxNodes)
    {
        //  Small maps: a linear scan for the cheapest node is fast enough and keeps ties stable.
        let index = 0;
        for (let i = 1; i < open.length; i++) if (open[i].f < open[index].f) index = i;
        const node = open.splice(index, 1)[0];
        if (goal(node.x, node.y))
        {
            const path: Direction[] = [];
            for (let n: Node | null = node; n?.dir; n = n.parent) path.push(n.dir);
            return path.reverse();
        }
        for (const dir of Object.keys(DIRECTION_DELTA) as Direction[])
        {
            const [dx, dy] = DIRECTION_DELTA[dir];
            const x = node.x + dx;
            const y = node.y + dy;
            if (!options.canStep(node.x, node.y, dir)) continue;
            const g = node.g + 1;
            const k = key(x, y);
            if ((best.get(k) ?? Infinity) <= g) continue;
            best.set(k, g);
            open.push({ x, y, g, f: g + heuristic(x, y), parent: node, dir });
        }
    }
    return null;
}

/**
 * @brief The direction from one tile towards another, along the longer axis.
 * @return The direction, or `null` if they are the same tile.
 */
export function directionTowards (fromX: number, fromY: number, toX: number, toY: number): Direction | null
{
    const dx = toX - fromX;
    const dy = toY - fromY;
    if (dx === 0 && dy === 0) return null;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
}
