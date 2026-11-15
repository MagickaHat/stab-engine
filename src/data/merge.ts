/**
 * @file merge.ts
 * @brief Layering of `content/pbs/custom` overrides on top of `content/pbs/generated`.
 *
 * Uses **JSON Merge Patch** (RFC 7386) per entry:
 * - an ID that only exists in the custom file is **added**;
 * - an object **patches** the generated entry: nested objects merge,
 *   everything else (numbers, strings, arrays) is replaced;
 * - `null` **removes** a key, or the whole entry when used as the entry value.
 *
 * @code
 * // content/pbs/custom/pokedex.json
 * {
 *   "$schema": "../schemas/pokedex.patch.schema.json",
 *   "pikachu": { "baseStats": { "spe": 120 } },       // patch one stat
 *   "missingno": null,                                // remove an entry
 *   "sparkmouse": { "num": -1, "name": "Sparkmouse", … } // add a new species
 * }
 * @endcode
 *
 * Keys starting with `$` (like `$schema`, `$comment`) are ignored, so files
 * can point editors at a JSON schema for autocompletion.
 *
 * ### Content packs
 * Besides files directly in `content/pbs/custom/`, every sub-folder is a
 * **pack** with the same file names (`custom/my-fakemon/pokedex.json`, …).
 * Packs are applied in alphabetical order, then the top-level custom files
 * last. Prefix a folder with `_` (`custom/_old-pack/`) to disable it, or
 * delete the folder to remove the pack.
 */

/** @brief Any JSON value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * @brief Check for a plain JSON object (not an array or null).
 * @param value Value to test.
 * @return `true` for `{…}`.
 */
export function isPlainObject (value: unknown): value is Record<string, Json>
{
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @brief Apply an RFC 7386 JSON Merge Patch.
 * @param target Original value (not modified).
 * @param patch Patch to apply.
 * @return The patched value (a new object where anything changed).
 */
export function mergePatch (target: Json | undefined, patch: Json): Json
{
    if (!isPlainObject(patch)) return patch;
    const result: Record<string, Json> = isPlainObject(target) ? { ...target } : {};
    for (const [key, value] of Object.entries(patch))
    {
        if (value === null) delete result[key];
        else result[key] = mergePatch(result[key], value);
    }
    return result;
}

/**
 * @brief Remove editor-only keys (`$schema`, `$comment`, …) from a table file.
 * @param table A parsed table file.
 * @return A copy without `$`-prefixed keys.
 */
export function stripMetaKeys<T extends Record<string, unknown>> (table: T): T
{
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(table))
    {
        if (!key.startsWith('$')) out[key] = value;
    }
    return out as T;
}

/**
 * @brief Merge any number of override layers onto a generated table.
 * @param generated The generated table (may be empty).
 * @param layers Custom tables, applied in order (later wins).
 * @return Merged table. Inputs are not modified.
 */
export function mergeTable (generated: Record<string, Json>, ...layers: Record<string, Json>[]): Record<string, Json>
{
    let result: Json = stripMetaKeys(generated);
    for (const layer of layers) result = mergePatch(result, stripMetaKeys(layer));
    return result as Record<string, Json>;
}

/**
 * @brief Sort and filter custom file paths into layer order.
 *
 * Order: packs (sub-folders) alphabetically, then top-level custom files.
 * Folders starting with `_` are disabled.
 *
 * @param paths File paths relative to `content/pbs/custom`, using `/`
 *              (e.g. `pokedex.json`, `my-pack/pokedex.json`).
 * @return Enabled paths in the order they should be applied.
 */
export function orderCustomFiles (paths: string[]): string[]
{
    const enabled = paths.filter((p) => !p.split('/').slice(0, -1).some((dir) => dir.startsWith('_')));
    const packOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null);
    return enabled.sort((a, b) =>
    {
        const pa = packOf(a);
        const pb = packOf(b);
        if (pa === pb) return a.localeCompare(b);
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pa.localeCompare(pb);
    });
}

/**
 * @brief Combine several merge patches into one equivalent patch.
 *
 * Unlike `mergePatch()`, `null` values are kept (they still mean "delete"
 * when the combined patch is applied). Used to hand all custom layers to the
 * Showdown bridge at once.
 *
 * @param patches Patches in the order they would be applied.
 * @return One patch.
 */
export function composePatches (...patches: Json[]): Json
{
    let result: Json = {};
    for (const patch of patches)
    {
        if (!isPlainObject(patch) || !isPlainObject(result))
        {
            result = patch;
            continue;
        }
        const next: Record<string, Json> = { ...result };
        for (const [key, value] of Object.entries(patch))
        {
            next[key] = isPlainObject(value) && isPlainObject(next[key]) ? composePatches(next[key], value) : value;
        }
        result = next;
    }
    return result;
}
