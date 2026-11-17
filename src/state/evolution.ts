/**
 * @file evolution.ts
 * @brief Works out whether a Pokémon can evolve by levelling up, and evolves it.
 *
 * Nothing here plays an animation. After a battle, `PartyBattle.finish()`
 * lists the party members that can now evolve (`PendingEvolution`); an
 * evolution scene shows each one and then calls `evolvePokemon()`:
 *
 * @code
 * for (const { uid, into } of outcome.evolutions)
 * {
 *     // ... play the sequence; skip the rest if the player cancels it
 *     evolvePokemon(state, uid, into, {
 *         ability: evolvedAbility(pokedex[from].abilities, pokedex[into].abilities, pokemon.ability),
 *         moves: levelUpMoves(learnsets[into]?.learnset, -1, 0),
 *     });
 * }
 * @endcode
 */
import type { EvolutionMethod } from '../data/schemas/engine.ts';
import type { GameState } from './GameState.ts';
import type { SavedPokemon } from './schema.ts';

/** @brief A Pokémon that can evolve now. */
export interface PendingEvolution
{
    /** `uid` of the Pokémon. */
    uid: string;
    /** Species ID it has now. */
    from: string;
    /** Species ID it evolves into. */
    into: string;
}

/** @brief What `findEvolution()` may need to know besides the Pokémon itself. */
export interface EvolutionContext
{
    /** The time in the game world. Left out: evolutions that need a time of day do not happen. */
    timeOfDay?: 'day' | 'night' | 'dusk' | 'full-moon';
    /** The party, for evolutions that need a companion. Default: none. */
    party?: readonly SavedPokemon[];
    /** The Pokémon's Attack and Defense, for Tyrogue. Left out: that evolution does not happen. */
    stats?: { atk: number; def: number };
    /** Type of a move, e.g. `"Fairy"`. Left out: evolutions that need a move of a type do not happen. */
    moveType?: (move: string) => string | undefined;
    /** Types of a species. Left out: evolutions that need a party member of a type do not happen. */
    speciesTypes?: (species: string) => readonly string[] | undefined;
}

/** @brief Conditions `findEvolution()` can check. A method with any other condition is skipped. */
const CHECKED = new Set([
    'into', 'trigger', 'minLevel', 'gender', 'timeOfDay', 'heldItem', 'knownMove', 'knownMoveType',
    'minHappiness', 'relativePhysicalStats', 'partySpecies', 'partyType',
]);

/**
 * @brief The species a Pokémon evolves into after levelling up, if any.
 *
 * Only `level-up` methods are considered, and only when every condition can
 * be checked and holds. Methods that depend on the overworld (a location,
 * rain, steps walked...) are left to the code that knows about those. A
 * Pokémon holding an Everstone does not evolve.
 *
 * @param pokemon The Pokémon, at its new level.
 * @param methods The species' evolution methods (`SpeciesInfo.evolutions`).
 * @param context Time of day, party and lookups; see `EvolutionContext`.
 * @return ID of the species to evolve into (the first method that applies), or `null`.
 */
export function findEvolution (
    pokemon: SavedPokemon, methods: readonly EvolutionMethod[] | undefined, context: EvolutionContext = {},
): string | null
{
    if (!methods || pokemon.item === 'everstone') return null;
    const party = context.party ?? [];
    for (const method of methods)
    {
        if (method.trigger !== 'level-up') continue;
        if (Object.keys(method).some((key) => !CHECKED.has(key))) continue;
        if (method.minLevel !== undefined && pokemon.level < method.minLevel) continue;
        if (method.gender && pokemon.gender !== method.gender) continue;
        if (method.timeOfDay && context.timeOfDay !== method.timeOfDay) continue;
        if (method.heldItem && pokemon.item !== method.heldItem) continue;
        if (method.knownMove && !pokemon.moves.some((move) => move.id === method.knownMove)) continue;
        if (method.knownMoveType && !pokemon.moves.some((move) => context.moveType?.(move.id) === method.knownMoveType)) continue;
        if (method.minHappiness !== undefined && pokemon.friendship < method.minHappiness) continue;
        if (method.relativePhysicalStats !== undefined)
        {
            if (!context.stats) continue;
            if (Math.sign(context.stats.atk - context.stats.def) !== method.relativePhysicalStats) continue;
        }
        if (method.partySpecies && !party.some((member) => member.species === method.partySpecies)) continue;
        if (method.partyType && !party.some((member) => member.uid !== pokemon.uid
            && context.speciesTypes?.(member.species)?.includes(method.partyType!))) continue;
        return method.into;
    }
    return null;
}

/**
 * @brief The ability a Pokémon has after evolving: the one in the same ability slot.
 * @param from Abilities of the species it was, by slot (`SpeciesData.abilities`, e.g. `{ 0: "Static", H: "Lightning Rod" }`).
 * @param into Abilities of the species it becomes.
 * @param ability ID of its current ability.
 * @return ID of the new ability. The first slot's if the old slot does not exist on the new species.
 */
export function evolvedAbility (
    from: Readonly<Record<string, string | undefined>>, into: Readonly<Record<string, string | undefined>>, ability: string,
): string
{
    const id = (name: string | undefined) => (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const slot = Object.keys(from).find((key) => id(from[key]) === ability);
    return id((slot !== undefined ? into[slot] : undefined) ?? into['0']) || ability;
}

/** @brief What changes besides the species when a Pokémon evolves. */
export interface EvolveOptions
{
    /** ID of its new ability (see `evolvedAbility()`). Left out: the ability stays. */
    ability?: string;
    /** IDs of moves it learns on evolving. They go to free move slots, then to the move bank. */
    moves?: readonly string[];
}

/**
 * @brief Evolve a Pokémon: change its species, wherever it is.
 *
 * Its nickname, level, experience, HP and everything else stay as they are.
 * Call it when the evolution sequence has been shown and not cancelled.
 *
 * @param state The game.
 * @param uid The Pokémon's `uid`.
 * @param into ID of the species to become.
 * @param options New ability and moves; see `EvolveOptions`.
 * @return `false` if no Pokémon with that `uid` is owned.
 */
export function evolvePokemon (state: GameState, uid: string, into: string, options: EvolveOptions = {}): boolean
{
    const change: Partial<SavedPokemon> = { species: into };
    if (options.ability) change.ability = options.ability;
    if (!state.updatePokemon(uid, change)) return false;
    for (const move of options.moves ?? []) state.learnMove(uid, move);
    return true;
}
