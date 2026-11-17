# Asset Pipeline (sprites, icons, cries, graphics, animations)

STAB-engine does not ship Pokémon graphics or audio. `npm run assets:import` brings them in from
a **Pokémon Essentials resource pack** — it was built for the
[Generation 9 Resource Pack](https://eeveeexpo.com/resources/1101) (Essentials v21.1), and any
Essentials project folder has the same layout. Files are renamed to the Showdown IDs used by
`content/pbs` (see [DATA_PIPELINE.md](DATA_PIPELINE.md)) and reduced to 1× pixel scale.

---

## Contents

1. [Quick start](#1-quick-start)
2. [Output layout](#2-output-layout)
3. [Sizes](#3-sizes)
4. [How names are worked out](#4-how-names-are-worked-out)
5. [Reading the report](#5-reading-the-report)
6. [Your own art](#6-your-own-art)
7. [Using the assets in the game](#7-using-the-assets-in-the-game)
8. [Changing what is imported](#8-changing-what-is-imported)
9. [Other graphics: tilesets, UI, characters…](#9-other-graphics-tilesets-ui-characters)
10. [Battle animation sheets and sounds](#10-battle-animation-sheets-and-sounds)
11. [Credits](#11-credits)

---

## 1. Quick start

1. Extract the pack (`.rar`) somewhere. On WSL, keep it on the Linux side (`~/packs/...`), not
   under `/mnt/c/`: reading thousands of small files across that boundary is very slow.
2. Preview, then import:

```bash
npm run assets:import -- --pack ~/packs/Generation_9_Pack --dry-run
npm run assets:import -- --pack ~/packs/Generation_9_Pack
```

The first run converts about 14,000 files (seconds to a minute, depending on CPU cores). Later
runs only convert files that are new or changed.

| Option | What it does |
|--------|--------------|
| `--pack <dir>` | Pack to import. Repeat it to layer packs; later ones replace files from earlier ones. |
| `--only <kinds>` | Import some kinds only: `front`, `back`, `icon`, `overworld`, `footprint`, `cry`, `item`. |
| `--dry-run` | Print the plan and the naming report without writing anything. |
| `--force` | Convert every file again. |
| `--out <dir>` | Write somewhere other than `public/assets`. |
| `--manifest-only` | Just rebuild `manifest.json` (after adding art by hand). |
| `--jobs <n>` | Number of worker threads (default: all CPU cores). |
| `-v` | Print every report line. |

Example of layering: use the pack's optional Gen 3-style back sprites on top of the main pack.

```bash
npm run assets:import -- --pack ~/packs/Generation_9_Pack \
    --pack "~/packs/Generation_9_Pack/OPTIONAL/Gen 9 Backsprites in Vanilla Style"
```

## 2. Output layout

Sprites: one folder per species, as in pokeemerald-expansion, named with Showdown IDs. Formes
are sub-folders named with the Showdown forme ID. Cries: one flat folder, each file named with
the full Showdown ID.

```
public/assets/
├─ img/pokemon/
│  ├─ charizard/
│  │  ├─ front.png            front_shiny.png
│  │  ├─ back.png             back_shiny.png
│  │  ├─ icon.png             icon_shiny.png          two frames side by side
│  │  ├─ overworld.png        overworld_shiny.png     4 directions × 4 frames
│  │  ├─ footprint.png                                (where the pack has one)
│  │  ├─ megax/               Charizard-Mega-X → charizard/megax
│  │  │  └─ front.png …
│  │  └─ megay/
│  ├─ unfezant/
│  │  ├─ front.png
│  │  └─ frontf.png           female gender difference: an `f` after the name
│  ├─ meowstic/
│  │  └─ f/                   Meowstic-F is a forme in Showdown, so it is a folder
│  └─ tauros/paldeacombat/    Tauros-Paldea-Combat
├─ sound/se/cries/
│  ├─ charizard.ogg
│  ├─ charizardmegax.ogg      formes that have their own cry: species ID + forme ID
│  └─ meowsticf.ogg
├─ items/
│  ├─ potion.png              Showdown item ID
│  ├─ charizarditex.png
│  ├─ tm_fire.png             one TM disc per type (also tr_<type>)
│  └─ unknown.png             placeholder icon
├─ credits/<pack folder>.txt  the pack's credits, copied as-is
└─ manifest.json              list of everything above (see section 7)
```

To find a species' sprite folder from its pokedex entry: base species ID, then the forme ID if
it has one — `toID(baseSpecies ?? name)` + `/` + `toID(forme)`. Its cry is the same two IDs
joined without the slash, which is simply the species' own Showdown ID (`charizardmegax`).

## 3. Sizes

Essentials packs store art pre-enlarged. The importer undoes that exactly: when an image is made
of clean 2×2 (or 3×3) pixel blocks, one pixel per block is kept and nothing is lost.

| Kind | In the pack | Imported |
|------|-------------|----------|
| Front sprite | 192×192 (2×) | **96×96** |
| Back sprite | 288×288 (3×) | **96×96** |
| Icon | 128×64 (2×) | 64×32 (two 32×32 frames) |
| Overworld | 256×256 (2×) | 128×128 (16 frames of 32×32); large Pokémon use bigger sheets |
| Footprint | 32×32 (2×) | 16×16 |
| Item | 48×48 (2×) | 24×24 |
| Cry | `.ogg` | copied unchanged |

Battle sprites are always exactly 96×96. A sprite on a different canvas (for example the optional
80×80 back sprites) is placed bottom-centre on a 96×96 canvas. Draw the game at an integer zoom
(2×, 3×…) to get the size back.

PNGs are written as palette images when they have 256 colours or fewer, which keeps them small.

## 4. How names are worked out

- **Species and items**: the Essentials ID in lower case is the Showdown ID (`MRMIME` → `mrmime`,
  `BLACKAUGURITE` → `blackaugurite`).
- **Forms** (`GROWLITHE_1`): the pack's PBS files give the form a name (`FormName = Hisuian`),
  and that name is matched against the formes of that species in `content/pbs`
  (`Growlithe-Hisui` → `growlithe/hisui`). Because your own data is the reference, custom
  formes you add to `content/pbs/custom` are matched too.
- **Aliases** in `tools/assets/packs/gen9.ts` cover the cases this cannot decide (Pikachu's
  costumes, Alcremie, Minior, species where Essentials and Showdown disagree on the base forme).
- **Nothing is guessed.** A form with no usable name is imported as `form<N>`
  (`kyurem/form3`) and listed in the report.

## 5. Reading the report

After every run (and `--dry-run`) the importer prints what needs a human look; the full lists are
in `tools/assets/.cache/report.json`.

| Line | Meaning | What to do |
|------|---------|------------|
| Forms with no known name | Imported as `form<N>`. | Add an alias in `packs/gen9.ts` (`'KYUREM_3': 'kyurem/whiteoverdrive'`) and run again; the old folder is removed for you. Or ignore them. |
| Items not in content/pbs | Icon imported, but no item with that ID exists. | Add the item to `content/pbs/custom/items.json`, or ignore. |
| Species not in content/pbs | Same, for species. | Usually a misnamed file in the pack. |
| Not a clean upscale | The art was drawn at the enlarged size, so shrinking it dropped pixels. | Check how it looks; redraw if needed (section 6). |
| Smaller than the canvas | Sprite was padded up to the fixed size. | Nothing. |
| Same destination as another file | Two pack files mean the same thing; the first was kept. | Nothing. |
| File names not understood | Not `SPECIES[_form][_female]`. | Nothing, unless you wanted that file. |

## 6. Your own art

Put your own files straight into the same folders — for example
`public/assets/img/pokemon/pikachu/delta/front.png`. The importer only ever touches files it wrote
itself, and it will not overwrite yours unless the pack has a file for exactly the same path.
Run `npm run assets:import -- --manifest-only` afterwards so the manifest lists them.

Templates: `front.png` / `back.png` 96×96, `icon.png` 64×32 (two frames), `overworld.png`
128×128 (4×4 frames, rows: down, left, right, up).

## 7. Using the assets in the game

`public/assets/manifest.json` lists every file, so the game can check what exists before loading:

```json
{
    "pokemon": {
        "charizard": {
            "files": { "front.png": [96, 96], "overworld.png": [128, 128] },
            "formes": { "megax": { "front.png": [96, 96] } }
        }
    },
    "items": { "potion": [24, 24] },
    "cries": ["charizard", "charizardmegax"]
}
```

Sizes are `[width, height]`; an overworld frame is a quarter of each. Load battle sprites and
cries when a battle needs them rather than preloading every species:

```ts
// In a Phaser scene; `manifest` is the parsed manifest.json.
const folder = species.forme ? `${toID(species.baseSpecies)}/${toID(species.forme)}` : species.id;
const [base, forme] = folder.split('/');
const files = forme ? manifest.pokemon[base]?.formes?.[forme] : manifest.pokemon[base]?.files;
// Fall back to the base species when a forme has no sprite of its own.
const dir = files?.['front.png'] ? folder : base;
this.load.image(`front:${species.id}`, `assets/img/pokemon/${dir}/front.png`);
// Most formes share the base species' cry.
const cry = manifest.cries.includes(species.id) ? species.id : base;
this.load.audio(`cry:${species.id}`, `assets/sound/se/cries/${cry}.ogg`);
```

## 8. Changing what is imported

Everything pack-specific is data in `tools/assets/packs/gen9.ts` (and
`tools/assets/packs/graphics.ts` for section 9):

- The output folders themselves (`img/pokemon`, `sound/se/cries`, `items`) are constants in
  `tools/assets/config.ts`.
- `rules`: one line per pack folder — where it is, the output file name, and the size
  (`size: [96, 96]` for a fixed canvas, `divide: 2` to halve). Change a size here and run again.
- `forms`: aliases, `'<ESSENTIALS NAME>': '<species>/<forme>'`.
- `ignore`: file names to skip.
- `item`: special item file names.

For a pack with a different folder layout, copy the file, adjust it, register it in
`tools/assets/config.ts`, and pass `--format <name>`.

## 9. Other graphics: tilesets, UI, characters…

`npm run assets:graphics` imports the rest of an Essentials project's (or a correctly laid-out
asset pack's) `Graphics/` folder into `public/assets/img/`. It is the same importer with
`--format graphics`, so `--dry-run`, `--only`, `--force`, `--out`, layering several `--pack`s and
the incremental re-runs all work the same way.

```bash
npm run assets:graphics -- --pack "~/Pokemon Essentials v21.1" --dry-run
npm run assets:graphics -- --pack "~/Pokemon Essentials v21.1"
npm run assets:graphics -- --pack <dir> --only tilesets,autotiles,characters
npm run assets:graphics -- --pack <dir> --pack <tileset pack>       # layer packs; later wins
npm run assets:graphics -- --pack <dir> --exclude "Graphics/UI/Mining" --exclude "Graphics/Battlebacks/unused"
```

**Names.** The folder structure is kept and every folder and file name is put in the engine's
style: lower case, accents dropped, anything else that is not a letter or digit becomes one `_`.

```
Graphics/Tilesets/Poke Centre interior.png      → img/tilesets/poke_centre_interior.png
Graphics/Characters/trainer_POKEMONTRAINER_Red.png → img/characters/trainer_pokemontrainer_red.png
Graphics/UI/Town Map/mapPlayer000.png           → img/ui/town_map/mapplayer000.png
Graphics/Transitions/021-Normal01.png           → img/transitions/021_normal01.png
Graphics/Battle animations/ballBurst_ring4.bmp  → img/battle_animations/ballburst_ring4.png
```

Character sheets land in `img/characters/`, which is where the overworld loads them from (an
event's graphic `npc_01` is `img/characters/npc_01.png`). `.bmp` files are converted to PNG.
`--only` takes the first folder's new name (`tilesets`, `ui`, `battle_animations`…).

**Left out** (listed in `tools/assets/packs/graphics.ts`): `Pokemon`, `Items` and
`Characters/Followers*` (the gen9 import covers them), `Animations`, `UI/Controls help`,
`UI/Debug`, and the RPG Maker windowskins `Windowskins/Window.png` and `001-Blue01.png`. Patterns
ignore case, treat spaces and `_` alike, and may use `*` (`Graphics/Characters/Followers*`).

**Size.** Essentials draws everything at 2× on a 512×384 screen; the engine is 256×192, so every
image is halved (32 px tiles become 16 px). How each image is halved:

| The image is… | What happens | Report line |
|---------------|--------------|-------------|
| clean 2× pixel art (almost all of Essentials) | one pixel per 2×2 block, nothing lost | — |
| pixel art with some 1× detail (tilesets' red "X" marker tiles, a few UI sheets) | each 2×2 block becomes its **main colour**; on a tie the colour that is rarer around it wins, so thin outlines survive. No new colours, every output pixel is exactly one block: no mixels | Not a clean upscale |
| soft art: gradients, translucent fogs, transition masks (over 64 colours, mostly gentle colour steps) | blocks are blended, weighted by alpha | Soft art |
| not a multiple of 2 in size | transparent pixels added right/bottom first | transparent pixels added |

The filter is `filter: 'auto'` in the pack layout; set `'dominant'`, `'average'` or `'nearest'` on
the rule to force one. Anything listed under "Not a clean upscale" is worth a look in an image
viewer at 4× zoom.

## 10. Battle animation sheets and sounds

`npm run assets:animations` imports what battle animations draw and play, from an Essentials
project or an animation pack (e.g. the Gen 9 Move Animation Project). The animation data itself
is converted by `npm run animations:import`; see [ANIMATION_SYSTEM.md](ANIMATION_SYSTEM.md).

```bash
npm run assets:animations -- --pack ~/packs/Gen_9_Move_Animation_Project --dry-run
npm run assets:animations -- --pack ~/packs/Gen_9_Move_Animation_Project
npm run assets:animations -- --pack <dir> --only images        # or sounds
```

```
Graphics/Animations/PRAS- Strike.png        → img/animations/pras_strike.png
Graphics/Animations/!.png                   → img/animations/exclamation.png
Audio/SE/Anim/PRSFX- King's Shield1.wav     → sound/se/anim/prsfx_kings_shield1.wav
Audio/SE/Anim/Acupressure.ogg / .mp3        → sound/se/anim/acupressure.ogg / .mp3
```

Names follow the same rule as section 9. Apostrophes are dropped, and a name made only of
symbols is spelled out. Sounds are copied as they are (`.ogg`, `.wav`, `.mp3`), so the animation
data refers to the exact file; when a name has several formats, the data picks `.ogg` first.

**Sheets.** Essentials sheets are 192×192 frames, 5 per row, drawn for a 512×384 screen. They
become 96×96 frames for 256×192. Each frame is reduced like this:

- **Clean 2× frames** are halved losslessly.
- **Frames pasted one pixel off the 2×2 grid** (common in packs assembled from many sources) are
  found and moved half an output pixel, so they halve losslessly too. Only frames with an empty
  outer edge get their own grid. Full-bleed pictures (backgrounds) keep one grid for the whole
  image, so no seams appear between frames. Report line: *moved half a pixel*.
- **Pixel art with 1× detail** keeps the main colour of each block: no new colours, no mixels.
  Report line: *Not a clean upscale*.
- **Soft effects** (RPG Maker-style fire, water and light sheets with thousands of colours) are
  blended. Report line: *Soft art*.

On the Gen 9 project: 681 sheets in about 45 s.

- 330 were clean;
- 191 had frames realigned;
- 152 still have some 1× detail (worth a look at 4× zoom);
- 119 soft sheets were blended.

The rule is `{ divide: 2, filter: 'auto', align: [192, 192] }` in
`tools/assets/packs/animations.ts`.

## 11. Credits

Sprites in these packs newer than Generation 5 are fan-made. The importer copies the pack's
credits file to `public/assets/credits/`; keep it with your game and credit the artists in your
own credits screen. This repository has the imported sprites and item icons committed; cries
are not, so run the import once to get them.
