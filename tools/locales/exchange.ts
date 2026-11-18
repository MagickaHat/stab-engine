/**
 * @file exchange.ts
 * @brief Translator sheets: one CSV per language with the English text next
 *        to the translation, made by `locales:export` and read back by `locales:import`.
 *
 * Sheet columns:
 *
 * | Column             | Meaning                                                                 |
 * |--------------------|-------------------------------------------------------------------------|
 * | `key`              | Text key (do not change).                                               |
 * | `category`         | Locale file it belongs to (`battle`, `ui`...).                          |
 * | `english`          | The English text (for reference).                                       |
 * | `notes`            | English notes: who says it, where it is shown (for reference).          |
 * | `max`              | Length limit (for reference).                                           |
 * | `status`           | `missing`, `stale`, `unverified`, `sister` or `ok` (for reference).     |
 * | `text`             | **The translation.** Leave empty to skip.                               |
 * | `tags`             | **Grammar tags** of the translation: `gender=f`.                        |
 * | `translator_notes` | **Notes** kept in the locale file's `notes` column.                     |
 *
 * Importing writes `text`, `tags` and `translator_notes` into
 * `content/locales/<category>/<locale>.csv` and stamps each row's `hash` with
 * the English text it was translated from, so later English edits show up as stale.
 */
import { parseCsvRecords, textHash, writeCsv, writeLocaleCsv } from '../../src/i18n/csv.ts';
import type { LocaleRow } from '../../src/i18n/csv.ts';
import { fallbackChain } from '../../src/i18n/languages.ts';
import type { LocaleFileInfo } from './content.ts';

/** @brief Columns of a translator sheet, in order. */
export const SHEET_COLUMNS = ['key', 'category', 'english', 'notes', 'max', 'status', 'text', 'tags', 'translator_notes'] as const;

/** @brief Which rows to export. */
export interface ExportOptions
{
    locale: string;
    /** Only keys that are missing, stale or unverified. */
    todo?: boolean;
    /** Also export generated game-data names (items, Pokémon...) so translators can override them. */
    data?: boolean;
    /** Only these categories. */
    categories?: string[];
}

/** @brief A row of English text: key, category and the row itself. */
interface Source
{
    key: string;
    category: string;
    text: string;
    notes?: string;
    max?: string;
}

/**
 * @brief Make a translator sheet.
 * @param files Every locale file.
 * @param generated Generated text: locale → key → text.
 * @param options Locale and filters.
 * @return CSV text.
 */
export function exportSheet (files: readonly LocaleFileInfo[], generated: Record<string, Record<string, string>>, options: ExportOptions): string
{
    const rowsOf = (locale: string) => new Map(files.filter((f) => f.locale === locale).flatMap((f) => f.file.rows.map((row) => [row.key, row] as const)));
    const own = rowsOf(options.locale);
    const sisters = fallbackChain(options.locale).slice(1).filter((name) => name !== 'en').map(rowsOf);
    const sources: Source[] = files.filter((f) => f.locale === 'en').flatMap((f) => f.file.rows.map((row) => ({ key: row.key, category: f.category, text: row.text, notes: row.notes, max: row.max })));
    if (options.data)
    {
        const known = new Set(sources.map((source) => source.key));
        for (const [key, text] of Object.entries(generated.en ?? {}))
        {
            if (!known.has(key)) sources.push({ key, category: key.split('.')[0], text });
        }
    }
    const out: string[][] = [[...SHEET_COLUMNS]];
    for (const source of sources)
    {
        if (options.categories && !options.categories.includes(source.category)) continue;
        const row = own.get(source.key);
        const translated = row?.text.trim() ? row : undefined;
        const generatedText = generated[options.locale]?.[source.key];
        const status = translated
            ? !translated.hash ? 'unverified' : translated.hash === textHash(source.text) ? 'ok' : 'stale'
            : sisters.some((rows) => rows.get(source.key)?.text.trim()) ? 'sister' : generatedText ? 'ok' : 'missing';
        if (options.todo && status !== 'missing' && status !== 'stale' && status !== 'unverified') continue;
        out.push([
            source.key, source.category, source.text, source.notes ?? '', source.max ?? '', status,
            translated?.text ?? generatedText ?? '', translated?.tags ?? '', translated?.notes ?? '',
        ]);
    }
    return writeCsv(out);
}

/** @brief What an import changed. */
export interface ImportResult
{
    /** New CSV text by category, for every file that changed. */
    files: Map<string, string>;
    added: number;
    updated: number;
    unchanged: number;
    /** Keys of the sheet that English does not have. */
    unknown: string[];
    /** Problems with the sheet itself. */
    problems: string[];
}

/**
 * @brief Merge a translator sheet into a locale's files.
 * @param sheet The sheet's CSV text.
 * @param files Every locale file.
 * @param generated Generated text (English game-data names count as known keys).
 * @param locale Locale the sheet is for.
 * @return The new file contents and what changed. Nothing is written.
 */
export function importSheet (sheet: string, files: readonly LocaleFileInfo[], generated: Record<string, Record<string, string>>, locale: string): ImportResult
{
    const result: ImportResult = { files: new Map(), added: 0, updated: 0, unchanged: 0, unknown: [], problems: [] };
    const { records, issues } = parseCsvRecords(sheet);
    for (const item of issues) result.problems.push(`line ${item.line}: ${item.message}`);
    const header = records[0]?.fields.map((cell) => cell.trim().toLowerCase()) ?? [];
    const column = (name: string) => header.indexOf(name);
    if (column('key') < 0 || column('text') < 0)
    {
        result.problems.push('the sheet needs "key" and "text" columns');
        return result;
    }
    const english = new Map(files.filter((f) => f.locale === 'en').flatMap((f) => f.file.rows.map((row) => [row.key, { row, category: f.category }] as const)));
    const target = new Map(files.filter((f) => f.locale === locale).map((f) => [f.category, f.file.rows.map((row) => ({ ...row }))] as const));
    const where = new Map<string, string>();
    for (const [category, rows] of target) for (const row of rows) where.set(row.key, category);
    const changed = new Set<string>();

    for (const record of records.slice(1))
    {
        const cell = (name: string) => (column(name) >= 0 ? record.fields[column(name)] ?? '' : '');
        const key = cell('key').trim();
        const text = cell('text');
        if (!key || !text.trim()) continue;
        const source = english.get(key)?.row.text ?? generated.en?.[key];
        if (source === undefined)
        {
            result.unknown.push(key);
            continue;
        }
        const category = where.get(key) ?? (cell('category').trim() || english.get(key)?.category || key.split('.')[0]);
        let rows = target.get(category);
        if (!rows) target.set(category, rows = []);
        const next: Omit<LocaleRow, 'line'> = { key, text, hash: textHash(source) };
        const tags = cell('tags').trim();
        const notes = cell('translator_notes').trim();
        if (tags) next.tags = tags;
        if (notes) next.notes = notes;
        const index = rows.findIndex((row) => row.key === key);
        if (index < 0)
        {
            rows.push({ ...next, line: 0 });
            where.set(key, category);
            result.added++;
            changed.add(category);
            continue;
        }
        const old = rows[index];
        const merged = { ...old, ...next, tags: next.tags ?? old.tags, notes: next.notes ?? old.notes };
        if (old.text === merged.text && old.hash === merged.hash && old.tags === merged.tags && old.notes === merged.notes)
        {
            result.unchanged++;
            continue;
        }
        rows[index] = merged;
        result.updated++;
        changed.add(category);
    }
    for (const category of changed) result.files.set(category, writeLocaleCsv(target.get(category)!, ['key', 'text', 'notes', 'tags', 'hash']));
    return result;
}

/**
 * @brief Stamp every translation without a `hash` with the current English text (after a review).
 * @param files Every locale file.
 * @param locale Locale to stamp.
 * @return New CSV text by category, for every file that changed, and how many rows were stamped.
 */
export function stampHashes (files: readonly LocaleFileInfo[], locale: string): { files: Map<string, string>; stamped: number }
{
    const english = new Map(files.filter((f) => f.locale === 'en').flatMap((f) => f.file.rows.map((row) => [row.key, row.text] as const)));
    const out = new Map<string, string>();
    let stamped = 0;
    for (const info of files.filter((f) => f.locale === locale))
    {
        let changed = false;
        const rows = info.file.rows.map((row) =>
        {
            const source = english.get(row.key);
            if (row.hash || source === undefined || !row.text.trim()) return row;
            changed = true;
            stamped++;
            return { ...row, hash: textHash(source) };
        });
        if (changed) out.set(info.category, writeLocaleCsv(rows, ['key', 'text', 'notes', 'tags', 'hash']));
    }
    return { files: out, stamped };
}
