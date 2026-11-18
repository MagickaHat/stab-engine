/**
 * @file Localizer.ts
 * @brief Translated text for every loaded locale: lookups through fallback
 *        chains, grammar tags, placeholders, and hot reload.
 *
 * Text is added in **sources** (one per file: `csv:battle`, `data:items`...).
 * A source can be replaced as a whole, which is how a CSV edited during
 * `npm run dev` replaces its old rows without a page reload.
 *
 * A key is looked up along `fallbackChain(locale)`: `es-mx`, then `es-es`,
 * then `en`, then the key itself is shown, so a gap is visible but never
 * crashes the game.
 *
 * The locale of a game comes from its save file and never changes. Call
 * `lock()` once it is set: setting `locale` afterwards throws.
 *
 * @code
 * const text = new Localizer({ en: { 'ui.bag.count': '{n, plural, one {# item} other {# items}}' } }, 'en');
 * text.format('ui.bag.count', { n: 3 });   // "3 items"
 * @endcode
 */
import { BASE_LOCALE, fallbackChain } from './languages.ts';
import { formatMessage, formatNumber } from './message.ts';
import type { MessageValue, TaggedText } from './message.ts';

/** @brief Values for placeholders, by name. */
export type MessageParams = Readonly<Record<string, MessageValue | undefined>>;

/**
 * @brief Where placeholders that are not in the params get their values.
 *
 * The event system fills it from the game state; tools leave it empty.
 */
export interface MessageEnv
{
    /** The player's name, for `{player}`. */
    player?: string;
    /** The player's money, for `{money}`. */
    money?: number;
    /** A game variable, for `{var:name}`. */
    variable?: (name: string) => string | number | undefined;
    /** An ink variable, for `{ink:name}`. */
    ink?: (name: string) => string | number | undefined;
}

/** @brief Categories the `{category:id}` placeholders read names from. */
const DATA_PLACEHOLDERS: Readonly<Record<string, string>> = {
    item: 'items', species: 'pokemon', pokemon: 'pokemon', move: 'moves',
    ability: 'abilities', nature: 'natures', type: 'types',
};

/** @brief How deep `{text:key}` may nest. */
const MAX_DEPTH = 4;

/** @brief A key's text and the locale it was found in. */
export interface Lookup
{
    text: string;
    locale: string;
    tags: Readonly<Record<string, string>>;
}

/** @brief Text of one locale, by source. */
interface LocaleTables
{
    sources: Map<string, Record<string, string>>;
    tags: Map<string, Record<string, Record<string, string>>>;
    merged: Map<string, string> | null;
    mergedTags: Map<string, Record<string, string>> | null;
}

/** @brief Translated text, placeholders and fallbacks. */
export class Localizer
{
    private readonly locales = new Map<string, LocaleTables>();
    private current: string;
    private chainCache: string[];
    private locked = false;
    private readonly listeners = new Set<() => void>();

    /**
     * @param tables Text by locale, then by key. More can be added with `add()`.
     * @param locale Locale to show. Default: `BASE_LOCALE`.
     */
    constructor (tables: Record<string, Record<string, string>> = {}, locale: string = BASE_LOCALE)
    {
        for (const [name, table] of Object.entries(tables)) this.add(name, table);
        this.current = locale;
        this.chainCache = fallbackChain(locale);
    }

    /** @brief The locale being shown. */
    get locale (): string
    {
        return this.current;
    }

    /**
     * @brief Change the locale being shown.
     * @throws Error once `lock()` was called with a different locale (a save's language never changes).
     */
    set locale (locale: string)
    {
        if (locale === this.current) return;
        if (this.locked) throw new Error(`[i18n] the language is locked to "${this.current}" for this save and cannot change to "${locale}"`);
        this.current = locale;
        this.chainCache = fallbackChain(locale);
        this.changed();
    }

    /** @brief Whether `lock()` was called. */
    get isLocked (): boolean
    {
        return this.locked;
    }

    /**
     * @brief Fix the locale for good (for the rest of this game session).
     * @param locale Locale to set first. Default: the current one.
     */
    lock (locale: string = this.current): void
    {
        this.locale = locale;
        this.locked = true;
    }

    /** @brief The locales a key is looked up in, in order. */
    get chain (): readonly string[]
    {
        return this.chainCache;
    }

    /** @brief Every locale some text was added for. */
    get loadedLocales (): string[]
    {
        return [...this.locales.keys()];
    }

    /**
     * @brief Add text to a locale. Keys already there are replaced.
     * @param locale Locale, e.g. `de`.
     * @param table Key → text.
     * @param source Name of the source. Text from the same source is merged.
     * @param tags Grammar tags by key (from the `tags` column).
     */
    add (locale: string, table: Readonly<Record<string, string>>, source = 'default', tags?: Readonly<Record<string, Record<string, string>>>): void
    {
        const tables = this.tablesOf(locale);
        tables.sources.set(source, { ...tables.sources.get(source), ...table });
        if (tags) tables.tags.set(source, { ...tables.tags.get(source), ...tags });
        this.invalidate(tables);
    }

    /**
     * @brief Replace everything one source added to a locale (hot reload).
     * @param locale Locale.
     * @param source Source name given to `add()`.
     * @param table The new text. Keys it no longer has are removed.
     * @param tags The new grammar tags.
     */
    replace (locale: string, source: string, table: Readonly<Record<string, string>>, tags: Readonly<Record<string, Record<string, string>>> = {}): void
    {
        const tables = this.tablesOf(locale);
        tables.sources.set(source, { ...table });
        tables.tags.set(source, { ...tags });
        this.invalidate(tables);
    }

    /**
     * @brief Be told when text or the locale changes (hot reload, `locale` set).
     * @param listener Called with no arguments.
     * @return A function that removes the listener.
     */
    subscribe = (listener: () => void): (() => void) =>
    {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    /**
     * @brief Whether a key has text in a locale (without fallbacks).
     * @param key Text key.
     * @param locale Default: `BASE_LOCALE`.
     */
    has (key: string, locale: string = BASE_LOCALE): boolean
    {
        return this.merged(locale).has(key);
    }

    /**
     * @brief Find a key along the fallback chain.
     * @param key Text key.
     * @param locale Start of the chain. Default: the current locale.
     * @return The text, where it was found and its tags; `undefined` if no locale has it.
     */
    lookup (key: string, locale?: string): Lookup | undefined
    {
        const chain = locale === undefined ? this.chainCache : fallbackChain(locale);
        for (const name of chain)
        {
            const text = this.merged(name).get(key);
            if (text !== undefined) return { text, locale: name, tags: this.mergedTags(name).get(key) ?? {} };
        }
        return undefined;
    }

    /**
     * @brief The raw text of a key, without filling placeholders.
     * @param key Text key.
     * @return The text in the first locale of the chain that has it, else the key itself.
     */
    raw (key: string): string
    {
        return this.lookup(key)?.text ?? key;
    }

    /**
     * @brief The grammar tags of a key in the current locale (or where it falls back to).
     * @param key Text key.
     */
    tags (key: string): Readonly<Record<string, string>>
    {
        return this.lookup(key)?.tags ?? {};
    }

    /**
     * @brief A key's text with its tags, to pass as a placeholder value.
     * @param key Text key.
     */
    tagged (key: string): TaggedText
    {
        const found = this.lookup(key);
        return { text: found?.text ?? key, tags: found?.tags ?? {} };
    }

    /**
     * @brief A translated game-data name, such as `items.potion.name`.
     * @param category Locale category: `items`, `pokemon`, `moves`...
     * @param id Entry ID.
     * @param locale Look it up in this locale instead of the current one.
     * @return The name with its grammar tags; the ID itself if there is no text for it.
     */
    dataNameTagged (category: string, id: string, locale?: string): TaggedText
    {
        const found = this.lookup(`${category}.${id}.name`, locale);
        return found ? { text: found.text, tags: found.tags } : { text: id, tags: {} };
    }

    /**
     * @brief A translated game-data name, such as `items.potion.name`.
     * @param category Locale category.
     * @param id Entry ID.
     * @return The name, or the ID itself if there is no text for it.
     */
    dataName (category: string, id: string): string
    {
        return this.dataNameTagged(category, id).text;
    }

    /**
     * @brief The name a Pokémon is shown with: its nickname, else its species name.
     * @param pokemon Species ID and optional nickname.
     * @return Text with the species' grammar tags.
     */
    pokemonName (pokemon: { species: string; nickname?: string }): TaggedText
    {
        const species = this.dataNameTagged('pokemon', pokemon.species);
        return pokemon.nickname ? { text: pokemon.nickname, tags: species.tags } : species;
    }

    /**
     * @brief A number in the current locale's format.
     * @param n The number.
     * @param style `integer`, `percent`, or nothing.
     */
    number (n: number, style?: string): string
    {
        return formatNumber(this.current, n, style);
    }

    /**
     * @brief The text of a key with its placeholders filled.
     * @param key Text key.
     * @param params Values for placeholders.
     * @param env Values for `{player}`, `{var:...}` and friends.
     * @return The finished text.
     */
    format (key: string, params: MessageParams = {}, env: MessageEnv = {}): string
    {
        return this.fill(this.raw(key), params, env, 0);
    }

    /**
     * @brief Fill the placeholders of a text that is not in a locale file.
     * @param text Text with placeholders.
     * @param params Values for placeholders.
     * @param env Values for `{player}` and friends.
     */
    formatText (text: string, params: MessageParams = {}, env: MessageEnv = {}): string
    {
        return this.fill(text, params, env, 0);
    }

    /** @brief Fill placeholders, following `{text:...}` a few levels deep. */
    protected fill (text: string, params: MessageParams, env: MessageEnv, depth: number): string
    {
        return formatMessage(text, this.current, (name) => this.resolve(name, params, env, depth));
    }

    /**
     * @brief The value of one placeholder name.
     * @param name E.g. `player`, `item:potion`, `count`.
     * @param params Caller's values.
     * @param env Game values.
     * @param depth Nesting depth of `{text:...}`.
     * @return The value, or `undefined` to leave the placeholder as written.
     */
    protected resolve (name: string, params: MessageParams, env: MessageEnv, depth: number): MessageValue | undefined
    {
        if (name in params)
        {
            const value = params[name];
            if (typeof value === 'string' && this.isKey(value)) return this.tagged(value);
            return value;
        }
        const colon = name.indexOf(':');
        if (colon < 0)
        {
            if (name === 'player') return env.player;
            if (name === 'money') return env.money;
            return undefined;
        }
        const kind = name.slice(0, colon);
        const arg = name.slice(colon + 1);
        if (kind in DATA_PLACEHOLDERS) return this.dataNameTagged(DATA_PLACEHOLDERS[kind], arg);
        switch (kind)
        {
            case 'var': return env.variable?.(arg) ?? '';
            case 'ink': return env.ink?.(arg) ?? '';
            case 'text':
                if (depth >= MAX_DEPTH) return undefined;
                return { text: this.fill(this.raw(arg), params, env, depth + 1), tags: this.tags(arg) };
            default: return undefined;
        }
    }

    /** @brief Whether a string is a text key that some locale has. */
    protected isKey (value: string): boolean
    {
        return /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_:-]+)+$/.test(value) && this.lookup(value) !== undefined;
    }

    /** @brief Tables of a locale, made on first use. */
    private tablesOf (locale: string): LocaleTables
    {
        let tables = this.locales.get(locale);
        if (!tables)
        {
            tables = { sources: new Map(), tags: new Map(), merged: null, mergedTags: null };
            this.locales.set(locale, tables);
        }
        return tables;
    }

    /** @brief All text of a locale, later sources over earlier ones. */
    private merged (locale: string): Map<string, string>
    {
        const tables = this.locales.get(locale);
        if (!tables) return EMPTY;
        if (!tables.merged)
        {
            tables.merged = new Map();
            for (const table of tables.sources.values()) for (const [key, text] of Object.entries(table)) tables.merged.set(key, text);
        }
        return tables.merged;
    }

    /** @brief All grammar tags of a locale. */
    private mergedTags (locale: string): Map<string, Record<string, string>>
    {
        const tables = this.locales.get(locale);
        if (!tables) return EMPTY_TAGS;
        if (!tables.mergedTags)
        {
            tables.mergedTags = new Map();
            for (const table of tables.tags.values()) for (const [key, tags] of Object.entries(table)) tables.mergedTags.set(key, tags);
        }
        return tables.mergedTags;
    }

    private invalidate (tables: LocaleTables): void
    {
        tables.merged = null;
        tables.mergedTags = null;
        this.changed();
    }

    private changed (): void
    {
        for (const listener of [...this.listeners]) listener();
    }
}

const EMPTY = new Map<string, string>();
const EMPTY_TAGS = new Map<string, Record<string, string>>();
