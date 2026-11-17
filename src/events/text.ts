/**
 * @file text.ts
 * @brief Translated event text: locale CSV files, placeholders and fallbacks.
 *
 * Scripts never contain the words the player reads, only **text keys**
 * (`"events.lab_aide.hello"`). The words live in
 * `content/locales/<category>/<locale>.csv`, one file per language, so
 * translators work on spreadsheets and never touch scripts.
 *
 * A CSV file has a header row `key,text` and one row per line of text.
 * Fields with commas, quotes or line breaks are quoted, with `""` for a
 * quote (the usual spreadsheet export):
 *
 * @code
 * key,text
 * events.lab_aide.hello,"Hello, {player}! Take this {item:potion}."
 * system.yes,Yes
 * @endcode
 *
 * Placeholders:
 * - `{player}`: the player's name; `{money}`: their money;
 * - `{var:name}`: a variable;
 * - `{item:id}`, `{species:id}`, `{move:id}`: a translated name (`items.<id>.name`...);
 * - `{text:key}`: another line;
 * - `{name}`: the command's `params.name`. A param whose value is a text
 *   key (e.g. `"items.potion.name"`) is shown translated.
 *
 * A key missing in the current locale falls back to English, then to the
 * key itself, so a missing line is visible but never crashes the game.
 */
import type { GameState } from '../state/GameState.ts';
import { resolveValue } from './conditions.ts';
import type { TextParams } from './schema.ts';

/** @brief Locale that every other locale falls back to. */
export const FALLBACK_LOCALE = 'en';

/**
 * @brief Read CSV text (RFC 4180: quoted fields, `""` escapes, CRLF or LF).
 * @param text The file's contents.
 * @return Rows of fields. Empty lines are skipped.
 */
export function parseCsv (text: string): string[][]
{
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;   // byte order mark
    const endRow = () =>
    {
        row.push(field);
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
        field = '';
    };
    for (; i < text.length; i++)
    {
        const c = text[i];
        if (quoted)
        {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') quoted = false;
            else field += c;
        }
        else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') endRow();
        else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length > 0) endRow();
    return rows;
}

/**
 * @brief Read a locale CSV file into a key → text table.
 * @param text The file's contents, with a `key,text` header.
 * @return The table. Rows without a key are skipped.
 */
export function parseLocaleCsv (text: string): Record<string, string>
{
    const rows = parseCsv(text);
    const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
    const keyColumn = header.indexOf('key');
    const textColumn = header.indexOf('text');
    const hasHeader = keyColumn >= 0 && textColumn >= 0;
    const out: Record<string, string> = {};
    for (const row of hasHeader ? rows.slice(1) : rows)
    {
        const key = row[hasHeader ? keyColumn : 0]?.trim();
        if (key) out[key] = row[hasHeader ? textColumn : 1] ?? '';
    }
    return out;
}

/** @brief What placeholders are filled from. */
export interface TextContext
{
    state: GameState;
    random?: () => number;
}

/**
 * @brief Translated text for every loaded locale, with placeholder filling.
 *
 * @code
 * const text = new TextStore({ en: parseLocaleCsv(enCsv) }, 'en');
 * text.format('events.lab_aide.hello', { state });
 * @endcode
 */
export class TextStore
{
    private readonly tables = new Map<string, Record<string, string>>();
    private current: string;

    /**
     * @param tables Text by locale, then by key. More can be added with `add()`.
     * @param locale Locale to show. Default: `FALLBACK_LOCALE`.
     */
    constructor (tables: Record<string, Record<string, string>> = {}, locale = FALLBACK_LOCALE)
    {
        for (const [name, table] of Object.entries(tables)) this.add(name, table);
        this.current = locale;
    }

    /** @brief The locale being shown. */
    get locale (): string
    {
        return this.current;
    }

    /** @brief Change the locale being shown. Keys it lacks still fall back to English. */
    set locale (locale: string)
    {
        this.current = locale;
    }

    /**
     * @brief Add text to a locale. Keys already there are replaced.
     * @param locale Locale, e.g. `de`.
     * @param table Key → text.
     */
    add (locale: string, table: Record<string, string>): void
    {
        this.tables.set(locale, { ...this.tables.get(locale), ...table });
    }

    /**
     * @brief Whether a key has text in a locale.
     * @param key Text key.
     * @param locale Default: the fallback locale.
     */
    has (key: string, locale = FALLBACK_LOCALE): boolean
    {
        return this.tables.get(locale)?.[key] !== undefined;
    }

    /**
     * @brief The raw text of a key, without filling placeholders.
     * @param key Text key.
     * @return The text in the current locale, else English, else the key itself.
     */
    raw (key: string): string
    {
        return this.tables.get(this.current)?.[key] ?? this.tables.get(FALLBACK_LOCALE)?.[key] ?? key;
    }

    /**
     * @brief The text of a key with its placeholders filled.
     * @param key Text key.
     * @param ctx The game, for `{player}`, `{var:...}` and friends.
     * @param params Values for `{name}` placeholders.
     * @return The finished text.
     */
    format (key: string, ctx: TextContext, params: TextParams = {}): string
    {
        return this.fill(this.raw(key), ctx, params, 0);
    }

    /** @brief Fill placeholders, following `{text:...}` at most a few levels deep. */
    private fill (text: string, ctx: TextContext, params: TextParams, depth: number): string
    {
        return text.replace(/\{([A-Za-z0-9_]+)(?::([A-Za-z0-9_.:-]+))?\}/g, (whole, name: string, arg?: string) =>
        {
            const data = ctx.state.getSnapshot();
            if (arg === undefined)
            {
                if (name in params)
                {
                    const value = String(resolveValue(params[name], ctx));
                    return this.isKey(value) ? this.raw(value) : value;
                }
                if (name === 'player') return data.player.name;
                if (name === 'money') return String(data.player.money);
                return whole;
            }
            switch (name)
            {
                case 'var': return String(ctx.state.getVar(arg) ?? '');
                case 'item': return this.name('items', arg);
                case 'species': return this.name('pokemon', arg);
                case 'move': return this.name('moves', arg);
                case 'text': return depth < 4 ? this.fill(this.raw(arg), ctx, params, depth + 1) : whole;
                default: return whole;
            }
        });
    }

    /** @brief Whether some locale has this text key. */
    private isKey (value: string): boolean
    {
        return /^[A-Za-z0-9_.:-]+\.[A-Za-z0-9_.:-]+$/.test(value) && this.raw(value) !== value;
    }

    /**
     * @brief A translated game-data name, such as `items.potion.name`.
     * @param category Locale category: `items`, `pokemon`, `moves`...
     * @param id Entry ID.
     * @return The name, or the ID itself if there is no text for it.
     */
    dataName (category: string, id: string): string
    {
        return this.name(category, id);
    }

    /** @brief A translated data name (`items.potion.name`), or the ID itself. */
    private name (category: string, id: string): string
    {
        const key = `${category}.${id}.name`;
        const text = this.raw(key);
        return text === key ? id : text;
    }
}
