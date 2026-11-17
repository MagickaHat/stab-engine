/**
 * @file schema.ts
 * @brief What a saved game contains: Zod schemas and their TypeScript types.
 *
 * Everything here is plain data (strings, numbers, booleans, arrays and
 * objects), so a `SaveData` can be turned into JSON and back without losing
 * anything. Nothing in this folder imports Phaser or React.
 *
 * As in `src/data/schemas`, each schema and its type share one name:
 * `SavedPokemon` is both the Zod schema and the type of a parsed value.
 *
 * Imports use explicit `.ts` extensions so the Node tests can run these files
 * without a bundler.
 */
import { z } from 'zod';
import { ID, StatusID } from '../data/schemas/common.ts';
import { ItemPocket } from '../data/schemas/engine.ts';

/** @brief Largest party. */
export const PARTY_SIZE = 6;

/** @brief Number of PC boxes in a new game. */
export const DEFAULT_BOX_COUNT = 30;

/** @brief Number of Pokémon one PC box holds in a new game. */
export const DEFAULT_BOX_SIZE = 30;

/** @brief Most of one item the bag holds. */
export const MAX_ITEM_QUANTITY = 999;

/** @brief Most moves a Pokémon has ready at once. */
export const MAX_MOVES = 4;

/** @brief Most effort values in one stat. */
export const MAX_EV = 252;

/** @brief Most effort values over all six stats. */
export const MAX_TOTAL_EVS = 510;

/** @brief Most money the player can carry. */
export const MAX_MONEY = 9_999_999;

/** @brief Makes a six-stat table schema whose values lie between 0 and `max`. */
function statSpread (max: number)
{
    const value = z.number().int().min(0).max(max);
    return z.object({ hp: value, atk: value, def: value, spa: value, spd: value, spe: value });
}

/** @brief Individual values, 0 to 31 per stat. */
export const IVSpread = statSpread(31);
export type IVSpread = z.infer<typeof IVSpread>;

/** @brief Effort values, 0 to 255 per stat. */
export const EVSpread = statSpread(255);
export type EVSpread = z.infer<typeof EVSpread>;

/** @brief `"M"`, `"F"`, or `"N"` for genderless. */
export const Gender = z.enum(['M', 'F', 'N']);
export type Gender = z.infer<typeof Gender>;

/** @brief One move a Pokémon knows. */
export const SavedMove = z.object({
    /** Move ID, e.g. `thunderbolt`. */
    id: ID,
    /** PP left. Left out when the move has all its PP. */
    pp: z.number().int().min(0).optional(),
    /** PP Ups used on the move, 0 to 3. */
    ppUps: z.number().int().min(0).max(3),
});
export type SavedMove = z.infer<typeof SavedMove>;

/**
 * @brief One Pokémon, in the party or in the PC.
 *
 * Stats are not stored: they follow from the species, level, IVs, EVs and
 * nature. For the same reason "full" is stored by leaving a value out: a
 * Pokémon without `hp` is at full HP and a move without `pp` has all its PP.
 * That keeps this module independent of the species and move data.
 */
export const SavedPokemon = z.object({
    /** Unique within a save. Stays the same when the Pokémon is moved, traded or evolves. */
    uid: z.string().min(1),
    /** Species ID, including the forme, e.g. `pikachu` or `rotomwash`. */
    species: ID,
    /** Nickname. Left out when it has none. */
    nickname: z.string().min(1).optional(),
    level: z.number().int().min(1),
    /** Total experience points. */
    exp: z.number().int().min(0),
    ivs: IVSpread,
    evs: EVSpread,
    /** Nature ID, e.g. `timid`. */
    nature: ID,
    /** Ability ID, e.g. `static`. */
    ability: ID,
    /** Held item ID. Left out when it holds nothing. */
    item: ID.optional(),
    /** One to four moves, in the order shown in menus. */
    moves: z.array(SavedMove).min(1).max(4),
    /**
     * The move bank: IDs of moves it has learned but does not have ready, in
     * the order they were learned. The player can swap them back in outside
     * battle (`GameState.relearnMove()`), as in Generation 9.
     */
    moveBank: z.array(ID),
    /** Current HP; 0 means fainted. Left out when at full HP. */
    hp: z.number().int().min(0).optional(),
    /** Status condition. Left out when healthy. */
    status: StatusID.optional(),
    shiny: z.boolean(),
    gender: Gender,
    friendship: z.number().int().min(0).max(255),
    /** ID of the Poké Ball it was caught in, e.g. `pokeball`. */
    ball: ID,
    /** Tera type, e.g. `"Electric"`. Left out to use the species' first type. */
    teraType: z.string().min(1).optional(),
    /** Original trainer. */
    ot: z.object({ name: z.string(), id: z.number().int().min(0) }),
    /** Where and when it was obtained. `date` is an ISO 8601 string. */
    met: z.object({ map: z.string(), level: z.number().int().min(1), date: z.string() }),
});
export type SavedPokemon = z.infer<typeof SavedPokemon>;

/** @brief The direction a character faces. */
export const Facing = z.enum(['up', 'down', 'left', 'right']);
export type Facing = z.infer<typeof Facing>;

/** @brief Where the player stands. `x` and `y` are tiles on `map`. */
export const Position = z.object({
    /** Map ID or name. Empty until the game places the player. */
    map: z.string(),
    x: z.number().int(),
    y: z.number().int(),
    facing: Facing,
});
export type Position = z.infer<typeof Position>;

/** @brief The player character. */
export const PlayerData = z.object({
    name: z.string(),
    /** Trainer ID number, copied into `SavedPokemon.ot.id` of caught Pokémon. */
    trainerId: z.number().int().min(0),
    money: z.number().int().min(0).max(MAX_MONEY),
    /** Time played, in milliseconds. */
    playTimeMs: z.number().min(0),
    position: Position,
});
export type PlayerData = z.infer<typeof PlayerData>;

/** @brief One PC box. Every slot is a Pokémon or `null` (empty). */
export const PcBox = z.object({
    name: z.string(),
    slots: z.array(SavedPokemon.nullable()).min(1),
});
export type PcBox = z.infer<typeof PcBox>;

/** @brief The Pokémon storage system. */
export const PcStorage = z.object({
    /** Index of the box that was open last. */
    current: z.number().int().min(0),
    boxes: z.array(PcBox).min(1),
}).refine((pc) => pc.current < pc.boxes.length, { message: 'pc.current must be the index of an existing box' });
export type PcStorage = z.infer<typeof PcStorage>;

/** @brief A slot of the PC. Both numbers start at 0. */
export interface PcLocation
{
    box: number;
    slot: number;
}

/** @brief One kind of item in the bag and how many of it. */
export const BagStack = z.object({
    item: ID,
    quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY),
});
export type BagStack = z.infer<typeof BagStack>;

/** @brief The bag: for every pocket, its items in the order the player sees them. */
export const Bag = z.record(ItemPocket, z.array(BagStack));
export type Bag = z.infer<typeof Bag>;

/** @brief A value a variable can hold. */
export const VariableValue = z.union([z.number(), z.string()]);
export type VariableValue = z.infer<typeof VariableValue>;

/** @brief Everything a save file remembers about a game. */
export const SaveData = z.object({
    player: PlayerData,
    /** The party, first Pokémon first. At most `PARTY_SIZE`. */
    party: z.array(SavedPokemon).max(PARTY_SIZE),
    pc: PcStorage,
    bag: Bag,
    /** Yes/no facts by name, e.g. `{ got_starter: true }`. A missing flag is `false`. */
    flags: z.record(z.string(), z.boolean()),
    /** Numbers and text by name, e.g. `{ badges: 3, rival_name: "Blue" }`. */
    variables: z.record(z.string(), VariableValue),
    /** Story states from `DialogueEngine.save()`, by story name. */
    dialogue: z.record(z.string(), z.string()),
    /**
     * Event self switches (A to D, as in RPG Maker XP) that are on, keyed by
     * `"<map>:<event id>:<letter>"` (see `selfSwitchKey()`). A missing key is off.
     * Added after version 1 shipped, so older files without it load as empty.
     */
    selfSwitches: z.record(z.string(), z.boolean()).default({}),
    /** Events hidden for good with the `hide` command, keyed by `"<map>:<event id>"`. */
    hiddenEvents: z.record(z.string(), z.boolean()).default({}),
    /**
     * Story progress: for each story track (`"main"`, a side quest...), the
     * ID of the last milestone reached. The order of milestones is defined in
     * `src/events/registry/story.ts`.
     */
    story: z.record(z.string(), z.string()).default({}),
});
export type SaveData = z.infer<typeof SaveData>;

/** @brief The four self switch letters every event has. */
export const SELF_SWITCHES = ['A', 'B', 'C', 'D'] as const;
export type SelfSwitch = (typeof SELF_SWITCHES)[number];

/**
 * @brief Key of an event in `SaveData.hiddenEvents` and the start of its self switch keys.
 * @param map Map ID.
 * @param event Event ID on that map (the Tiled object ID).
 * @return `"<map>:<event>"`.
 */
export function eventKey (map: string, event: number): string
{
    return `${map}:${event}`;
}

/**
 * @brief Key of a self switch in `SaveData.selfSwitches`.
 * @param map Map ID.
 * @param event Event ID on that map.
 * @param letter `A` to `D`.
 * @return `"<map>:<event>:<letter>"`.
 */
export function selfSwitchKey (map: string, event: number, letter: SelfSwitch): string
{
    return `${eventKey(map, event)}:${letter}`;
}
