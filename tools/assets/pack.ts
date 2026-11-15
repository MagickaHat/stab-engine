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
     */
    target: 'pokemon' | 'cry' | 'item';
    /** Folder inside the pack, e.g. `'Graphics/Pokemon/Front'` (case is ignored). */
    dir: string;
    /** File extension to pick up, lowercase with the dot, e.g. `'.png'`. */
    ext: string;
    /**
     * Output file name inside the species folder, e.g. `'front{f}.png'`.
     * `{f}` becomes `f` for female gender-difference sprites and is removed
     * otherwise. Only used by `pokemon` rules (`cry` and `item` files are named after their ID).
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
    forms: FormAliases;
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
