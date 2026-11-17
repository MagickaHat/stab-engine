/**
 * @file trainers.ts
 * @brief Builds an NPC trainer's team when the battle starts.
 *
 * A trainer (schema.ts `Trainer`) lists one or more **variants**. The first
 * variant whose conditions pass is used, and each of its Pokémon is included
 * only if its own conditions pass. Levels can follow a variable or the
 * player's party, so the same trainer can scale with the story:
 *
 * @code
 * "rival_lab": {
 *   "class": "rival", "name": "trainers.rival.name",
 *   "variants": [
 *     { "conditions": { "var": "starter_choice", "value": "bulbasaur" },
 *       "team": [{ "species": "charmander", "level": 5 }] },
 *     { "team": [{ "species": "squirtle", "level": { "party": "max", "offset": 0 } }] }
 *   ]
 * }
 * @endcode
 *
 * Moves left out are the last four the species learns by levelling up;
 * an ability left out is its first one. Both need game data, given through
 * `TrainerData`.
 */
import { Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { levelUpMoves, MAX_LEVEL } from '../state/experience.ts';
import { evaluate, resolveNumber } from './conditions.ts';
import type { EvalContext } from './conditions.ts';
import type { Trainer, TrainerLevel, TrainerPokemon } from './schema.ts';

/** @brief Game data the team builder needs to fill in left-out fields. */
export interface TrainerData
{
    /** A species' level-up learnset (move ID → Showdown sources such as `"9L12"`). */
    learnset?: (species: string) => Readonly<Record<string, readonly string[]>> | undefined;
    /** A species' first ability's ID. */
    ability?: (species: string) => string | undefined;
}

/** @brief A built team. */
export interface BuiltTeam
{
    /** Index of the variant used. */
    variant: number;
    sets: PokemonSet[];
    /** The sets packed for `PlayerOptions.team`. */
    packed: string;
}

/**
 * @brief Work out a level.
 * @param level Fixed, from a variable, or from the player's party.
 * @param ctx The game.
 * @return A level from 1 to `MAX_LEVEL`.
 */
export function resolveLevel (level: TrainerLevel, ctx: EvalContext): number
{
    let value: number;
    if (typeof level === 'number') value = level;
    else if ('var' in level) value = resolveNumber({ var: level.var }, ctx, `level variable "${level.var}"`) + (level.offset ?? 0);
    else
    {
        const levels = ctx.state.getSnapshot().party.map((pokemon) => pokemon.level);
        if (!levels.length) levels.push(1);
        const base = level.party === 'max' ? Math.max(...levels)
            : level.party === 'min' ? Math.min(...levels)
                : Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
        value = base + (level.offset ?? 0);
    }
    return Math.min(MAX_LEVEL, Math.max(1, Math.round(value)));
}

/**
 * @brief Describe one trainer Pokémon as a Showdown set.
 * @param pokemon The trainer Pokémon.
 * @param level Its level.
 * @param data Game data for moves and ability left out.
 * @return The set.
 * @throws Error if moves or the ability are left out and cannot be filled in.
 */
export function trainerSet (pokemon: TrainerPokemon, level: number, data: TrainerData = {}): PokemonSet
{
    let moves = pokemon.moves ? [...pokemon.moves] : levelUpMoves(data.learnset?.(pokemon.species), 0, level).slice(-4);
    if (!moves.length) throw new Error(`[events] no moves for ${pokemon.species} at level ${level}: list them or provide learnsets`);
    //  The same move learned at two levels appears once.
    moves = [...new Set(moves)];
    const ability = pokemon.ability ?? data.ability?.(pokemon.species);
    if (!ability) throw new Error(`[events] no ability for ${pokemon.species}: give one or provide species data`);
    const iv = pokemon.ivs ?? 31;
    const set: PokemonSet = {
        name: pokemon.nickname ?? '',
        species: pokemon.species,
        item: pokemon.item ?? '',
        ability,
        moves,
        nature: pokemon.nature ?? 'serious',
        gender: pokemon.gender === 'N' ? '' : (pokemon.gender ?? ''),
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: { hp: iv, atk: iv, def: iv, spa: iv, spd: iv, spe: iv },
        level,
        shiny: pokemon.shiny ?? false,
    };
    if (pokemon.teraType) set.teraType = pokemon.teraType;
    return set;
}

/**
 * @brief Build a trainer's team for a battle that starts now.
 * @param trainer The trainer.
 * @param ctx The game, for conditions and levels.
 * @param data Game data for left-out moves and abilities.
 * @return The team.
 * @throws Error if no variant's conditions pass or no Pokémon is left.
 */
export function buildTrainerTeam (trainer: Trainer, ctx: EvalContext, data: TrainerData = {}): BuiltTeam
{
    const variant = trainer.variants.findIndex((v) => evaluate(v.conditions, ctx));
    if (variant < 0) throw new Error(`[events] trainer "${trainer.name}": no team's conditions pass`);
    const sets = trainer.variants[variant].team
        .filter((pokemon) => evaluate(pokemon.conditions, ctx))
        .map((pokemon) => trainerSet(pokemon, resolveLevel(pokemon.level, ctx), data));
    if (!sets.length) throw new Error(`[events] trainer "${trainer.name}": every Pokémon's conditions failed`);
    return { variant, sets, packed: Teams.pack(sets) };
}
