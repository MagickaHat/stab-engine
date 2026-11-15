# STAB-engine

Team Lead - MagickaHat

## Third-party software

- **[Pokémon Showdown](https://github.com/smogon/pokemon-showdown)** by Guangcong Luo and contributors (MIT License). Provides the battle simulator.
- **[@pkmn/sim](https://github.com/pkmn/ps)** by the pkmn project (MIT License). Packages the Showdown simulator for browsers and npm.
- **[ink](https://github.com/inkle/ink)** by inkle Ltd. (MIT License). Narrative scripting language used for dialogue.
- **[inkjs](https://github.com/y-lohse/inkjs)** by Yannick Lohse and contributors (MIT License). JavaScript port of the ink runtime and compiler.
- **[PokeAPI](https://github.com/PokeAPI/pokeapi)** by Paul Hallett and PokeAPI contributors (BSD-3-Clause License). Source of the imported game data in `content/pbs/generated`.
- **[Zod](https://zod.dev)** by Colin McDonnell (MIT License). Schema validation for game data.
- **[Phaser](https://phaser.io)** by Phaser Studio Inc. (MIT License). Game framework.

## Imported assets

The sprites and item icons under `public/assets` (and the cries, which are not committed) are not original to this repository. They are imported with `npm run assets:import` (see [ASSET_PIPELINE.md](ASSET_PIPELINE.md)) from community resource packs such as the **[Generation 9 Resource Pack](https://eeveeexpo.com/resources/1101)** compiled by Caruban. The importer copies each pack's own credits file to `public/assets/credits/`; games built with these assets must credit the artists listed there.

Pokémon and all related names are trademarks of Nintendo, Game Freak and Creatures Inc. STAB-engine is a non-commercial fan project and is not affiliated with or endorsed by them.
