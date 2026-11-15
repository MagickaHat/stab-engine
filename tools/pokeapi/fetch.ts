/**
 * @file fetch.ts
 * @brief Loads PokeAPI CSV files from GitHub (with a local cache) or a local folder.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { CACHE_DIR, POKEAPI_CSV_PATH, POKEAPI_REPO } from './config.ts';
import { parseCsv } from './csv.ts';
import type { Row } from './csv.ts';

/** @brief Where CSV files come from. */
export interface CsvSource
{
    /** Git ref to download (branch, tag or commit). */
    ref: string;
    /** Read from this local folder instead of downloading (e.g. a clone of PokeAPI). */
    localDir?: string;
    /** Ignore the cache and download again. */
    refresh?: boolean;
}

/**
 * @brief Loads and caches CSV tables by name.
 */
export class CsvLoader
{
    private readonly source: CsvSource;
    private readonly tables = new Map<string, Row[]>();

    /**
     * @brief Create a loader.
     * @param source Where to read files from.
     */
    constructor (source: CsvSource)
    {
        this.source = source;
    }

    /** @brief Folder downloaded files are cached in. */
    get cacheDir (): string
    {
        return path.join(CACHE_DIR, this.source.ref.replace(/[^\w.-]/g, '_'));
    }

    /**
     * @brief Get the text of one CSV file, downloading it if needed.
     * @param name Table name without extension, e.g. `'pokemon_species'`.
     * @return File contents.
     */
    private async text (name: string): Promise<string>
    {
        if (this.source.localDir)
        {
            return fs.readFileSync(path.join(this.source.localDir, `${name}.csv`), 'utf-8');
        }
        const cached = path.join(this.cacheDir, `${name}.csv`);
        if (!this.source.refresh && fs.existsSync(cached)) return fs.readFileSync(cached, 'utf-8');

        const url = `https://raw.githubusercontent.com/${POKEAPI_REPO}/${this.source.ref}/${POKEAPI_CSV_PATH}/${name}.csv`;
        let lastError: unknown;
        for (let attempt = 0; attempt < 4; attempt++)
        {
            try
            {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
                const body = await response.text();
                fs.mkdirSync(this.cacheDir, { recursive: true });
                fs.writeFileSync(cached, body);
                return body;
            }
            catch (error)
            {
                lastError = error;
                await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
            }
        }
        throw new Error(`Could not download ${name}.csv: ${String(lastError)}`);
    }

    /**
     * @brief Load several tables at once (downloads run in parallel).
     * @param names Table names.
     */
    async preload (names: string[]): Promise<void>
    {
        const queue = names.filter((n) => !this.tables.has(n));
        const workers = Array.from({ length: 6 }, async () =>
        {
            for (let name = queue.shift(); name; name = queue.shift())
            {
                this.tables.set(name, parseCsv(await this.text(name)));
            }
        });
        await Promise.all(workers);
    }

    /**
     * @brief Get a table that was loaded with `preload()`.
     * @param name Table name.
     * @return Its rows.
     * @throws Error if the table was not preloaded.
     */
    get (name: string): Row[]
    {
        const rows = this.tables.get(name);
        if (!rows) throw new Error(`CSV table "${name}" was not preloaded`);
        return rows;
    }

    /**
     * @brief Index a table by its `id` column (or another column).
     * @param name Table name.
     * @param column Column to index by.
     * @return Map of column value → row.
     */
    byId (name: string, column = 'id'): Map<string, Row>
    {
        return new Map(this.get(name).map((row) => [row[column], row]));
    }
}

/**
 * @brief Resolve a branch or tag to its commit SHA, for reproducible imports.
 *
 * Tries the GitHub API, then `git ls-remote`.
 * @param ref Ref to resolve.
 * @return Commit SHA, or `null` if GitHub could not be reached.
 */
export async function resolveCommit (ref: string): Promise<string | null>
{
    if (/^[0-9a-f]{40}$/.test(ref)) return ref;
    for (let attempt = 0; attempt < 3; attempt++)
    {
        try
        {
            const response = await fetch(`https://api.github.com/repos/${POKEAPI_REPO}/commits/${ref}`, {
                headers: { Accept: 'application/vnd.github.sha' },
            });
            const sha = response.ok ? (await response.text()).trim() : '';
            if (/^[0-9a-f]{40}$/.test(sha)) return sha;
        }
        catch
        {
            // Retry below.
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
    // Fallback (GitHub API rate limits, restricted networks): ask git directly.
    try
    {
        const { stdout } = await promisify(execFile)('git', ['ls-remote', `https://github.com/${POKEAPI_REPO}.git`, ref], { timeout: 30000 });
        const lines = stdout.trim().split('\n').filter(Boolean);
        const line = lines.find((l) => l.endsWith('^{}')) ?? lines[0];
        const sha = line?.split(/\s+/)[0];
        return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
    }
    catch
    {
        return null;
    }
}

/** @brief Every CSV table the importer reads. */
export const CSV_TABLES = [
    'languages', 'generations', 'version_groups', 'versions', 'stats', 'types', 'type_names', 'type_efficacy',
    'pokemon', 'pokemon_species', 'pokemon_species_names', 'pokemon_species_flavor_text', 'pokemon_forms',
    'pokemon_form_names', 'pokemon_stats', 'pokemon_types', 'pokemon_abilities', 'pokemon_egg_groups',
    'egg_groups', 'pokemon_colors', 'pokemon_shapes', 'pokemon_habitats', 'growth_rates', 'pokemon_evolution',
    'evolution_triggers', 'locations', 'genders',
    'moves', 'move_names', 'move_meta', 'move_meta_ailments', 'move_meta_categories', 'move_meta_stat_changes',
    'move_flag_map', 'move_flags', 'move_targets', 'move_damage_classes', 'move_effect_prose', 'move_flavor_text',
    'abilities', 'ability_names', 'ability_prose', 'ability_flavor_text',
    'items', 'item_names', 'item_prose', 'item_flavor_text', 'item_categories', 'item_pockets', 'item_flag_map',
    'item_flags', 'item_fling_effects', 'item_game_indices', 'berries', 'machines',
    'natures', 'nature_names',
    'pokemon_moves', 'pokemon_move_methods',
];
