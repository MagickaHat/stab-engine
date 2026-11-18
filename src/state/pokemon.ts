/**
 * @file pokemon.ts
 * @brief Helpers for making and reading `SavedPokemon`.
 */
import { STAT_IDS } from '../data/schemas/common.ts';
import { SavedPokemon } from './schema.ts';
import type { EVSpread, Gender, IVSpread, PokemonLanguage } from './schema.ts';

/** @brief IDs of the 25 standard natures, used to pick one at random. */
export const NATURE_IDS = [
    'hardy', 'lonely', 'brave', 'adamant', 'naughty', 'bold', 'docile', 'relaxed', 'impish', 'lax',
    'timid', 'hasty', 'serious', 'jolly', 'naive', 'modest', 'mild', 'quiet', 'bashful', 'rash',
    'calm', 'gentle', 'sassy', 'careful', 'quirky',
] as const;

/**
 * @brief What `createPokemon()` needs. Everything but the first four fields has a default.
 */
export interface NewPokemon
{
    /** Species ID, e.g. `pikachu`. */
    species: string;
    level: number;
    /** Ability ID, e.g. `static`. */
    ability: string;
    /** One to four move IDs. They start with full PP. */
    moves: readonly string[];
    /** Moves it has learned but does not have ready. Default: none. */
    moveBank?: readonly string[];
    /** Default: none. */
    nickname?: string;
    /** Default: 0. Pass the experience the species needs for `level`. */
    exp?: number;
    /** Default: random, 0 to 31 each. Stats left out are random too. */
    ivs?: Partial<IVSpread>;
    /** Default: all 0. */
    evs?: Partial<EVSpread>;
    /** Nature ID. Default: a random standard nature. */
    nature?: string;
    /** Held item ID. Default: none. */
    item?: string;
    /** Default: `false`. */
    shiny?: boolean;
    /** Default: `"N"`. The gender ratio is species data, so the caller decides. */
    gender?: Gender;
    /** Default: 70. Pass the species' base friendship if it differs. */
    friendship?: number;
    /** Poké Ball ID. Default: `pokeball`. */
    ball?: string;
    teraType?: string;
    /**
     * Original trainer. Default: nobody (`{ name: '', id: 0 }`), which
     * `GameState.addToParty()` replaces with the player.
     */
    ot?: { name: string; id: number };
    /**
     * Language it comes from. Default: `"en"`. `GameState.addToParty()` gives a
     * Pokémon without an original trainer (the player's own) the save's language.
     */
    language?: PokemonLanguage;
    /** Map it was obtained on. Default: `""`. */
    metMap?: string;
    /** When it was obtained. Default: now. */
    metDate?: Date;
    /** Default: a new random ID. */
    uid?: string;
}

/**
 * @brief Makes a random ID for a Pokémon.
 * @param random Source of random numbers from 0 (inclusive) to 1 (exclusive).
 * @return 16 hexadecimal digits.
 */
export function makeUid (random: () => number = Math.random): string
{
    let uid = '';
    for (let i = 0; i < 16; i++) uid += Math.floor(random() * 16).toString(16);
    return uid;
}

/**
 * @brief Makes a new Pokémon at full health.
 *
 * @code
 * state.addToParty(createPokemon({
 *     species: 'pikachu', level: 5, ability: 'static', moves: ['thundershock', 'growl'],
 *     gender: 'F', ot: { name: player.name, id: player.trainerId }, metMap: 'route1',
 * }));
 * @endcode
 *
 * @param options The Pokémon; see `NewPokemon` for the defaults.
 * @param random Source of random numbers from 0 (inclusive) to 1 (exclusive). Pass a
 *               seeded one for repeatable results.
 * @return The Pokémon, checked against the `SavedPokemon` schema.
 * @throws Error if a value is not allowed (level 0, five moves, an ID with capitals...).
 */
export function createPokemon (options: NewPokemon, random: () => number = Math.random): SavedPokemon
{
    const ivs = {} as IVSpread;
    const evs = {} as EVSpread;
    for (const stat of STAT_IDS)
    {
        ivs[stat] = options.ivs?.[stat] ?? Math.floor(random() * 32);
        evs[stat] = options.evs?.[stat] ?? 0;
    }
    const pokemon: SavedPokemon = {
        uid: options.uid ?? makeUid(random),
        species: options.species,
        level: options.level,
        exp: options.exp ?? 0,
        ivs,
        evs,
        nature: options.nature ?? NATURE_IDS[Math.floor(random() * NATURE_IDS.length)],
        ability: options.ability,
        moves: options.moves.map((id) => ({ id, ppUps: 0 })),
        moveBank: [...(options.moveBank ?? [])],
        shiny: options.shiny ?? false,
        gender: options.gender ?? 'N',
        friendship: options.friendship ?? 70,
        ball: options.ball ?? 'pokeball',
        ot: options.ot ? { ...options.ot } : { name: '', id: 0 },
        language: options.language ?? 'en',
        met: {
            map: options.metMap ?? '',
            level: options.level,
            date: (options.metDate ?? new Date()).toISOString(),
        },
    };
    if (options.nickname) pokemon.nickname = options.nickname;
    if (options.item) pokemon.item = options.item;
    if (options.teraType) pokemon.teraType = options.teraType;

    const result = SavedPokemon.safeParse(pokemon);
    if (!result.success) throw new Error(`[state] createPokemon: ${describeIssues(result.error.issues)}`);
    return result.data;
}

/**
 * @brief Whether a Pokémon has fainted.
 * @param pokemon The Pokémon.
 * @return `true` if its HP is 0.
 */
export function isFainted (pokemon: SavedPokemon): boolean
{
    return pokemon.hp === 0;
}

/**
 * @brief A Pokémon restored to full HP and PP with no status condition.
 * @param pokemon The Pokémon. It is not changed.
 * @return A healed copy.
 */
export function healed (pokemon: SavedPokemon): SavedPokemon
{
    const { hp: _hp, status: _status, ...rest } = pokemon;
    return { ...rest, moves: pokemon.moves.map((move) => ({ id: move.id, ppUps: move.ppUps })) };
}

/**
 * @brief Turns Zod issues into one readable line.
 * @param issues The issues of a failed parse.
 * @return Up to five issues as `path: message`, separated by `; `.
 */
export function describeIssues (issues: readonly { path: PropertyKey[]; message: string }[]): string
{
    const lines = issues.slice(0, 5).map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
    if (issues.length > 5) lines.push(`and ${issues.length - 5} more`);
    return lines.join('; ');
}
