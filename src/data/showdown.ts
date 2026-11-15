/**
 * @file showdown.ts
 * @brief Bridge from PBS data to the Pokémon Showdown simulator (`@pkmn/sim`).
 *
 * Builds a Showdown **mod** from your `content/pbs/custom` layer and registers
 * it with `Dex.mod()`, the same mechanism `loadMod()` uses for official mods.
 *
 * Only custom entries are sent to the simulator. The generated PokeAPI data
 * describes the official games, which the simulator already has, *with* the
 * code (move/ability/item callbacks) that PokeAPI cannot provide:
 * - an entry that patches an existing ID is sent as `{ inherit: true, …changed fields }`,
 *   so Showdown keeps its callbacks and only the fields you changed differ;
 * - a brand-new ID is sent whole (from the merged data);
 * - `null` (removed) is sent as `null`, which removes it from the mod.
 *
 * This file has no Vite-specific code, so Node tools and tests can use it
 * directly. Game code normally calls `registerStabMod()` from `src/data`.
 */
import { Dex } from '@pkmn/sim';
import type { ID, ModData, ModdedDex } from '@pkmn/sim';
import { isPlainObject, stripMetaKeys } from './merge.ts';
import type { Json } from './merge.ts';
import { TABLES, TABLE_NAMES } from './tables.ts';
import type { TableName } from './tables.ts';

/** @brief Options for `buildModData()` / `registerMod()`. */
export interface ShowdownModOptions
{
    /** Mod ID. Default `'stab'`. */
    id?: string;
    /** Parent mod the data builds on. Default `'gen9'`. */
    inherit?: string;
    /**
     * Formats to register with the mod. Default: one `[Gen 9] STAB Custom Game`
     * (`gen9stabcustomgame`) format with the same rules as `gen9customgame`.
     */
    formats?: Record<string, unknown>[];
}

/** @brief Raw tables keyed by table name. */
export type RawTables = Partial<Record<TableName, Record<string, Json>>>;

/**
 * @brief Default format(s) registered with the mod.
 * @param modId Mod ID.
 * @return Showdown format definitions.
 */
export function defaultFormats (modId: string): Record<string, unknown>[]
{
    return [{
        name: `[Gen 9] ${modId.toUpperCase()} Custom Game`,
        mod: modId,
        ruleset: ['Team Preview', 'Cancel Mod', 'Max Team Size = 24', 'Max Move Count = 24', 'Max Level = 9999', 'Default Level = 100'],
        debug: true,
    }];
}

/**
 * @brief Build Showdown `ModData` from the custom layer.
 * @param custom Tables from `content/pbs/custom` (the patches, as written).
 * @param merged The same tables after merging with generated data.
 * @param options Mod settings.
 * @return Data for `Dex.mod()`.
 */
export function buildModData (custom: RawTables, merged: RawTables, options: ShowdownModOptions = {}): ModData
{
    const id = options.id ?? 'stab';
    const parent = Dex.mod((options.inherit ?? 'gen9') as ID);
    const parentGen = parent.gen;
    const modData: Record<string, unknown> = {
        Scripts: { inherit: options.inherit ?? 'gen9', gen: parentGen },
        Formats: options.formats ?? defaultFormats(id),
    };

    for (const name of TABLE_NAMES)
    {
        const key = TABLES[name].showdown;
        const patches = custom[name];
        if (!key || !patches) continue;
        const parentData = parent.data[key] as Record<string, unknown>;
        const out: Record<string, unknown> = {};

        for (const [entryId, patch] of Object.entries(stripMetaKeys(patches)))
        {
            if (patch === null)
            {
                out[entryId] = null;
                continue;
            }
            const full = merged[name]?.[entryId];
            if (!isPlainObject(full)) continue;
            if (entryId in parentData && isPlainObject(patch))
            {
                // Showdown's inherit is shallow: send complete values for every top-level field touched.
                const changed: Record<string, Json> = {};
                for (const field of Object.keys(patch)) if (field in full) changed[field] = full[field];
                out[entryId] = { inherit: true, ...changed };
            }
            else
            {
                out[entryId] = { ...full };
            }
        }
        modData[key] = out;
    }
    return modData as unknown as ModData;
}

/**
 * @brief Build and register the mod with the simulator.
 *
 * Calling it again replaces the mod (e.g. after editing custom data in dev).
 *
 * @param custom Custom tables.
 * @param merged Merged tables.
 * @param options Mod settings.
 * @return The modded Dex; pass it to `new BattleEngine({ dex, formatid: 'gen9stabcustomgame', … })`.
 */
export function registerMod (custom: RawTables, merged: RawTables, options: ShowdownModOptions = {}): ModdedDex
{
    const data = buildModData(custom, merged, options);
    return Dex.mod((options.id ?? 'stab') as ID, data);
}
