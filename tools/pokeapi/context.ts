/**
 * @file context.ts
 * @brief Shared state for one import run: CSV tables, ID maps, localized
 *        text and the warning log.
 */
import { LANGUAGES, PRIMARY_LANGUAGE } from './config.ts';
import { int } from './csv.ts';
import type { Row } from './csv.ts';
import type { CsvLoader } from './fetch.ts';
import { titleCase, toID } from './ids.ts';

/** @brief Localized strings for one locale category: locale → key → text. */
export type LocaleStrings = Map<string, Map<string, string>>;

/** @brief Showdown identity of a PokeAPI entity. */
export interface Named
{
    id: string;
    name: string;
}

/**
 * @brief Clean up PokeAPI in-game text: joins soft-hyphenated line breaks,
 *        turns form feeds/newlines into spaces and collapses whitespace.
 * @param text Raw text.
 * @return Single-line text.
 */
export function cleanText (text: string): string
{
    return text
        .replace(/­\s*/g, '')
        .replace(/-\n(?=[a-z])/g, '-')
        .replace(/[\f\n\r\t]+/g, ' ')
        .replace(/ {2,}/g, ' ')
        .trim();
}

/**
 * @brief Everything converters need, built once per import.
 */
export class ImportContext
{
    readonly csv: CsvLoader;
    readonly warnings: string[] = [];

    /** PokeAPI language id → engine locale. */
    readonly locales = new Map<string, string>();
    /** PokeAPI language id of `PRIMARY_LANGUAGE`. */
    readonly primaryLanguageId: string;
    /** version_group id → generation number. */
    readonly versionGroupGen = new Map<string, number>();
    /** version_group id → order (newest = highest). */
    readonly versionGroupOrder = new Map<string, number>();
    /** version_group id → identifier. */
    readonly versionGroupName = new Map<string, string>();
    /** version id → version_group id. */
    readonly versionGroupOfVersion = new Map<string, string>();
    /** type id → Showdown type name ("Fire"). */
    readonly typeName = new Map<string, string>();

    /** PokeAPI pokemon id → Showdown species. */
    readonly species = new Map<string, Named>();
    /** PokeAPI move id → Showdown move. */
    readonly moves = new Map<string, Named>();
    /** PokeAPI ability id → Showdown ability. */
    readonly abilities = new Map<string, Named>();
    /** PokeAPI item id → Showdown item. */
    readonly items = new Map<string, Named>();

    /** Localized strings by category. */
    readonly text = new Map<string, LocaleStrings>();

    /**
     * @brief Build the context from preloaded CSV tables.
     * @param csv Loader with every table in `CSV_TABLES` preloaded.
     */
    constructor (csv: CsvLoader)
    {
        this.csv = csv;
        let primary = '';
        for (const row of csv.get('languages'))
        {
            const locale = LANGUAGES[row.identifier];
            if (locale) this.locales.set(row.id, locale);
            if (row.identifier === PRIMARY_LANGUAGE) primary = row.id;
        }
        this.primaryLanguageId = primary;

        for (const row of csv.get('version_groups'))
        {
            this.versionGroupGen.set(row.id, Number(row.generation_id));
            this.versionGroupOrder.set(row.id, Number(row.order));
            this.versionGroupName.set(row.id, row.identifier);
        }
        for (const row of csv.get('versions')) this.versionGroupOfVersion.set(row.id, row.version_group_id);
        for (const row of csv.get('types')) this.typeName.set(row.id, titleCase(row.identifier));
    }

    /**
     * @brief Record a warning for the import report.
     * @param message Text.
     */
    warn (message: string): void
    {
        this.warnings.push(message);
    }

    /**
     * @brief Add one localized string.
     * @param category Locale category (`moves`, `pokemon`…).
     * @param languageId PokeAPI language id.
     * @param key Full key, e.g. `moves.tackle.name`.
     * @param value Text (ignored if empty or language not imported).
     */
    addText (category: string, languageId: string, key: string, value: string | undefined): void
    {
        const locale = this.locales.get(languageId);
        if (!locale || !value) return;
        let byLocale = this.text.get(category);
        if (!byLocale) this.text.set(category, byLocale = new Map());
        let strings = byLocale.get(locale);
        if (!strings) byLocale.set(locale, strings = new Map());
        strings.set(key, value);
    }

    /**
     * @brief Collect the primary-language value of a `*_names` table.
     * @param table e.g. `'move_names'`.
     * @param idColumn e.g. `'move_id'`.
     * @param valueColumn Column with the text.
     * @return Map of entity id → text.
     */
    primaryNames (table: string, idColumn: string, valueColumn = 'name'): Map<string, string>
    {
        const out = new Map<string, string>();
        for (const row of this.csv.get(table))
        {
            if (row.local_language_id === this.primaryLanguageId && row[valueColumn]) out.set(row[idColumn], row[valueColumn]);
        }
        return out;
    }

    /**
     * @brief Copy every imported language of a `*_names`-style table into the locale strings.
     * @param category Locale category.
     * @param table CSV table.
     * @param idColumn Entity id column.
     * @param valueColumn Text column.
     * @param keyOf Builds the locale key for an entity id (return `null` to skip).
     * @param languageColumn Language column (`local_language_id` or `language_id`).
     */
    importNames (category: string, table: string, idColumn: string, valueColumn: string,
        keyOf: (id: string) => string | null, languageColumn = 'local_language_id'): void
    {
        for (const row of this.csv.get(table))
        {
            const key = keyOf(row[idColumn]);
            if (key) this.addText(category, row[languageColumn], key, cleanText(row[valueColumn] ?? ''));
        }
    }

    /**
     * @brief Import the newest flavor text per entity and language.
     *
     * Texts shared by many entries are placeholders (e.g. Scarlet/Violet's
     * "This move can't be used…" for removed moves) and are skipped in favour
     * of the newest real description.
     *
     * @param category Locale category.
     * @param table e.g. `'move_flavor_text'`.
     * @param idColumn Entity id column.
     * @param keyOf Builds the locale key for an entity id.
     */
    importFlavor (category: string, table: string, idColumn: string, keyOf: (id: string) => string | null): void
    {
        const candidates = new Map<string, { order: number; text: string; lang: string; key: string }[]>();
        const frequency = new Map<string, number>();
        for (const row of this.csv.get(table))
        {
            const key = keyOf(row[idColumn]);
            if (!key || !this.locales.has(row.language_id)) continue;
            const group = row.version_group_id ?? this.versionGroupOfVersion.get(row.version_id) ?? '';
            const text = cleanText(row.flavor_text);
            const slot = `${key}|${row.language_id}`;
            const list = candidates.get(slot) ?? [];
            list.push({ order: this.versionGroupOrder.get(group) ?? 0, text, lang: row.language_id, key });
            candidates.set(slot, list);
            frequency.set(`${row.language_id}|${text}`, (frequency.get(`${row.language_id}|${text}`) ?? 0) + 1);
        }
        const PLACEHOLDER_MIN = 25;
        for (const list of candidates.values())
        {
            list.sort((a, b) => b.order - a.order);
            const best = list.find((c) => (frequency.get(`${c.lang}|${c.text}`) ?? 0) < PLACEHOLDER_MIN) ?? list[0];
            this.addText(category, best.lang, best.key, best.text);
        }
    }

    /**
     * @brief Turn PokeAPI prose markup into plain text.
     *
     * PokeAPI writes links like `[regular damage]{mechanic:regular-damage}` or
     * `[]{move:thunderbolt}` (empty label = use the target's name), and
     * placeholders like `$effect_chance`.
     *
     * @param text Raw prose.
     * @param effectChance Value for `$effect_chance`.
     * @return Plain text.
     */
    cleanProse (text: string, effectChance?: number | null): string
    {
        return cleanText(text
            .replace(/\[([^\]]*)\]\{(\w+):([\w-]+)\}/g, (_m, label: string, _kind: string, target: string) =>
                label || titleCase(target).replace(/-/g, ' '))
            .replace(/\$effect_chance/g, String(effectChance ?? '')));
    }

    /**
     * @brief Generation a version group belongs to.
     * @param versionGroupId PokeAPI version group id.
     * @return Generation number, or `undefined`.
     */
    genOf (versionGroupId: string | undefined): number | undefined
    {
        return versionGroupId ? this.versionGroupGen.get(versionGroupId) : undefined;
    }

    /**
     * @brief Index rows by a column, grouping duplicates.
     * @param table CSV table.
     * @param column Column to group by.
     * @return Map of column value → rows.
     */
    group (table: string, column: string): Map<string, Row[]>
    {
        const out = new Map<string, Row[]>();
        for (const row of this.csv.get(table))
        {
            const list = out.get(row[column]);
            if (list) list.push(row);
            else out.set(row[column], [row]);
        }
        return out;
    }
}

export { int, toID };
