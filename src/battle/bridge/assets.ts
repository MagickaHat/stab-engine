/**
 * @file assets.ts
 * @brief Finds the sprite and cry files of a Pokémon in `public/assets`.
 *
 * The asset importer (`npm run assets:import`) names everything with Showdown
 * IDs and lists what exists in `public/assets/manifest.json`. These helpers
 * read that list, so the game only asks for files that are really there:
 *
 * @code
 * img/pokemon/<species>/<file>            base forme,  e.g. img/pokemon/charizard/front.png
 * img/pokemon/<species>/<forme>/<file>    other formes, e.g. img/pokemon/charizard/megax/front.png
 * sound/se/cries/<species><forme>.ogg     cries,        e.g. sound/se/cries/charizardmegax.ogg
 * @endcode
 *
 * See docs/ASSET_PIPELINE.md for the full layout.
 */

/** @brief Files of one sprite folder: file name → `[width, height]`. */
export type SpriteFiles = Record<string, [number, number]>;

/** @brief The parts of `public/assets/manifest.json` used here. */
export interface AssetManifest
{
    /** Species ID → its files and the files of its formes. */
    pokemon: Record<string, { files?: SpriteFiles; formes?: Record<string, SpriteFiles> }>;
    /** Showdown IDs that have a cry file. */
    cries: string[];
}

/** @brief The Pokémon to find files for. A `PokemonView` from a snapshot fits. */
export interface SpriteSubject
{
    /** Showdown ID of the base species, e.g. `"charizard"`. */
    baseSpeciesId: string;
    /** Showdown ID of the forme, e.g. `"megax"`, or `""`. */
    formeId: string;
    shiny?: boolean;
    /** `"F"` selects the female sprite where the species has one. */
    gender?: string;
}

/** @brief Which battle sprite: `front` for the opponent, `back` for the player. */
export type SpriteFacing = 'front' | 'back';

/**
 * @brief Which sprite file: a battle sprite, or `icon` (the party/menu icon,
 *        two square frames side by side, e.g. 64×32).
 */
export type SpriteKind = SpriteFacing|'icon';

/** @brief Folder of Pokémon sprites, relative to the assets folder. */
export const POKEMON_SPRITE_DIR = 'img/pokemon';

/** @brief Folder of cries, relative to the assets folder. */
export const CRY_DIR = 'sound/se/cries';

/**
 * @brief Find a sprite of a Pokémon (battle sprite or icon).
 *
 * Uses the closest file that exists, in this order: the forme's own sprite
 * before the base species', the shiny sprite before the normal one, the
 * female sprite before the shared one.
 *
 * @param manifest The parsed manifest.json.
 * @param pokemon The Pokémon.
 * @param facing `'front'`, `'back'` or `'icon'`.
 * @return Path relative to the assets folder, e.g. `"img/pokemon/charizard/megax/back_shiny.png"`,
 *         or `null` if the species has no such sprite at all.
 */
export function spritePath(manifest: AssetManifest, pokemon: SpriteSubject, facing: SpriteKind): string|null
{
    const entry = manifest.pokemon[pokemon.baseSpeciesId];
    if (!entry) return null;

    const folders: [string, SpriteFiles | undefined][] = [];
    if (pokemon.formeId) folders.push([`${pokemon.baseSpeciesId}/${pokemon.formeId}`, entry.formes?.[pokemon.formeId]]);
    folders.push([pokemon.baseSpeciesId, entry.files]);

    const female = pokemon.gender === 'F';
    const names: string[] = [];
    for (const shiny of pokemon.shiny ? ['_shiny', ''] : [''])
    {
        if (female) names.push(`${facing}f${shiny}.png`);
        names.push(`${facing}${shiny}.png`);
    }

    for (const name of names)
    {
        for (const [folder, files] of folders)
        {
            if (files?.[name]) return `${POKEMON_SPRITE_DIR}/${folder}/${name}`;
        }
    }
    return null;
}

/**
 * @brief Split a species ID that includes its forme (as saves store it) into
 *        the base species and forme the sprite folders use.
 *
 * Uses the manifest, so no Pokédex data is needed: `rotomwash` is `rotom` +
 * `wash` when `img/pokemon/rotom/wash/` exists. An ID the manifest does not
 * know is returned as a base species without a forme.
 *
 * @param manifest The parsed manifest.json.
 * @param speciesId Showdown ID, e.g. `"charizardmegax"` or `"pikachu"`.
 * @return `{ baseSpeciesId, formeId }`, e.g. `{ baseSpeciesId: "charizard", formeId: "megax" }`.
 */
export function splitSpeciesId(
    manifest: AssetManifest, speciesId: string): Pick<SpriteSubject, 'baseSpeciesId'|'formeId'>
{
    if (manifest.pokemon[speciesId]) return { baseSpeciesId: speciesId, formeId: '' };
    //  The longest base species whose forme folder makes up the rest of the ID.
    for (let cut = speciesId.length - 1; cut > 0; cut--)
    {
        const base = speciesId.slice(0, cut);
        const forme = speciesId.slice(cut);
        if (manifest.pokemon[base]?.formes?.[forme]) return { baseSpeciesId: base, formeId: forme };
    }
    return { baseSpeciesId: speciesId, formeId: '' };
}

/**
 * @brief Find the cry of a Pokémon.
 *
 * Most formes share the cry of their base species; a few (Mega Evolutions,
 * for example) have their own.
 *
 * @param manifest The parsed manifest.json.
 * @param pokemon The Pokémon.
 * @return Path relative to the assets folder, e.g. `"sound/se/cries/charizardmegax.ogg"`,
 *         or `null` if there is no cry for it.
 */
export function cryPath (manifest: AssetManifest, pokemon: Pick<SpriteSubject, 'baseSpeciesId' | 'formeId'>): string | null
{
    const cries = cryIndex(manifest);
    for (const id of [pokemon.baseSpeciesId + pokemon.formeId, pokemon.baseSpeciesId])
    {
        if (cries.has(id)) return `${CRY_DIR}/${id}.ogg`;
    }
    return null;
}

const cryIndexes = new WeakMap<AssetManifest, Set<string>>();

/** @brief The manifest's cry list as a set, built once per manifest. */
function cryIndex (manifest: AssetManifest): Set<string>
{
    let index = cryIndexes.get(manifest);
    if (!index) cryIndexes.set(manifest, index = new Set(manifest.cries));
    return index;
}
