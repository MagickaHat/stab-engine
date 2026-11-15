# Game Data (PBS) Pipeline

STAB-engine keeps its Pokémon, moves, abilities, items, natures, type chart and learnsets as
JSON files in `content/pbs/`. The official data is imported from
[PokeAPI](https://github.com/PokeAPI/pokeapi)'s CSV dump and converted to
**Pokémon Showdown's data format**, so the battle simulator (`@pkmn/sim`, see
[BATTLE_SYSTEM.md](BATTLE_SYSTEM.md)) can use it as-is. Your own content and changes live in a
separate folder that the importer never touches.

---

## Contents

1. [Overview](#1-overview)
2. [Folder layout](#2-folder-layout)
3. [Commands](#3-commands)
4. [Importing from PokeAPI](#4-importing-from-pokeapi)
5. [Custom content and overrides](#5-custom-content-and-overrides)
6. [Data format (Showdown)](#6-data-format-showdown)
7. [Validation (Zod)](#7-validation-zod)
8. [Using the data in the game](#8-using-the-data-in-the-game)
9. [Battles with custom data](#9-battles-with-custom-data)
10. [Localization](#10-localization)
11. [Known limitations](#11-known-limitations)

---

## 1. Overview

```
 PokeAPI CSVs ──▶ npm run pokeapi:import ──▶ content/pbs/generated/*.json ─┐
 (GitHub)         (tools/pokeapi)            (Showdown format, committed)  │  JSON Merge Patch
                                                                           ├──────────────────▶ loadPbs()  (game)
                  you ──────────────────────▶ content/pbs/custom/**/*.json ┘        │
                                             (overrides, new content)               └─────────▶ registerStabMod() ─▶ @pkmn/sim
                                                                                                (custom layer only)
```

- **Generated** data belongs to the importer. Re-running the import overwrites it.
- **Custom** data belongs to you. It is layered on top of the generated data at load time:
  add entries, change single fields, or remove entries.
- Everything is validated with [Zod](https://zod.dev) schemas in `src/data/schemas/`, which
  also give the game TypeScript types.

## 2. Folder layout

| Path | What it is |
|------|------------|
| `content/pbs/generated/` | Importer output. **Do not edit.** Committed to git so the game works right after cloning. |
| `content/pbs/generated/_meta.json` | Import report: PokeAPI commit, entry counts, warnings. |
| `content/pbs/generated/locales/<locale>/<category>.json` | Names and descriptions from PokeAPI per language (see [Localization](#10-localization)). |
| `content/pbs/custom/` | Your overrides and new content (one file per table, plus optional pack folders). |
| `content/pbs/schemas/` | JSON Schemas for editor autocompletion (`npm run pbs:schemas`). |
| `src/data/` | Runtime: schemas, merge rules, loader, Showdown bridge. |
| `tools/pokeapi/` | The PokeAPI importer. |
| `tools/pbs/` | Validator, Showdown comparison, JSON-schema generator. |

Tables (the same file names are used in `generated/` and `custom/`):

| File | Showdown table | Contents |
|------|----------------|----------|
| `pokedex.json` | `Pokedex` | Species and formes: types, base stats, abilities, evolutions, formes… |
| `moves.json` | `Moves` | Type, category, power, accuracy, PP, target, flags, secondary effects… |
| `abilities.json` | `Abilities` | Names and numbers (ability behaviour is code in Showdown). |
| `items.json` | `Items` | Fling, Natural Gift, berry/ball flags… |
| `natures.json` | `Natures` | Raised/lowered stat. |
| `typechart.json` | `TypeChart` | Damage multipliers per defending type. |
| `learnsets.json` | `Learnsets` | Which moves each species learns, how and in which generation. |
| `species_info.json` | *(engine only)* | Catch rate, base exp, EV yield, growth rate, egg cycles, friendship, structured evolution methods. |
| `item_info.json` | *(engine only)* | Price, bag pocket, category, flags, move taught by TMs. |

## 3. Commands

| Command | What it does |
|---------|--------------|
| `npm run pokeapi:import` | Download PokeAPI's CSVs and regenerate `content/pbs/generated`. |
| `npm run pbs:validate` | Validate generated + custom data (schemas and cross-references). Add `-- --strict` to fail on warnings too. |
| `npm run pbs:compare` | Compare the data with Showdown's own data and list differences (`-- --verbose` for all, `-- --generated` to skip custom). |
| `npm run pbs:schemas` | Regenerate the JSON Schemas in `content/pbs/schemas` after changing a Zod schema. |

The tools are TypeScript run directly by Node 22+ (no build step). Run `npm install` first.

## 4. Importing from PokeAPI

```bash
npm run pokeapi:import
```

Options (after `--`):

| Option | Meaning |
|--------|---------|
| `--ref <branch/tag/commit>` | PokeAPI version to import. Default `master`. The resolved commit is saved in `_meta.json`; pass it to reproduce an import exactly. |
| `--refresh` | Download again instead of using the cache in `tools/pokeapi/.cache` (gitignored). |
| `--csv-dir <folder>` | Read CSVs from a local PokeAPI clone (`…/pokeapi/data/v2/csv`) instead of downloading. |

The importer validates everything before writing; if the generated data is invalid nothing is
written. It also checks that your custom files still apply to the new data and warns if not.

What gets imported and how is configured in `tools/pokeapi/config.ts`: languages, version groups
excluded from learnsets (Colosseum/XD, Let's Go, BDSP, Legends…), and learn-method codes.

### How PokeAPI data is converted

| PokeAPI | Showdown (what you get) |
|---------|-------------------------|
| identifiers `mr-mime`, `u-turn`, `charizard-mega-x` | IDs `mrmime`, `uturn`, `charizardmegax`; names `Mr. Mime`, `U-turn`, `Charizard-Mega-X` |
| `types.identifier` `fire` | `"Fire"` |
| height (dm) / weight (hg) | `heightm` / `weightkg` |
| `gender_rate` (eighths female) | `gender: "N"` or `genderRatio: { M, F }` |
| ability slots 1/2/hidden | `abilities: { "0", "1", "H" }` |
| egg groups `water1`, `ground`, `humanshape` | `"Water 1"`, `"Field"`, `"Human-Like"` |
| `pokemon_evolution` | `prevo`, `evos`, `evoType`, `evoLevel`, `evoItem`, `evoMove`, `evoCondition` (+ structured `species_info.evolutions`) |
| extra `pokemon_forms` (Unown B…) | `cosmeticFormes` |
| `is_battle_only` / `is_mega` forms | `battleOnly`, `requiredItem` (Mega Stone) |
| `damage_class` | `category: "Physical" / "Special" / "Status"` |
| `move_targets` | `target` (`normal`, `allAdjacentFoes`, `self`, `any`…) |
| `move_flags` (`authentic`, `ballistics`…) | `flags` (`bypasssub`, `bullet`…) |
| `move_meta` ailment/stat/drain/healing | `status`, `volatileStatus`, `secondary`, `boosts`, `self`, `drain`, `recoil`, `heal`, `critRatio`, `multihit` |
| `type_efficacy` (0/50/100/200) | `damageTaken` codes (3/2/0/1) |
| `pokemon_moves` per version group | learnsets like `"9L15"`, `"8M"`, `"7T"`, `"6E"` |

Names are spelled the way Showdown spells them: every entry is matched against `@pkmn/sim`'s Dex.
Entries Showdown does not have (e.g. Koraidon's build formes) get a name in the same style and
are listed in the warnings in `_meta.json`.

## 5. Custom content and overrides

Put your changes in `content/pbs/custom/`, using the same file names as `generated/`. Each file
is a **JSON Merge Patch** ([RFC 7386](https://www.rfc-editor.org/rfc/rfc7386)) applied per entry:

| You write | Result |
|-----------|--------|
| An ID that doesn't exist yet | **New** entry (must be complete) |
| An object for an existing ID | **Patch**: nested objects merge; numbers, strings and arrays are replaced |
| `null` for an ID | **Removes** the entry |
| `null` for a field | **Removes** the field |

```jsonc
// content/pbs/custom/pokedex.json
{
    "$schema": "../schemas/pokedex.patch.schema.json",   // editor autocompletion; ignored by the game
    "pikachu": { "baseStats": { "spe": 120 } },           // only Speed changes
    "pikachugmax": null,                                   // remove a forme
    "sparkmouse": {                                        // a new species
        "num": -1, "name": "Sparkmouse", "types": ["Electric", "Fairy"],
        "baseStats": { "hp": 60, "atk": 60, "def": 50, "spa": 95, "spd": 60, "spe": 110 },
        "abilities": { "0": "Static", "H": "Pixilate" },
        "heightm": 0.4, "weightkg": 5, "color": "Yellow", "eggGroups": ["Field"],
        "isNonstandard": "Custom"
    }
}
```

(The real files must be plain JSON: no comments.)

Rules for new entries:

- The key is the **ID**: lowercase letters and digits only, and equal to the name with everything
  else removed (`"Spark Burst"` → `sparkburst`). Use negative `num`s for fan-made content so they
  never collide with official ones.
- Reference other entries **by name** like Showdown does (`"abilities": { "0": "Static" }`,
  `"evos": ["Sparkrat"]`, `"type": "Electric"`).
- Give new species a `learnsets.json` entry, or they can't learn anything in battles.

### Content packs

Any sub-folder of `content/pbs/custom/` is a **pack** containing its own table files:

```
content/pbs/custom/
├── pokedex.json             ← project-wide tweaks (applied last)
├── fakemon-wave-1/
│   ├── pokedex.json
│   ├── moves.json
│   └── learnsets.json
└── _balance-experiment/     ← starts with "_": disabled
    └── moves.json
```

- Packs apply in alphabetical order, then the top-level files, so top-level files always win.
- **Add** content: drop a pack folder in. **Remove** it: delete the folder. **Disable** it
  temporarily: rename it to start with `_`.
- Run `npm run pbs:validate` after any change.

## 6. Data format (Showdown)

The Showdown tables follow the simulator's own data files (`data/pokedex.ts`, `data/moves.ts`…
in [smogon/pokemon-showdown](https://github.com/smogon/pokemon-showdown/tree/master/data)).
The Zod schemas in `src/data/schemas/` document every field. In short:

```json
"thunderbolt": {
    "num": 85, "name": "Thunderbolt", "type": "Electric", "category": "Special",
    "basePower": 90, "accuracy": 100, "pp": 15, "priority": 0, "target": "normal",
    "flags": { "protect": 1, "mirror": 1 },
    "secondary": { "chance": 10, "status": "par" }, "gen": 1
}
```

Engine-only data that Showdown has no field for lives in `species_info.json` and
`item_info.json`, keyed by the same IDs, so the Showdown tables stay clean.

## 7. Validation (Zod)

`checkData()` (`src/data/integrity.ts`) runs:

1. the Zod schema of each table (types, ranges, required fields, ID format);
2. cross-table checks: types exist in the type chart, abilities/items/moves referenced exist,
   evolutions point at real species, learnsets only use existing species and moves;
3. warnings for unknown fields (probable typos like `basepower`) and names that don't match IDs.

It runs in `npm run pbs:validate`, before every import writes, and automatically in the game
during `npm run dev` (errors are thrown with the full list). Production builds skip it.

To add a field, add it to the schema, then run `npm run pbs:schemas`.

## 8. Using the data in the game

```ts
import { loadPbs, textKey } from '../../data';

const { pokedex, moves, speciesInfo } = await loadPbs(['pokedex', 'moves', 'speciesInfo']);

pokedex.pikachu.baseStats.spe;      // number (fully typed)
moves.thunderbolt.secondary;         // { chance: 10, status: 'par' }
speciesInfo.pikachu.catchRate;       // 190
```

- `loadPbs(tables?, { validate? })` loads the generated data with all custom layers applied.
  Each table is its own lazily loaded chunk, so only the tables you ask for are downloaded.
- Types for every table are exported: `SpeciesData`, `MoveData`, `ItemData`, `SpeciesInfo`, …

## 9. Battles with custom data

The simulator already contains all official data **with** the code behind moves, abilities and
items, which PokeAPI cannot provide. So only your custom layer is sent to it, as a Showdown mod
named `stab`:

```ts
import { registerStabMod } from '../../data';
import { BattleEngine } from '../../battle';

const dex = await registerStabMod();
const engine = new BattleEngine({ dex, formatid: 'gen9stabcustomgame', p1, p2 });
```

- Patched entries are sent as `{ inherit: true, …fields you changed }`: Thunderbolt with a new
  `basePower` keeps its paralysis code.
- New entries are sent whole. A new move with a JSON-describable effect (damage, secondary
  status/boosts, drain, recoil, healing, multi-hit, priority…) works without any code.
- Removed entries (`null`) are removed from the mod.
- `gen9stabcustomgame` uses the same rules as `gen9customgame`. Pass `formats` to
  `registerStabMod()` for your own rules.

Effects that need code (a new ability, a move with a unique effect) need a Showdown mod with
TypeScript callbacks; see [Showdown's mod docs](https://github.com/smogon/pokemon-showdown/blob/master/data/mods/README.md)
and `loadMod()` in `src/battle/mods.ts`.

## 10. Localization

Data tables store only the English `name` (Showdown needs one, and it serves as the fallback).
All player-facing text goes into locale files keyed by **category, ID and field**
(`textKey()` in `src/data/i18n.ts`):

| Key | Text |
|-----|------|
| `pokemon.bulbasaur.name` / `.genus` / `.flavor` | Name, category ("Seed Pokémon"), Pokédex entry |
| `pokemon.charizardmegax.form` | Forme name |
| `moves.thunderbolt.name` / `.desc` / `.flavor` | Name, short effect, in-game description |
| `abilities.<id>.*`, `items.<id>.*` | Same fields as moves |
| `natures.<id>.name`, `types.<id>.name` | Names |

The importer writes PokeAPI's translations to
`content/pbs/generated/locales/<locale>/<category>.json` for `en`, `de`, `fr`, `es-es`, `es-mx` and
`pt-br`. PokeAPI has no European Portuguese and little Brazilian Portuguese, so translators
fill those in. `loadGeneratedText(locale, category)` returns one of these files.

A future localization system should load these generated strings first, then the hand-written
`content/locales/<category>/<locale>.csv` files on top, so translators can override anything. The
category names already match the folders in `content/locales/`. For custom content, add your
keys (e.g. `pokemon.sparkmouse.name`) to those CSVs.

## 11. Known limitations

These come from PokeAPI's data and are listed in `_meta.json` / `npm run pbs:compare`:

- **No battle behaviour.** Ability and item effects, and most special move effects, exist only as
  code in Showdown. That is why the bridge sends only custom data to the simulator.
- **Newer moves have incomplete effect data.** PokeAPI lacks `move_meta` for many Gen 8–9 moves
  (e.g. Axe Kick's confusion chance), and move flags are only reliable up to Gen 7.
  `pbs:compare` lists the differences.
- **Learnsets** contain level-up, TM/TR, tutor and egg moves. Event (`S`), Dream World (`D`) and
  Virtual Console (`V`) sources don't exist in PokeAPI.
- **Megas from PokeAPI's newest games** may have no ability ("No Ability") until PokeAPI adds them.
- Showdown-only data (tiers, random battle sets, `desc` texts) is not part of PokeAPI.
- The type chart is the current generation's.

## Credits

Data from [PokeAPI](https://pokeapi.co) (BSD-3-Clause). Data format from
[Pokémon Showdown](https://github.com/smogon/pokemon-showdown) (MIT).
