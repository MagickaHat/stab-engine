/**
 * @file protocol.ts
 * @brief Small helpers for reading Pokémon Showdown's battle protocol.
 *
 * The simulator describes everything that happens as text lines such as
 * `|move|p1a: Pikachu|Thunderbolt|p2a: Gyarados` or
 * `|-damage|p2a: Gyarados|0 fnt`. These helpers split those lines into
 * useful pieces and turn the most common ones into readable sentences.
 *
 * Full protocol reference:
 * https://github.com/smogon/pokemon-showdown/blob/master/sim/SIM-PROTOCOL.md
 */
import { Protocol } from '@pkmn/protocol';
import type {
    BattleRequest, MoveRequest, SideID, SwitchRequest, TeamPreviewRequest, WaitRequest
} from './types.ts';

/** @brief A protocol line split into its command and arguments. */
export interface ProtocolLine {
    /** Command name without the leading pipe, e.g. `"move"`, `"-damage"`. Empty for plain text lines. */
    cmd: string;
    /** Positional arguments that follow the command. */
    args: string[];
    /** Bracketed keyword arguments, e.g. `[from] item: Life Orb` becomes `{ from: 'item: Life Orb' }`. */
    kwArgs: Record<string, string>;
    /** The original, unmodified line. */
    raw: string;
}

/** @brief HP and status parsed from a condition string. */
export interface HPStatus {
    /** Current HP (exact for your own Pokémon, a percentage out of 100 for others). */
    hp: number;
    /** Maximum HP (100 when the value is a percentage). */
    maxhp: number;
    /** Status condition: `"par"`, `"brn"`, `"slp"`, `"frz"`, `"psn"`, `"tox"`, `"fnt"`, or `""`. */
    status: string;
}

/** @brief A Pokémon reference such as `"p2a: Gengar"`, split into parts. */
export interface PokemonIdent {
    /** Which player owns it. */
    side: SideID;
    /** Field position letter (`"a"`, `"b"`...) or `""` if not on the field. */
    position: string;
    /** The Pokémon's nickname. */
    name: string;
}

/**
 * @brief Split one protocol line into command, arguments and keyword arguments.
 *
 * @param line A single line from a battle stream.
 * @return The parsed line. Lines not starting with `|` get an empty `cmd`.
 */
export function parseLine (line: string): ProtocolLine
{
    if (!line.startsWith('|'))
    {
        return { cmd: '', args: [line], kwArgs: {}, raw: line };
    }
    const parts = line.slice(1).split('|');
    const cmd = parts.shift() ?? '';

    //  `|request|` and `|error|` carry a payload that may itself contain pipes.
    if (cmd === 'request' || cmd === 'error')
    {
        return { cmd, args: [parts.join('|')], kwArgs: {}, raw: line };
    }

    const args: string[] = [];
    const kwArgs: Record<string, string> = {};
    for (const part of parts)
    {
        const match = /^\[(\w+)\]\s?(.*)$/.exec(part);
        if (match)
        {
            kwArgs[match[1]] = match[2];
        }
        else
        {
            args.push(part);
        }
    }
    return { cmd, args, kwArgs, raw: line };
}

/**
 * @brief Parse an HP/status condition string.
 *
 * Examples: `"120/211"`, `"85/211 par"`, `"0 fnt"`, `"48/100 brn"`.
 *
 * @param condition The condition string from a request or protocol line.
 * @return Parsed HP, max HP and status.
 */
export function parseHP (condition: string): HPStatus
{
    const [hpPart, status = ''] = condition.trim().split(' ');
    if (hpPart === '0')
    {
        return { hp: 0, maxhp: 0, status: status || 'fnt' };
    }
    const [hp, maxhp] = hpPart.split('/').map(Number);
    return { hp: hp || 0, maxhp: maxhp || 100, status };
}

/**
 * @brief Split a Pokémon reference like `"p2a: Gengar"` or `"p1: Pikachu"`.
 *
 * @param ident The reference from a protocol line or request.
 * @return The side, field position and nickname.
 */
export function parseIdent (ident: string): PokemonIdent
{
    const colon = ident.indexOf(':');
    const prefix = ident.slice(0, colon);
    return {
        side: prefix.slice(0, 2) as SideID,
        position: prefix.slice(2),
        name: ident.slice(colon + 1).trim(),
    };
}

/** @brief Return the nickname from a reference, e.g. `"p2a: Gengar"` → `"Gengar"`. */
function who (ident: string | undefined): string
{
    if (!ident) return '';
    const { side, name } = parseIdent(ident);
    return side === 'p2' ? `the opposing ${name}` : name;
}

/** @brief Readable names for status abbreviations. */
const STATUS_NAMES: Record<string, string> = {
    brn: 'burned', par: 'paralyzed', slp: 'put to sleep',
    frz: 'frozen', psn: 'poisoned', tox: 'badly poisoned',
};

/**
 * @brief Turn a protocol line into a short, human-readable sentence.
 *
 * Only common commands are covered; it returns `null` for everything else
 * (including bookkeeping lines like `|t:|` or `|upkeep|`), so you can skip them.
 * Lines are written from player 1's point of view ("the opposing X" = player 2).
 *
 * @param line Raw line or an already parsed line.
 * @return A sentence for the battle log, or `null` if the line is not described.
 */
export function describeLine (line: string | ProtocolLine): string | null
{
    const { cmd, args, kwArgs } = typeof line === 'string' ? parseLine(line) : line;
    const from = kwArgs.from ? ` (${kwArgs.from.replace(/^(item|ability): /, '')})` : '';

    switch (cmd)
    {
        case 'player': return args[1] ? `${args[1]} joined as ${args[0]}.` : null;
        case 'turn': return `--- Turn ${args[0]} ---`;
        case 'switch':
        case 'drag': return `${who(args[0])} was sent out! (${args[1].split(',')[0]})`;
        case 'move': return `${who(args[0])} used ${args[1]}!`;
        case '-damage': return `${who(args[0])} took damage${from}. [${args[1]}]`;
        case '-heal': return `${who(args[0])} restored HP${from}. [${args[1]}]`;
        case '-supereffective': return `It's super effective!`;
        case '-resisted': return `It's not very effective...`;
        case '-immune': return `It doesn't affect ${who(args[0])}...`;
        case '-crit': return `A critical hit!`;
        case '-miss': return `${who(args[0])}'s attack missed!`;
        case '-fail': return `But it failed!`;
        case '-status': return `${who(args[0])} was ${STATUS_NAMES[args[1]] ?? args[1]}!`;
        case '-boost': return `${who(args[0])}'s ${args[1]} rose by ${args[2]}!`;
        case '-unboost': return `${who(args[0])}'s ${args[1]} fell by ${args[2]}!`;
        case '-terastallize': return `${who(args[0])} Terastallized into the ${args[1]} type!`;
        case 'cant': return `${who(args[0])} can't move (${args[1]})!`;
        case 'faint': return `${who(args[0])} fainted!`;
        case 'win': return `${args[0]} won the battle!`;
        case 'tie': return `The battle ended in a tie.`;
        default: return null;
    }
}

/** @brief `true` if the request asks for a move (or optional switch). */
export function isMoveRequest (req: BattleRequest): req is MoveRequest
{
    return 'active' in req && !req.forceSwitch && !req.teamPreview && !req.wait;
}

/** @brief `true` if the request forces a switch (e.g. after a faint). */
export function isSwitchRequest (req: BattleRequest): req is SwitchRequest
{
    return Array.isArray(req.forceSwitch);
}

/** @brief `true` if the request is for Team Preview. */
export function isTeamPreviewRequest (req: BattleRequest): req is TeamPreviewRequest
{
    return req.teamPreview === true;
}

/** @brief `true` if the player has nothing to do and should wait. */
export function isWaitRequest (req: BattleRequest): req is WaitRequest
{
    return req.wait === true;
}

/**
 * @brief Parse a chunk of protocol text into fully typed lines using @pkmn/protocol.
 *
 * This is the strongly typed alternative to `parseLine()`: `args[0]` is the
 * command, and TypeScript knows the exact type of every other argument
 * (e.g. for `'-damage'`, `args[1]` is a `PokemonIdent` and `args[2]` a `PokemonHPStatus`).
 * Pair it with a `Handler` (see docs/BATTLE_SYSTEM.md) to react to each command.
 *
 * @param chunk One or more protocol lines separated by `\n`.
 * @return A generator of `{ args, kwArgs }` for each line.
 */
export function parseTyped (chunk: string)
{
    return Protocol.parse(chunk);
}
