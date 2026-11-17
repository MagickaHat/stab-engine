# Battle Animations

Battle animations (move effects, status effects, weather and so on) come from Pokémon
Essentials projects or animation packs such as the *Gen 9 Move Animation Project*. The importers
turn them into readable files the engine owns. This document covers the file format and how to
import it, and it is the starting point for the animation **player** and the in-engine
**editor**, which don't exist yet.

---

## Contents

1. [Importing](#1-importing)
2. [Files](#2-files)
3. [The format](#3-the-format)
4. [Coordinates and focus](#4-coordinates-and-focus)
5. [Finding the animation for a move](#5-finding-the-animation-for-a-move)
6. [Building the player](#6-building-the-player)
7. [Building the editor](#7-building-the-editor)
8. [Mapping from Essentials](#8-mapping-from-essentials)
9. [Open questions](#9-open-questions)

---

## 1. Importing

Two commands, run with the same pack folders. They name files the same way, so the data always
points at the right sheets and sounds.

```bash
# Sheets → public/assets/img/animations, sounds → public/assets/sound/se/anim
npm run assets:animations -- --pack ~/packs/Gen_9_Move_Animation_Project

# Data/PkmnAnimations.rxdata → content/animations/**/*.json
npm run animations:import -- --pack ~/packs/Gen_9_Move_Animation_Project
```

Both accept `--dry-run`, and several `--pack`s (later ones win). `animations:import` also takes
`--file <path>.rxdata` when the data file is somewhere else.

**Re-importing is safe.** `animations:import` remembers what it wrote (in
`tools/animations/.cache`, gitignored):

- A file you edited since then is kept, and listed in the report. Pass `--force` to overwrite it.
- Files from an earlier import that are no longer produced are removed, unless you edited them.
- Files you created yourself are never touched.

**The report** lists:

- sounds and sheets the data mentions but the pack doesn't have (the reference is kept, so adding
  the file later is enough);
- move IDs missing from `content/pbs`;
- animations that share a name;
- empty slots and `~ Section ~` dividers, which are skipped.

With the Gen 9 Move Animation Project, 1,490 animations are converted (1,205 moves, 81 common,
204 others) in about a second. Every frame, cel and timing is kept.

How the sheets are reduced to the engine's resolution is in
[ASSET_PIPELINE.md §10](ASSET_PIPELINE.md#10-battle-animation-sheets-and-sounds).

## 2. Files

```
content/animations/
├─ schema.json                 JSON Schema: editors validate and autocomplete the files
├─ moves/
│  ├─ tackle.json              Move:TACKLE
│  └─ tackle_opp.json          OppMove:TACKLE (played when the foe uses it)
├─ common/
│  └─ burn.json                Common:Burn
└─ other/
   ├─ barrage_hit_2.json       any other name (custom lookups, multi-hit, charging turns)
   └─ barrage_hit_2_dup1.json  an earlier animation with the same name (Essentials plays the last one)
```

- **Move IDs** are Showdown IDs (`toID` of the Essentials ID, e.g. `KINGSSHIELD` → `kingsshield`).
- **Other names** follow the asset naming rule (lower case, `_` between words).

Every file starts with `"$schema": "../schema.json"`, so VS Code checks it while you edit.

## 3. The format

Types: [`src/battle/animation/format.ts`](../src/battle/animation/format.ts). Schema:
[`content/animations/schema.json`](../content/animations/schema.json).

```json
{
    "$schema": "../schema.json",
    "format": "stab-animation",
    "version": 1,
    "name": "Move:TACKLE",
    "kind": "move",
    "id": "tackle",
    "graphic": "pras_strike",
    "defaultFocus": "userAndTarget",
    "fps": 20,
    "timings": [
        {"frame":0,"type":"sound","sound":"prsfx_tackle.wav"}
    ],
    "frames": [
        [
            {"x":64,"y":112,"pattern":"user","focus":"userAndTarget","locked":true},
            {"x":192,"y":48,"pattern":"target","focus":"userAndTarget","locked":true}
        ],
        [
            {"x":77,"y":105.5,"pattern":"user","focus":"userAndTarget","locked":true},
            {"x":192,"y":51,"pattern":"target","focus":"userAndTarget","locked":true},
            {"x":185.5,"y":49.5,"pattern":0,"focus":"userAndTarget","opacity":100}
        ]
    ]
}
```

Like Essentials, the model is **frame by frame**: every frame lists every sprite's full state.
Nothing is tweened at play time; the editor does the tweening when you create frames.

| Field | Meaning |
|-------|---------|
| `name` | Essentials-style lookup name (§5). |
| `kind`, `id`, `opponent` | Parsed from `name`, so the engine doesn't have to. |
| `graphic` | Sheet `public/assets/img/animations/<graphic>.png`: 96×96 frames, 5 per row. Pattern `n` is column `n % 5`, row `⌊n / 5⌋` (`patternRect()`). |
| `hue` | Hue rotation of the sheet, in degrees. |
| `defaultFocus` | Focus that new cels get in the editor. |
| `fps` | 20, the speed Essentials plays animations at. |
| `timings` | Events on a frame (0-based): `sound`; `background`/`foreground` (show a picture from `img/animations`); `backgroundMove`/`foregroundMove` (move or fade that picture over `duration` frames). A field left out means "unchanged". |
| `frames` | One array per frame. Each holds **slots**: `null` = empty slot, trailing empties dropped. A slot is the same sprite from frame to frame. **Slot 0 is the user battler, slot 1 the target battler.** |

Cel fields: only `x`, `y`, `pattern` and `focus` are always present. The others are left out when
they have their default (in brackets).

| Field | Meaning |
|-------|---------|
| `x`, `y` | Centre of the sprite, in game pixels, relative to the focus (§4). Can be `.5`. |
| `pattern` | Sheet frame (`0`, `1`…), or `"user"` / `"target"` to draw that battler's sprite. |
| `focus` | `user`, `target`, `userAndTarget` or `screen` (§4). |
| `zoomX`, `zoomY` | Scale in percent [100]. |
| `angle` | Degrees, anticlockwise [0]. |
| `mirror` | Flip horizontally [false]. |
| `blend` | `add` or `subtract` [normal]. |
| `opacity` | 0–255 [255]; values outside are clamped. |
| `color` | `[r, g, b, strength]` blended over the sprite [none]. |
| `tone` | `[r, g, b, grey]` tone shift, −255–255 (grey 0–255) [none]. |
| `flash` | Essentials' per-cel flash colour [none]. |
| `priority` | `back`, `behindFocus`, `aboveFocus` or [`front`] (§6). |
| `hidden` | Not drawn this frame [false]. |
| `locked` | Essentials editor flag, kept for round trips; players ignore it. |

Unknown Essentials values (a priority or focus number with no known meaning) are kept as numbers
rather than guessed.

## 4. Coordinates and focus

Animations are designed on a 256×192 stage with the user battler at **(64, 112)** and the
target battler at **(192, 48)** (`ANIMATION_STAGE`; Essentials' 512×384 editor positions,
halved). A cel's `focus` says how its position follows the real battlers:

| Focus | Drawn at |
|-------|----------|
| `screen` | `(x, y)` as is. |
| `user` | `(x, y) − stage.user + realUser`. |
| `target` | `(x, y) − stage.target + realTarget`. |
| `userAndTarget` | The stage's user→target line is mapped onto the real user→target line, so a projectile flies between the battlers wherever they stand. Essentials does this in `transformPoint` (`PBAnimationPlayerX`); port that function exactly. |

`realUser`/`realTarget` are the battler sprites' positions (their centres, as Essentials uses
them).

## 5. Finding the animation for a move

These are Essentials' rules. Keep them so imported packs behave as their authors expect:

1. **The user is on the player's side:** play `Move:<ID>`.
2. **The user is on the opponent's side:** play `OppMove:<ID>` if it exists. Otherwise play
   `Move:<ID>` with user and target swapped; that works because positions are relative to the
   battlers.
3. **Common animations** (status, weather, stat changes, Mega Evolution…) are `Common:<Name>`.
   Each has an `OppCommon:` version if the pack provides one.
4. **Same name twice:** Essentials uses the **last** one. The importer gives it the plain file name
   and the earlier ones `_dup<N>`.
5. **No animation:** Essentials falls back to a generic one for the move's type and category. The
   engine's fallback is up to the player.

## 6. Building the player

Suggested shape: an `AnimationPlayer` in `src/battle/animation/` that the battle scene drives.

- **Loading.** The converted Gen 9 set is about 24 MB of JSON (it compresses very well), so don't
  bundle it. Load each animation when a battle needs it. A small Vite plugin (like
  `vite/plugins/events.mjs`) can copy `content/animations` to the build minified, along with an
  index of `name → file`. Preload the sheet (`animationImagePath(graphic)`) and sounds
  (`ANIMATION_SOUND_DIR`) along with the JSON.
- **Timing.** Advance one frame every `1000 / fps` ms, using elapsed time rather than counting
  render frames. Run `timings` when their frame starts.
- **Drawing a cel.** Use one sprite per slot, reused from frame to frame:
  - `pattern` ≥ 0: crop the sheet with `patternRect()` and set the origin to the frame's centre.
  - `"user"`/`"target"`: draw (or move) that battler's sprite.
  - Then apply zoom, angle, mirror, opacity, blend mode (Phaser `ADD` / a subtract pipeline),
    `color` (tint/fill) and `tone`.
  - Hue rotation needs a shader or a pre-tinted texture.
- **Priority.** `back` goes behind both battlers and `front` in front of everything.
  `behindFocus`/`aboveFocus` go just behind or in front of the focused battler (for
  `userAndTarget`/`screen` focus, use the middle layer). Draw any other number like `front`, as
  Essentials does.
- **Battler cels.** Slots 0 and 1 move the real battler sprites during the animation (a lunge in
  Tackle). Put them back where they started at the end.
- **Backgrounds.**
  - `background`/`foreground` show a picture behind the battlers or over everything, at
    `(x, y)`, with `opacity` and `color`.
  - `…Move` timings tween those values over `duration` frames.
  - In Essentials, a background picture smaller than the screen is tiled.
- **Pixel-perfect.** Round every final position to whole pixels and draw with nearest-neighbour
  filtering (`pixelArt: true`), so sprites stay on the 256×192 grid. Rotation and non-integer zoom
  still produce mixels, as in any pixel-art engine; keep them to effects that are moving anyway.

## 7. Building the editor

The format is meant to be edited in the engine, not just played. A React panel (see
[UI_SYSTEM.md](UI_SYSTEM.md)) over a paused battle stage would cover what Essentials' editor does:

- **Timeline:** frames as columns, slots as rows. Insert, delete and copy frames; set the length.
- **Stage:** drag cels on the 256×192 stage with the two battlers at their stage positions.
  Snap to whole pixels (Essentials' data has half-pixels; keep them unless moved).
- **Cel properties:** a form for the fields in §3, with defaults left out on save.
- **Pattern picker:** the sheet's 96×96 frames as a grid.
- **Tweening:** fill frames between two frames of one slot (position, zoom, angle, opacity, colour,
  tone), as Essentials' "Tween" does. The result is written as plain frames.
- **Timings:** a list per frame, with sound and picture pickers from the asset folders.
- **Saving:** write with the same layout as the importer (`formatAnimation()` in
  `tools/animations/convert.ts`). Because it's a dev-only tool, the dev server can save files
  through a small endpoint. Saved files are protected from re-imports (§1).
- **Validation:** check files against `content/animations/schema.json` (like `events:validate`),
  plus a check that every `graphic`/`sound` exists.

Possible later extensions, kept compatible by bumping `version`:

- keyframes with easing instead of baked frames;
- named slots;
- per-battler-size scaling.

## 8. Mapping from Essentials

What the importer reads (`tools/animations/convert.ts`):

| Essentials | Engine |
|------------|--------|
| `PBAnimations#array` | One file per animation. |
| `PBAnimation#name` | `name`, and from it `kind`/`id`/`opponent` and the file path. |
| `PBAnimation#graphic` | `graphic`: the asset name of the sheet. |
| `PBAnimation#hue` | `hue` |
| `PBAnimation#position` | `defaultFocus` |
| `PBAnimation#array` (frames) | `frames`; cel arrays become objects (below). |
| `PBAnimation#timing` | `timings`, sorted by frame. |
| Cel `[0]`/`[1]` X/Y | `x`/`y` × ½ |
| `[2]` ZOOMX, `[11]` ZOOMY, `[3]` ANGLE | `zoomX`, `zoomY`, `angle` |
| `[4]` MIRROR, `[5]` BLENDTYPE, `[6]` VISIBLE | `mirror`, `blend` (1 add, 2 subtract), `hidden` |
| `[7]` PATTERN | `pattern` (−1 `user`, −2 `target`) |
| `[8]` OPACITY | `opacity` |
| `[12–15]` COLOR, `[16–19]` TONE, `[21–24]` FLASH | `color`, `tone`, `flash` |
| `[20]` LOCKED | `locked` |
| `[25]` PRIORITY | `priority` (0 back, 1 front, 2 behindFocus, 3 aboveFocus) |
| `[26]` FOCUS | `focus` (1 target, 2 user, 3 userAndTarget, 4 screen) |
| `PBAnimTiming` type 0 | `sound` (`name` → resolved file in `sound/se/anim`, `volume`, `pitch`, flash if set) |
| type 1 / 3 | `background` / `foreground` (`name`, `bgX`/`bgY` × ½, `opacity`, `colorRed`…) |
| type 2 / 4 | `backgroundMove` / `foregroundMove` (+ `duration`) |

`.rxdata` files are Ruby Marshal data. `tools/animations/marshal.ts` reads them without running
Ruby or creating Ruby objects, so files from anywhere are safe to import. The same reader can
open other Essentials data files later (`Data/*.rxdata`), for example to import maps' events.

## 9. Open questions

Settle these against Essentials' source (`Battle_AnimationPlayer.rb`, `Animation_Editor`) when
the player is written:

- **`transformPoint`.** Port it exactly for `userAndTarget` (§4); only its intent is described here.
- **Per-cel `flash` and timing `flash.scope`.** These are kept, but every animation in the Gen 9
  project leaves them at 0.
- **Priority 4.** About 2,000 cels in the Gen 9 project use it, with no documented meaning.
  Essentials draws it like `front`, and it's kept as `4`.
- **`hue` on battler cels.** Essentials only hues the sheet.
