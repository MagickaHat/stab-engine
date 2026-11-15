/**
 * @file manifest.ts
 * @brief Writes `manifest.json`: a list of every Pokémon and item asset that
 *        exists, so the game can check for a sprite without a failed request.
 *
 * The manifest is built from the folders themselves, not from the import, so
 * art you add by hand (for example a custom forme's folder) is listed too.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CRIES_DIR, ITEMS_DIR, POKEMON_DIR } from './config.ts';
import { pngSize } from './png.ts';

/** @brief File name → `[width, height]` for PNGs, `0` for other files. */
export type FileList = Record<string, [number, number] | 0>;

/** @brief Assets of one species: its own files plus one entry per forme folder. */
export interface SpeciesAssets
{
    files: FileList;
    formes?: Record<string, FileList>;
}

/** @brief Contents of `manifest.json`. */
export interface AssetManifest
{
    /** Keyed by Showdown species ID (folder name). */
    pokemon: Record<string, SpeciesAssets>;
    /** Keyed by item ID (file name without `.png`). */
    items: Record<string, [number, number] | 0>;
    /** Showdown IDs that have a cry (file name without `.ogg`), sorted. */
    cries: string[];
}

/**
 * @brief Read the first bytes of a file.
 * @param file Path.
 * @param length Number of bytes.
 * @return The bytes read.
 */
function head (file: string, length: number): Buffer
{
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try
    {
        return buffer.subarray(0, fs.readSync(fd, buffer, 0, length, 0));
    }
    finally
    {
        fs.closeSync(fd);
    }
}

/**
 * @brief List the files directly inside a folder.
 * @param dir Folder.
 * @return File name → size.
 */
function listFolder (dir: string): FileList
{
    const files: FileList = {};
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)))
    {
        if (!entry.isFile() || entry.name.startsWith('.')) continue;
        files[entry.name] = entry.name.toLowerCase().endsWith('.png') ? pngSize(head(path.join(dir, entry.name), 24)) ?? 0 : 0;
    }
    return files;
}

/**
 * @brief List the sub-folders of a folder, sorted.
 * @param dir Folder (may be missing).
 * @return Folder names.
 */
function subFolders (dir: string): string[]
{
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/**
 * @brief Scan the asset folders.
 * @param assetsDir Output folder (`public/assets`).
 * @return The manifest.
 */
export function buildManifest (assetsDir: string): AssetManifest
{
    const manifest: AssetManifest = { pokemon: {}, items: {}, cries: [] };
    const pokemonDir = path.join(assetsDir, POKEMON_DIR);
    for (const species of subFolders(pokemonDir))
    {
        const entry: SpeciesAssets = { files: listFolder(path.join(pokemonDir, species)) };
        for (const forme of subFolders(path.join(pokemonDir, species)))
        {
            (entry.formes ??= {})[forme] = listFolder(path.join(pokemonDir, species, forme));
        }
        manifest.pokemon[species] = entry;
    }
    const itemsDir = path.join(assetsDir, ITEMS_DIR);
    if (fs.existsSync(itemsDir))
    {
        for (const [name, size] of Object.entries(listFolder(itemsDir)))
        {
            if (name.toLowerCase().endsWith('.png')) manifest.items[name.slice(0, -4)] = size;
        }
    }
    const criesDir = path.join(assetsDir, CRIES_DIR);
    if (fs.existsSync(criesDir))
    {
        manifest.cries = Object.keys(listFolder(criesDir)).filter((name) => name.toLowerCase().endsWith('.ogg')).map((name) => name.slice(0, -4));
    }
    return manifest;
}

/**
 * @brief Scan the asset folders and write `manifest.json` (one species per line).
 * @param assetsDir Output folder (`public/assets`).
 * @return The manifest that was written.
 */
export function writeManifest (assetsDir: string): AssetManifest
{
    const manifest = buildManifest(assetsDir);
    const lines = (table: Record<string, unknown>) =>
        Object.entries(table).map(([key, value]) => `        ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'manifest.json'), [
        '{',
        `    "$comment": "Written by \`npm run assets:import\`. Lists every file in ${POKEMON_DIR}/, items/ and ${CRIES_DIR}/; PNG sizes are [width, height].",`,
        `    "pokemon": {\n${lines(manifest.pokemon)}\n    },`,
        `    "items": {\n${lines(manifest.items)}\n    },`,
        `    "cries": ${JSON.stringify(manifest.cries)}`,
        '}',
        '',
    ].join('\n'));
    return manifest;
}
