/**
 * @file essentials.ts
 * @brief Reads the parts of a Pokémon Essentials resource pack the asset
 *        importer needs: asset file names and form names from PBS files.
 */
import fs from 'node:fs';
import path from 'node:path';

/** @brief An Essentials asset file name split into its parts. */
export interface AssetName
{
    /** Essentials species ID, e.g. `'CHARIZARD'` or `'NIDORANfE'`. */
    id: string;
    /** Form number (0 when the name has none). */
    form: number;
    /** `true` for `_female` gender-difference sprites. */
    female: boolean;
}

/**
 * @brief Split an Essentials Pokémon asset name: `SPECIES[_form][_female]`.
 * @param stem File name without extension, e.g. `'SNEASEL_1_female'`.
 * @return The parts, or `null` if the name does not follow the pattern
 *         (e.g. `'PIKACHU_faint'`, `'000_cracks'`).
 */
export function parseAssetName (stem: string): AssetName | null
{
    const match = /^([A-Za-z0-9]+?)(?:_(\d+))?(?:_(female))?$/.exec(stem);
    if (!match) return null;
    return { id: match[1], form: Number(match[2] ?? 0), female: Boolean(match[3]) };
}

/**
 * @brief Build the lookup key used for form names and aliases.
 * @param id Essentials species ID.
 * @param form Form number.
 * @return `'CHARIZARD'` for form 0, `'CHARIZARD_1'` otherwise.
 */
export function formKey (id: string, form: number): string
{
    return form ? `${id}_${form}` : id;
}

/**
 * @brief Collect `FormName` values from Essentials PBS text.
 *
 * Reads both `pokemon*.txt` (`[SPECIES]` sections, form 0) and
 * `pokemon_forms*.txt` (`[SPECIES,1]` sections).
 *
 * @param text Contents of one PBS file.
 * @param into Map to add to (`formKey` → form name). Existing entries are kept.
 * @return `into`.
 */
export function parseFormNames (text: string, into = new Map<string, string>()): Map<string, string>
{
    let key: string | null = null;
    for (const line of text.replace(/^﻿/, '').split(/\r?\n/))
    {
        const section = /^\s*\[\s*([A-Za-z0-9]+)\s*(?:,\s*(\d+)\s*)?\]/.exec(line);
        if (section)
        {
            key = formKey(section[1], Number(section[2] ?? 0));
            continue;
        }
        const name = /^\s*FormName\s*=\s*(.+?)\s*$/.exec(line);
        if (name && key && !into.has(key)) into.set(key, name[1]);
    }
    return into;
}

/**
 * @brief List every file under a folder.
 * @param dir Folder (may be missing).
 * @return Paths relative to `dir`, with `/` separators, sorted.
 */
export function listFiles (dir: string): string[]
{
    if (!fs.existsSync(dir)) return [];
    return (fs.readdirSync(dir, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
        .sort();
}

/**
 * @brief Read every form name defined by a pack's PBS files.
 *
 * Packs often ship several copies of the same PBS file (backups, optional
 * variants). Files closest to the pack root are read first and win.
 *
 * @param packDir Pack root folder.
 * @param names Map to add to. Existing entries are kept.
 * @return `formKey` → form name, e.g. `'GROWLITHE_1'` → `'Hisuian'`.
 */
export function readFormNames (packDir: string, names = new Map<string, string>()): Map<string, string>
{
    const files = listFiles(packDir)
        .filter((file) => /(^|\/)pokemon[^/]*\.txt$/i.test(file) && !/metrics/i.test(file))
        .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    for (const file of files) parseFormNames(fs.readFileSync(path.join(packDir, file), 'utf8'), names);
    return names;
}

/**
 * @brief Find a sub-folder by path, ignoring upper/lower case.
 *
 * Packs are made on Windows, where `Back shiny` and `Back Shiny` are the
 * same folder; on Linux they are not.
 *
 * @param root Folder to start from.
 * @param relative Path such as `'Graphics/Pokemon/Back shiny'`.
 * @return The real path, or `null` if there is no such folder.
 */
export function findDir (root: string, relative: string): string | null
{
    let current = root;
    for (const part of relative.split('/'))
    {
        if (!fs.existsSync(current)) return null;
        const match = fs.readdirSync(current, { withFileTypes: true })
            .find((entry) => entry.isDirectory() && entry.name.toLowerCase() === part.toLowerCase());
        if (!match) return null;
        current = path.join(current, match.name);
    }
    return current;
}
