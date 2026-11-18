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
 * 3. `finish()`: after the battle, writes HP, status, PP, experience, level,
 *    effort values and learned moves back into the `GameState`, and reports
 *    who can now evolve.
 *
 * @code
 * const { speciesInfo, learnsets } = await loadPbs(['speciesInfo', 'learnsets']);
 * const link = partyBattle(state, {
 *     exp: { species: (id) => speciesInfo[id], learnset: (id) => learnsets[id] },
 * });
 * const bridge = new BattleBridge({
 *     p1: { name: state.getSnapshot().player.name, team: link.team },
 *     p2: { name: 'Rival', team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
 *     prepare: link.prepare,
 * });
 * // ... when the battle has ended:
 * const { gains, evolutions } = link.finish();
 * @endcode
 *
 * The battle scene does this for you when it is started with
 * `usePlayerParty: true` (see src/game/scenes/Battle.ts).
 *
 * Fainted Pokémon are left out of the team, as they cannot be sent out. They
 * stay in the party untouched.
 *
 * Experience is the simulator's missing piece: Showdown has no levels to gain.
 * With the `exp` option, every opponent that faints gives its effort values
 * and experience to the party members that can still fight (half the
 * experience to those that were not on the field against it, as in
 * Generation 9; 1.5 times as much to traded Pokémon). A Pokémon that reaches a
 * new level grows at once: its level and stats change in the running battle,
 * and it learns the moves of that level. A new move takes a free move slot
 * and can be used straight away; with four moves already, it goes to the
 * Pokémon's move bank (`GameState.relearnMove()`). Each of these adds a
 * `|-message|` line to the protocol for the battle text.
 *
 * Held items follow the rule the games use since Generation 9: an item that
 * was used up, knocked off or taken during the battle is back afterwards
 * (Throat Spray, Focus Sash, Air Balloon, White Herb...). The exception is a
 * Berry the Pokémon ate or flung itself, which is gone for good.
 */
import { Teams } from '@pkmn/sim';
import type { Battle, ID, Pokemon, PokemonSet } from '@pkmn/sim';
import { encodeTextMessage } from '../battle/text.ts';
import type { EvolutionMethod } from '../data/schemas/engine.ts';
import { findEvolution } from './evolution.ts';
import type { EvolutionContext, PendingEvolution } from './evolution.ts';
import { addEvs, expForLevel, expGain, levelForExp, levelUpMoves, MAX_LEVEL } from './experience.ts';
import type { GrowthRate } from './experience.ts';
import type { GameState } from './GameState.ts';
import { isFainted } from './pokemon.ts';
import { MAX_MOVES } from './schema.ts';
import type { EVSpread, SavedMove, SavedPokemon } from './schema.ts';

/** @brief A side of a two-player battle. */
export type PartySide = 'p1' | 'p2';

/** @brief What the experience rules need to know about a species (a `SpeciesInfo` fits). */
export interface ExpSpecies
{
    /** Experience it gives when defeated, before scaling. `null` or 0: none. */
    baseExp: number | null;
    /** How fast it levels up. */
    growthRate: GrowthRate;
    /** Effort values it gives when defeated, e.g. `{ spe: 2 }`. Left out: none. */
    evYield?: Partial<EVSpread>;
    /** How it evolves. Left out: it is never reported as ready to evolve. */
    evolutions?: EvolutionMethod[];
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
     * Looks up a species' learnset, normally in the `learnsets` table:
     * `(id) => learnsets[id]`. Left out: no moves are learned on level-up.
     */
    learnset?: (id: string) => { learnset?: Record<string, string[]> } | undefined;
    /** Generation whose level-up moves are used. Default: 9. */
    gen?: number;
    /** The time in the game world, for evolutions that need one. */
    timeOfDay?: EvolutionContext['timeOfDay'];
    /**
     * `false` to leave out the `|-message|` protocol lines ("Sparky gained 120
     * Exp. Points!", "Sparky grew to Lv. 12!", "Sparky learned Thunder
     * Wave!"). Default: `true`.
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

/** @brief What one Pokémon gained in a battle. */
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
    /** IDs of the moves it learned and has ready. */
    learned: string[];
    /** IDs of the moves it learned that went to its move bank, as its move slots were full. */
    banked: string[];
    /** Effort values gained, e.g. `{ spe: 4 }`. */
    evs: Partial<EVSpread>;
}

/** @brief What a battle changed for the party, from `PartyBattle.finish()`. */
export interface BattleOutcome
{
    /** What each team member gained, in team order. Empty without the `exp` option. */
    gains: ExpResult[];
    /**
     * Team members that levelled up and can now evolve, in team order. Show
     * each one's evolution and then call `evolvePokemon()` (evolution.ts).
     */
    evolutions: PendingEvolution[];
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
     * Writes the battle's results into the `GameState`: HP, status, PP, and
     * with the `exp` option experience, level, effort values and learned
     * moves. Berries that were used up are removed (other held items are
     * kept). Call it once the battle has ended (or been left) and before the
     * battle is destroyed.
     *
     * @return What was gained and who can evolve. Empty lists if the battle never began,
     *         and on a second call.
     */
    finish: () => BattleOutcome;
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
 * @brief Work out a Pokémon's stats again after its level or effort values changed.
 *
 * Its HP rises by as much as its maximum HP did. A transformed Pokémon keeps
 * the stats it copied.
 *
 * @param battle The simulator's battle.
 * @param pokemon The simulator's Pokémon.
 */
function refreshStats (battle: Battle, pokemon: Pokemon): void
{
    if (pokemon.transformed) return;
    const stats = battle.spreadModify(pokemon.species.baseStats, pokemon.set);
    pokemon.baseStoredStats = stats;
    for (const stat of ['atk', 'def', 'spa', 'spd', 'spe'] as const) pokemon.storedStats[stat] = stats[stat];
    pokemon.updateMaxHp();
}

/**
 * @brief Raise a Pokémon's level in a running battle and show it at once.
 *
 * Its stats are worked out again for the new level. A `|detailschange|`
 * protocol line carries the new level to whoever shows the battle, whether
 * the Pokémon is on the field or not, so `BattleSnapshot` has it as soon as
 * the line is presented instead of at the player's next choice.
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
    refreshStats(battle, pokemon);

    //  Under an Illusion the line would give the disguise away; the next request has the level.
    if (pokemon.illusion) return;
    battle.add('detailschange', pokemon, pokemon.details);
    //  Viewers reset the ability to the species' first on that line; put the real one back.
    if (pokemon.ability !== battle.toID(pokemon.species.abilities['0']))
    {
        battle.add('-ability', pokemon, pokemon.getAbility().name, '[silent]');
    }
}

/**
 * @brief Give a Pokémon a new move slot in a running battle, with full PP.
 * @param battle The simulator's battle.
 * @param pokemon The simulator's Pokémon.
 * @param move Move ID.
 */
function addBattleMove (battle: Battle, pokemon: Pokemon, move: string): void
{
    const data = battle.dex.moves.get(move);
    if (!data.exists) return;
    const slot = {
        move: data.name, id: data.id, pp: data.pp, maxpp: data.pp, target: data.target,
        disabled: false, disabledSource: '', used: false,
    };
    pokemon.baseMoveSlots.push(slot);
    //  A transformed Pokémon uses the moves it copied until it leaves the field.
    if (!pokemon.transformed) pokemon.moveSlots.push(slot);
}

/** @brief What a team member has gained so far in the battle. */
interface Progress
{
    growth: GrowthRate;
    /** Total experience. */
    exp: number;
    gained: number;
    fromLevel: number;
    traded: boolean;
    /** Effort values now, and before the battle. */
    evs: EVSpread;
    startEvs: EVSpread;
    /** IDs of every move it knows: ready moves and move bank. */
    known: Set<string>;
    /** IDs of its ready moves. */
    ready: string[];
    learned: string[];
    banked: string[];
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

    /** The simulator's Pokémon by `uid`, filled in by `prepare`. */
    const battlers = new Map<string, Pokemon>();
    /** Gains so far, by `uid`. Only filled when the battle gives experience. */
    const progress = new Map<string, Progress>();
    /** For each opponent, the party members that were on the field against it. */
    const fought = new Map<Pokemon, Set<Pokemon>>();
    let sim: Battle | null = null;

    /** Looks something up by species ID, falling back to the base species for formes. */
    const lookup = <T>(battle: Battle, find: ((id: string) => T | undefined) | undefined, id: string): T | undefined =>
        find?.(id) ?? find?.(battle.toID(battle.dex.species.get(id).baseSpecies));

    /** Adds a `|-message|` line unless messages are turned off. */
    const say = (battle: Battle, text: string): void =>
    {
        if (exp?.messages !== false) battle.add('-message', text);
    };

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

    /** A Pokémon went from `fromLevel` to its current level: teach it the moves of those levels. */
    const teach = (battle: Battle, pokemon: Pokemon, entry: Progress, fromLevel: number): void =>
    {
        const learnset = lookup(battle, exp?.learnset, pokemon.baseSpecies.id)?.learnset;
        for (const move of levelUpMoves(learnset, fromLevel, pokemon.level, exp?.gen))
        {
            if (entry.known.has(move)) continue;
            entry.known.add(move);
            const name = battle.dex.moves.get(move).name || move;
            if (entry.ready.length < MAX_MOVES)
            {
                entry.ready.push(move);
                entry.learned.push(move);
                addBattleMove(battle, pokemon, move);
                say(battle, encodeTextMessage('battle.move.learned', { pokemon: pokemon.name, move: name }));
            }
            else
            {
                entry.banked.push(move);
                say(battle, encodeTextMessage('battle.move.banked', { pokemon: pokemon.name, move: name }));
            }
        }
    };

    /** An opponent fainted: share out its effort values and experience, and apply level-ups. */
    const award = (battle: Battle, defeated: Pokemon): void =>
    {
        const own = battle.getSide(side);
        if (defeated.side === own || defeated.side === own.allySide) return;
        const species = lookup(battle, exp?.species, defeated.species.id);
        const participants = fought.get(defeated);
        for (const [uid, pokemon] of battlers)
        {
            const entry = progress.get(uid);
            if (!entry || pokemon.fainted) continue;

            const evs = addEvs(entry.evs, species?.evYield ?? {});
            if (evs !== entry.evs)
            {
                entry.evs = evs;
                pokemon.set.evs = { ...evs };
                refreshStats(battle, pokemon);
            }

            if (pokemon.level >= MAX_LEVEL) continue;
            const gained = Math.min(
                expGain({
                    baseExp: species?.baseExp ?? 0,
                    defeatedLevel: defeated.level,
                    level: pokemon.level,
                    participated: participants?.has(pokemon) ?? false,
                    luckyEgg: pokemon.item === 'luckyegg',
                    traded: entry.traded,
                }),
                expForLevel(entry.growth, MAX_LEVEL) - entry.exp,
            );
            if (gained <= 0) continue;
            entry.exp += gained;
            entry.gained += gained;
            say(battle, encodeTextMessage('battle.exp.gained', { pokemon: pokemon.name, exp: gained }));

            const before = pokemon.level;
            const level = levelForExp(entry.growth, entry.exp);
            if (level <= before) continue;
            setBattleLevel(battle, pokemon, level);
            say(battle, encodeTextMessage('battle.exp.level', { pokemon: pokemon.name, level }));
            teach(battle, pokemon, entry, before);
        }
    };

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
                const growth = lookup(battle, exp.species, saved.species)?.growthRate ?? 'medium';
                progress.set(saved.uid, {
                    growth,
                    //  A Pokémon made without `exp` starts at the least its level needs.
                    exp: Math.max(saved.exp, expForLevel(growth, saved.level)),
                    gained: 0,
                    fromLevel: saved.level,
                    traded: state.isTraded(saved),
                    evs: saved.evs,
                    startEvs: saved.evs,
                    known: new Set([...saved.moves.map((move) => move.id), ...saved.moveBank]),
                    ready: saved.moves.map((move) => move.id),
                    learned: [],
                    banked: [],
                });
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

    const finish = (): BattleOutcome =>
    {
        const outcome: BattleOutcome = { gains: [], evolutions: [] };
        const battle = sim;
        if (!battle) return outcome;

        for (const [uid, pokemon] of battlers)
        {
            const entry = progress.get(uid);
            state.updatePokemon(uid, (saved) =>
            {
                const { hp: _hp, status: _status, item, ...rest } = saved;
                const next: SavedPokemon = {
                    ...rest,
                    moves: (entry?.ready ?? saved.moves.map((move) => move.id)).map((id) =>
                    {
                        const move: SavedMove = { id, ppUps: saved.moves.find((known) => known.id === id)?.ppUps ?? 0 };
                        const slot = pokemon.baseMoveSlots.find((known) => known.id === id);
                        if (slot && slot.pp < slot.maxpp) move.pp = slot.pp;
                        return move;
                    }),
                };
                const hp = pokemon.fainted ? 0 : pokemon.hp;
                if (hp < pokemon.maxhp) next.hp = hp;
                //  A fainted Pokémon has no status condition.
                if (hp > 0 && pokemon.status) next.status = pokemon.status as SavedPokemon['status'];
                //  The saved item is kept whatever happened to it, unless it is a Berry that was used up.
                if (item && !usedUpBerry(battle, pokemon, item)) next.item = item;
                if (entry)
                {
                    next.exp = entry.exp;
                    next.level = pokemon.level;
                    next.evs = entry.evs;
                    next.moveBank = [...saved.moveBank, ...entry.banked];
                }
                return next;
            });
            if (!entry) continue;

            const evs: Partial<EVSpread> = {};
            for (const stat of Object.keys(entry.evs) as (keyof EVSpread)[])
            {
                if (entry.evs[stat] > entry.startEvs[stat]) evs[stat] = entry.evs[stat] - entry.startEvs[stat];
            }
            outcome.gains.push({
                uid, gained: entry.gained, fromLevel: entry.fromLevel, toLevel: pokemon.level,
                learned: entry.learned, banked: entry.banked, evs,
            });
        }

        //  Evolutions are checked once everyone is saved, as some depend on the rest of the party.
        const party = state.getSnapshot().party;
        for (const [uid, pokemon] of battlers)
        {
            const entry = progress.get(uid);
            const saved = party.find((member) => member.uid === uid);
            if (!entry || !saved || pokemon.fainted || pokemon.level <= entry.fromLevel) continue;
            const into = findEvolution(saved, lookup(battle, exp?.species, saved.species)?.evolutions, {
                timeOfDay: exp?.timeOfDay,
                party,
                stats: { atk: pokemon.baseStoredStats.atk, def: pokemon.baseStoredStats.def },
                moveType: (move) => battle.dex.moves.get(move).type,
                speciesTypes: (species) => battle.dex.species.get(species).types,
            });
            if (into) outcome.evolutions.push({ uid, from: saved.species, into });
        }

        battlers.clear();
        progress.clear();
        fought.clear();
        sim = null;
        return outcome;
    };

    return {
        team: Teams.pack(members.map(toPokemonSet)),
        uids: members.map((pokemon) => pokemon.uid),
        prepare,
        finish,
    };
}
