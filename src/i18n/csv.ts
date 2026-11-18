/**
 * @file csv.ts
 * @brief Reading and writing locale CSV files.
 *
 * A locale file is `content/locales/<category>/<locale>.csv`: a header row,
 * then one row per text key. Only `key` and `text` are required; the other
 * columns are optional and may come in any order:
 *
 * | Column  | Meaning                                                                    |
 * |---------|----------------------------------------------------------------------------|
 * | `key`   | Text key, e.g. `events.lab_aide.hello`.                                    |
 * | `text`  | The text, with placeholders (see message.ts).                              |
 * | `notes` | Context for translators: who speaks, where it is shown. Never shown in game. |
 * | `max`   | English files only: the longest the text may be, as `120px`, `16` (characters) or `2x120px` (lines × width). |
 * | `tags`  | Grammar tags of this text in this language: `gender=f; article=la`.       |
 * | `hash`  | Translations only: `textHash()` of the English text it was translated from. A different hash means the English changed: the translation is **stale**. |
 *
 * Fields follow RFC 4180: quote a field that has a comma, quote or line
 * break, and write a quote as `""` (what spreadsheet programs export).
 */

/** @brief Columns a locale file can have, in the order `writeLocaleCsv()` writes them. */
export const LOCALE_COLUMNS = ['key', 'text', 'notes', 'max', 'tags', 'hash'] as const;
export type LocaleColumn = (typeof LOCALE_COLUMNS)[number];

/** @brief One row of a locale file. */
export interface LocaleRow
{
    key: string;
    text: string;
    notes?: string;
    max?: string;
    tags?: string;
    hash?: string;
    /** Line of the file the row starts on (1-based). */
    line: number;
}

/** @brief A problem found while reading a CSV file. */
export interface CsvIssue
{
    /** Line (1-based). */
    line: number;
    message: string;
    /** `error` makes the file unusable or loses text; `warning` does not. */
    severity: 'error' | 'warning';
}

/** @brief A parsed locale file. */
export interface LocaleFile
{
    /** Header columns as written (lower case). */
    columns: string[];
    rows: LocaleRow[];
    issues: CsvIssue[];
}

/** @brief One parsed CSV record and the line it starts on. */
interface CsvRecord
{
    fields: string[];
    line: number;
}

/**
 * @brief Read CSV text, keeping line numbers and reporting unterminated quotes.
 * @param text The file's contents (a byte order mark is skipped).
 * @return Records and problems. Empty lines are skipped.
 */
export function parseCsvRecords (text: string): { records: CsvRecord[]; issues: CsvIssue[] }
{
    const records: CsvRecord[] = [];
    const issues: CsvIssue[] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    let line = 1;
    let start = 1;
    let quoteLine = 1;
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    const endRow = () =>
    {
        row.push(field);
        if (row.length > 1 || row[0] !== '') records.push({ fields: row, line: start });
        row = [];
        field = '';
    };
    for (; i < text.length; i++)
    {
        const c = text[i];
        if (c === '\n') line++;
        if (quoted)
        {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') quoted = false;
            else if (c !== '\r' || text[i + 1] !== '\n') field += c;
        }
        else if (c === '"')
        {
            quoted = true;
            quoteLine = line;
        }
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n')
        {
            endRow();
            start = line;
        }
        else if (c !== '\r') field += c;
    }
    if (quoted) issues.push({ line: quoteLine, severity: 'error', message: 'a quoted field is never closed (missing ")' });
    if (field !== '' || row.length > 0) endRow();
    return { records, issues };
}

/**
 * @brief Read CSV text (RFC 4180: quoted fields, `""` escapes, CRLF or LF).
 * @param text The file's contents.
 * @return Rows of fields. Empty lines are skipped.
 */
export function parseCsv (text: string): string[][]
{
    return parseCsvRecords(text).records.map((record) => record.fields);
}

/**
 * @brief Read a locale file with every column, line numbers and problems.
 *
 * A file without a `key,text` header is read as two columns, key then text.
 *
 * @param text The file's contents.
 * @return The rows; later rows with the same key replace earlier ones and are reported.
 */
export function readLocaleCsv (text: string): LocaleFile
{
    const { records, issues } = parseCsvRecords(text);
    const header = records[0]?.fields.map((cell) => cell.trim().toLowerCase()) ?? [];
    const hasHeader = header.includes('key') && header.includes('text');
    const columns = hasHeader ? header : ['key', 'text'];
    if (hasHeader)
    {
        for (const column of header)
        {
            if (column && !(LOCALE_COLUMNS as readonly string[]).includes(column))
            {
                issues.push({ line: records[0].line, severity: 'warning', message: `unknown column "${column}" is ignored` });
            }
        }
    }
    else if (records.length)
    {
        issues.push({ line: records[0].line, severity: 'warning', message: 'no "key,text" header row; reading the first two columns' });
    }
    const index = (name: string) => columns.indexOf(name);
    const rows: LocaleRow[] = [];
    const seen = new Map<string, number>();
    for (const record of hasHeader ? records.slice(1) : records)
    {
        const cell = (name: LocaleColumn) =>
        {
            const at = index(name);
            return at >= 0 ? record.fields[at] : undefined;
        };
        const key = cell('key')?.trim();
        if (!key)
        {
            if (record.fields.some((value) => value.trim())) issues.push({ line: record.line, severity: 'warning', message: 'row without a key is ignored' });
            continue;
        }
        const row: LocaleRow = { key, text: cell('text') ?? '', line: record.line };
        for (const name of ['notes', 'max', 'tags', 'hash'] as const)
        {
            const value = cell(name)?.trim();
            if (value) row[name] = value;
        }
        const previous = seen.get(key);
        if (previous !== undefined)
        {
            issues.push({ line: record.line, severity: 'error', message: `duplicate key "${key}" (first on line ${rows[previous].line}); the later row wins` });
            rows[previous] = row;
            continue;
        }
        seen.set(key, rows.length);
        rows.push(row);
    }
    return { columns, rows, issues };
}

/**
 * @brief Read a locale file into a key → text table.
 * @param text The file's contents, with a `key,text` header.
 * @return The table. Rows without a key are skipped.
 */
export function parseLocaleCsv (text: string): Record<string, string>
{
    const out: Record<string, string> = {};
    for (const row of readLocaleCsv(text).rows) out[row.key] = row.text;
    return out;
}

/**
 * @brief Quote a CSV field if it needs it.
 * @param value Field text.
 */
export function csvField (value: string): string
{
    return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * @brief Write CSV text from rows of fields (LF line ends, trailing newline).
 * @param rows Rows, the header first.
 */
export function writeCsv (rows: readonly (readonly string[])[]): string
{
    return rows.map((row) => row.map(csvField).join(',')).join('\n') + '\n';
}

/**
 * @brief Write a locale file.
 * @param rows Rows to write, in order.
 * @param columns Columns to write. Default: `key`, `text`, and every optional column some row uses.
 * @return CSV text.
 */
export function writeLocaleCsv (rows: readonly Omit<LocaleRow, 'line'>[], columns?: readonly LocaleColumn[]): string
{
    const used = columns ?? LOCALE_COLUMNS.filter((column) => column === 'key' || column === 'text' || rows.some((row) => row[column]));
    return writeCsv([used, ...rows.map((row) => used.map((column) => row[column] ?? ''))]);
}

/**
 * @brief Read a `tags` cell: `gender=f; article=la; elision` → `{ gender: 'f', article: 'la', elision: 'true' }`.
 * @param cell The cell text.
 * @return The tags. A tag without `=` has the value `"true"`.
 */
export function parseTags (cell: string | undefined): Record<string, string>
{
    const tags: Record<string, string> = {};
    for (const part of (cell ?? '').split(/[;|]/))
    {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) tags[trimmed] = 'true';
        else tags[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return tags;
}

/**
 * @brief Write tags back as a `tags` cell.
 * @param tags Tags.
 */
export function formatTags (tags: Readonly<Record<string, string>>): string
{
    return Object.entries(tags).map(([name, value]) => (value === 'true' ? name : `${name}=${value}`)).join('; ');
}

/**
 * @brief Short hash of a text (FNV-1a, 32 bits, 8 hex digits), for the `hash` column.
 *
 * Line ends are normalised first, so the hash does not change when a file is
 * saved with Windows line ends.
 *
 * @param text English text.
 */
export function textHash (text: string): string
{
    let hash = 0x811c9dc5;
    const normalised = text.replace(/\r\n?/g, '\n');
    for (let i = 0; i < normalised.length; i++)
    {
        hash ^= normalised.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/** @brief A parsed `max` cell. */
export interface TextLimit
{
    /** Longest line in pixels of the UI font. */
    width?: number;
    /** Most characters (code points). */
    chars?: number;
    /** Most lines after wrapping at `width`. */
    lines?: number;
}

/**
 * @brief Read a `max` cell: `120px` (width), `12` (characters), `2x120px` (lines × width).
 * @param cell The cell.
 * @return The limit, or `null` if the cell is empty or not understood.
 */
export function parseLimit (cell: string | undefined): TextLimit | null
{
    const value = cell?.trim().toLowerCase();
    if (!value) return null;
    let match = /^(\d+)\s*x\s*(\d+)\s*px$/.exec(value);
    if (match) return { lines: Number(match[1]), width: Number(match[2]) };
    match = /^(\d+)\s*px$/.exec(value);
    if (match) return { width: Number(match[1]), lines: 1 };
    match = /^(\d+)\s*(chars?)?$/.exec(value);
    if (match) return { chars: Number(match[1]) };
    return null;
}
