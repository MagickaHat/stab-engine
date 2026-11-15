/**
 * @file BattleState.ts
 * @brief Tracks everything known about a battle, using @pkmn/client.
 *
 * The simulator only *describes* what happens (protocol lines). `@pkmn/client`
 * reads those lines - the same way the Pokémon Showdown website does - and
 * keeps an up-to-date model of the battle: each side's team, the active
 * Pokémon, their HP, status, stat boosts, volatile effects, weather, terrain,
 * hazards and so on. A UI can simply read from that model.
 *
 * `BattleEngine` creates and feeds a `BattleState` automatically
 * (`engine.state`), so you normally only read from it.
 */
import { Battle } from '@pkmn/client';
import { Generations } from '@pkmn/data';
import { Protocol } from '@pkmn/protocol';
import { Dex } from '@pkmn/sim';
import type { SideID } from './types';

/** @brief The `Dex` type `@pkmn/data` expects. */
type DataDex = ConstructorParameters<typeof Generations>[0];

let sharedGenerations: Generations | undefined;

/**
 * @brief Get the shared `Generations` object (Pokédex data per generation).
 *
 * Built once from `@pkmn/sim`'s `Dex`, so the client and the simulator use
 * exactly the same data. `@pkmn/data` and `@pkmn/sim` declare their `Dex`
 * types slightly differently, so a cast is needed (it is safe at runtime).
 *
 * @return A `Generations` instance; `gens.get(9)` gives Gen 9 data.
 */
export function createGenerations (): Generations
{
    sharedGenerations ??= new Generations(Dex as unknown as DataDex);
    return sharedGenerations;
}

/**
 * @brief A live, queryable model of one battle.
 *
 * @code
 * const foe = engine.state.foe.active[0];
 * console.log(foe?.name, `${foe?.hp}/${foe?.maxhp}`, foe?.status, foe?.boosts);
 * console.log('Weather:', engine.state.battle.field.weather);
 * @endcode
 */
export class BattleState
{
    /** @brief The underlying `@pkmn/client` Battle. See its typings for every field. */
    readonly battle: Battle;

    /** @brief The side this state is viewed from (`'p1'` unless told otherwise). */
    readonly player: SideID;

    /**
     * @brief Create an empty battle model.
     * @param player The point of view. Hidden information (like the opponent's
     *               exact HP in some formats) is only known for this side.
     */
    constructor (player: SideID = 'p1')
    {
        this.player = player;
        this.battle = new Battle(createGenerations(), player as never);
    }

    /** @brief Your side (`battle.p1` when viewing as player 1). */
    get me () { return this.player === 'p2' ? this.battle.p2 : this.battle.p1; }

    /** @brief The opponent's side. */
    get foe () { return this.me.foe; }

    /** @brief Current turn number (0 before the first turn). */
    get turn (): number { return this.battle.turn; }

    /**
     * @brief Feed one protocol line (anything except `|request|`) into the model.
     * @param line Raw protocol line, e.g. `|-damage|p2a: Gengar|120/261`.
     */
    add (line: string): void
    {
        if (!line.startsWith('|') || line.startsWith('|request|')) return;
        this.battle.add(line);
    }

    /**
     * @brief Merge a request's exact information about your own team into the model.
     *
     * Call this after the protocol lines of a batch have been added.
     * @param requestJSON The JSON text after `|request|`.
     */
    addRequest (requestJSON: string): void
    {
        if (!requestJSON) return;
        this.battle.update(Protocol.parseRequest(requestJSON as Protocol.RequestJSON));
    }

    /** @brief Free the model's memory. */
    destroy (): void
    {
        this.battle.destroy();
    }
}
