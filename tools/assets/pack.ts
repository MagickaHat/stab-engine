/**
 * @file pack.ts
 * @brief What a resource pack definition looks like. Add a file in `packs/`
 *        to teach the importer a new pack layout.
 */
import type { ImageOp } from './image.ts';
import type { FormAliases } from './resolve.ts';

/** @brief One folder of a pack and what to do with its files. */
export interface Rule
{
    /** Short label used in reports and with `--only`, e.g. `'front'`. */
    kind: string;
    /**
     * Where the files go:
     * - `pokemon`: into the species folder, `img/pokemon/<species>[/<forme>]/<output>`.
     * - `cry`: into the flat cries folder, named with the full Showdown ID:
     *   `sound/se/cries/<species><forme>.ogg` (e.g. `charizardmegax.ogg`).
     * - `item`: into `items/`, named with the item ID.
     * - `tree`: the whole folder, sub-folders included, into the `output`
     *   folder. Every folder and file name is renamed with `rename`, so
     *   `Graphics/UI/Town Map/mapPlayer000.png` becomes `img/ui/town_map/mapplayer000.png`.
     *   Each file's kind (for reports and `--only`) is its first folder,
     *   e.g. `ui`; `--only <rule kind>` still selects the whole rule.
     */
    target: 'pokemon' | 'cry' | 'item' | 'tree';
    /** Folder inside the pack, e.g. `'Graphics/Pokemon/Front'` (case is ignored). */
    dir: string;
    /** File extension to pick up, lowercase with the dot, e.g. `'.png'`. */
    ext: string;
    /**
     * `tree` rules only: more extensions to pick up besides `ext`, e.g.
     * `['.bmp']`. Images (`.png`, `.bmp`) are always written as `.png`;
     * other files are copied unchanged.
     */
    extraExts?: string[];
    /**
     * Output file name inside the species folder, e.g. `'front{f}.png'`.
     * `{f}` becomes `f` for female gender-difference sprites and is removed
     * otherwise. Only used by `pokemon` rules (`cry` and `item` files are named after their ID).
     *
     * For `tree` rules: the folder (inside the output folder) the tree is
     * copied into, e.g. `'img'`.
     */
    output?: string;
    /** How to resize images. Leave out to copy the file as it is (audio, or art already at 1×). */
    image?: ImageOp;
}

/** @brief Everything the importer needs to know about one kind of pack. */
export interface PackDefinition
{
    /** Name used with `--format` and for the credits file. */
    name: string;
    /** Path of the pack's credits file, copied next to the imported assets. */
    credits?: string;
    /** Folders to import. */
    rules: Rule[];
    /** Species/form names the resolver cannot work out by itself. */
    forms?: FormAliases;
    /**
     * Paths (from the pack root) that `tree` rules leave out: a folder leaves
     * out everything in it. Upper/lower case and spaces vs underscores are
     * ignored, and `*` matches any part of one name, e.g.
     * `'Graphics/Characters/Followers*'`. The CLI's `--exclude` adds more.
     */
    exclude?: string[];
    /**
     * @brief Rename one folder or file name (without extension) copied by a `tree` rule.
     * @param name Original name, e.g. `'Town Map'`.
     * @return New name, or `null` to skip the file. Default: `assetName()`.
     */
    rename?: (name: string) => string | null;
    /** Pokémon file names (without extension) to leave out, e.g. stray duplicates in the pack. */
    ignore?: RegExp[];
    /**
     * @brief Name an item file.
     * @param stem File name without extension, e.g. `'machine_FIRE'`.
     * @return Output name without extension, or `null` to skip the file.
     *         Return `undefined` to use the Showdown ID of `stem`.
     */
    item?: (stem: string) => string | null | undefined;
}
