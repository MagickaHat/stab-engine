/**
 * @file io.ts
 * @brief Reading and writing PBS JSON files from Node tools.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TABLES, TABLE_NAMES } from '../../src/data/tables.ts';
import type { TableName } from '../../src/data/tables.ts';
import { composePatches, mergeTable, orderCustomFiles } from '../../src/data/merge.ts';
import type { Json } from '../../src/data/merge.ts';

/**
 * @brief Serialize JSON on a single line with spaces after `:` and `,`.
 * @param value Value.
 * @return JSON text, e.g. `{ "hp": 45, "atk": 49 }`.
 */
function formatInline (value: unknown): string
{
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(formatInline).join(', ')}]`;
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return '{}';
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${formatInline(v)}`).join(', ')} }`;
}

/**
 * @brief Serialize JSON readably but compactly: one entry per line at the top
 *        levels, short arrays/objects kept on one line. Keeps diffs small and
 *        files a fraction of the size of fully indented JSON.
 * @param value Value to write.
 * @param indent Current indentation.
 * @return JSON text.
 */
export function formatJson (value: unknown, indent = ''): string
{
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    const inline = formatInline(value);
    if (indent.length >= 12 || inline.length <= 100 - indent.length) return inline;

    const next = `${indent}    `;
    if (Array.isArray(value))
    {
        return `[\n${value.map((v) => next + formatJson(v, next)).join(',\n')}\n${indent}]`;
    }
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([k, v]) => `${next}${JSON.stringify(k)}: ${formatJson(v, next)}`).join(',\n')}\n${indent}}`;
}

/**
 * @brief Write a JSON file (creating folders), ending with a newline.
 * @param file Path.
 * @param value Data.
 */
export function writeJson (file: string, value: unknown): void
{
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${formatJson(value)}\n`);
}

/**
 * @brief Read a JSON file.
 * @param file Path.
 * @return Parsed data, or `undefined` if the file does not exist.
 * @throws Error with the file name if the JSON is invalid.
 */
export function readJson (file: string): Json | undefined
{
    if (!fs.existsSync(file)) return undefined;
    try
    {
        return JSON.parse(fs.readFileSync(file, 'utf-8')) as Json;
    }
    catch (error)
    {
        throw new Error(`${path.relative(process.cwd(), file)}: ${(error as Error).message}`);
    }
}

/**
 * @brief Read every table from a folder.
 * @param dir `content/pbs/generated` or `content/pbs/custom`.
 * @return Tables found, keyed by table name.
 */
export function readTables (dir: string): Partial<Record<TableName, Record<string, Json>>>
{
    const out: Partial<Record<TableName, Record<string, Json>>> = {};
    for (const name of TABLE_NAMES)
    {
        const data = readJson(path.join(dir, TABLES[name].file));
        if (data !== undefined) out[name] = data as Record<string, Json>;
    }
    return out;
}

/** @brief Tables keyed by table name. */
export type Tables = Partial<Record<TableName, Record<string, Json>>>;

/** @brief One custom layer: a pack folder, or the top-level custom files (`pack: null`). */
export interface CustomLayer
{
    pack: string | null;
    tables: Tables;
}

/**
 * @brief Read every enabled custom layer, in the order they apply
 *        (see "Content packs" in `src/data/merge.ts`).
 * @param dir `content/pbs/custom`.
 * @return Layers.
 */
export function readCustomLayers (dir: string): CustomLayer[]
{
    if (!fs.existsSync(dir)) return [];
    const files = (fs.readdirSync(dir, { recursive: true }) as string[])
        .map((f) => f.split(path.sep).join('/'))
        .filter((f) => f.endsWith('.json'));
    const layers: CustomLayer[] = [];
    for (const file of orderCustomFiles(files))
    {
        const name = TABLE_NAMES.find((n) => file === TABLES[n].file || file.endsWith(`/${TABLES[n].file}`));
        if (!name) continue;
        const pack = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : null;
        let layer = layers.at(-1);
        if (!layer || layer.pack !== pack) layers.push(layer = { pack, tables: {} });
        layer.tables[name] = readJson(path.join(dir, file)) as Record<string, Json>;
    }
    return layers;
}

/**
 * @brief Combine all custom layers into one patch per table (for the Showdown bridge).
 * @param layers Custom layers.
 * @return Combined patches.
 */
export function composeLayers (layers: CustomLayer[]): Tables
{
    const out: Tables = {};
    for (const name of TABLE_NAMES)
    {
        const patches = layers.map((l) => l.tables[name]).filter((t) => t !== undefined);
        if (patches.length) out[name] = composePatches(...patches) as Record<string, Json>;
    }
    return out;
}

/**
 * @brief Apply custom layers onto generated tables (see `src/data/merge.ts`).
 * @param generated Generated tables.
 * @param layers Custom layers, in order.
 * @return Merged tables.
 */
export function mergeTables (generated: Tables, layers: CustomLayer[]): Tables
{
    const out: Tables = {};
    for (const name of TABLE_NAMES)
    {
        const patches = layers.map((l) => l.tables[name]).filter((t) => t !== undefined);
        if (generated[name] === undefined && !patches.length) continue;
        out[name] = mergeTable(generated[name] ?? {}, ...patches);
    }
    return out;
}
