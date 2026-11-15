/**
 * @file csv.ts
 * @brief Minimal RFC 4180 CSV parser for the PokeAPI dump.
 *
 * Handles quoted fields with commas, doubled quotes and line breaks (the
 * prose and flavor-text tables use all three).
 */

/** @brief One CSV row: column name → raw string value (`''` for empty). */
export type Row = Record<string, string>;

/**
 * @brief Parse CSV text into rows, using the first line as the header.
 * @param text CSV file contents.
 * @return Array of rows.
 */
export function parseCsv (text: string): Row[]
{
    const records: string[][] = [];
    let record: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++)
    {
        const c = text[i];
        if (inQuotes)
        {
            if (c === '"')
            {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            }
            else field += c;
        }
        else if (c === '"') inQuotes = true;
        else if (c === ',') { record.push(field); field = ''; }
        else if (c === '\n' || c === '\r')
        {
            if (c === '\r' && text[i + 1] === '\n') i++;
            record.push(field);
            records.push(record);
            record = [];
            field = '';
        }
        else field += c;
    }
    if (field !== '' || record.length > 0)
    {
        record.push(field);
        records.push(record);
    }

    const [header, ...body] = records;
    if (!header) return [];
    return body
        .filter((r) => !(r.length === 1 && r[0] === ''))
        .map((r) =>
        {
            const row: Row = {};
            header.forEach((name, i) => { row[name] = r[i] ?? ''; });
            return row;
        });
}

/**
 * @brief Read an integer column.
 * @param value Raw CSV value.
 * @return The number, or `null` if empty.
 */
export function int (value: string | undefined): number | null
{
    if (value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * @brief Read a 0/1 boolean column.
 * @param value Raw CSV value.
 * @return `true` for `"1"`.
 */
export function bool (value: string | undefined): boolean
{
    return value === '1';
}
