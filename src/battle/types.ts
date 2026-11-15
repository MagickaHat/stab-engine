/**
 * @file types.ts
 * @brief Type definitions for the data the simulator sends to the engine.
 *
 * Pokémon Showdown asks each player what they want to do by sending a
 * `|request|` message containing JSON. These interfaces describe the shape
 * of that JSON so the rest of the engine gets autocomplete and type checks.
 *
 * They mirror `ChoiceRequest` in `@pkmn/sim` (sim/side.ts), which is not
 * exported from the package root.
 */

/** @brief A player slot in the battle. */
export type SideID = 'p1' | 'p2' | 'p3' | 'p4';

/** @brief One move as listed in a move request. */
export interface MoveOption {
    /** Display name, e.g. `"Thunderbolt"`. */
    move: string;
    /** Move ID, e.g. `"thunderbolt"`. */
    id: string;
    /** Remaining PP. */
    pp?: number;
    /** Maximum PP. */
    maxpp?: number;
    /** Targeting type, e.g. `"normal"`, `"self"`. */
    target?: string;
    /** `true` (or a reason string) if the move cannot be selected right now. */
    disabled?: string | boolean;
}

/** @brief Options for one active Pokémon when it is time to pick a move. */
export interface ActiveRequest {
    /** The active Pokémon's moves, in slot order (slot 1 = index 0). */
    moves: MoveOption[];
    /** `true` if the Pokémon cannot switch out. */
    trapped?: boolean;
    /** `true` if the Pokémon might be trapped (hidden info). */
    maybeTrapped?: boolean;
    /** Set when the Pokémon can Terastallize; holds its Tera type. */
    canTerastallize?: string;
    /** `true` if the Pokémon can Mega Evolve. */
    canMegaEvo?: boolean;
    /** `true` if the Pokémon can Dynamax. */
    canDynamax?: boolean;
}

/** @brief One Pokémon on the player's own team, as seen in a request. */
export interface SidePokemon {
    /** `"p1: Pikachu"` - side ID plus nickname. */
    ident: string;
    /** `"Pikachu, L50, M"` - species, level, gender, shiny. */
    details: string;
    /** HP and status, e.g. `"120/211"`, `"0 fnt"`, `"85/211 par"`. */
    condition: string;
    /** `true` if this Pokémon is currently on the field. */
    active: boolean;
    /** Calculated stats (not including HP). */
    stats: Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>;
    /** Move IDs. */
    moves: string[];
    /** Ability ID applied on switch-in. */
    baseAbility: string;
    /** Held item ID (empty string if none). */
    item: string;
    /** Poké Ball ID. */
    pokeball: string;
    /** Current ability ID (Gen 7+). */
    ability?: string;
    /** Tera type, if any. */
    teraType?: string;
}

/** @brief The player's side as sent with every request. */
export interface SideRequest {
    /** Player name. */
    name: string;
    /** Player slot. */
    id: SideID;
    /** Whole team in current party order (slot 1 = index 0). */
    pokemon: SidePokemon[];
}

/** @brief Fields shared by every request kind. */
interface BaseRequest {
    /** The player's own team. */
    side: SideRequest;
    /** Request ID; increments every time a new decision is needed. */
    rqid?: number;
    /** If `true`, a choice cannot be undone after it is sent. */
    noCancel?: boolean;
}

/** @brief "Pick a move (or switch)" - the normal turn request. */
export interface MoveRequest extends BaseRequest {
    /** One entry per active Pokémon (1 in singles, 2 in doubles). */
    active: ActiveRequest[];
    wait?: undefined;
    teamPreview?: undefined;
    forceSwitch?: undefined;
}

/** @brief "You must switch" - e.g. after a faint or U-turn. */
export interface SwitchRequest extends BaseRequest {
    /** One flag per active slot; `true` means that slot must switch. */
    forceSwitch: boolean[];
    wait?: undefined;
    teamPreview?: undefined;
}

/** @brief "Choose your lead / team order" - formats with Team Preview. */
export interface TeamPreviewRequest extends BaseRequest {
    teamPreview: true;
    /** How many Pokémon will be brought into battle. */
    maxChosenTeamSize?: number;
    wait?: undefined;
    forceSwitch?: undefined;
}

/** @brief "Nothing to do - wait for the opponent". */
export interface WaitRequest extends BaseRequest {
    wait: true;
    teamPreview?: undefined;
    forceSwitch?: undefined;
}

/**
 * @brief Any request the simulator may send to a player.
 *
 * Narrow it with the helper guards in `protocol.ts` or by checking fields:
 * `'active' in req`, `req.forceSwitch`, `req.teamPreview`, `req.wait`.
 */
export type BattleRequest = MoveRequest | SwitchRequest | TeamPreviewRequest | WaitRequest;
