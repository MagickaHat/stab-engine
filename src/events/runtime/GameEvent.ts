/**
 * @file GameEvent.ts
 * @brief One event on the current map: its script, position, tags and active page.
 */
import type { CompiledPage, CompiledScript } from '../compile.ts';
import { evaluate } from '../conditions.ts';
import type { EvalContext, EventRef } from '../conditions.ts';

/**
 * @brief What a map object factory produces: an event before it is on the map.
 *
 * See src/events/tiled.ts for the factories that make these from Tiled objects.
 */
export interface EventDefinition
{
    /** Event ID: the Tiled object ID, unique on its map. */
    id: number;
    /** Object name in Tiled (for debugging). */
    name: string;
    /** Tiled class it was made from (`Event`, `Npc`, `Sign`...). */
    kind: string;
    /** Top-left tile. */
    x: number;
    y: number;
    /** Size in tiles (trigger regions can cover several tiles). Default: 1 × 1. */
    width: number;
    height: number;
    tags: string[];
    script: CompiledScript;
}

/** @brief An event on the map. */
export class GameEvent implements EventRef
{
    readonly id: number;
    readonly name: string;
    readonly kind: string;
    readonly tags: string[];
    readonly script: CompiledScript;
    /** Where it was placed. Its character's position is the current one. */
    readonly home: { x: number; y: number; width: number; height: number };
    /** Index of the active page, or -1 for none (the event is not there). */
    pageIndex = -1;
    /** Removed until the map is loaded again (`erase`). */
    erased = false;
    /** Turned towards the player and holding still while its script runs. */
    locked = false;

    /**
     * @param definition What the factory made.
     */
    constructor (definition: EventDefinition)
    {
        this.id = definition.id;
        this.name = definition.name;
        this.kind = definition.kind;
        this.tags = [...new Set([...definition.tags, ...definition.script.tags])];
        this.script = definition.script;
        this.home = { x: definition.x, y: definition.y, width: definition.width, height: definition.height };
    }

    /** @brief The active page, or `null`. */
    get page (): CompiledPage | null
    {
        return this.pageIndex >= 0 ? this.script.pages[this.pageIndex] : null;
    }

    /**
     * @brief Pick the active page again: the last one whose conditions pass.
     * @param ctx The game. `self` is set to this event.
     * @param hidden Whether the event is hidden for good (`hide`).
     * @return `true` if the active page changed.
     */
    refresh (ctx: EvalContext, hidden: boolean): boolean
    {
        let index = -1;
        if (!this.erased && !hidden)
        {
            const own = { ...ctx, self: this };
            for (let i = this.script.pages.length - 1; i >= 0; i--)
            {
                if (evaluate(this.script.pages[i].conditions, own))
                {
                    index = i;
                    break;
                }
            }
        }
        const changed = index !== this.pageIndex;
        this.pageIndex = index;
        return changed;
    }

    /**
     * @brief Whether a tile is covered by the event's trigger area (where it was placed).
     * @param x Tile column.
     * @param y Tile row.
     */
    covers (x: number, y: number): boolean
    {
        const { home } = this;
        return x >= home.x && y >= home.y && x < home.x + home.width && y < home.y + home.height;
    }
}
