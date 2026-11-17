/**
 * @file snapshot.ts
 * @brief The battle as plain data for the UI: `BattleSnapshot`.
 *
 * A snapshot is a read-only object describing the battle at one moment: who
 * is on the field, their HP and status, the player's party, and what the
 * player may choose right now. `BattleBridge` builds a new one after every
 * step it presents, so the UI never sees the result of an event before the
 * event itself has been shown.
 *
 * Snapshots are never modified after they are made. That is what lets React
 * compare them cheaply (see `useBattle()` in src/ui/useBattle.ts).
 */
import type { Pokemon, Side } from '@pkmn/client';
import type { BattleState } from '../BattleState.ts';
import { parseHP } from '../protocol.ts';
import type { ActiveRequest, BattleRequest, SideID } from '../types.ts';
import type { BattleStep } from './steps.ts';

/**
 * @brief What the bridge is doing.
 *
 * - `idle`: created, not started yet.
 * - `presenting`: steps are being shown. Do not offer choices.
 * - `choosing`: the player must decide; see `BattleSnapshot.choice`.
 * - `waiting`: nothing to show or choose (the simulator or the opponent is busy).
 * - `ended`: the battle is over; see `BattleSnapshot.winner`.
 */
export type BattlePhase = 'idle' | 'presenting' | 'choosing' | 'waiting' | 'ended';

/** @brief One Pokémon as the UI should show it. */
export interface PokemonView
{
    /** Reference such as `"p1: Pikachu"`. Stays the same for the whole battle. */
    ident: string;
    /** Nickname (the species name if it has none). */
    name: string;
    /** Species and forme as shown right now, e.g. `"Charizard-Mega-X"`. */
    speciesForme: string;
    /** Showdown ID of `speciesForme`, e.g. `"charizardmegax"`. */
    speciesId: string;
    /** Showdown ID of the base species, e.g. `"charizard"`. Names the sprite folder. */
    baseSpeciesId: string;
    /** Showdown ID of the forme, e.g. `"megax"`, or `""` for the base forme. */
    formeId: string;
    level: number;
    /** `"M"`, `"F"` or `"N"` (genderless or unknown). */
    gender: string;
    shiny: boolean;
    /** Current HP. Out of 100 for the opponent in formats with the HP Percentage Mod. */
    hp: number;
    /** Maximum HP. 0 for an opponent's Pokémon that has not been on the field yet. */
    maxhp: number;
    /** `"brn"`, `"par"`, `"slp"`, `"frz"`, `"psn"`, `"tox"`, or `""`. */
    status: string;
    fainted: boolean;
    /** Stat stages that are not 0, e.g. `{ atk: 2, spe: -1 }`. */
    boosts: Readonly<Record<string, number>>;
    /** IDs of temporary effects (confusion, Substitute, Leech Seed...). */
    volatiles: readonly string[];
    /** Tera type if it has Terastallized, else `null`. */
    terastallized: string | null;
    /** Held item ID if known, else `""`. */
    item: string;
    /** Ability ID if known, else `""`. */
    ability: string;
    /** `true` if it is on the field. */
    active: boolean;
}

/** @brief One player's side of the field. */
export interface SideView
{
    id: SideID;
    /** Player name. */
    name: string;
    /** Pokémon on the field, by position (one in singles). `null` = empty position. */
    active: readonly (PokemonView | null)[];
    /** Every Pokémon known on this side. For the opponent, only those seen so far. */
    team: readonly PokemonView[];
    /** Team size, including Pokémon not seen yet. */
    totalPokemon: number;
    /** IDs of hazards and screens on this side (Stealth Rock, Reflect...). */
    conditions: readonly string[];
}

/** @brief A move the player may pick. */
export interface MoveChoice
{
    /** Slot to pass to `chooseMove()`, starting at 1. */
    slot: number;
    id: string;
    name: string;
    /** Remaining PP, or `null` if the move has none (Struggle, a locked-in move). */
    pp: number | null;
    maxpp: number | null;
    /** `true` if it cannot be selected right now. */
    disabled: boolean;
}

/** @brief A party member the player may switch to. */
export interface SwitchChoice
{
    /** Slot to pass to `chooseSwitch()`, starting at 1. */
    slot: number;
    /** Reference such as `"p1: Pikachu"`; matches `PokemonView.ident`. */
    ident: string;
    name: string;
    /** Details string, e.g. `"Pikachu, L50, M"`. */
    details: string;
    hp: number;
    maxhp: number;
    status: string;
    /** `true` if it cannot be chosen: already out, fainted, or the active Pokémon is trapped. */
    disabled: boolean;
}

/** @brief What the player may do right now. Only set while `phase` is `'choosing'`. */
export interface ChoiceView
{
    /**
     * - `move`: a normal turn. Pick a move or, unless `trapped`, a switch.
     * - `switch`: a Pokémon must be sent out.
     * - `team`: Team Preview. Answer with `chooseTeam()`.
     */
    kind: 'move' | 'switch' | 'team';
    /** Moves of the active Pokémon (empty unless `kind` is `'move'`). */
    moves: readonly MoveChoice[];
    /** The whole party in slot order. */
    switches: readonly SwitchChoice[];
    /** `true` if the active Pokémon cannot switch out. */
    trapped: boolean;
    /** Tera type if the active Pokémon can Terastallize this turn, else `null`. */
    canTerastallize: string | null;
    canMegaEvo: boolean;
    canDynamax: boolean;
    /** The simulator's own request, for anything not covered above (e.g. double battles). */
    request: BattleRequest;
}

/** @brief The whole battle at one moment. */
export interface BattleSnapshot
{
    phase: BattlePhase;
    /** Turn number (0 before the first turn). */
    turn: number;
    /** The side the local player controls. */
    player: SideID;
    /** The local player's side. */
    me: SideView;
    /** The opponent's side. */
    foe: SideView;
    /** Weather name, e.g. `"Rain"`, or `null`. */
    weather: string | null;
    /** Terrain name, e.g. `"Electric"`, or `null`. */
    terrain: string | null;
    /** The step being shown (or shown last), or `null` before the first one. */
    step: BattleStep | null;
    /** What the player may choose, or `null` when there is nothing to choose. */
    choice: ChoiceView | null;
    /** Why the last choice was rejected, or `null`. Cleared by the next choice. */
    error: string | null;
    /** Winner's name, `null` for a tie, `undefined` while the battle is running. */
    winner: string | null | undefined;
}

/** @brief Showdown ID of a name: lowercase letters and digits only. */
function toID (text: string | undefined): string
{
    return (text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * @brief Describe one Pokémon.
 * @param pokemon The `@pkmn/client` Pokémon.
 * @return Its view.
 */
function viewPokemon (pokemon: Pokemon): PokemonView
{
    const speciesForme = pokemon.speciesForme;
    //  Missing for a species the battle model has no data for.
    const species = pokemon.species as Pokemon['species'] | undefined;
    const boosts: Record<string, number> = {};
    for (const [stat, stages] of Object.entries(pokemon.boosts))
    {
        if (stages) boosts[stat] = stages;
    }
    return {
        ident: pokemon.originalIdent,
        name: pokemon.name,
        speciesForme,
        speciesId: toID(speciesForme),
        baseSpeciesId: toID(species?.baseSpecies) || toID(speciesForme),
        formeId: toID(species?.forme),
        level: pokemon.level,
        gender: pokemon.gender,
        //  A transformed Pokémon looks like its target, shininess included.
        shiny: pokemon.volatiles.transform?.shiny ?? pokemon.shiny,
        hp: pokemon.hp,
        maxhp: pokemon.maxhp,
        status: pokemon.status ?? '',
        fainted: pokemon.fainted,
        boosts,
        volatiles: Object.keys(pokemon.volatiles),
        terastallized: pokemon.terastallized ?? null,
        item: pokemon.item,
        ability: pokemon.ability,
        active: pokemon.isActive(),
    };
}

/**
 * @brief Describe one side.
 * @param side The `@pkmn/client` side.
 * @param id Which player it is.
 * @return Its view.
 */
function viewSide (side: Side, id: SideID): SideView
{
    const views = new Map<Pokemon, PokemonView>();
    const view = (pokemon: Pokemon) =>
    {
        let made = views.get(pokemon);
        if (!made) views.set(pokemon, made = viewPokemon(pokemon));
        return made;
    };
    return {
        id,
        name: side.name,
        team: side.team.map(view),
        active: side.active.map((pokemon) => (pokemon ? view(pokemon) : null)),
        totalPokemon: side.totalPokemon,
        conditions: Object.keys(side.sideConditions),
    };
}

/**
 * @brief Reduce a simulator request to what a menu needs.
 * @param request The request.
 * @return The choice, or `null` for a "wait" request.
 */
export function viewChoice (request: BattleRequest): ChoiceView | null
{
    if (request.wait) return null;

    const kind = request.teamPreview ? 'team' : request.forceSwitch ? 'switch' : 'move';
    const active: ActiveRequest | undefined = kind === 'move' && 'active' in request ? request.active[0] : undefined;
    const trapped = !!active?.trapped;

    return {
        kind,
        moves: (active?.moves ?? []).map((move, index) => ({
            slot: index + 1,
            id: move.id,
            name: move.move,
            pp: move.pp ?? null,
            maxpp: move.maxpp ?? null,
            disabled: !!move.disabled,
        })),
        switches: request.side.pokemon.map((pokemon, index) =>
        {
            const { hp, maxhp, status } = parseHP(pokemon.condition);
            const fainted = status === 'fnt';
            return {
                slot: index + 1,
                ident: pokemon.ident,
                name: pokemon.ident.slice(pokemon.ident.indexOf(':') + 1).trim(),
                details: pokemon.details,
                hp,
                maxhp,
                status: fainted ? '' : status,
                //  In Team Preview nobody is out yet, so every Pokémon can lead.
                disabled: kind !== 'team' && (pokemon.active || fainted || trapped),
            };
        }),
        trapped,
        canTerastallize: active?.canTerastallize ?? null,
        canMegaEvo: !!active?.canMegaEvo,
        canDynamax: !!active?.canDynamax,
        request,
    };
}

/** @brief The parts of a snapshot that do not come from the battle model. */
export interface SnapshotExtras
{
    phase: BattlePhase;
    step: BattleStep | null;
    choice: ChoiceView | null;
    error: string | null;
    winner: string | null | undefined;
}

/**
 * @brief Build a snapshot from the battle model.
 * @param state The model, as far as it has been presented.
 * @param extras Phase, current step, choice, error and winner.
 * @return A new snapshot.
 */
export function buildSnapshot (state: BattleState, extras: SnapshotExtras): BattleSnapshot
{
    const player = state.player;
    const foeId: SideID = player === 'p2' ? 'p1' : 'p2';
    const field = state.battle.field;
    return {
        ...extras,
        turn: state.turn,
        player,
        me: viewSide(state.me, player),
        foe: viewSide(state.foe, foeId),
        weather: field.weather ?? null,
        terrain: field.terrain ?? null,
    };
}
