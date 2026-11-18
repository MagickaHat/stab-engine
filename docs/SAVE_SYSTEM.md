# Game State and Save System

The game state is everything the game must remember about one playthrough: the party, the
PC, the bag, flags and variables, and where the player stands. It is **plain data kept
outside Phaser**, so scenes, the React UI and Node tests all work with the same object, and
saving is turning that data into JSON.

The code lives in `src/state/`. It imports neither Phaser nor React.

---

## Contents

1. [Overview](#1-overview)
2. [File map](#2-file-map)
3. [Quick start](#3-quick-start)
4. [What is saved](#4-what-is-saved)
5. [Changing the state](#5-changing-the-state)
6. [Pokémon](#6-pokémon)
7. [Saving and loading](#7-saving-and-loading)
8. [Storage, export and import](#8-storage-export-and-import)
9. [Changing the save format (versions and migrations)](#9-changing-the-save-format-versions-and-migrations)
10. [Battles with the saved party](#10-battles-with-the-saved-party)
11. [Dialogue](#11-dialogue)
12. [Using it from Phaser and React](#12-using-it-from-phaser-and-react)
13. [API reference](#13-api-reference)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Overview

```
 scenes ──┐                           ┌──▶ React UI (useGameState())
 UI ──────┼─ addItem(), setFlag()… ─▶ GameState
 dialogue ┘                           │  toJSON() ▲ fromJSON()
                                      ▼           │
                                   SaveManager ──▶ SaveStorage (localStorage by default)
```

- **`GameState`** holds the data and is the only thing that changes it. Every change
  replaces the data with a new object and tells its subscribers.
- **`SaveManager`** writes a `GameState` to a numbered slot and reads it back. It checks
  every file it reads and upgrades files from older versions.
- **`getGameState()` / `setGameState()`** remember which game is being played, so any
  scene or component can reach it.

---

## 2. File map

| File | What it does |
|------|--------------|
| `src/state/index.ts` | Public entry point. Import everything from here. |
| `src/state/schema.ts` | What a save contains: Zod schemas and types (`SaveData`, `SavedPokemon`, …) and the limits (`PARTY_SIZE`, `MAX_MONEY`, …). |
| `src/state/GameState.ts` | `GameState`: the data and every way to change it. |
| `src/state/pokemon.ts` | `createPokemon()`, `isFainted()`, `healed()`. |
| `src/state/SaveManager.ts` | `SaveManager`: slots, storage, versions, export/import. `SaveError`. |
| `src/state/session.ts` | `getGameState()`, `setGameState()`: the game in progress. |
| `src/state/saves.ts` | `getSaveManager()`, `setSaveManager()`: the game's shared `SaveManager`. |
| `src/state/battle.ts` | `partyBattle()`: takes the party into a battle and brings the result back. |
| `src/state/experience.ts` | `expForLevel()`, `levelForExp()`, `expGain()`, `addEvs()`, `levelUpMoves()`: growth curves, the experience formula, effort values and level-up moves. |
| `src/state/evolution.ts` | `findEvolution()`, `evolvePokemon()`, `evolvedAbility()`: evolving on level-up. |
| `src/state/state.test.ts` | Tests. Run with `npm test`. |
| `src/ui/useGameState.ts` | `useGameState()`: the React hook. |
| `src/game/scenes/Battle.ts` | The battle scene; `usePlayerParty: true` makes it use the saved party. |

---

## 3. Quick start

```ts
import { GameState, SaveManager, createPokemon, setGameState } from '../../state';

// New game
const state = GameState.create({ name: 'Red' });
setGameState(state);

state.addToParty(createPokemon({
    species: 'pikachu', level: 5, ability: 'static', moves: ['thundershock', 'growl'],
}));
state.addItem('potion', 3, 'medicine');
state.setFlag('got_starter');
state.setPosition({ map: 'pallettown', x: 5, y: 7, facing: 'down' });

// Save to slot 0, and later continue from it
const saves = new SaveManager();
saves.save(0, state);
setGameState(saves.load(0));
```

---

## 4. What is saved

`SaveData` (in `src/state/schema.ts`):

```
SaveData
├─ language   "de"                                    the game's language; set once, never changed
├─ player     { name, trainerId, money, playTimeMs,
│               position { map, x, y, facing } }
├─ party      SavedPokemon[]                          0 to 6
├─ pc         { current, boxes: [{ name, slots }] }   30 boxes of 30; an empty slot is null
├─ bag        { medicine: [{ item, quantity }], pokeballs: […], … }   one list per pocket
├─ flags      { got_starter: true, … }                yes/no facts
├─ variables  { badges: 3, rival_name: "Blue", … }    numbers and text
├─ dialogue   { sample: "…" }                         ink story states
├─ selfSwitches { "route1:12:A": true, … }            event self switches that are on
├─ hiddenEvents { "route1:7": true, … }               events hidden with the `hide` command
├─ story      { main: "got_starter", … }              last milestone of each story track
└─ pokedex    { eevee: { seen, owned, languages: ["de", "ja"] }, … }
```

`language` is chosen on the New Game language menu (`GameState.create({ language })`,
`startNewGame()` in `src/world/newGame.ts`) and has no setter. Every `SavedPokemon` has a
`language` too: the save's for the player's own Pokémon, its own for traded ones. The
Pokédex records seen and owned species and the languages owned, which unlock foreign
Pokédex entries (`getPokedexEntry()`, `markSeen()`, `registerOwned()`,
`pokedexLanguages()`). See `docs/LOCALIZATION.md` §6 and §9. These fields are part of
save version 1: the engine is unreleased, so `SAVE_VERSION` is raised only with the first
published major version.

The last three belong to the event system (see `docs/EVENT_SYSTEM.md`). They were added
without changing `SAVE_VERSION`: older files that lack them load with empty values.
While a cutscene or battle runs, `SaveManager.save()` throws `SaveError` with code `busy`
(see `blockSaving()` in `src/state/session.ts`); check `isSavingBlocked()` to grey out a
Save option.

- `position.x` and `position.y` are tiles on `position.map`; `facing` is `up`, `down`,
  `left` or `right`.
- The bag pockets are the ones in the item data (`ItemPocket` in
  `src/data/schemas/engine.ts`). Items keep the order they were added in.
- A flag that was never set reads as `false`. A variable that was never set reads as
  `undefined`.
- Use **flags** for things that happened (`beat_brock`) and **variables** for amounts and
  names. Values an ink story needs can be copied in with `dialogue.setVariable()`.

A new game has 30 boxes of 30. Pass `boxCount` and `boxSize` to `GameState.create()` for a
different PC.

---

## 5. Changing the state

Read with `getSnapshot()`, change with the methods. Never edit the snapshot itself: the
UI only notices changes made through the methods.

```ts
const data = state.getSnapshot();      // read-only SaveData
data.party[0].level;
data.player.money;
```

| Area | Methods |
|------|---------|
| Party | `addToParty(pokemon)`, `removeFromParty(index)`, `swapParty(a, b)`, `healParty()` |
| Any owned Pokémon | `findPokemon(uid)`, `updatePokemon(uid, change)`, `isTraded(pokemon)` |
| Moves | `learnMove(uid, move)`, `forgetMove(uid, move)`, `relearnMove(uid, move, replace?)` (see [the move bank](#new-moves-and-the-move-bank)) |
| PC | `deposit(index, target?)`, `withdraw(from)`, `movePokemon(from, to)`, `removeFromPc(from)`, `renameBox(box, name)`, `setCurrentBox(box)` |
| Bag | `addItem(item, quantity?, pocket?)`, `removeItem(item, quantity?)`, `countItem(item)` |
| Flags, variables | `getFlag(name)`, `setFlag(name, value?)`, `getVar(name)`, `setVar(name, value)` |
| Player | `setPlayerName(name)`, `setPosition(position)`, `addMoney(amount)`, `addPlayTime(ms)` |
| Dialogue | `getDialogueState(story)`, `setDialogueState(story, json)` |

Things worth knowing:

- `addToParty()` puts the Pokémon in the PC when the party is full (first free slot from
  the current box onwards) and returns where it went, or `null` if everything is full.
- `addItem()` needs the pocket the first time an item is added; take it from the item
  data (`ItemInfo.pocket`). It returns `false` instead of going above 999.
- `removeItem()` and `addMoney()` return `false` and change nothing if the player does not
  have enough. That makes shop code short:

  ```ts
  if (state.addMoney(-price)) state.addItem('potion', 1, 'medicine');
  ```
- PC slots are `{ box, slot }`, both counted from 0.
- Call `addPlayTime(delta)` from a scene's `update(time, delta)` to count time played.

To be told of changes outside React:

```ts
const stop = state.subscribe(() => console.log(state.getSnapshot().player.money));
stop();   // when no longer interested
```

---

## 6. Pokémon

A `SavedPokemon` stores what makes one Pokémon itself: `uid`, `species`, `nickname`,
`level`, `exp`, `ivs`, `evs`, `nature`, `ability`, `item`, `moves`, `moveBank`, `hp`,
`status`,
`shiny`, `gender`, `friendship`, `ball`, `teraType`, `ot` (original trainer) and `met`
(map, level, date). IDs are Showdown IDs, as in the game data (`toID('Mr. Mime')` →
`mrmime`).

Two rules keep it small and independent of the species data:

- **Stats are not stored.** They follow from species, level, IVs, EVs and nature; the
  battle simulator works them out.
- **"Full" is stored by leaving the value out.** No `hp` means full HP, a move without
  `pp` has all its PP, no `status` means healthy. `hp: 0` means fainted.

`createPokemon()` fills in the rest (random IVs and nature, a new `uid`, today's date):

```ts
const pikachu = createPokemon({
    species: 'pikachu', level: 5, ability: 'static', moves: ['thundershock', 'growl'],
    nickname: 'Sparky', gender: 'F',
    ot: { name: data.player.name, id: data.player.trainerId }, metMap: 'route1',
});
```

Gender, ability and starting moves depend on the species data, so the caller chooses
them. Change a Pokémon later through its `uid`, wherever it is:

```ts
state.updatePokemon(uid, { level: 16, species: 'ivysaur' });
state.updatePokemon(uid, ({ status, ...rest }) => rest);     // remove an optional field
```

---

## 7. Saving and loading

The game shares one manager, `getSaveManager()` (`src/state/saves.ts`): the title screen's
Continue menu reads it, and anything that saves should use it too. It keeps saves in
`localStorage`, or in memory (with a warning) where there is none. Call
`setSaveManager({ slots: 5 })` (or pass a `SaveManager`) before the title screen to change it.

```ts
const saves = getSaveManager();         // or new SaveManager(): 3 slots (0, 1, 2) in localStorage

saves.save(0, state);                   // write
const state = saves.load(0);            // read into a new GameState
saves.delete(0);
```

`load()` returns a new `GameState`; call `setGameState()` to make it the game in progress.

For a "Continue" screen, `list()` describes every slot without throwing (the title screen's
New Game / Continue menu is built on it, see `docs/TITLE_SCREEN.md`):

```ts
for (const info of saves.list())
{
    if (info.status === 'empty') { /* "New game" */ }
    else if (info.status === 'ok')
    {
        const { playerName, playTimeMs, map, party, savedAt, badges, pokedexOwned, language } = info.summary;
        //  party: [{ species, level, shiny, gender }], first Pokémon first
    }
    else { /* info.error.code: the file cannot be read */ }
}
```

Failures are `SaveError`s with a `code`:

| Code | Meaning |
|------|---------|
| `empty` | The slot holds nothing. |
| `corrupt` | The text is not a save file. |
| `newer` | The file was written by a later version of the game. |
| `invalid` | It is a save file, but its data is not valid. The message says which field. |
| `storage` | There is no storage, or it refused the write (full, private browsing). |

```ts
try { setGameState(saves.load(slot)); }
catch (error)
{
    if (error instanceof SaveError && error.code === 'newer') showMessage('Update the game to load this save.');
    else throw error;
}
```

Reading never changes what is stored, so an unreadable file is still there afterwards.

---

## 8. Storage, export and import

Each slot is one JSON text under the key `stab-engine:save:<slot>`:

```json
{ "version": 1, "savedAt": "2026-01-02T03:04:05.000Z", "data": { "player": { }, "party": [ ] } }
```

Anything with `getItem`, `setItem` and `removeItem` can store saves:

```ts
new SaveManager({ storage: new MemoryStorage() });            // tests, Node
new SaveManager({ storage: myFileStorage, slots: 1, prefix: 'mygame:save:' });
```

Set `prefix` if two games are served from the same site, so they do not share slots.

To let players back up a save or move it to another device:

```ts
const text = saves.exportSave(0);       // offer it as a download
saves.importSave(0, text);              // checked first; a bad file leaves the slot alone
```

---

## 9. Changing the save format (versions and migrations)

When you add, rename or remove something in `SaveData`:

1. Change the schema in `src/state/schema.ts`.
2. Raise `SAVE_VERSION` in `src/state/SaveManager.ts`.
3. Add a function to `MIGRATIONS` that upgrades the **previous** version's data:

```ts
export const SAVE_VERSION = 2;

export const MIGRATIONS: Record<number, Migration> = {
    // version 1 → 2: the Pokédex was added
    1: (data) => ({ ...(data as object), pokedex: { seen: [], caught: [] } }),
};
```

An older file goes through every step in turn (1 → 2 → 3 …) and is then checked against the
schema. Players' existing saves keep working. The stored file is only rewritten on the
next save.

---

## 10. Battles with the saved party

Start the battle scene with `usePlayerParty: true`:

```ts
const data: BattleSceneData = {
    usePlayerParty: true,
    options: {
        p1: { team: '' },    // name and team come from the game state
        p2: { name: 'Rival', team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
    },
};
this.scene.start(BATTLE_SCENE_KEY, data);
```

- The party enters the battle with its saved HP, status conditions and PP.
- Fainted Pokémon are left out of the team. If nobody can fight, the scene throws.
- Every opponent that faints gives the party experience and effort values. A Pokémon
  that reaches a new level grows at once and learns that level's moves (see below).
- When the battle ends (or the scene is left early), HP, status, PP, experience, level,
  effort values and moves are written back to the game state. Then
  `GameEvents.BATTLE_EVOLUTIONS` is emitted if anyone can evolve, then
  `GameEvents.BATTLE_END`.

### Experience, effort values and level-ups

The simulator has no experience points, so `src/state` adds them:

- **Who gets it:** every party member in the battle that has not fainted, as in
  Generation 9. Those that were not on the field against the defeated Pokémon get half
  the experience.
- **How much:** the formula of Generation 7 onwards (`expGain()` in
  `src/state/experience.ts`), from the defeated species' `baseExp` and level and the
  receiver's level. A traded Pokémon gets 1.5×, and so does one holding a Lucky Egg
  (2.25× for both).
- **Traded** means the Pokémon's original trainer ID is not the player's
  (`state.isTraded()`). `addToParty()` makes the player the original trainer of a Pokémon
  that has none, so give gift and in-game trade Pokémon an `ot` in `createPokemon()`.
- **Effort values:** the defeated species' `evYield` goes to the same Pokémon, level 100
  included, up to 252 per stat and 510 in total (`addEvs()`). Stats are worked out again
  at once.
- **Level-ups happen during the battle.** The Pokémon's level and stats change in the
  running battle and its HP rises with its maximum HP. Levels follow the species'
  `growthRate` (`expForLevel()` / `levelForExp()`), up to level 100.
- **The new level is shown at once.** A `|detailschange|` protocol line is sent for the
  Pokémon, on the field or on the bench, so `BattleSnapshot` has the new level by the
  time the "grew to" message is presented.

### New moves and the move bank

A Pokémon that levels up learns the moves of the levels it passed (the species'
level-up list in `learnsets.json`, Generation 9 by default):

- With a free move slot, the move is **ready at once** and can be used in the same battle.
- With four moves already, nothing is forgotten: the move goes to the Pokémon's **move
  bank** (`SavedPokemon.moveBank`).

Outside battle the player rearranges moves freely, as in Generation 9:

```ts
state.relearnMove(uid, 'electroball', 'growl');   // bank → ready, Growl goes to the bank
state.relearnMove(uid, 'growl');                  // into a free slot
state.forgetMove(uid, 'tailwhip');                // ready → bank (not the last move)
state.learnMove(uid, 'thunderbolt');              // a TM: ready if there is room, else the bank
```

A move taken from the bank has full PP. PP Ups used on a move are lost when it goes to
the bank.

### Battle text

Each of these adds a `|-message|` line to the protocol, in order, right after the
opponent faints:

```
Sparky gained 530 Exp. Points!
Sparky grew to Lv. 12!
Sparky learned Electro Ball! It was stored in its move bank.
Bulbasaur learned Growth!
```

The lines carry text keys (`battle.exp.gained`, `battle.exp.level`, `battle.move.learned`,
`battle.move.banked`) and their values, made by `encodeTextMessage()`. The battle's
narrator shows them in the game's language, like every other line of battle text, so a
message box that prints `snapshot.step.text` shows them with no extra code; without a
narrator they are shown in English (above). `messages: false` leaves the lines out.

### Evolution after the battle

`finish()` also reports which party members levelled up and can now evolve. The battle
scene passes that on as an event just before `BATTLE_END`, and only when there is
something to evolve:

```ts
EventBus.on(GameEvents.BATTLE_EVOLUTIONS, (evolutions: PendingEvolution[]) =>
{
    // [{ uid, from: 'caterpie', into: 'metapod' }, …] in party order
});
```

Nothing has changed yet at that point. The evolution scene shows each one and, unless
the player cancels it, makes it happen:

```ts
const { pokedex, learnsets } = await loadPbs(['pokedex', 'learnsets']);
const { pokemon } = state.findPokemon(uid)!;

evolvePokemon(state, uid, into, {
    ability: evolvedAbility(pokedex[from].abilities, pokedex[into].abilities, pokemon.ability),
    moves: levelUpMoves(learnsets[into]?.learnset, -1, 0),     // moves learned on evolving
});
```

`evolvePokemon()` changes the species and keeps everything else (nickname, level, HP,
`uid`). `findEvolution()` is the rule behind the list: `level-up` methods only, with these
conditions checked: level, gender, held item, a known move or move type, friendship,
Attack against Defense, a species or type in the party, and the time of day (pass
`timeOfDay` in the `exp` options, otherwise those evolutions do not happen). An Everstone
prevents evolution. Methods that depend on the overworld (a location, rain, steps) and
the other triggers (items, trades) are for the code that handles those.

The scene loads the `speciesInfo` and `learnsets` tables before a party battle starts
(`learnsets.json` is about 4.6 MB, fetched once and then cached).
Pass `exp: false` in `BattleSceneData` for a battle that should give none of this; the
tables are then not loaded.

Not done yet: the sequences themselves (there is no evolution scene), and items that
change the effort values gained (Macho Brace, Power items).

Outside the scene (tests, your own battle code), use `partyBattle()` directly. Leave out
`exp` and the party gains no experience:

```ts
const { speciesInfo, learnsets } = await loadPbs(['speciesInfo', 'learnsets']);
const link = partyBattle(state, {
    exp: { species: (id) => speciesInfo[id], learnset: (id) => learnsets[id] },
});
const bridge = new BattleBridge({
    p1: { name: 'Red', team: link.team },
    p2: { name: 'Rival', team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
    prepare: link.prepare,
});
// … once the battle has ended, and before bridge.destroy():
const { gains, evolutions } = link.finish();
// gains:      [{ uid, gained, fromLevel, toLevel, learned, banked, evs }, …]
// evolutions: [{ uid, from, into }, …]
```

---

## 11. Dialogue

An ink story's position, variables and visit counts are saved with the game by handing
them to the state under a name of your choice:

```ts
state.setDialogueState('sample', dialogue.save());       // before saving

const json = state.getDialogueState('sample');           // after loading
if (json) dialogue.load(json);
```

See [DIALOGUE_SYSTEM.md](DIALOGUE_SYSTEM.md#9-saving-and-loading).

---

## 12. Using it from Phaser and React

In a scene:

```ts
import { requireGameState } from '../../state';

create ()
{
    const state = requireGameState();                    // throws if no game was started
    const { map, x, y, facing } = state.getSnapshot().player.position;
    // … place the player
}

update (_time: number, delta: number)
{
    requireGameState().addPlayTime(delta);
}
```

The overworld already counts play time this way (adding it once a second, so the state's
listeners are not woken every frame), which is what the Continue panel shows.

In a component, `useGameState()` returns the current data and re-renders when it changes:

```tsx
import { useGameState } from './ui';

function MoneyCounter ()
{
    const game = useGameState();
    if (!game) return null;                              // no game started yet
    return <div style={{ position: 'absolute', right: 4, top: 4 }}>$ {game.player.money}</div>;
}
```

To change something from a component, call the methods of `getGameState()`.

---

## 13. API reference

**`GameState`**

| Member | Description |
|--------|-------------|
| `GameState.create(options?)` | New game. Options: `name`, `trainerId`, `money`, `position`, `boxCount`, `boxSize`. |
| `GameState.fromJSON(data)` | Rebuild from `toJSON()` data. Throws if it is not valid. |
| `toJSON()` | A deep copy of the data, ready for `JSON.stringify()`. |
| `getSnapshot()` | The current data (read-only). Same object until something changes. |
| `subscribe(listener)` | Called after every change. Returns a function that unsubscribes. |
| Changing methods | See [section 5](#5-changing-the-state). |

**`SaveManager`**

| Member | Description |
|--------|-------------|
| `new SaveManager(options?)` | Options: `storage`, `slots`, `prefix`, `now`. |
| `save(slot, state)` | Write a slot. Returns a `SaveSummary`. |
| `load(slot)` | Read a slot into a new `GameState`. |
| `has(slot)`, `delete(slot)` | Whether a slot holds anything; erase it. |
| `list()` | One `SlotInfo` per slot: `empty`, `ok` (with `summary`) or `error`. |
| `exportSave(slot)`, `importSave(slot, json)` | Save file text out and in. |
| `getSaveManager()`, `setSaveManager(options)` | The game's shared manager (`src/state/saves.ts`). |

A `SaveSummary` holds `slot`, `savedAt`, `playerName`, `playTimeMs`, `map`, `party`
(`{ species, level, shiny, gender }` each), `badges` (the `badges` variable), `pokedexOwned`
and `language`: what a Continue panel shows, without loading the save.

**Functions**

| Function | Description |
|----------|-------------|
| `getGameState()`, `requireGameState()` | The game in progress (`null`, or an error, if there is none). |
| `setGameState(state)` | Set or clear the game in progress. |
| `subscribeGameState(listener)` | Called when a different game becomes the one in progress. |
| `createPokemon(options, random?)` | A new `SavedPokemon` at full health. |
| `isFainted(pokemon)`, `healed(pokemon)` | HP is 0; a fully restored copy. |
| `partyBattle(state, options?)` | `{ team, uids, prepare, finish }` for a battle. Options: `side`, `exp`. |
| `expForLevel(growth, level)`, `levelForExp(growth, exp)` | Total experience at a level, and the level for an amount of experience. |
| `expGain(input)` | Experience for defeating one Pokémon. |
| `addEvs(evs, gained)` | Effort values after a gain, within the limits. |
| `levelUpMoves(learnset, fromLevel, toLevel, gen?)` | Moves learned between two levels. |
| `findEvolution(pokemon, methods, context?)` | The species a Pokémon evolves into after a level-up, or `null`. |
| `evolvePokemon(state, uid, into, options?)` | Change a Pokémon's species (and ability, and teach it moves). |
| `evolvedAbility(from, into, ability)` | The ability in the same slot on the evolved species. |
| `parseSaveFile(json)` | Check and upgrade save file text without a `SaveManager`. |
| `useGameState()` | React hook (`src/ui`). |

---

## 14. Troubleshooting

| Problem | Cause and fix |
|---------|---------------|
| `[save] localStorage is not available here` | Running in Node, or the browser blocks storage. Pass `{ storage: new MemoryStorage() }` or your own storage. |
| `[state] invalid save data: party.0.level: …` | The data does not match the schema. The path names the field. |
| `[state] no game in progress` | `requireGameState()` was called before `setGameState()`. Start or load a game first. |
| `[state] addItem: "x" is not in the bag yet, so its pocket is needed` | Pass the pocket as the third argument the first time an item is added. |
| The UI does not update | The snapshot was edited directly. Use the `GameState` methods. |
| Old saves stop loading after a schema change | `SAVE_VERSION` was not raised, or the migration is missing. See [section 9](#9-changing-the-save-format-versions-and-migrations). |
| `[state] partyBattle: the party has no Pokémon that can fight` | The party is empty or everyone has fainted. Heal with `healParty()` or check before starting a battle. |
