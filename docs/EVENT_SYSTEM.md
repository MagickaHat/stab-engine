# Event and Scripting System

Events are the people, signs, items, doors and cutscenes on a map. STAB keeps the event
structure of **Pokémon Essentials / RPG Maker XP** — events with **pages**, each with
**conditions**, a **trigger** and a list of **commands**, plus four **self switches** — and
writes scripts as **JSON** that is checked and compiled at build time. Maps are made in
**Tiled**, where events are placed as objects.

Nothing in a script is ever run as code: there is no `eval`, no `new Function` and no
JavaScript loaded at run time. Scripts are data walked by an interpreter, which keeps the game
working in Android WebViews and stores that forbid dynamic code.

## Contents

1. [Overview](#1-overview)
2. [File map](#2-file-map)
3. [Quick start](#3-quick-start)
4. [Events, pages and triggers](#4-events-pages-and-triggers)
5. [Conditions](#5-conditions)
6. [Commands](#6-commands)
7. [Targets, movement routes and pathfinding](#7-targets-movement-routes-and-pathfinding)
8. [Text and localization](#8-text-and-localization)
9. [Trainers and battles](#9-trainers-and-battles)
10. [Common events, listeners and natives](#10-common-events-listeners-and-natives)
11. [Autorun pages and saving during cutscenes](#11-autorun-pages-and-saving-during-cutscenes)
12. [Registries](#12-registries)
13. [Tiled](#13-tiled)
14. [The overworld scene](#14-the-overworld-scene)
15. [Validation](#15-validation)
16. [Using it from code](#16-using-it-from-code)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. Overview

```
 content/events/*.json ─┐                                     ┌─ src/tiled/maps/*.tmj
 content/trainers/*.json┤                                     │   (objects with a class)
                        ▼                                     ▼
          vite/plugins/events.mjs ──▶ EventBundle      instantiateMap() ── factory per class
          (check + compile)          (plain data)             │
                        └───────────────┬─────────────────────┘
                                        ▼
                                  EventManager ── picks pages, starts scripts, listeners
                                        │
                                   Interpreter ── one command at a time
                                        │
                                   WorldHost  ── Overworld scene: map, characters, camera,
                                                 sound, message box (React), battles
```

- **Compile time**: event files are validated with Zod and compiled to flat instruction lists
  (`if`/`elsif`/`else`, loops, labels, choices and battle results become jumps).
- **Map load**: every object on the map's object layers is sent to the **factory** of its
  Tiled class (`Npc`, `Sign`, `ItemBall`, `Warp`, `Trainer`, `Event`…), which returns an event.
- **Play**: the `EventManager` picks each event's active page whenever the game state
  changes and runs scripts through the `Interpreter`, which talks to the world only through
  the `WorldHost` interface. The whole system runs in Node with a fake host, which is how the
  tests work.

## 2. File map

| Path | What |
|------|------|
| `src/events/schema.ts` | The JSON format: conditions, commands, pages, files, trainers. |
| `src/events/compile.ts` | Checks and compiles event files into instructions. |
| `src/events/conditions.ts` | Evaluates conditions and values. |
| `src/events/text.ts` | Locale CSV parsing, `TextStore`, placeholders. |
| `src/events/trainers.ts` | Builds trainer teams when a battle starts. |
| `src/events/pathfinding.ts` | A* pathfinding on the tile grid. |
| `src/events/tiled.ts` | Tiled object classes, their properties, factories, `instantiateMap()`. |
| `src/events/runtime/` | `EventManager`, `Interpreter`, `GameEvent`, routes, battle hooks, `WorldHost`. |
| `src/events/registry/` | Code registries: flags, variables, story milestones, emotes, natives. |
| `src/world/` | Overworld helpers: `Character`, map/tileset loading, dialogue requests, ink runner. |
| `src/game/scenes/Overworld.ts` | The overworld scene (the `WorldHost`). |
| `src/ui/EventDialogue.tsx` | Shows messages, choices and name entry with the dialogue windows in `src/ui/dialogue/` (React, see `docs/UI_SYSTEM.md`). |
| `vite/plugins/events.mjs` | Compiles the event files into `virtual:stab-events`. |
| `content/events/` | Event files (scripts, common events, listeners, hooks). `schema.json` is generated. |
| `content/trainers/` | Trainer files (same format, usually only `trainers`). |
| `content/locales/events/` | Text of events and the engine's `system.*` lines. |
| `src/tiled/` | Tiled project, `extensions/`, object templates in `events/`, `maps/`, `tilesets/`. |
| `tools/events/` | `validate`, `sync-tiled`, `schema`, `new-script` and their shared code. |

## 3. Quick start

1. Add a script to an event file (or run `npm run events:new -- route1_old_man route1`):

   ```json
   {
       "$schema": "./schema.json",
       "scripts": {
           "route1_old_man": {
               "pages": [
                   { "graphic": "oldman", "commands": [
                       { "cmd": "message", "key": "events.route1.old_man_hello" },
                       { "cmd": "giveItem", "item": "potion" },
                       { "cmd": "setSelfSwitch", "switch": "A" } ] },
                   { "conditions": { "selfSwitch": "A" }, "graphic": "oldman", "commands": [
                       { "cmd": "message", "key": "events.route1.old_man_again" } ] }
               ]
           }
       }
   }
   ```

2. Add the text to `content/locales/events/en.csv`:

   ```csv
   events.route1.old_man_hello,"Take this, {player}."
   events.route1.old_man_again,Use it well.
   ```

3. Run `npm run events:sync-tiled`, reload the project in Tiled, open your map, and place an
   object of class **Event** (Map ▸ *Create STAB Event…*, or drag `src/tiled/events/Event.tj`)
   with `script` = `route1_old_man`.
4. Run `npm run events:validate`, then `npm run dev` and open
   `http://localhost:8080/?map=route1` to walk around the map.

## 4. Events, pages and triggers

An event script is `{ "tags": [...], "pages": [...] }`. The **last** page whose conditions pass
is the active page (as in RPG Maker XP); with none, the event is not on the map. Pages are
picked again whenever the game state changes, so setting a flag or self switch switches pages
at once.

| Page field | Meaning |
|------------|---------|
| `conditions` | See §5. Default: always. |
| `trigger` | When the commands run (below). Default: `action`. |
| `graphic` | Character sheet `assets/img/characters/<name>.png`. Empty: invisible. |
| `direction` | Direction it faces. |
| `moveType` | `fixed`, `random`, `towardPlayer`, or `route` (repeats `moveRoute`). |
| `moveSpeed`, `moveFrequency` | 1 to 6 (3 = walking speed / normal). |
| `through` | Walks through walls and characters, and does not block. |
| `alwaysOnTop` | Drawn above everything. |
| `directionFix` | Does not turn to the player when talked to. |
| `sightRange` | Tiles a `sight` page sees. Default 4. |
| `autorunClear` | `auto` (default) or `none`; see §11. |
| `commands` | The commands. |

| Trigger | Runs when |
|---------|-----------|
| `action` | The player faces it (or stands on it) and presses the action button. |
| `playerTouch` | The player walks into it or onto it. |
| `eventTouch` | It walks into the player, or the player into it. |
| `autorun` | By itself, as soon as nothing else runs. Blocks the player until it ends. |
| `parallel` | By itself, alongside play; starts again each time it ends. |
| `sight` | A trainer sees the player in a straight line (also works as `action`). |
| `none` | Never by itself (only through other scripts). |

Events started by `action` or touch are **locked**: they turn to the player (unless
`directionFix`) and stop wandering until the script ends. **Self switches** A–D belong to each
event and are saved per map and event ID (`"route1:12:A"`).

## 5. Conditions

Conditions are JSON trees. Leaves:

| Condition | Passes when |
|-----------|-------------|
| `{ "flag": "got_starter", "is": true }` | The flag has that value (`is` defaults to `true`). |
| `{ "selfSwitch": "A", "is": true, "event": 5 }` | A self switch (of this event, or `event`). |
| `{ "var": "badges", "op": "ge", "value": 3 }` | Variable compared (`eq` default, `ne`, `lt`, `le`, `gt`, `ge`). `value` can be `{ "var": … }`. |
| `{ "story": "got_starter", "op": "reached" }` | Story progress: `reached` (default), `before` or `at`. Optional `track`. |
| `{ "item": "potion", "op": "ge", "value": 1 }` | How many are in the bag. |
| `{ "bagHasRoom": "potion", "quantity": 1 }` | That many more fit in the bag. |
| `{ "money": 500, "op": "ge" }` | Money compared. |
| `{ "partySize": 2, "op": "ge" }` | Party size compared. |
| `{ "hasSpecies": "pikachu" }` | The species is in the party. |
| `{ "trainerDefeated": "youngster_joey" }` | That trainer was beaten. |
| `{ "playerFacing": "up" }` | The player faces that way. |
| `{ "eventId": 5, "of": "trigger" }` | ID check of `self` (default) or the event that started the script. |
| `{ "hasTag": "rival", "of": "self" }` | Tag check of `self` (default) or the trigger. |
| `{ "map": "route1" }` | The current map. |
| `{ "battleResult": "win" }` | The last battle's result (`win`, `lose`, `draw`, `flee`, `caught`). |
| `{ "random": 0.25 }` | With that chance. |

Combine with `{ "all": [...] }`, `{ "any": [...] }` and `{ "not": {...} }`.

## 6. Commands

Every command is an object with `cmd`. Values marked *value* accept a number or text,
`{ "var": "name" }` or `{ "random": [min, max] }`.

### Flow

| Command | Does |
|---------|------|
| `{ "cmd": "if", "cond": C, "then": [...], "elsif": [{ "cond": C, "then": [...] }], "else": [...] }` | Runs the first branch whose condition passes; any number of `elsif`. |
| `{ "cmd": "switch", "var": "x", "cases": [{ "value": 1, "then": [...] }], "default": [...] }` | Branch on a variable. |
| `{ "cmd": "loop", "body": [...] }` / `{ "cmd": "break" }` | Repeat until `break`. |
| `{ "cmd": "label", "name": "a" }` / `{ "cmd": "goto", "label": "a" }` | Jump within the same command list. |
| `{ "cmd": "wait", "ms": 500 }` | Wait. |
| `{ "cmd": "exit" }` | End the script. |
| `{ "cmd": "callCommon", "id": "heal_party" }` | Run a common event and come back. |
| `{ "cmd": "parallel", "branches": [[...], [...]] }` | Run lists at the same time; continue when all are done. |
| `{ "cmd": "lock" }` / `{ "cmd": "unlock" }` | Turn the event to the player and hold it still / release it. |
| `{ "cmd": "native", "name": "openShop", "args": {...}, "resultVar": "x" }` | Call a TypeScript function registered by the game (§10). |
| `{ "cmd": "comment", "text": "…" }` | Nothing; a note. |

### State

| Command | Does |
|---------|------|
| `{ "cmd": "setFlag", "flag": "got_starter", "value": true }` | Set a flag. |
| `{ "cmd": "setVar", "var": "x", "op": "add", "value": 1 }` | `op`: `set` (default), `add`, `sub`, `mul`, `div`, `mod`. |
| `{ "cmd": "setSelfSwitch", "switch": "A", "value": true, "event": 5 }` | Own self switch, or another event's. |
| `{ "cmd": "setStory", "milestone": "got_starter", "track": "main" }` | Record story progress. |
| `{ "cmd": "addMoney", "amount": -500 }` | Add (or take) money; never below 0. |

### Dialogue

| Command | Does |
|---------|------|
| `{ "cmd": "message", "key": "events.x.hello", "params": { "n": 3 }, "speaker": "events.x.name" }` | Show a translated line. |
| `{ "cmd": "choice", "key": "events.x.q", "options": [{ "key": "…", "then": [...] }], "cancel": 1 }` | Ask; the picked option's commands run. `cancel`: option for the cancel button (-1: cannot cancel). The index is also stored in `choice_result`. |
| `{ "cmd": "yesNo", "key": "events.x.q", "yes": [...], "no": [...] }` | Yes/No question. |
| `{ "cmd": "ink", "story": "sample", "knot": "professor" }` | Run an ink story (or knot) through the same message box. |
| `{ "cmd": "nameInput", "var": "rival_name", "key": "events.x.ask", "max": 10 }` | Ask for a name (the game language's keyboard and length). |
| `{ "cmd": "nickname", "slot": 0, "key": "events.x.ask" }` | Let the player nickname a party Pokémon (default: the last one) with its own language's keyboard and rules. Says `system.cannot_nickname` if the player is not its original trainer. |
| `{ "cmd": "pokedexEntry", "species": "pikachu" }` | Show a Pokédex entry, in every language the player has unlocked. |

### Cutscenes

| Command | Does |
|---------|------|
| `{ "cmd": "move", "target": T, "route": [...], "wait": true, "skipBlocked": false }` | Play a movement route. With `wait: false` the script goes on. |
| `{ "cmd": "moveMany", "moves": [{ "target": T, "route": [...] }, …] }` | Move several characters at once; waits for all. |
| `{ "cmd": "waitMoves" }` | Wait for moves started with `wait: false`. |
| `{ "cmd": "pathTo", "target": T, "to": { "x": 5, "y": 3 } }` / `"to": { "target": "player" }` | Walk there around obstacles; to a character it stops next to it and faces it. |
| `{ "cmd": "face", "target": T, "dir": "up" }` / `"towards": T` | Turn. |
| `{ "cmd": "camera", "to": { "x": 8, "y": 4 }, "ms": 600 }` / `"to": { "target": T }` / `"to": "player"` | Pan the camera; `"player"` returns and follows again. |
| `{ "cmd": "shake", "intensity": 0.01, "ms": 300 }` | Shake the screen. |
| `{ "cmd": "emote", "target": T, "emote": "exclamation" }` | Emote bubble (`src/events/registry/emotes.ts`). |
| `{ "cmd": "fade", "dir": "out", "color": "#000000", "ms": 400 }` | Fade the screen out or `in`. |
| `{ "cmd": "tint", "color": "#ff8040", "alpha": 0.3, "ms": 500 }` | Tint the screen (`alpha: 0` removes it). |
| `{ "cmd": "flash", "color": "#ffffff", "ms": 300 }` | Flash. |
| `{ "cmd": "se", "name": "door" }` | Sound effect `assets/sound/se/<name>.ogg`. |
| `{ "cmd": "bgm", "name": "route1", "fadeMs": 500 }` / `"name": null` | Change or stop the music (`assets/sound/bgm`). |
| `{ "cmd": "me", "name": "item_get" }` | Jingle (`assets/sound/me`), pausing the music. |
| `{ "cmd": "cry", "species": "pikachu", "wait": true }` | A Pokémon's cry. |
| `{ "cmd": "show", "target": T }` / `{ "cmd": "hide", "target": T }` | Show/hide events for good (saved). |
| `{ "cmd": "erase", "target": T }` | Remove an event until the map is loaded again. |
| `{ "cmd": "setPosition", "target": T, "x": 3, "y": 4, "dir": "down" }` | Move a character at once. |
| `{ "cmd": "setGraphic", "target": T, "graphic": "rival_run" }` | Change a character's graphic. |
| `{ "cmd": "warp", "map": "town", "spawn": "door", "transition": "fade" }` | Go to another map (`x`/`y` or a `Spawn` name; optional `dir`). |
| `{ "cmd": "playerControl", "enabled": false }` | Stop (or allow) walking during parallel scripts. |

### Pokémon, items and the player

| Command | Does |
|---------|------|
| `{ "cmd": "givePokemon", "species": "eevee", "level": 5 }` | Give a Pokémon (to the PC if the party is full). Moves and ability default to the species' level-up moves and first ability. Optional `moves`, `ability`, `nickname`, `shiny`, `item`, `nature`, `gender`, `silent`; `language` with `ot` for a Pokémon from another trainer in another language (see docs/LOCALIZATION.md §9). |
| `{ "cmd": "removePokemon", "species": "eevee" }` | Take the first party member of that species. |
| `{ "cmd": "heal" }` | Heal the party. |
| `{ "cmd": "giveItem", "item": "potion", "quantity": 2 }` | Give items and say so (`silent` to skip the message). |
| `{ "cmd": "takeItem", "item": "potion", "quantity": 1 }` | Take items. |
| `{ "cmd": "teachMove", "species": "pikachu", "move": "surf" }` | Teach a move (or `slot`); goes to the move bank if four are known. |
| `{ "cmd": "setPlayerName", "name": { "var": "typed_name" } }` | Rename the player. |

### Battles

| Command | Does |
|---------|------|
| `{ "cmd": "trainerBattle", "trainer": "rival_lab", "canLose": true, "onWin": [...], "onLose": [...] }` | Battle a trainer (§9). |
| `{ "cmd": "wildBattle", "species": "snorlax", "level": 30, "onWin": [...], "onFlee": [...], "onCatch": [...] }` | Battle a wild Pokémon. |

Without `canLose`, a loss ends the script and runs the host's whiteout (heal and return).
Otherwise the result's block runs (`onDraw` falls back to `onLose`) and the script continues.
The result is also stored in the variable `battle_result`.

## 7. Targets, movement routes and pathfinding

**Targets** (`T` above): `"self"`, `"player"`, `"trigger"` (the event that started the script,
else the player), `{ "id": 12 }` (an event's Tiled object ID) or `{ "tag": "rival" }` (every
event with that tag; commands that need one character use the first). Tags come from the
script's `tags` and the object's `tags` property in Tiled.

**Route steps**: `up`, `down`, `left`, `right`, `forward`, `backward`, `towardPlayer`,
`awayFromPlayer`, `random`, `turnUp`, `turnDown`, `turnLeft`, `turnRight`, `turnAround`,
`turnTowardPlayer`, `turnAwayFromPlayer`, `turnRandom`, and the objects `{ "wait": ms }`,
`{ "jump": [dx, dy] }`, `{ "speed": 1-6 }`, `{ "through": bool }`, `{ "visible": bool }`,
`{ "graphic": "name" }`, `{ "face": "up" }`, `{ "se": "name" }`,
`{ "repeat": n, "steps": [...] }`. A blocked step is retried for about two seconds, then
skipped (`skipBlocked: true` skips at once).

```json
{ "cmd": "moveMany", "moves": [
    { "target": "self", "route": ["down", "down", "turnLeft"] },
    { "target": { "tag": "aide" }, "route": [{ "speed": 4 }, "left", "left", { "jump": [0, 0] }] },
    { "target": "player", "route": ["turnRight"] } ] }
```

`pathTo` uses A* over the map's collisions and characters (`src/events/pathfinding.ts`).

## 8. Text and localization

Scripts only contain text **keys**. The words are in `content/locales/<category>/<locale>.csv`
(header `key,text`), with English as the fallback, and support placeholders such as
`{player}`, `{var:rival_name}`, `{item:potion}`, `{species:pikachu}` and `{name}` from the
command's `params`. See **[LOCALIZATION.md](LOCALIZATION.md)**.

## 9. Trainers and battles

Trainers live in event files under `trainers` (by convention in `content/trainers/`). Their
team is built **when the battle starts**, so it can depend on the story:

```json
"rival_lab": {
    "class": "rival", "name": "trainers.rival.name", "money": 20, "defeat": "events.rival.defeat",
    "variants": [
        { "conditions": { "var": "starter_choice", "value": "bulbasaur" },
          "team": [{ "species": "charmander", "level": { "party": "max" } }] },
        { "team": [
            { "species": "bulbasaur", "level": 5, "moves": ["tackle", "growl"], "ability": "overgrow" },
            { "species": "pidgey", "level": { "var": "rival_level", "offset": -2 }, "conditions": { "story": "beat_gym_1" } } ] }
    ]
}
```

- The **first variant** whose conditions pass is used; each Pokémon is included only if its
  own `conditions` pass.
- `level`: a number, `{ "var": "name", "offset": n }`, or `{ "party": "max" | "avg" | "min", "offset": n }`.
- Left-out `moves` are the last four level-up moves, a left-out `ability` the species' first.
- On a win: the flag `trainer:<id>` is set (`trainerDefeated`), prize money is
  `money × level of the last Pokémon`, and `defeat` is shown.
- `format`: `singles` (default) or `doubles`.

**Battle hooks** run commands during a battle (only commands that do not need the overworld:
messages, flags, variables, sounds, items…):

```json
"hooks": {
    "rival_last_pokemon": { "on": "faint", "trainer": "rival_lab", "side": "foe",
        "commands": [{ "cmd": "message", "key": "events.rival.hang_on" }] }
}
```

`on`: `battleStart`, `turnStart` (with optional `turn`), `faint`, `switchIn` (with optional
`side` and `species`), `battleEnd`. `once` defaults to `true` (once per battle). The battle
scene waits for each hook before showing the next step.

## 10. Common events, listeners and natives

**Common events** are named command lists any script runs with `callCommon`:

```json
"common": { "heal_party": [{ "cmd": "fade", "dir": "out" }, { "cmd": "heal" }, { "cmd": "fade", "dir": "in" }] }
```

**Global listeners** run on any map when something happens:

```json
"listeners": {
    "first_badge": { "on": "varChanged", "name": "badges", "once": true,
        "conditions": { "var": "badges", "op": "ge", "value": 1 },
        "commands": [{ "cmd": "message", "key": "events.first_badge" }] }
}
```

`on`: `flagChanged`, `varChanged`, `itemObtained`, `pokemonObtained`, `storyChanged`,
`mapEnter`, `mapExit`, `step`, `battleEnd`; `name` narrows it (flag, variable, item, species,
track, map or trainer). Conditions are checked when the change happens. `once` listeners are
remembered with the flag `listener:<id>`. Listeners block the player like `autorun`.

**Natives** are TypeScript functions a script may call by name, for things commands do not
cover (shops, PC, Pokédex). List the name in `src/events/registry/natives.ts` and register it:

```ts
events.registerNative('openShop', async ({ stock }) => { await openShopScreen(String(stock)); });
```

## 11. Autorun pages and saving during cutscenes

An `autorun` page runs as soon as nothing else does, and RPG Maker would run it forever if its
condition stayed true. In STAB, when an autorun page ends **and is still the active page**, it
**clears its own trigger condition**: the first flag or self switch its conditions test (at the
top or inside `all`) is flipped. A page with nothing to flip is erased until the map is loaded
again, with a warning. Set `"autorunClear": "none"` to keep the RPG Maker behaviour. Pages
whose commands change their own condition (`setSelfSwitch`, `setStory`…) are never touched.

While any blocking script (action, touch, sight, autorun, listener) runs, **saving is
blocked**: `SaveManager.save()` throws `SaveError` with code `busy`, and `isSavingBlocked()`
(`src/state`) tells a menu to grey out Save. Battles started from scripts count too.

## 12. Registries

Every name a script or map uses is checked against a registry:

| Registry | Source |
|----------|--------|
| Flags | `src/events/registry/flags.ts` (`trainer:*` and `listener:*` are automatic) |
| Variables | `src/events/registry/variables.ts` |
| Story milestones and tracks | `src/events/registry/story.ts` (ordered) |
| Emotes | `src/events/registry/emotes.ts` |
| Natives | `src/events/registry/natives.ts` |
| Items, species, moves | `content/pbs` (generated + custom) |
| Trainers, scripts, common events | the event files |
| Ink stories and knots | `content/dialogue/*.ink` |
| Text keys | `content/locales/*/en.csv` |
| Maps | `src/tiled/maps/**/*.tmj` |

Add a flag or variable by adding a line to its registry, then run
`npm run events:sync-tiled` so Tiled offers it.

## 13. Tiled

Open `src/tiled/stab.tiled-project` in Tiled 1.11 or later. Maps go in `src/tiled/maps/`
(saved as JSON, `.tmj`), tilesets and their images in `src/tiled/tilesets/` (`.tsj` or
embedded).

### Syncing the project

`npm run events:sync-tiled` writes the registries into the project as **enums** (`Flag`,
`Variable`, `Item`, `Species`, `Move`, `TrainerId`, `StoryMilestone`, `StoryTrack`,
`InkStory`, `InkKnot`, `TextKey`, `Script`, `CommonEvent`, `Map`, `TriggerType`, `Direction`,
`MoveType`, `Emote`, `Native`), the object **classes** below, the map class `StabMap`, an
object template per class in `src/tiled/events/`, and two entries in Tiled's Command menu.
Types you add yourself are kept, and existing types keep their IDs. Use `--check` in CI.
Reload the project in Tiled afterwards.

### Object classes

| Class | Properties | Becomes |
|-------|-----------|---------|
| `Event` | `script`*, `tags` | An event with the script's pages. |
| `Npc` | `graphic`, `direction`, `moveType`, `text`, `script`, `tags` | Says `text` when talked to, or uses `script` (its pages default to the Npc's graphic). |
| `Sign` | `text`*, `tags` | Shows `text` when read. |
| `ItemBall` | `item`*, `quantity`, `graphic` | Gives the item once (self switch A), then disappears. Stays if the bag is full. |
| `HiddenItem` | `item`*, `quantity` | Invisible, found with the action button. |
| `Warp` | `map`*, `spawn` or `x`/`y`, `direction`, `fade`, `se` | Moves the player when stepped on. Can cover several tiles. |
| `Trainer` | `trainer`*, `graphic`, `direction`, `sightRange`, `intro`, `after`, `script` | Sees the player, shows `!`, walks up, says `intro`, battles; afterwards says `after`. `script` adds pages after these. |
| `Trigger` | `script`*, `trigger`, `tags` | An area (any size) running a script; pages without a trigger use `trigger` (default `playerTouch`). |
| `Spawn` | `direction` (the object's **name** is the spawn name) | A place warps arrive at. `start` is the default. |

\* required. An object's **event ID** is its Tiled object ID. Objects without a class are
ignored (use them for notes). Map properties (class `StabMap`): `name` (text key) and `bgm`.

### Editor extensions

`src/tiled/extensions/` is loaded by Tiled automatically:

- **Map ▸ Create STAB Event…** (Ctrl+Shift+E): pick a class, name and tile; the object is
  added to the current object layer. For an `Event` or `Trigger` with a new script ID, it can
  create the script in `content/events/<map>.json` (through `CreateEventSource.sh` / `.bat`,
  which run `npm run events:new` and refresh the project).
- **Map ▸ Validate STAB Map** (Ctrl+Shift+V): checks the open map (classes, required
  properties, list values, grid alignment, Spawn names). It also runs on every save.
  Problems appear in the Issues view; double-click one to select the object.
- **Map ▸ Validate STAB Project**: runs the full validator (§15).

## 14. The overworld scene

`Overworld` (`src/game/scenes/Overworld.ts`) is the `WorldHost`. Start it with
`this.scene.start(OVERWORLD_SCENE_KEY, { map: 'route1' })`, or open
`http://localhost:8080/?map=route1` (`&spawn=name`) during `npm run dev`.

- Tile layers draw in order. A layer with the bool property `above` draws over characters; one
  with `collision` is hidden and blocks every tile on it. Tileset tiles with the bool property
  `collides` block.
- Controls come from the input system (`docs/INPUT_SYSTEM.md`): the D-pad walks, hold B to
  run, A (or a tap / left click on the game) acts. Messages and choices are drawn by
  `<EventDialogue>` (React) and take the same buttons, or a tap on the box or an option.
- Assets (none are shipped; missing files are skipped):
  `assets/img/characters/<graphic>.png` (4×4 RPG Maker XP sheets), the player's
  `assets/img/characters/player.png`, emotes `assets/img/system/emotes.png` (16×16 frames,
  order in `emotes.ts`), sounds in `assets/sound/{bgm,se,me}/<name>.ogg`, cries from
  `assets/sound/se/cries/`. In development builds characters without art are drawn as
  outlines so maps can be tested before art exists.
- **Battles**: the scene sleeps, `Battle` runs with the player's party and the built team, and
  battle hooks run between steps. The result comes back through `GameEvents.BATTLE_RESULT`.
- **Whiteout**: heals the party and returns to the map's `Spawn` named `heal`. Change
  `Overworld.whiteout()` for your game's rules.
- Characters 1×1 tile in size get a `Character`; larger events are trigger areas.

## 15. Validation

`npm run events:validate` (also in Tiled's Command menu) compiles every event file and checks
every map:

- **Errors**: invalid JSON or schema, duplicate IDs across files, unknown labels, `break`
  outside `loop`, unknown flags, variables, story milestones, items, species, moves, trainers,
  common events, natives, emotes, ink stories or knots; text keys missing from English;
  overworld-only commands in battle hooks; warps to unknown maps, spawns or tiles outside the
  map; map objects with unknown classes, missing required properties or values not in their
  list; duplicate Spawn names.
- **Warnings**: untranslated keys per language, objects off the tile grid, autorun pages that
  never change their own condition and have nothing to clear.

It exits with 1 on errors (`--strict`: also on warnings). The Vite plugin runs the same
compiler, so a broken event file stops `npm run build` and shows an error overlay in
`npm run dev`.

## 16. Using it from code

```ts
import bundle from 'virtual:stab-events';
import { EventManager, instantiateMap, TextStore } from '../events';

const events = new EventManager({ state, bundle, text, host, data });
events.loadMap('route1', instantiateMap(tiledJson, 'route1', bundle).events);
// each frame:
events.update();
// input:
if (!events.busy) events.playerAction();
events.runCommon('heal_party');
```

Add a Tiled class of your own with a factory:

```ts
import { buildScript, registerFactory } from '../events';

registerFactory('Berry', (object) => ({
    id: object.id, name: object.name, kind: 'Berry', x: object.x, y: object.y, width: 1, height: 1, tags: object.tags,
    script: buildScript(object, { pages: [{ graphic: 'berrytree', commands: [
        { cmd: 'giveItem', item: String(object.props.berry) }, { cmd: 'setSelfSwitch', switch: 'A' } ] },
        { conditions: { selfSwitch: 'A' }, graphic: 'berrytree_empty', commands: [] } ] }),
}));
```

Then add the class to `CLASS_SPECS` in `src/events/tiled.ts` so the sync script and the
validator know its properties.

## 17. Troubleshooting

| Problem | Fix |
|---------|-----|
| A new flag, script or text key is not in Tiled's drop-down | `npm run events:sync-tiled`, then reload the project in Tiled. |
| `virtual:stab-events` error overlay in `npm run dev` | Run `npm run events:validate` for the full list. |
| An event never appears | No page's conditions pass, it was hidden (`hide`) or erased, or its object has no class. |
| An autorun page runs only once per map visit | It had nothing to clear (§11); give it a self switch or flag condition. |
| Characters are invisible | Add `assets/img/characters/<graphic>.png` (outlines show only in development). |
| Saving fails with `busy` | A cutscene or battle is running; save after it ends. |
