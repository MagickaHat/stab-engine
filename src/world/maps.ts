/**
 * @file maps.ts
 * @brief Finds Tiled maps, tilesets and tileset images in src/tiled for the overworld.
 *
 * Maps are `src/tiled/maps/**\/*.tmj` (Tiled's JSON map format); a map's ID
 * is its path under `maps/` without `.tmj` (`route1`, `towns/pallet`).
 * Tilesets may be embedded in the map or saved next to it as `.tsj` files in
 * `src/tiled/tilesets/`; their images must be in `src/tiled/tilesets/` too.
 * Everything is bundled by Vite and fetched only when a map is entered.
 *
 * Map files are read as text and parsed with `JSON.parse`, so loading a map
 * never runs code.
 */
import type { TiledMap } from '../events/tiled';

const MAPS = import.meta.glob<string>('../tiled/maps/**/*.tmj', { query: '?raw', import: 'default' });
const TILESETS = import.meta.glob<string>('../tiled/tilesets/**/*.tsj', { query: '?raw', import: 'default' });
const IMAGES = import.meta.glob<string>('../tiled/tilesets/**/*.{png,webp}', { query: '?url', import: 'default' });

/** @brief Prefix of every glob key. */
const ROOT = '../tiled/';

/** @brief A map with its tilesets embedded and the URL of each tileset image. */
export interface MapAssets
{
    id: string;
    map: TiledMap;
    /** Tileset name → image URL. */
    images: Record<string, string>;
}

/**
 * @brief Resolve a path relative to a file inside src/tiled.
 * @param from Glob key of the file, e.g. `../tiled/maps/route1.tmj`.
 * @param relative Path written in it, e.g. `../tilesets/outdoor.tsj`.
 * @return The glob key of the target.
 */
function resolve (from: string, relative: string): string
{
    const url = new URL(relative, `https://tiled.invalid/${from.slice(ROOT.length)}`);
    return ROOT + decodeURIComponent(url.pathname.slice(1));
}

/** @brief The IDs of every map. */
export function mapIds (): string[]
{
    return Object.keys(MAPS).map((key) => key.slice(`${ROOT}maps/`.length).replace(/\.tmj$/, '')).sort();
}

/**
 * @brief Load a map and everything its tilesets need.
 * @param id Map ID.
 * @return The map with embedded tilesets and image URLs.
 * @throws Error if the map, a tileset or an image cannot be found.
 */
export async function loadMapAssets (id: string): Promise<MapAssets>
{
    const key = `${ROOT}maps/${id}.tmj`;
    const loadMap = MAPS[key];
    if (!loadMap) throw new Error(`[world] map "${id}" not found (expected src/tiled/maps/${id}.tmj)`);
    const map = JSON.parse(await loadMap()) as TiledMap;
    const images: Record<string, string> = {};
    const tilesets: TiledMap['tilesets'] = [];
    for (const entry of map.tilesets)
    {
        let tileset = entry as Record<string, unknown>;
        let base = key;
        if ('source' in entry && typeof entry.source === 'string')
        {
            base = resolve(key, entry.source);
            const loadTileset = TILESETS[base];
            if (!loadTileset) throw new Error(`[world] map "${id}": tileset ${entry.source} not found in src/tiled/tilesets`);
            tileset = { ...JSON.parse(await loadTileset()), firstgid: entry.firstgid };
        }
        const name = String(tileset.name);
        if (typeof tileset.image === 'string')
        {
            const loadImage = IMAGES[resolve(base, tileset.image)];
            if (!loadImage) throw new Error(`[world] tileset "${name}": image ${tileset.image} not found in src/tiled/tilesets`);
            images[name] = await loadImage();
        }
        tilesets.push(tileset as TiledMap['tilesets'][number]);
    }
    return { id, map: { ...map, tilesets }, images };
}
