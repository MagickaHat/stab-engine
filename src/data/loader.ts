/**
 * @file loader.ts
 * @brief Loads PBS game data in the game (Vite): generated + custom layers,
 *        merged and (in development) validated.
 *
 * Each table is a separate lazily loaded chunk, so e.g. the 4 MB learnsets
 * file is only downloaded if you ask for it.
 *
 * @code
 * import { loadPbs, registerStabMod } from '../data';
 *
 * const { pokedex, moves } = await loadPbs(['pokedex', 'moves']);
 * console.log(pokedex.pikachu.baseStats.spe);
 *
 * // Battles that use your custom species/moves:
 * const dex = await registerStabMod();
 * const engine = new BattleEngine({ dex, formatid: 'gen9stabcustomgame', p1, p2 });
 * @endcode
 */
import { checkData } from './integrity.ts';
import { composePatches, mergeTable, orderCustomFiles } from './merge.ts';
import type { Json } from './merge.ts';
import { registerMod } from './showdown.ts';
import type { RawTables, ShowdownModOptions } from './showdown.ts';
import { TABLES, TABLE_NAMES } from './tables.ts';
import type { LocaleCategory, PbsData, TableName } from './tables.ts';
import type { ModdedDex } from '@pkmn/sim';

type JsonTable = Record<string, Json>;

/** @brief Lazy imports of every generated/custom JSON file, keyed by file path. */
const GENERATED = import.meta.glob<JsonTable>('../../content/pbs/generated/*.json', { import: 'default' });
const CUSTOM = import.meta.glob<JsonTable>('../../content/pbs/custom/**/*.json', { import: 'default' });
const CUSTOM_ROOT = '../../content/pbs/custom/';
const LOCALES = import.meta.glob<Record<string, string>>('../../content/pbs/generated/locales/*/*.json', { import: 'default' });

/**
 * @brief Find and load a file from a glob by file name.
 * @param files Glob result.
 * @param file File name, e.g. `pokedex.json`.
 * @return The data, or `undefined` if there is no such file.
 */
async function loadFile<T> (files: Record<string, () => Promise<T>>, file: string): Promise<T | undefined>
{
    const entry = Object.entries(files).find(([path]) => path.endsWith(`/${file}`));
    return entry ? entry[1]() : undefined;
}

/**
 * @brief Custom files for one table, in layer order (packs, then top-level files).
 * @param file Table file name, e.g. `pokedex.json`.
 * @return Loader functions in the order their patches apply.
 */
function customLayers (file: string): (() => Promise<JsonTable>)[]
{
    const relative = Object.keys(CUSTOM).map((p) => p.slice(CUSTOM_ROOT.length))
        .filter((p) => p === file || p.endsWith(`/${file}`));
    return orderCustomFiles(relative).map((p) => CUSTOM[CUSTOM_ROOT + p]);
}

/** @brief Loaded tables (combined custom patch + merged result), cached per table. */
const cache = new Map<TableName, Promise<{ custom?: JsonTable; merged: JsonTable }>>();

/**
 * @brief Load one table: generated data with every enabled custom layer applied.
 * @param name Table name.
 * @return Combined custom patch (`undefined` if none) and merged table.
 */
function loadTable (name: TableName): Promise<{ custom?: JsonTable; merged: JsonTable }>
{
    let promise = cache.get(name);
    if (!promise)
    {
        promise = (async () =>
        {
            const [generated, ...layers] = await Promise.all([
                loadFile(GENERATED, TABLES[name].file),
                ...customLayers(TABLES[name].file).map((load) => load()),
            ]);
            return {
                custom: layers.length ? composePatches(...layers) as JsonTable : undefined,
                merged: mergeTable(generated ?? {}, ...layers),
            };
        })();
        promise.catch(() => cache.delete(name));
        cache.set(name, promise);
    }
    return promise;
}

/** @brief Options for `loadPbs()`. */
export interface LoadOptions
{
    /**
     * Validate with Zod and check cross-table references. Default: on in
     * `npm run dev`, off in production builds (the data was already checked
     * by `npm run pbs:validate`).
     */
    validate?: boolean;
}

/**
 * @brief Load game data tables (generated data with custom overrides applied).
 * @param tables Tables to load. Default: all.
 * @param options Loading options.
 * @return The requested tables.
 * @throws Error listing every problem if validation is on and fails.
 */
export async function loadPbs<K extends TableName = TableName> (tables?: K[], options: LoadOptions = {}): Promise<Pick<PbsData, K>>
{
    const names = (tables ?? TABLE_NAMES) as K[];
    const loaded = await Promise.all(names.map((name) => loadTable(name)));
    const raw: Partial<Record<TableName, JsonTable>> = {};
    names.forEach((name, i) => { raw[name] = loaded[i].merged; });

    if (options.validate ?? import.meta.env.DEV)
    {
        const { errors, warnings } = checkData(raw);
        for (const warning of warnings.slice(0, 20)) console.warn(`[pbs] ${warning}`);
        if (errors.length) throw new Error(`[pbs] Game data is invalid:\n${errors.join('\n')}`);
    }
    return raw as unknown as Pick<PbsData, K>;
}

/**
 * @brief Register `content/pbs/custom` with the battle simulator as the `stab` mod.
 *
 * See `src/data/showdown.ts` for how custom data is turned into a Showdown mod.
 *
 * @param options Mod settings (ID, parent mod, formats).
 * @return The modded Dex for `BattleEngine({ dex, formatid: 'gen9stabcustomgame' })`.
 */
export async function registerStabMod (options: ShowdownModOptions = {}): Promise<ModdedDex>
{
    const names = TABLE_NAMES.filter((name) => TABLES[name].showdown);
    const loaded = await Promise.all(names.map((name) => loadTable(name)));
    const custom: RawTables = {};
    const merged: RawTables = {};
    names.forEach((name, i) =>
    {
        if (loaded[i].custom) custom[name] = loaded[i].custom;
        merged[name] = loaded[i].merged;
    });
    if (options.id === undefined || options.id === 'stab')
    {
        const { errors } = checkData(merged);
        if (errors.length) throw new Error(`[pbs] Custom data is invalid:\n${errors.join('\n')}`);
    }
    return registerMod(custom, merged, options);
}

/**
 * @brief Load the text PokeAPI provides for one locale and category.
 *
 * Intended as the bottom layer of a future localization system; hand-written
 * translations in `content/locales/<category>/<locale>.csv` should override it.
 *
 * @param locale e.g. `'fr'`.
 * @param category e.g. `'moves'`.
 * @return `key → text`, empty if there is no file.
 */
export async function loadGeneratedText (locale: string, category: LocaleCategory): Promise<Record<string, string>>
{
    return (await loadFile(LOCALES, `${locale}/${category}.json`)) ?? {};
}
