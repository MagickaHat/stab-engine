/**
 * @file steps.ts
 * @brief Turns protocol lines into battle steps: one thing to show at a time.
 *
 * The simulator sends a whole turn as a block of text. A presentation layer
 * (a Phaser scene, a text box) wants single events instead: "this Pokémon was
 * sent out", "this one lost HP", "this one fainted". `toStep()` converts one
 * protocol line into such an event, a `BattleStep`.
 *
 * The most common events get their own `kind` with ready-to-use fields. Every
 * other line becomes an `'other'` step, which still carries the parsed line,
 * so a presenter can react to any protocol command without changes here.
 */
import { describeLine, parseHP, parseIdent, parseLine } from '../protocol.ts';
import type { HPStatus, PokemonIdent, ProtocolLine } from '../protocol.ts';

/** @brief A Pokémon named by a step. */
export interface StepPokemon extends PokemonIdent
{
    /** The reference as written in the protocol, e.g. `"p2a: Gengar"`. */
    ident: string;
    /** Index of the field position: 0 for `a`, 1 for `b`... or -1 if not on the field. */
    slot: number;
}

/** @brief Fields every step has. */
interface StepBase
{
    /** The parsed protocol line this step was made from. */
    line: ProtocolLine;
    /** A short English sentence for the line (`describeLine()`), or `null` if it has none. */
    text: string | null;
}

/** @brief A Pokémon entered the field (`|switch|`, `|drag|`, `|replace|`). */
export interface SwitchStep extends StepBase
{
    kind: 'switch';
    pokemon: StepPokemon;
    /** Details string, e.g. `"Pikachu, L50, M, shiny"`. */
    details: string;
    /** HP and status on entry. */
    hp: HPStatus;
    /** `true` if it was forced in (Roar, Dragon Tail...). */
    drag: boolean;
    /** `true` if it replaced the Pokémon already shown (an Illusion ended). */
    replace: boolean;
}

/** @brief A Pokémon used a move (`|move|`). */
export interface MoveStep extends StepBase
{
    kind: 'move';
    pokemon: StepPokemon;
    /** Move name, e.g. `"Thunderbolt"`. */
    move: string;
    /** The target, or `null` if the move has none. */
    target: StepPokemon | null;
    /** `true` if the move missed. */
    missed: boolean;
}

/** @brief A Pokémon's HP changed (`|-damage|`, `|-heal|`, `|-sethp|`). */
export interface HPStep extends StepBase
{
    kind: 'damage' | 'heal';
    pokemon: StepPokemon;
    /** HP and status after the change. */
    hp: HPStatus;
    /** What caused it when it was not a move, e.g. `"item: Leftovers"`, else `null`. */
    from: string | null;
}

/** @brief A status condition was applied or cured (`|-status|`, `|-curestatus|`). */
export interface StatusStep extends StepBase
{
    kind: 'status';
    pokemon: StepPokemon;
    /** `"brn"`, `"par"`, `"slp"`, `"frz"`, `"psn"` or `"tox"`. */
    status: string;
    /** `true` if the status was removed. */
    cured: boolean;
}

/** @brief A stat stage changed (`|-boost|`, `|-unboost|`). */
export interface BoostStep extends StepBase
{
    kind: 'boost';
    pokemon: StepPokemon;
    /** `"atk"`, `"def"`, `"spa"`, `"spd"`, `"spe"`, `"accuracy"` or `"evasion"`. */
    stat: string;
    /** Stages gained (positive) or lost (negative). */
    amount: number;
}

/** @brief A Pokémon fainted (`|faint|`). */
export interface FaintStep extends StepBase
{
    kind: 'faint';
    pokemon: StepPokemon;
}

/**
 * @brief A Pokémon changed how it looks without leaving the field
 *        (`|detailschange|`, `|-formechange|`, `|-transform|`): Mega Evolution,
 *        forme changes, Transform.
 */
export interface FormeChangeStep extends StepBase
{
    kind: 'formechange';
    pokemon: StepPokemon;
    /** `true` if the change lasts after switching out (Mega Evolution, Terastal formes...). */
    permanent: boolean;
}

/** @brief The weather changed, continued or ended (`|-weather|`). */
export interface WeatherStep extends StepBase
{
    kind: 'weather';
    /** Weather name, e.g. `"RainDance"`, or `null` when it cleared. */
    weather: string | null;
    /** `true` for the end-of-turn reminder that the weather is still active. */
    upkeep: boolean;
}

/** @brief A new turn started (`|turn|`). */
export interface TurnStep extends StepBase
{
    kind: 'turn';
    turn: number;
}

/** @brief The battle is over (`|win|`, `|tie|`). */
export interface EndStep extends StepBase
{
    kind: 'end';
    /** Winning player's name, or `null` for a tie. */
    winner: string | null;
}

/** @brief Any other protocol line. Read `line.cmd`, `line.args` and `line.kwArgs`. */
export interface OtherStep extends StepBase
{
    kind: 'other';
}

/**
 * @brief One thing that happened in the battle.
 *
 * Narrow it with `step.kind`:
 * @code
 * if (step.kind === 'damage') flash(step.pokemon.side, step.pokemon.slot);
 * @endcode
 */
export type BattleStep =
    | SwitchStep | MoveStep | HPStep | StatusStep | BoostStep | FaintStep
    | FormeChangeStep | WeatherStep | TurnStep | EndStep | OtherStep;

/** @brief Every value of `BattleStep['kind']`. */
export type BattleStepKind = BattleStep['kind'];

/** @brief Lines that carry no event: timestamps, debug output, stream bookkeeping. */
const SILENT = new Set(['', 't:', 'debug', 'request', 'error', 'split', 'upkeep']);

/**
 * @brief Parse a Pokémon reference into a `StepPokemon`.
 * @param ident Reference such as `"p1a: Pikachu"`.
 * @return The parsed reference.
 */
function pokemonOf (ident: string): StepPokemon
{
    const parsed = parseIdent(ident);
    return { ...parsed, ident, slot: parsed.position ? parsed.position.charCodeAt(0) - 97 : -1 };
}

/**
 * @brief Convert one protocol line into a step.
 *
 * @param raw A protocol line, e.g. `|-damage|p2a: Gengar|120/261`.
 * @return The step, or `null` for lines with nothing to show (empty lines,
 *         timestamps, `|upkeep|`, `|request|`...).
 */
export function toStep (raw: string): BattleStep | null
{
    if (!raw.startsWith('|')) return null;
    const line = parseLine(raw);
    const { cmd, args, kwArgs } = line;
    if (SILENT.has(cmd)) return null;

    const base = { line, text: describeLine(line) };
    switch (cmd)
    {
        case 'switch':
        case 'drag':
        case 'replace':
            return {
                ...base, kind: 'switch', pokemon: pokemonOf(args[0]), details: args[1] ?? '',
                hp: parseHP(args[2] ?? ''), drag: cmd === 'drag', replace: cmd === 'replace',
            };
        case 'move':
            return {
                ...base, kind: 'move', pokemon: pokemonOf(args[0]), move: args[1] ?? '',
                target: args[2] ? pokemonOf(args[2]) : null, missed: 'miss' in kwArgs,
            };
        case '-damage':
        case '-heal':
        case '-sethp':
        {
            const hp = parseHP(args[1] ?? '');
            return {
                ...base, kind: cmd === '-damage' ? 'damage' : 'heal',
                pokemon: pokemonOf(args[0]), hp, from: kwArgs.from ?? null,
            };
        }
        case '-status':
        case '-curestatus':
            return { ...base, kind: 'status', pokemon: pokemonOf(args[0]), status: args[1] ?? '', cured: cmd === '-curestatus' };
        case '-boost':
        case '-unboost':
            return {
                ...base, kind: 'boost', pokemon: pokemonOf(args[0]), stat: args[1] ?? '',
                amount: (Number(args[2]) || 0) * (cmd === '-boost' ? 1 : -1),
            };
        case 'faint':
            return { ...base, kind: 'faint', pokemon: pokemonOf(args[0]) };
        case 'detailschange':
        case '-formechange':
        case '-transform':
            return { ...base, kind: 'formechange', pokemon: pokemonOf(args[0]), permanent: cmd === 'detailschange' };
        case '-weather':
            return { ...base, kind: 'weather', weather: !args[0] || args[0] === 'none' ? null : args[0], upkeep: 'upkeep' in kwArgs };
        case 'turn':
            return { ...base, kind: 'turn', turn: Number(args[0]) || 0 };
        case 'win':
            return { ...base, kind: 'end', winner: args[0] ?? null };
        case 'tie':
            return { ...base, kind: 'end', winner: null };
        default:
            return { ...base, kind: 'other' };
    }
}
