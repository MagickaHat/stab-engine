/**
 * @file graphics.ts
 * @brief Layout for importing the general graphics of a Pokémon Essentials
 *        project or resource pack: tilesets, autotiles, characters, trainers,
 *        battlebacks, UI, pictures, titles, transitions, weather, fogs,
 *        windowskins and the rest of `Graphics/`.
 *
 * Everything under `Graphics/` is copied into `img/`, keeping the folder
 * structure, with every folder and file name in the engine's style
 * (`Graphics/UI/Town Map/mapPlayer000.png` → `img/ui/town_map/mapplayer000.png`)
 * and reduced from Essentials' 512×384 screen to the engine's 256×192 (½).
 *
 * Pokémon, items and followers are left out: the `gen9` layout imports
 * those into their Showdown-named folders. Add a folder to `exclude` (or
 * pass `--exclude`) to leave out more.
 *
 * @code
 * npm run assets:graphics -- --pack "~/Pokemon Essentials v21.1"
 * npm run assets:graphics -- --pack <dir> --only tilesets,autotiles,characters
 * @endcode
 */
import type { PackDefinition } from '../pack.ts';

export const graphics: PackDefinition = {
    name: 'graphics',
    rules: [
        // Essentials draws at 2× (32 px tiles on a 512×384 screen); the engine is 1× (16 px tiles,
        // 256×192). Clean 2× art is halved losslessly; anything else is reduced with `auto`
        // (main colour per 2×2 block for pixel art, blended for soft art such as fogs).
        { kind: 'graphics', target: 'tree', dir: 'Graphics', ext: '.png', extraExts: ['.bmp'], output: 'img', image: { divide: 2, filter: 'auto' } },
    ],
    exclude: [
        // Covered by the gen9 layout (`npm run assets:import`).
        'Graphics/Pokemon',
        'Graphics/Items',
        'Graphics/Characters/Followers',
        'Graphics/Characters/Followers shiny',
        // Not needed by the engine.
        'Graphics/Animations',
        'Graphics/Windowskins/Window.png',
        'Graphics/Windowskins/001-Blue01.png',
        'Graphics/UI/Controls help',
        'Graphics/UI/Debug',
    ],
};
