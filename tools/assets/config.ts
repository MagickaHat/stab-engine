/**
 * @file config.ts
 * @brief Settings for the asset importer: where things are read from and written to.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {OutputRedirect} from './destinations.ts';
import type { PackDefinition } from './pack.ts';
import { animations } from './packs/animations.ts';
import { gen9 } from './packs/gen9.ts';
import { graphics } from './packs/graphics.ts';

/** @brief Repository root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @brief Game data used to look up Showdown IDs. */
export const PBS_DIR = path.join(ROOT, 'content/pbs');

/** @brief Default output folder. Served by Vite/Phaser as `assets/`. */
export const ASSETS_DIR = path.join(ROOT, 'public/assets');

/**
 * @brief Tileset images. They are read by Tiled and bundled with the maps
 *        (src/world/maps.ts), so they live next to the Tiled tilesets instead
 *        of in the output folder.
 */
export const TILESETS_DIR = path.join(ROOT, 'src/tiled/tilesets');

/**
 * @brief Outputs written outside the output folder: an output path starting
 *        with `prefix` (e.g. `img/tilesets/outside.png`) is written to `dir`
 *        instead (`src/tiled/tilesets/outside.png`). Only used with the default
 *        output folder; with `--out` everything stays inside that folder.
 */
export const OUTPUT_REDIRECTS: OutputRedirect[] = [
    {prefix: 'img/tilesets', dir: TILESETS_DIR},
];

/** @brief Folder (inside the output folder) holding one folder of sprites per species. */
export const POKEMON_DIR = 'img/pokemon';

/** @brief Folder (inside the output folder) holding Pokémon cries, one file per species/forme. */
export const CRIES_DIR = 'sound/se/cries';

/** @brief Folder (inside the output folder) holding item icons. */
export const ITEMS_DIR = 'img/items';

/** @brief Importer bookkeeping: what was imported from where, and the last report (gitignored). */
export const CACHE_DIR = path.join(ROOT, 'tools/assets/.cache');

/** @brief Pack layouts the importer knows, by `--format` name. */
export const PACKS: Record<string, PackDefinition> = { gen9, graphics, animations };

/** @brief Bump when conversion output changes, to make every file be converted again. */
export const PIPELINE_VERSION = 1;

/** @brief Default `--format` of `npm run assets:import`. */
export const DEFAULT_FORMAT = 'gen9';
