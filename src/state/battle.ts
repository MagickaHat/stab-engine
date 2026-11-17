/**
 * @file battle.ts
 * @brief Takes the saved party into a battle and brings the result back.
 *
 * The simulator starts every Pokémon at full health, and a `SavedPokemon` is
 * not in the simulator's team format. `partyBattle()` covers both:
 *
 * 1. `team`: the party as a packed team string for `PlayerOptions.team`.
 * 2. `prepare`: applies each Pokémon's saved HP, status and PP before the
 *    battle begins (it is `BattleEngineOptions.prepare`).
 * 3. `finish()`: after the battle, writes HP, status, PP, experience and
 *    level back into the `GameState`.
 *
 * @code
 * const { speciesInfo } = await loadPbs(['speciesInfo']);
 * const link = partyBattle(state, { exp: { species: (id) => speciesInfo[id] } });
 * const bridge = new BattleBridge({
 *     p1: { name: state.getSnapshot().player.name, team: link.team },
 *     p2: { name: 'Rival', team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
 *     prepare: link.prepare,
 * });
 * // ... when the battle has ended:
 * link.finish();
 * @endcode
 *
 * The battle scene does this for you when it is started with
 * `usePlayerParty: true` (see src/game/scenes/Battle.ts).
 *
 * Fainted Pokémon are left out of the team, as they cannot be sent out. They
 * stay in the party untouched.
 *
 * Experience is the simulator's missing piece: Showdown has no levels to gain.
 * With the `exp` option, every opponent that faints gives experience to the
 * party members that can still fight (half to those that were not on the
 * field against it, as in Generation 9). A Pokémon that reaches a new level
 * grows at once: its level and stats change in the running battle.
 *
 * Held items follow the rule the games use since Generation 9: an item that
 * was used up, knocked off or taken during the battle is back afterwards
 * (Throat Spray, Focus Sash, Air Balloon, White Herb...). The exception is a
 * Berry the Pokémon ate or flung itself, which is gone for good.
 */
import { Teams } from '@pkmn/sim';
import type { Battle, ID, Pokemon, PokemonSet } from '@pkmn/sim';
import { expForLevel, expGain, levelForExp, MAX_LEVEL } from './experience.ts';
import type { GrowthRate } from './experience.ts';
import type { GameState } from './GameState.ts';
import { isFainted } from './pokemon.ts';
import type { SavedPokemon } from './schema.ts';

/** @brief A side of a two-player battle. */
export type PartySide = 'p1' | 'p2';

/** @brief What the experience rules need to know about a species. */
export interface ExpSpecies
{
    /** Experience it gives when defeated, before scaling. `null` or 0: none. */
    baseExp: number | null;
    /** How fast it levels up. */
    growthRate: GrowthRate;
}

/** @brief Turns experience on for a battle. See `PartyBattleOptions.exp`. */
export interface ExpOptions
{
    /**
     * Looks up a species by ID, normally in the `speciesInfo` table:
     * `(id) => speciesInfo[id]`. A forme that is not found is looked up again
     * by its base species. A species that is not found at all gives no
     * experience and levels up on the `medium` curve.
     */
    species: (id: string) => ExpSpecies | undefined;
    /**
     * `false` to leave out the `|-message|` protocol lines ("Sparky gained 120
     * Exp. Points!", "Sparky grew to Lv. 12!"). Default: `true`.
     */
    messages?: boolean;
}

/** @brief Settings for `partyBattle()`. */
export interface PartyBattleOptions
{
    /** The side the party plays on. Default: `'p1'`. */
    side?: PartySide;
    /** Give experience for defeated opponents. Left out: the party gains none. */
    exp?: ExpOptions;
}

/** @brief Experience one Pokémon gained in a battle. */
export interface ExpResult
{
    /** `uid` of the Pokémon. */
    uid: string;
    /** Experience points gained. */
    gained: number;
    /** Level before the battle. */
    fromLevel: number;
    /** Level after the battle. */
    toLevel: number;
}

/** @brief The connection between the saved party and one battle. See `partyBattle()`. */
export interface PartyBattle
{
    /** The party as a packed team string, for `PlayerOptions.team`. */
    team: string;
    /** `uid` of each team member, in team order (the party order without fainted Pokémon). */
    uids: readonly string[];
    /** Pass as `BattleEngineOptions.prepare`: applies saved HP, status and PP. */
    prepare: (battle: Battle) => void;
    /**
     * Writes each Pokémon's HP, status and PP back into the `GameState`, and
     * removes Berries that were used up (other held items are kept). Call
     * it once the battle has ended (or been left) and before the battle is
     * destroyed. Does nothing if the battle never began.
     *
     * Experience and levels gained are written too.
     * @return What each team member gained, in team order (empty without the `exp` option,
     *         and on a second call).
     */
    finish: () => ExpResult[];
}

/**
 * @brief Describe a saved Pokémon in the simulator's team format.
 * @param pokemon The Pokémon.
 * @return A set for `Teams.pack()`.
 */
export function toPokemonSet (pokemon: SavedPokemon): PokemonSet
{
    const set: PokemonSet = {
        name: pokemon.nickname ?? '',
        species: pokemon.species,
        item: pokemon.item ?? '',
        ability: pokemon.ability,
        moves: pokemon.moves.map((move) => move.id),
        nature: pokemon.nature,
        gender: pokemon.gender === 'N' ? '' : pokemon.gender,
        evs: { ...pokemon.evs },
        ivs: { ...pokemon.ivs },
        level: pokemon.level,
        shiny: pokemon.shiny,
        happiness: pokemon.friendship,
        pokeball: pokemon.ball,
    };
    if (pokemon.teraType) set.teraType = pokemon.teraType;
    return set;
}

/**
 * @brief The most PP a move can have with a number of PP Ups.
 * @param basePP The move's PP without PP Ups.
 * @param ppUps PP Ups used, 0 to 3. Each adds a fifth of `basePP`.
 * @param noPPBoosts `true` for moves PP Ups do not work on.
 * @return The maximum PP.
 */
export function maxPP (basePP: number, ppUps: number, noPPBoosts = false): number
{
    return noPPBoosts ? basePP : Math.floor(basePP * (5 + ppUps) / 5);
}

/**
 * @brief Whether a Pokémon used up the Berry it brought into the battle.
 *
 * Only Berries are lost after a battle; every other held item returns. A
 * Berry counts as used up if the Pokémon consumed it itself (ate it, or threw
 * it with Fling or Natural Gift) and is not holding it again at the end
 * (Recycle, Harvest and Cud Chew bring it back). A Berry that was knocked off
 * or taken by the opponent returns like any other item.
 *
 * @param battle The simulator's battle, for the item data.
 * @param pokemon The simulator's Pokémon at the end of the battle.
 * @param item ID of the item it held when the battle began.
 * @return `true` if the item is a Berry and it is gone.
 */
export function usedUpBerry (battle: Battle, pokemon: Pokemon, item: string): boolean
{
    if (!battle.dex.items.get(item).isBerry) return false;
    return pokemon.item !== item && pokemon.lastItem === item;
}

/**
 * @brief Raise a Pokémon's level in a running battle.
 *
 * Its stats are worked out again for the new level and its HP rises by as
 * much as its maximum HP did. A transformed Pokémon keeps the stats it
 * copied; only its level changes.
 *
 * @param battle The simulator's battle.
 * @param pokemon The simulator's Pokémon.
 * @param level The new level.
 */
export function setBattleLevel (battle: Battle, pokemon: Pokemon, level: number): void
{
    //  The simulator marks `level` read-only because it never changes it itself.
    (pokemon as { level: number }).level = level;
    pokemon.set.level = level;
    pokemon.details = pokemon.getUpdatedDetails();
    if (pokemon.transformed) return;

    const stats = battle.spreadModify(pokemon.species.baseStats, pokemon.set);
    pokemon.baseStoredStats = stats;
    for (const stat of ['atk', 'def', 'spa', 'spd', 'spe'] as const) pokemon.storedStats[stat] = stats[stat];
    pokemon.updateMaxHp();
    //  Tell whoever shows the battle about the new level.
    if (pokemon.isActive) battle.add('detailschange', pokemon, pokemon.details);
}

/**
 * @brief Connect the saved party to a battle.
 *
 * @param state The game whose party fights.
 * @param options The side the party plays on and whether it gains experience.
 * @return The team, the `prepare` hook and the `finish` function; see `PartyBattle`.
 * @throws Error if every Pokémon in the party has fainted, or the party is empty.
 */
export function partyBattle (state: GameState, options: PartyBattleOptions = {}): PartyBattle
{
    const { side = 'p1', exp } = options;
    const members = state.getSnapshot().party.filter((pokemon) => !isFainted(pokemon));
    if (!members.length) throw new Error('[state] partyBattle: the party has no Pokémon that can fight');

    /** Experience so far, by `uid`. Only filled when the battle gives experience. */
    const progress = new Map<string, { growth: GrowthRate; exp: number; gained: number; fromLevel: number }>();
    /** For each opponent, the party members that were on the field against it. */
    const fought = new Map<Pokemon, Set<Pokemon>>();

    /** Species data for the experience rules, falling back to the base species for formes. */
    const speciesOf = (battle: Battle, id: string): ExpSpecies | undefined =>
        exp?.species(id) ?? exp?.species(battle.toID(battle.dex.species.get(id).baseSpecies));

    /** Remember who is facing whom right now. */
    const markFought = (battle: Battle): void =>
    {
        const own = battle.getSide(side);
        for (const foeSide of battle.sides)
        {
            if (foeSide === own || foeSide === own.allySide) continue;
            for (const foe of foeSide.active)
            {
                if (!foe || foe.fainted) continue;
                let seen = fought.get(foe);
                if (!seen) fought.set(foe, seen = new Set());
                for (const pokemon of own.active) if (pokemon && !pokemon.fainted) seen.add(pokemon);
            }
        }
    };

    /** An opponent fainted: share out its experience and apply level-ups. */
    const award = (battle: Battle, defeated: Pokemon): void =>
    {
        const own = battle.getSide(side);
        if (defeated.side === own || defeated.side === own.allySide) return;
        const baseExp = speciesOf(battle, defeated.species.id)?.baseExp ?? 0;
        const participants = fought.get(defeated);
        for (const [uid, pokemon] of battlers)
        {
            const entry = progress.get(uid);
            if (!entry || pokemon.fainted || pokemon.level >= MAX_LEVEL) continue;
            const gained = Math.min(
                expGain({
                    baseExp,
                    defeatedLevel: defeated.level,
                    level: pokemon.level,
                    participated: participants?.has(pokemon) ?? false,
                    luckyEgg: pokemon.item === 'luckyegg',
                }),
                expForLevel(entry.growth, MAX_LEVEL) - entry.exp,
            );
            if (gained <= 0) continue;
            entry.exp += gained;
            entry.gained += gained;
            if (exp?.messages !== false) battle.add('-message', `${pokemon.name} gained ${gained} Exp. Points!`);

            const level = levelForExp(entry.growth, entry.exp);
            if (level <= pokemon.level) continue;
            setBattleLevel(battle, pokemon, level);
            if (exp?.messages !== false) battle.add('-message', `${pokemon.name} grew to Lv. ${level}!`);
        }
    };

    /** The simulator's Pokémon by `uid`, filled in by `prepare`. */
    const battlers = new Map<string, Pokemon>();
    let sim: Battle | null = null;

    const prepare = (battle: Battle): void =>
    {
        sim = battle;
        const team = battle.getSide(side).pokemon;
        for (const [index, saved] of members.entries())
        {
            const pokemon = team[index];
            battlers.set(saved.uid, pokemon);
            if (exp)
            {
                const growth = speciesOf(battle, saved.species)?.growthRate ?? 'medium';
                //  A Pokémon made without `exp` starts at the least its level needs.
                const start = Math.max(saved.exp, expForLevel(growth, saved.level));
                progress.set(saved.uid, { growth, exp: start, gained: 0, fromLevel: saved.level });
            }

            for (const slot of pokemon.baseMoveSlots)
            {
                const move = saved.moves.find((entry) => entry.id === slot.id);
                if (!move) continue;
                const data = battle.dex.moves.get(slot.id);
                slot.maxpp = maxPP(data.pp, move.ppUps, !!data.noPPBoosts);
                slot.pp = Math.min(move.pp ?? slot.maxpp, slot.maxpp);
            }
            if (saved.hp !== undefined) pokemon.hp = Math.min(Math.max(saved.hp, 1), pokemon.maxhp);
            if (saved.status)
            {
                pokemon.status = saved.status as ID;
                pokemon.statusState = battle.initEffectState({ id: saved.status, target: pokemon });
                //  What the status' own start handler would have set up.
                if (saved.status === 'slp') pokemon.statusState.startTime = pokemon.statusState.time = battle.random(2, 5);
                if (saved.status === 'tox') pokemon.statusState.stage = 0;
            }
        }
        if (!exp) return;
        battle.onEvent('SwitchIn', battle.format, function onSwitchIn (this: Battle) { markFought(this); });
        battle.onEvent('Faint', battle.format, function onFaint (this: Battle, target: Pokemon)
        {
            markFought(this);
            award(this, target);
        });
    };

    const finish = (): ExpResult[] =>
    {
        const results: ExpResult[] = [];
        for (const [uid, pokemon] of battlers)
        {
            const entry = progress.get(uid);
            if (entry) results.push({ uid, gained: entry.gained, fromLevel: entry.fromLevel, toLevel: pokemon.level });
            state.updatePokemon(uid, (saved) =>
            {
                const { hp: _hp, status: _status, item, ...rest } = saved;
                const next: SavedPokemon = {
                    ...rest,
                    moves: saved.moves.map((move) =>
                    {
                        const slot = pokemon.baseMoveSlots.find((entry) => entry.id === move.id);
                        const used = slot && slot.pp < slot.maxpp;
                        return used ? { id: move.id, ppUps: move.ppUps, pp: slot.pp } : { id: move.id, ppUps: move.ppUps };
                    }),
                };
                const hp = pokemon.fainted ? 0 : pokemon.hp;
                if (hp < pokemon.maxhp) next.hp = hp;
                //  The saved item is kept whatever happened to it, unless it is a Berry that was used up.
                if (item && !(sim && usedUpBerry(sim, pokemon, item))) next.item = item;
                if (entry)
                {
                    next.exp = entry.exp;
                    next.level = pokemon.level;
                }
                //  A fainted Pokémon has no status condition.
                if (hp > 0 && pokemon.status) next.status = pokemon.status as SavedPokemon['status'];
                return next;
            });
        }
        battlers.clear();
        progress.clear();
        fought.clear();
        sim = null;
        return results;
    };

    return {
        team: Teams.pack(members.map(toPokemonSet)),
        uids: members.map((pokemon) => pokemon.uid),
        prepare,
        finish,
    };
}
