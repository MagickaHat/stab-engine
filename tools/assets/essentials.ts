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

/**
 * @brief Default engine name for a folder or file copied from a pack:
 *        lower case, accents and apostrophes removed, every run of other characters turned
 *        into one `_`. Matches the engine's asset names (`front_shiny`, `tm_fire`).
 * @param name Original name without extension, e.g. `'Town Map'`, `'trainer_POKEMONTRAINER_Red'`, `"PRSFX- King's Shield1"`.
 * @return `'town_map'`, `'trainer_pokemontrainer_red'`, `'prsfx_kings_shield1'`. A name made only of
 *         symbols is spelled out (`'!'` → `'exclamation'`); `null` for an empty name.
 */
export function assetName (name: string): string | null
{
    const id = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/['\u2019]/g, '') // King's Shield → kings_shield
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (id || !name.trim()) return id || null;
    // Only symbols (Essentials' `!.png` emote sheet): spell them out.
    return [...name.trim()].map((c) => SYMBOL_NAMES[c] ?? `u${c.codePointAt(0)!.toString(16)}`).join('_');
}

/** @brief Words for symbols in file names that have no letters or digits at all. */
const SYMBOL_NAMES: Record<string, string> = {
    '!': 'exclamation', '?': 'question', '.': 'dot', '#': 'hash', '+': 'plus', '-': 'minus', '&': 'and',
    '@': 'at', '%': 'percent', '*': 'star', '$': 'dollar', '~': 'tilde', '=': 'equals', ' ': 'space', '_': 'underscore',
};

/**
 * @brief Comparison form of one path part: lower case, spaces and `_` treated alike.
 * @param part Folder or file name.
 * @return Normalised name.
 */
function pathKey (part: string): string
{
    return part.toLowerCase().replace(/[\s_]+/g, '_');
}

/**
 * @brief Check a path against exclusion patterns.
 *
 * A pattern matches the path itself or any folder above it, so
 * `'Graphics/UI/Debug'` leaves out everything in that folder. Upper/lower
 * case and spaces vs `_` are ignored, `*` matches any run of characters
 * within one name, and the last part may leave out the file extension.
 *
 * @param relPath Path from the pack root with `/`, e.g. `'Graphics/UI/Debug/icon.png'`.
 * @param patterns Patterns, e.g. `['Graphics/UI/Debug', 'Graphics/Characters/Followers*']`.
 * @return The first matching pattern, or `null`.
 */
export function excludedBy (relPath: string, patterns: readonly string[]): string | null
{
    const parts = relPath.split('/').map(pathKey);
    for (const pattern of patterns)
    {
        const want = pattern.replace(/\\/g, '/').split('/').filter(Boolean).map(pathKey);
        if (!want.length || want.length > parts.length) continue;
        const matches = want.every((part, i) =>
        {
            const regex = new RegExp(`^${part.split('*').map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
            const name = parts[i];
            const isFile = i === parts.length - 1;
            return regex.test(name) || (isFile && regex.test(name.replace(/\.[^.]*$/, '')));
        });
        if (matches) return pattern;
    }
    return null;
}
