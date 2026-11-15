/**
 * @file mods.ts
 * @brief Loads extra Pokémon Showdown data mods from @pkmn/mods.
 *
 * A "mod" swaps in different data or mechanics on top of a base generation.
 * For example `gen7letsgo` gives Let's Go Pikachu/Eevee rules, and `gen3frlg`
 * gives FireRed/LeafGreen data. Each mod is downloaded only when you load it
 * (Vite puts each one in its own file), so unused mods cost nothing.
 *
 * Once loaded, a mod also registers its formats with the simulator, so you
 * can start a battle in e.g. `gen7letsgoou` with `BattleEngine`.
 *
 * @code
 * await loadMod('gen7letsgo');
 * const engine = new BattleEngine({ formatid: 'gen7letsgoou', p1, p2 });
 * @endcode
 */
import { Dex } from '@pkmn/sim';
import type { ID, ModData, ModdedDex } from '@pkmn/sim';

/**
 * @brief Import functions for every mod in @pkmn/mods.
 *
 * Each entry has to be a literal `import('...')` so Vite can find the files
 * at build time and split each mod into its own chunk.
 */
const MOD_LOADERS = {
    gen1jpn: () => import('@pkmn/mods/gen1jpn'),
    gen1stadium: () => import('@pkmn/mods/gen1stadium'),
    gen2stadium2: () => import('@pkmn/mods/gen2stadium2'),
    gen3frlg: () => import('@pkmn/mods/gen3frlg'),
    gen3rs: () => import('@pkmn/mods/gen3rs'),
    gen4pt: () => import('@pkmn/mods/gen4pt'),
    gen5bw1: () => import('@pkmn/mods/gen5bw1'),
    gen6xy: () => import('@pkmn/mods/gen6xy'),
    gen7sm: () => import('@pkmn/mods/gen7sm'),
    gen7letsgo: () => import('@pkmn/mods/gen7letsgo'),
    gen8dlc1: () => import('@pkmn/mods/gen8dlc1'),
    gen9dlc1: () => import('@pkmn/mods/gen9dlc1'),
    gen9predlc: () => import('@pkmn/mods/gen9predlc'),
    champions: () => import('@pkmn/mods/champions'),
    championsregmb: () => import('@pkmn/mods/championsregmb'),
} as const;

/** @brief Name of a mod that `loadMod()` can load. */
export type ModID = keyof typeof MOD_LOADERS;

/** @brief Every mod name, e.g. for a debug menu. */
export const MOD_IDS = Object.keys(MOD_LOADERS) as ModID[];

/** @brief Mods built on another (non-generation) mod, which must be loaded first. */
const MOD_PARENTS: Partial<Record<ModID, ModID>> = {
    gen9predlc: 'gen9dlc1',
    championsregmb: 'champions',
};

/** @brief Mods already loaded (or loading), so each is only loaded once. */
const loaded = new Map<ModID, Promise<ModdedDex>>();

/**
 * @brief Load a mod and register it (and its formats) with the simulator.
 *
 * Safe to call more than once; later calls return the same result. Parent
 * mods (see `MOD_PARENTS`) are loaded automatically.
 *
 * @param id Mod name, e.g. `'gen7letsgo'`.
 * @return The modded Dex, for looking up that mod's Pokémon/moves/items.
 */
export function loadMod (id: ModID): Promise<ModdedDex>
{
    let promise = loaded.get(id);
    if (!promise)
    {
        promise = (async () =>
        {
            const parent = MOD_PARENTS[id];
            if (parent) await loadMod(parent);
            const module = await MOD_LOADERS[id]();
            //  Copy into a plain object: Dex.mod() adds fields to the data, but an
            //  imported module object is read-only in browsers.
            //  @pkmn/mods and @pkmn/sim type their data differently; the cast is safe.
            const data = { ...module } as unknown as ModData;
            return Dex.mod(id as ID, data);
        })();
        // Allow retrying if loading fails (e.g. network error).
        promise.catch(() => loaded.delete(id));
        loaded.set(id, promise);
    }
    return promise;
}

/**
 * @brief Check whether a mod has finished loading.
 * @param id Mod name.
 * @return `true` once `loadMod(id)` has been called (it may still be in progress).
 */
export function isModLoaded (id: ModID): boolean
{
    return loaded.has(id);
}
