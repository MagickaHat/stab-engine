/**
 * @file message.ts
 * @brief The placeholder language of locale text: parsing and formatting.
 *
 * Text can hold placeholders in braces. The simple ones from the event
 * system keep working, and an ICU MessageFormat subset adds plurals,
 * selects, grammar and numbers:
 *
 * | Placeholder                                        | Shows                                                    |
 * |----------------------------------------------------|----------------------------------------------------------|
 * | `{name}`                                           | A value given by the caller (`params.name`), or `{player}`, `{money}`. |
 * | `{item:potion}`, `{species:id}`, `{move:id}`, `{ability:id}`, `{nature:id}`, `{type:id}` | A translated game-data name. |
 * | `{var:name}`, `{text:key}`, `{ink:var}`            | A variable, another line, an ink variable.               |
 * | `{n, number}` / `{n, number, integer}` / `{n, number, percent}` | A number in the locale's format: `1,234` / `1.234`. |
 * | `{n, plural, one {# Potion} other {# Potions}}`    | Plural forms of the locale (`zero one two few many other`, `=0` exact). `#` is the number. |
 * | `{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}` | Ordinal forms. |
 * | `{who, select, rival {…} other {…}}`              | Picks by the value.                                      |
 * | `{pokemon@gender, select, f {la} m {le} other {le}}` | Picks by a **grammar tag** of the value (from the `tags` column). |
 *
 * Write `\{` and `\}` for literal braces. A placeholder nobody fills is left
 * as it is, so a mistake shows on screen instead of crashing the game.
 */
import { intlTag } from './languages.ts';

/** @brief A text with grammar tags, e.g. a species name with its gender. */
export interface TaggedText
{
    text: string;
    tags: Readonly<Record<string, string>>;
}

/** @brief A value a placeholder can be filled with. */
export type MessageValue = string | number | TaggedText;

/** @brief Turns a placeholder name into a value; `undefined` leaves the placeholder as written. */
export type MessageResolver = (name: string) => MessageValue | undefined;

/** @brief Plain text. */
type TextNode = string;
/** @brief `{name}` or `{name, number[, style]}`. */
interface ArgNode
{
    type: 'arg';
    name: string;
    format?: string;
    style?: string;
    source: string;
}
/** @brief `{name, plural|selectordinal|select, ...}`. */
interface ChoiceNode
{
    type: 'plural' | 'selectordinal' | 'select';
    name: string;
    offset: number;
    cases: Record<string, MessageNode[]>;
    source: string;
}
/** @brief `#` inside a plural case. */
interface PoundNode
{
    type: 'pound';
}
export type MessageNode = TextNode | ArgNode | ChoiceNode | PoundNode;

/** @brief A syntax problem in a message. */
export class MessageSyntaxError extends Error
{
    /** Index in the text where the problem is. */
    readonly position: number;

    constructor (message: string, position: number)
    {
        super(message);
        this.name = 'MessageSyntaxError';
        this.position = position;
    }
}

/** @brief Parsed messages, by source text. */
const cache = new Map<string, MessageNode[]>();

/**
 * @brief Parse message text (cached).
 * @param source Text with placeholders.
 * @return The nodes.
 * @throws MessageSyntaxError for unbalanced braces or a malformed plural/select.
 */
export function parseMessage (source: string): MessageNode[]
{
    let nodes = cache.get(source);
    if (!nodes)
    {
        const parser = new Parser(source);
        nodes = parser.parseNodes(false, 0);
        if (parser.pos < source.length) throw new MessageSyntaxError('unexpected "}"', parser.pos);
        if (cache.size > 5000) cache.clear();
        cache.set(source, nodes);
    }
    return nodes;
}

/** @brief Recursive-descent parser for the message syntax. */
class Parser
{
    pos = 0;
    readonly src: string;

    constructor (src: string)
    {
        this.src = src;
    }

    /** @brief Parse until the end, or a `}` closing a case. */
    parseNodes (inCase: boolean, plural: number): MessageNode[]
    {
        const nodes: MessageNode[] = [];
        let text = '';
        const flush = () =>
        {
            if (text) nodes.push(text);
            text = '';
        };
        while (this.pos < this.src.length)
        {
            const c = this.src[this.pos];
            if (c === '\\' && (this.src[this.pos + 1] === '{' || this.src[this.pos + 1] === '}' || this.src[this.pos + 1] === '#'))
            {
                text += this.src[this.pos + 1];
                this.pos += 2;
            }
            else if (c === '{')
            {
                flush();
                nodes.push(this.parsePlaceholder(plural));
            }
            else if (c === '}')
            {
                if (inCase) break;
                throw new MessageSyntaxError('unexpected "}"', this.pos);
            }
            else if (c === '#' && plural > 0)
            {
                flush();
                nodes.push({ type: 'pound' });
                this.pos++;
            }
            else
            {
                text += c;
                this.pos++;
            }
        }
        flush();
        return nodes;
    }

    /** @brief Parse `{...}` starting at the `{`. */
    private parsePlaceholder (plural: number): MessageNode
    {
        const start = this.pos;
        this.pos++;
        const close = this.findClose(start);
        const inner = this.src.slice(start + 1, close);
        const firstComma = inner.indexOf(',');
        if (firstComma < 0)
        {
            this.pos = close + 1;
            return { type: 'arg', name: inner.trim(), source: this.src.slice(start, close + 1) };
        }
        const name = inner.slice(0, firstComma).trim();
        const rest = inner.slice(firstComma + 1);
        const secondComma = rest.indexOf(',');
        const format = (secondComma < 0 ? rest : rest.slice(0, secondComma)).trim();
        if (format === 'plural' || format === 'select' || format === 'selectordinal')
        {
            if (secondComma < 0) throw new MessageSyntaxError(`"${format}" needs cases: {${name}, ${format}, other {…}}`, start);
            this.pos = start + 1 + firstComma + 1 + secondComma + 1;
            const node: ChoiceNode = { type: format, name, offset: 0, cases: {}, source: '' };
            for (;;)
            {
                this.skipSpace();
                if (this.src[this.pos] === '}') break;
                if (this.pos >= this.src.length) throw new MessageSyntaxError(`"{${name}, ${format}" is never closed`, start);
                const selector = this.readWord();
                if (!selector) throw new MessageSyntaxError(`expected a case name in {${name}, ${format}, …}`, this.pos);
                if (selector.startsWith('offset:'))
                {
                    node.offset = Number(selector.slice(7)) || 0;
                    continue;
                }
                this.skipSpace();
                if (this.src[this.pos] !== '{') throw new MessageSyntaxError(`case "${selector}" needs text in braces`, this.pos);
                this.pos++;
                node.cases[selector] = this.parseNodes(true, format === 'select' ? plural : plural + 1);
                if (this.src[this.pos] !== '}') throw new MessageSyntaxError(`case "${selector}" is never closed`, this.pos);
                this.pos++;
            }
            this.pos++;
            if (!node.cases.other) throw new MessageSyntaxError(`{${name}, ${format}, …} needs an "other" case`, start);
            node.source = this.src.slice(start, this.pos);
            return node;
        }
        this.pos = close + 1;
        const style = secondComma < 0 ? undefined : rest.slice(secondComma + 1).trim();
        return { type: 'arg', name, format, style, source: this.src.slice(start, close + 1) };
    }

    /** @brief Index of the `}` matching the `{` at `start` (for simple placeholders). */
    private findClose (start: number): number
    {
        let depth = 0;
        for (let i = start; i < this.src.length; i++)
        {
            const c = this.src[i];
            if (c === '\\') { i++; continue; }
            if (c === '{') depth++;
            else if (c === '}' && --depth === 0) return i;
        }
        throw new MessageSyntaxError('"{" is never closed', start);
    }

    private skipSpace (): void
    {
        while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
    }

    private readWord (): string
    {
        const start = this.pos;
        while (this.pos < this.src.length && !/[\s{}]/.test(this.src[this.pos])) this.pos++;
        return this.src.slice(start, this.pos);
    }
}

/** @brief `Intl` objects by locale, made once. */
const plurals = new Map<string, Intl.PluralRules>();
const numbers = new Map<string, Intl.NumberFormat>();

/**
 * @brief The plural category of a number in a locale.
 * @param locale Language ID or BCP 47 tag.
 * @param n The number.
 * @param ordinal `true` for ordinal forms (1st, 2nd).
 * @return `zero`, `one`, `two`, `few`, `many` or `other`.
 */
export function pluralCategory (locale: string, n: number, ordinal = false): Intl.LDMLPluralRule
{
    const id = `${locale}|${ordinal}`;
    let rules = plurals.get(id);
    if (!rules)
    {
        rules = new Intl.PluralRules(intlTag(locale), { type: ordinal ? 'ordinal' : 'cardinal' });
        plurals.set(id, rules);
    }
    return rules.select(n);
}

/**
 * @brief The plural categories a locale uses.
 * @param locale Language ID.
 * @param ordinal `true` for ordinal forms.
 */
export function pluralCategories (locale: string, ordinal = false): string[]
{
    pluralCategory(locale, 1, ordinal);
    return plurals.get(`${locale}|${ordinal}`)!.resolvedOptions().pluralCategories;
}

/**
 * @brief Write a number the way a locale does (`1,234.5` in English, `1.234,5` in German).
 * @param locale Language ID.
 * @param n The number.
 * @param style `integer`, `percent`, or nothing for a plain number.
 */
export function formatNumber (locale: string, n: number, style?: string): string
{
    const id = `${locale}|${style ?? ''}`;
    let format = numbers.get(id);
    if (!format)
    {
        const options: Intl.NumberFormatOptions = style === 'integer'
            ? { maximumFractionDigits: 0 }
            : style === 'percent' ? { style: 'percent' } : {};
        format = new Intl.NumberFormat(intlTag(locale), options);
        numbers.set(id, format);
    }
    return format.format(n);
}

/** @brief The text of a value. */
function textOf (value: MessageValue): string
{
    return typeof value === 'object' ? value.text : String(value);
}

/**
 * @brief Fill a message's placeholders.
 * @param source Text with placeholders. Malformed text is returned unchanged.
 * @param locale Language ID, for numbers and plural rules.
 * @param resolve Gives the value of each placeholder name.
 * @return The finished text.
 */
export function formatMessage (source: string, locale: string, resolve: MessageResolver): string
{
    let nodes: MessageNode[];
    try
    {
        nodes = parseMessage(source);
    }
    catch
    {
        return source;
    }
    return render(nodes, locale, resolve, null);
}

/** @brief Render nodes; `count` is the number `#` stands for. */
function render (nodes: readonly MessageNode[], locale: string, resolve: MessageResolver, count: number | null): string
{
    let out = '';
    for (const node of nodes)
    {
        if (typeof node === 'string')
        {
            out += node;
            continue;
        }
        if (node.type === 'pound')
        {
            out += count === null ? '#' : formatNumber(locale, count);
            continue;
        }
        if (node.type === 'arg')
        {
            const value = resolve(node.name);
            if (value === undefined) out += node.source;
            else if (node.format === 'number') out += formatNumber(locale, Number(textOf(value)), node.style);
            else out += typeof value === 'number' ? formatNumber(locale, value) : textOf(value);
            continue;
        }
        out += renderChoice(node, locale, resolve);
    }
    return out;
}

/** @brief Render a plural or select placeholder. */
function renderChoice (node: ChoiceNode, locale: string, resolve: MessageResolver): string
{
    const at = node.name.lastIndexOf('@');
    const name = node.type === 'select' && at > 0 ? node.name.slice(0, at) : node.name;
    const tag = node.type === 'select' && at > 0 ? node.name.slice(at + 1) : null;
    const value = resolve(name);
    if (value === undefined) return node.source;
    if (node.type === 'select')
    {
        const key = tag === null ? textOf(value) : (typeof value === 'object' ? value.tags[tag] : undefined) ?? 'other';
        return render(node.cases[key] ?? node.cases.other, locale, resolve, null);
    }
    const n = Number(textOf(value));
    if (!Number.isFinite(n)) return render(node.cases.other, locale, resolve, null);
    const exact = node.cases[`=${n}`];
    if (exact) return render(exact, locale, resolve, n);
    const shifted = n - node.offset;
    const category = pluralCategory(locale, shifted, node.type === 'selectordinal');
    return render(node.cases[category] ?? node.cases.other, locale, resolve, shifted);
}

/** @brief What a message uses, for validators. */
export interface MessageInfo
{
    /** Every placeholder name (for `x@tag`, the name `x`). */
    names: Set<string>;
    /** Plural/selectordinal placeholders: name → case names. */
    plurals: Map<string, { ordinal: boolean; cases: string[] }>;
    /** Grammar tags read with `@`: tag names. */
    tags: Set<string>;
}

/**
 * @brief List the placeholders of a message.
 * @param source Text with placeholders.
 * @return What it uses.
 * @throws MessageSyntaxError if the text is malformed.
 */
export function inspectMessage (source: string): MessageInfo
{
    const info: MessageInfo = { names: new Set(), plurals: new Map(), tags: new Set() };
    const walk = (nodes: readonly MessageNode[]) =>
    {
        for (const node of nodes)
        {
            if (typeof node === 'string' || node.type === 'pound') continue;
            const at = node.name.lastIndexOf('@');
            if (at > 0)
            {
                info.names.add(node.name.slice(0, at));
                info.tags.add(node.name.slice(at + 1));
            }
            else info.names.add(node.name);
            if (node.type === 'arg') continue;
            if (node.type !== 'select') info.plurals.set(node.name, { ordinal: node.type === 'selectordinal', cases: Object.keys(node.cases) });
            for (const branch of Object.values(node.cases)) walk(branch);
        }
    };
    walk(parseMessage(source));
    return info;
}
