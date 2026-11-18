/**
 * @file text.ts
 * @brief Translated battle text: protocol lines → sentences in the game's language.
 *
 * The simulator speaks English names (`|move|p2a: Gengar|Shadow Ball|`).
 * A **narrator** turns each line into a sentence from the `battle.*` keys in
 * `content/locales/battle/<locale>.csv`, translating every name on the way:
 *
 * - Pokémon: a Pokémon without a nickname shows its species name in the
 *   game's language (with the species' grammar tags, for `{pokemon@gender, select, …}`);
 *   a nickname is shown as it is;
 * - moves, abilities, items and types: by ID (`moves.shadowball.name`);
 * - stats and effects: `battle.stat.atk`, `battle.effect.<id>`.
 *
 * Templates get `side` = `own`, `foe` or `wild`, so one key covers "Pikachu",
 * "the opposing Pikachu" and "the wild Pikachu":
 * @code
 * battle.move,"{side, select, foe {The opposing {pokemon}} wild {The wild {pokemon}} other {{pokemon}}} used {move}!"
 * @endcode
 *
 * Text the game itself adds to a battle (experience, level ups, new moves,
 * see src/state/battle.ts) travels as a `|-message|` line made by
 * `encodeTextMessage()`: a key and its values instead of English words.
 * `describeLine()` (src/battle/protocol.ts) still shows those in English.
 */
import { toID } from '../data/integrity.ts';
import { formatMessage } from '../i18n/message.ts';
import type { Localizer, MessageParams } from '../i18n/index.ts';
import type { TaggedText } from '../i18n/message.ts';
import { parseIdent, parseLine } from './protocol.ts';
import type { ProtocolLine } from './protocol.ts';
import type { SideID } from './types.ts';

/** @brief Start of a `|-message|` that carries a text key. */
const MESSAGE_MARK = '@';

/**
 * @brief English text of the keys the game sends with `encodeTextMessage()`,
 *        used where no localizer is available (`describeLine()`, logs).
 */
export const ENGLISH_BATTLE_MESSAGES: Readonly<Record<string, string>> = {
    'battle.exp.gained': '{pokemon} gained {exp} Exp. Points!',
    'battle.exp.level': '{pokemon} grew to Lv. {level}!',
    'battle.move.learned': '{pokemon} learned {move}!',
    'battle.move.banked': '{pokemon} learned {move}! It was stored in its move bank.',
};

/**
 * @brief Make the text of a `|-message|` line that carries a text key.
 * @param key Text key, e.g. `battle.exp.gained`.
 * @param params Values. Pokémon go as their battle names, moves as English names:
 *               the narrator translates both.
 * @return E.g. `@battle.exp.gained {"pokemon":"Sparky","exp":"120"}`.
 */
export function encodeTextMessage (key: string, params: Record<string, string | number>): string
{
    const values: Record<string, string> = {};
    for (const [name, value] of Object.entries(params)) values[name] = String(value);
    return `${MESSAGE_MARK}${key} ${JSON.stringify(values)}`;
}

/**
 * @brief Read a `|-message|` made by `encodeTextMessage()`.
 * @param text The message.
 * @return The key and values, or `null` for plain text.
 */
export function decodeTextMessage (text: string): { key: string; params: Record<string, string> } | null
{
    if (!text.startsWith(MESSAGE_MARK)) return null;
    const space = text.indexOf(' ');
    const key = text.slice(1, space < 0 ? undefined : space);
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) return null;
    try
    {
        const params = space < 0 ? {} : JSON.parse(text.slice(space + 1)) as Record<string, string>;
        return { key, params };
    }
    catch
    {
        return null;
    }
}

/**
 * @brief English text of an encoded message, without a localizer.
 * @param text A `|-message|` text.
 * @return The English sentence, or the text unchanged if it is not encoded.
 */
export function englishMessage (text: string): string
{
    const decoded = decodeTextMessage(text);
    if (!decoded) return text;
    const template = ENGLISH_BATTLE_MESSAGES[decoded.key] ?? decoded.key;
    return formatMessage(template, 'en', (name) => decoded.params[name]);
}

/** @brief Statuses with their own keys. */
const STATUSES = new Set(['brn', 'par', 'slp', 'frz', 'psn', 'tox']);

/** @brief Weathers with their own keys (others use the generic ones). */
const WEATHERS = new Set(['raindance', 'primordialsea', 'sunnyday', 'desolateland', 'sandstorm', 'hail', 'snow', 'snowscape', 'deltastream']);

/** @brief Reasons a Pokémon cannot move that have their own keys. */
const CANT_REASONS = new Set(['slp', 'par', 'frz', 'flinch', 'recharge', 'taunt', 'disable', 'attract', 'truant']);

/** @brief Settings of a narrator. */
export interface NarratorOptions
{
    /** The side the player is on. Default: `p1`. */
    perspective?: SideID;
    /** `true` for a wild battle: the other side's Pokémon are "wild", not "opposing". */
    wild?: boolean;
}

/** @brief Turns one protocol line into a sentence, or `null` for none. Keeps state between lines. */
export type BattleNarrator = (line: ProtocolLine) => string | null;

/**
 * @brief Make a narrator for one battle.
 * @param text The game's localizer (its locale is the language of the sentences).
 * @param options The player's side, wild battle.
 * @return The narrator. Use one per battle: it remembers trainer names, species and weather.
 *
 * @code
 * const bridge = new BattleBridge({ ...options, narrate: createBattleNarrator(localizer, { wild: true }) });
 * @endcode
 */
export function createBattleNarrator (text: Localizer, options: NarratorOptions = {}): BattleNarrator
{
    const me = options.perspective ?? 'p1';
    const trainers: Partial<Record<string, string>> = {};
    /** Species (English name) of every Pokémon seen, by `"p1: Name"`. */
    const species = new Map<string, string>();
    let weather: string | null = null;

    const sideOf = (ident: string | undefined): 'own' | 'foe' | 'wild' =>
    {
        const side = ident ? parseIdent(ident).side : me;
        if (side === me) return 'own';
        return options.wild ? 'wild' : 'foe';
    };
    const speciesKey = (ident: string) =>
    {
        const { side, name } = parseIdent(ident);
        return `${side}: ${name}`;
    };
    /** A Pokémon's name: the translated species unless it has a nickname. */
    const pokemon = (ident: string | undefined): TaggedText =>
    {
        if (!ident) return { text: '', tags: {} };
        const { name } = parseIdent(ident);
        const known = species.get(speciesKey(ident)) ?? name;
        const id = toID(known);
        const found = text.lookup(`pokemon.${id}.name`);
        if (!found) return { text: name, tags: {} };
        const translated = { text: found.text, tags: found.tags };
        const english = text.lookup(`pokemon.${id}.name`, 'en')?.text;
        if (name === known || name === english) return translated;
        return { text: name, tags: translated.tags };
    };
    const dataName = (category: string, name: string | undefined): TaggedText =>
    {
        const id = toID(name);
        const found = text.lookup(`${category}.${id}.name`);
        return found ? { text: found.text, tags: found.tags } : { text: name ?? '', tags: {} };
    };
    /** `[from] item: Leftovers` → the item's name; `[from] psn` → `battle.effect.psn`. */
    const effect = (from: string | undefined): TaggedText | undefined =>
    {
        if (!from) return undefined;
        const match = /^(item|ability|move):\s*(.+)$/.exec(from);
        if (match)
        {
            const category = match[1] === 'item' ? 'items' : match[1] === 'ability' ? 'abilities' : 'moves';
            return dataName(category, match[2]);
        }
        const key = `battle.effect.${toID(from)}`;
        return text.lookup(key) ? text.tagged(key) : { text: from, tags: {} };
    };
    const say = (key: string, params: MessageParams): string | null =>
        (text.lookup(key) ? text.format(key, params) : null);
    const first = (keys: string[], params: MessageParams): string | null =>
    {
        for (const key of keys) if (text.lookup(key)) return text.format(key, params);
        return null;
    };

    return (line) =>
    {
        const { cmd, args, kwArgs } = line;
        const who = args[0];
        const base = { side: sideOf(who), pokemon: pokemon(who) };
        switch (cmd)
        {
            case 'player':
                if (args[1]) trainers[args[0]] = args[1];
                return null;
            case 'turn': return say('battle.turn', { turn: Number(args[0]) || 0 });
            case '-message':
            {
                const decoded = decodeTextMessage(args[0] ?? '');
                if (!decoded) return args[0] ?? null;
                const params: Record<string, string | TaggedText> = { ...decoded.params };
                if (decoded.params.pokemon) params.pokemon = pokemon(`${me}: ${decoded.params.pokemon}`);
                if (decoded.params.move) params.move = dataName('moves', decoded.params.move);
                if (decoded.params.exp) params.exp = text.number(Number(decoded.params.exp));
                return text.format(decoded.key, params);
            }
            case 'switch':
            case 'drag':
            case 'replace':
            {
                species.set(speciesKey(args[0]), (args[1] ?? '').split(',')[0]);
                if (cmd === 'replace') return null;
                const params = { ...base, pokemon: pokemon(args[0]), trainer: trainers[parseIdent(args[0]).side] ?? '' };
                return say(cmd === 'drag' ? 'battle.drag' : `battle.switch.${params.side}`, params);
            }
            case 'move': return say('battle.move', { ...base, move: dataName('moves', args[1]) });
            case '-damage':
            {
                const from = effect(kwArgs.from);
                if (!from) return null;
                return say('battle.damage.from', { ...base, effect: from });
            }
            case '-heal':
            {
                const from = effect(kwArgs.from);
                return say(from ? 'battle.heal.from' : 'battle.heal', { ...base, effect: from });
            }
            case '-supereffective': return say('battle.supereffective', base);
            case '-resisted': return say('battle.resisted', base);
            case '-immune': return say('battle.immune', base);
            case '-crit': return say('battle.crit', base);
            case '-miss': return say('battle.miss', base);
            case '-fail': return say('battle.fail', base);
            case '-status':
                return say(STATUSES.has(args[1]) ? `battle.status.${args[1]}` : 'battle.status', { ...base, status: args[1] ?? '' });
            case '-curestatus':
                return first([`battle.curestatus.${args[1]}`, 'battle.curestatus'], { ...base, status: args[1] ?? '' });
            case '-boost':
            case '-unboost':
            {
                const stat = text.lookup(`battle.stat.${args[1]}`) ? text.tagged(`battle.stat.${args[1]}`) : { text: args[1] ?? '', tags: {} };
                return say(cmd === '-boost' ? 'battle.boost' : 'battle.unboost', { ...base, stat, amount: Number(args[2]) || 0 });
            }
            case '-terastallize': return say('battle.terastallize', { ...base, type: dataName('types', args[1]) });
            case '-ability': return say('battle.ability', { ...base, ability: dataName('abilities', args[1]) });
            case 'cant':
            {
                const reason = toID(args[1]);
                return first([CANT_REASONS.has(reason) ? `battle.cant.${reason}` : '', 'battle.cant'].filter(Boolean), { ...base, reason: args[1] ?? '' });
            }
            case 'faint': return say('battle.faint', base);
            case '-weather':
            {
                const next = !args[0] || args[0] === 'none' ? null : toID(args[0]);
                if (!next)
                {
                    const ended = weather;
                    weather = null;
                    return ended ? first([`battle.weather.${ended}.end`, 'battle.weather.end'], {}) : null;
                }
                const upkeep = 'upkeep' in kwArgs;
                weather = next;
                const suffix = upkeep ? 'upkeep' : 'start';
                return WEATHERS.has(next) ? say(`battle.weather.${next}.${suffix}`, {}) : null;
            }
            case 'win':
                return say(args[0] === trainers[me] ? 'battle.win.own' : 'battle.win', { trainer: args[0] ?? '' });
            case 'tie': return say('battle.tie', {});
            default: return null;
        }
    };
}

/**
 * @brief Narrate one raw line with a fresh narrator (for tests and one-off lines).
 * @param raw Protocol line.
 * @param text Localizer.
 * @param options Narrator options.
 */
export function narrateLine (raw: string, text: Localizer, options: NarratorOptions = {}): string | null
{
    return createBattleNarrator(text, options)(parseLine(raw));
}
