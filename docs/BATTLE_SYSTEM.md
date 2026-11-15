# Battle System

STAB-engine uses the **Pokémon Showdown** battle simulator for its battles, through the
[`@pkmn/sim`](https://www.npmjs.com/package/@pkmn/sim) npm package. Showdown handles all of
the battle rules: damage formulas, abilities, items, weather, status, every move and
Pokémon. The engine sends it decisions and shows the results.

Three companion packages from the same [pkmn project](https://github.com/pkmn/ps) are also
included:

| Package | Used for |
|---------|----------|
| [`@pkmn/sim`](https://www.npmjs.com/package/@pkmn/sim) | The battle simulator itself. |
| [`@pkmn/client`](https://www.npmjs.com/package/@pkmn/client) | Keeps a live model of the battle (HP, status, boosts, field) for the UI. Comes with [`@pkmn/data`](https://www.npmjs.com/package/@pkmn/data). |
| [`@pkmn/protocol`](https://www.npmjs.com/package/@pkmn/protocol) | Fully typed parsing of the simulator's output. |
| [`@pkmn/mods`](https://www.npmjs.com/package/@pkmn/mods) | Extra rule/data sets such as Let's Go, FireRed/LeafGreen or Platinum. |

This page covers how the integration is built, how to use it from a Phaser scene, and how
to change teams, formats and the AI.

---

## Contents

1. [Overview](#1-overview)
2. [File map](#2-file-map)
3. [Quick start](#3-quick-start)
4. [The battle loop: requests and choices](#4-the-battle-loop-requests-and-choices)
5. [Reading the protocol](#5-reading-the-protocol) (incl. typed parsing with `@pkmn/protocol`)
6. [Battle state (`@pkmn/client`)](#6-battle-state-pkmnclient)
7. [Teams](#7-teams)
8. [Formats](#8-formats)
9. [Mods (`@pkmn/mods`)](#9-mods-pkmnmods)
10. [AI opponents](#10-ai-opponents)
11. [Reproducible battles (seeds)](#11-reproducible-battles-seeds)
12. [Using it from Phaser](#12-using-it-from-phaser)
13. [API reference](#13-api-reference)
14. [Troubleshooting](#14-troubleshooting)
15. [Further reading](#15-further-reading)

---

## 1. Overview

```
┌──────────────────────┐   chooseMove()/chooseSwitch()   ┌─────────────────────┐   ">p1 move 1"    ┌──────────────────┐
│  Phaser scene / your │ ──────────────────────────────▶ │    BattleEngine     │ ────────────────▶ │  @pkmn/sim       │
│  game code           │                                 │  (src/battle)       │                   │  BattleStream    │
│                      │ ◀────────────────────────────── │                     │ ◀──────────────── │  (Showdown sim)  │
└──────────────────────┘  onRequest / onProtocol / onEnd └──────────┬──────────┘  protocol lines   └──────────────────┘
           ▲                                                        │ every line + request                ▲
           │ reads engine.state                                     ▼                                     │ Dex.mod()
           │                                             ┌─────────────────────┐                 ┌──────────────────┐
           └──────────────────────────────────────────── │  BattleState        │                 │  loadMod()       │
                                                         │  (@pkmn/client)     │                 │  (@pkmn/mods)    │
                                                         └─────────────────────┘                 └──────────────────┘
```

- **`@pkmn/sim`** is the Showdown simulator, packaged so it runs in the browser. It works
  through text streams: you write commands like `>p1 move 1` and it writes back
  [protocol](#5-reading-the-protocol) lines like `|move|p1a: Pikachu|Thunderbolt|p2a: Blastoise`.
- **`BattleEngine`** (`src/battle/BattleEngine.ts`) wraps those streams in a few
  callbacks and methods, so game code doesn't need to manage streams itself.
- **`BattleState`** (`src/battle/BattleState.ts`) is fed every line automatically and
  keeps a model of the battle that the game can read at any time (`engine.state`).
- **`loadMod()`** (`src/battle/mods.ts`) loads optional rule/data mods before a battle.
- **The game** (Phaser scenes) only listens to callbacks and calls methods. The battle
  layer does not import Phaser, so you can also run it in Node, in tests or on a server.

All of this runs locally in the player's browser. It does not connect to any Showdown server.

---

## 2. File map

| File | What it does |
|------|--------------|
| `src/battle/index.ts` | Public entry point. Import everything from here. |
| `src/battle/BattleEngine.ts` | Starts the simulator, routes requests/choices and detects the end of a battle. |
| `src/battle/types.ts` | TypeScript types for the request JSON (`BattleRequest`, `MoveRequest`, `SidePokemon`, …). |
| `src/battle/protocol.ts` | Helpers for reading protocol lines (`parseLine`, `parseHP`, `parseIdent`, `describeLine`) and request type guards (`isMoveRequest`, …). |
| `src/battle/teams.ts` | `importTeam()` to convert Showdown team text, plus two sample teams. |
| `src/battle/BattleState.ts` | `BattleState`: battle model built with `@pkmn/client`. Also `createGenerations()`. |
| `src/battle/mods.ts` | `loadMod()`: loads `@pkmn/mods` data on demand. |

The packages live in `node_modules/@pkmn/` and are listed in `package.json`. In production
builds Vite puts the simulator, client, protocol and data packages together in their own
file (`pkmn-*.js`, set by `manualChunks` in `vite/config.*.mjs`), so changes to your game
code don't force players to re-download them. Each mod gets its own file (`gen7letsgo-*.js`,
…) that is only downloaded when `loadMod()` asks for it.

> **After pulling changes, run `npm install`.** `node_modules` is not stored in git, so new
> packages only appear on your machine after an install. Until then VS Code shows
> "Cannot find module '@pkmn/…'".

---

## 3. Quick start

```ts
import {
    BattleEngine, importTeam, describeLine,
    isMoveRequest, isSwitchRequest, isTeamPreviewRequest,
    SAMPLE_TEAM_P1, SAMPLE_TEAM_P2,
} from '../battle';   // path relative to your file

const engine = new BattleEngine({
    p1: { name: 'Player', team: importTeam(SAMPLE_TEAM_P1) },
    p2: { name: 'Rival',  team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
});

// 1. Something happened: print it.
engine.onProtocol = (lines) => {
    for (const line of lines) {
        const text = describeLine(line);
        if (text) console.log(text);
    }
};

// 2. The player needs to decide something.
engine.onRequest = (side, request) => {
    if (isTeamPreviewRequest(request)) engine.choose(side, 'default'); // keep team order
    else if (isSwitchRequest(request))  engine.chooseSwitch(side, 2);  // send out party slot 2
    else if (isMoveRequest(request))    engine.chooseMove(side, 1);    // use move slot 1
    // a "wait" request needs no answer
};

// 3. Battle over.
engine.onEnd = (winner) => {
    console.log(winner ? `${winner} wins!` : 'Tie!');
    engine.destroy();
};

engine.start();
```

Sample output:

```
Pikachu was sent out! (Pikachu)
the opposing Blastoise was sent out! (Blastoise)
--- Turn 1 ---
Pikachu used Thunderbolt!
It's super effective!
the opposing Blastoise took damage. [2/362]
...
Rival won the battle!
```

> **Tip:** Set callbacks **before** `start()`. The first messages arrive straight after it.

---

## 4. The battle loop: requests and choices

A battle repeats one cycle:

```
            ┌────────────────────────────────────────────────────────┐
            ▼                                                        │
  onProtocol(lines)  →  onRequest(side, request)  →  engine.choose…()  ─┘
  (what happened)        (what can you do now?)       (your decision)
```

1. The simulator sends a batch of **protocol** lines (roughly one turn) to `onProtocol`.
2. For every side your code controls, it sends a **request** to `onRequest`.
3. You answer each request with **one** choice. Once every player has chosen, the turn is
   played out and the cycle starts again.
4. When someone wins, `onEnd(winner)` fires.

In practice the request comes right after the protocol batch for that turn. In a game you
will often still be animating the turn when it arrives, so keep it, finish the animations,
and then show the menu. `engine.requests.p1` always holds the latest unanswered request.

### Request kinds

| Kind | How to detect | What it means | How to answer |
|------|---------------|---------------|---------------|
| Team Preview | `isTeamPreviewRequest(req)` | Pick the lead/order. Formats with Team Preview only (includes `gen9customgame`). | `engine.choose(side, 'team 213456')` or `'default'` |
| Move | `isMoveRequest(req)` | Normal turn. `req.active[0].moves` lists the moves. | `engine.chooseMove(side, slot)` or `engine.chooseSwitch(side, slot)` |
| Forced switch | `isSwitchRequest(req)` | Your active Pokémon fainted (or used U-turn etc.). | `engine.chooseSwitch(side, slot)` |
| Wait | `isWaitRequest(req)` | The opponent is deciding (e.g. their Pokémon fainted). | Nothing. Just wait. |

### Useful request fields

```ts
request.side.pokemon            // whole party, in current order (slot 1 = index 0)
request.side.pokemon[i].condition // "120/211", "85/211 par", "0 fnt" → use parseHP()
request.side.pokemon[i].active  // true if on the field
request.active[0].moves[j]      // { move: 'Thunderbolt', id, pp, maxpp, disabled }
request.active[0].trapped       // true → switching is not allowed
request.active[0].canTerastallize // Tera type if Tera is available
```

All types are in `src/battle/types.ts`, so your editor will autocomplete them.

### Choice syntax

Slots count **from 1**.

| Choice | Example | Notes |
|--------|---------|-------|
| Use a move | `chooseMove('p1', 2)` → `move 2` | Slot in `request.active[0].moves`. |
| Move + gimmick | `chooseMove('p1', 1, 'terastallize')` | Also `mega`, `zmove`, `dynamax`. |
| Switch | `chooseSwitch('p1', 3)` → `switch 3` | Slot in `request.side.pokemon`. You cannot switch to the active or a fainted Pokémon. |
| Team order | `choose('p1', 'team 312')` | Team Preview only. |
| Let the sim pick | `choose('p1', 'default')` | Uses the first valid option. |
| Doubles | `choose('p1', 'move 1 2, move 3 -1')` | One choice per active slot, separated by commas, with targets. |

If a choice is invalid (a disabled move, switching while trapped…), `onError(side, message)` fires
and the simulator sends the request again, so the player can try again.

---

## 5. Reading the protocol

Each protocol line looks like `|command|arg1|arg2|[keyword] value`. Common ones:

| Line | Meaning |
|------|---------|
| `\|turn\|3` | Turn 3 begins. |
| `\|switch\|p1a: Pikachu\|Pikachu, L50, M\|120/211` | Pikachu was sent out with 120/211 HP. |
| `\|move\|p1a: Pikachu\|Thunderbolt\|p2a: Blastoise` | Pikachu used Thunderbolt on Blastoise. |
| `\|-damage\|p2a: Blastoise\|2/362` | Blastoise's HP is now 2/362. |
| `\|-damage\|p2a: Gengar\|235/261\|[from] item: Life Orb` | Damage from a non-move source. |
| `\|-heal\|p2a: Blastoise\|24/362\|[from] item: Leftovers` | HP restored. |
| `\|-supereffective\|p2a: Blastoise` | "It's super effective!" |
| `\|-status\|p1a: Pikachu\|par` | Pikachu is paralyzed. |
| `\|-boost\|p1a: Snorlax\|atk\|2` | Attack rose 2 stages. |
| `\|faint\|p1a: Pikachu` | Pikachu fainted. |
| `\|win\|Rival` | Rival won the battle. |

**Pokémon references.** `p2a: Blastoise` = player 2, field position **a**, nickname Blastoise.
`parseIdent()` splits it: `{ side: 'p2', position: 'a', name: 'Blastoise' }`.

**HP.** `parseHP('85/211 par')` → `{ hp: 85, maxhp: 211, status: 'par' }`. In formats with
the *HP Percentage Mod* rule (most competitive formats), the opponent's HP is reported out
of 100.

**Helpers in `protocol.ts`:**

```ts
const p = parseLine('|-damage|p2a: Gengar|235/261|[from] item: Life Orb');
// p.cmd    → '-damage'
// p.args   → ['p2a: Gengar', '235/261']
// p.kwArgs → { from: 'item: Life Orb' }

describeLine(p); // → "the opposing Gengar took damage (Life Orb). [235/261]"
```

`describeLine()` only covers the common commands and returns `null` for everything else, so
it's a starting point for a battle log. For a full UI you will usually `switch` on
`parseLine(line).cmd` yourself and play animations or update HP bars.

Lines are reported from **player 1's** point of view by default (`perspective: 'p1'`). Use
`'spectator'` or `'omniscient'` for other views (e.g. replays or debugging).

### Typed parsing with `@pkmn/protocol`

`parseLine()` gives you plain strings. For larger UIs, `@pkmn/protocol` knows the exact shape
of **every** protocol command, so TypeScript can check your code. `parseTyped(chunk)` wraps
its `Protocol.parse()`, and a `Handler` is an object with one method per command you care
about:

```ts
import { Protocol, parseTyped } from '../battle';
import type { Handler } from '../battle';

class LogHandler implements Handler<void>
{
    '|move|' (args: Protocol.Args['|move|'])
    {
        const [, user, move] = args;              // typed: PokemonIdent, MoveName
        console.log(`${user} used ${move}`);
    }

    '|-damage|' (args: Protocol.Args['|-damage|'], kwArgs: Protocol.KWArgs['|-damage|'])
    {
        const [, target, hp] = args;
        console.log(`${target} → ${hp}`, kwArgs.from ?? '');
    }
}

const handler = new LogHandler();
engine.onProtocol = (lines) => {
    for (const { args, kwArgs } of parseTyped(lines.join('\n'))) {
        const key = Protocol.key(args);           // e.g. '|move|'
        if (key && key in handler) (handler as any)[key](args, kwArgs);
    }
};
```

`Protocol` also has helpers such as `Protocol.parsePokemonIdent()`, `Protocol.parseHealth()`
and `Protocol.parseDetails()`.

---

## 6. Battle state (`@pkmn/client`)

Protocol lines tell you what *changed*. Often you just want to know what things look like
*now*: "what's the foe's HP? Is it burned? Did its Attack go up? Is it raining?"
`@pkmn/client` answers that. It is the battle-tracking part of the Pokémon Showdown website,
packaged separately.

`BattleEngine` creates a `BattleState` for you and keeps it current. Every protocol line, and
your side's requests, are fed in **before** `onProtocol` / `onRequest` run, so you can read
`engine.state` from inside those callbacks:

```ts
engine.onProtocol = () => {
    const me  = engine.state.me.active[0];        // your active Pokémon
    const foe = engine.state.foe.active[0];       // the opponent's active Pokémon
    if (me && foe) {
        console.log(`${me.name} ${me.hp}/${me.maxhp} vs ${foe.name} ${foe.hp}/${foe.maxhp}`);
        console.log('Foe status:', foe.status ?? 'none', 'boosts:', foe.boosts);
    }
    console.log('Turn', engine.state.turn, 'weather:', engine.state.battle.field.weather ?? 'none');
};
```

Useful things to read (all from `@pkmn/client`; hover in VS Code for the full list):

| Path | What it is |
|------|------------|
| `state.me` / `state.foe` | Your side / the opponent's side (`Side`). |
| `side.active[0]` | Active Pokémon (`Pokemon`), or `null`. In doubles also `active[1]`. |
| `side.team` | Every Pokémon seen so far on that side. |
| `side.sideConditions` | Hazards and screens (Stealth Rock, Reflect…). |
| `pokemon.hp`, `.maxhp`, `.fainted` | HP. For the foe in formats with *HP Percentage Mod* this is out of 100. |
| `pokemon.status` | `'brn'`, `'par'`, `'slp'`, `'frz'`, `'psn'`, `'tox'` or `undefined`. |
| `pokemon.boosts` | Stat stages, e.g. `{ atk: 2, spe: -1 }`. |
| `pokemon.volatiles` | Temporary effects (confusion, Substitute, Leech Seed…). |
| `pokemon.speciesForme`, `.level`, `.shiny`, `.gender` | Details for picking sprites. |
| `pokemon.moveSlots`, `.item`, `.ability` | What has been revealed (everything, for your own side). |
| `state.battle.field` | Weather, terrain and pseudo-weather (Trick Room…). |
| `state.turn` | Current turn number. |

`state.battle` is the full `@pkmn/client` `Battle` object if you need more. The state is
viewed from the same player as `perspective` (`'p1'` by default).

`createGenerations()` returns the shared `Generations` object that `@pkmn/client` uses. It is
built from `@pkmn/sim`'s data, and you can use it for Pokédex lookups in your UI:

```ts
import { createGenerations } from '../battle';
const gen9 = createGenerations().get(9);
gen9.species.get('Pikachu')?.baseStats;   // { hp: 35, atk: 55, ... }
gen9.moves.get('Thunderbolt')?.basePower; // 90
```

---

## 7. Teams

Teams are written in **Showdown export format**, the same text the
[Showdown Teambuilder](https://play.pokemonshowdown.com/teambuilder) produces with
*Import/Export*:

```
Pikachu @ Light Ball
Ability: Static
Level: 50
Tera Type: Electric
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Thunderbolt
- Volt Switch
- Grass Knot
- Surf
```

- One Pokémon per paragraph (separate them with a blank line), up to 6.
- Leave a line out to get the default (Level defaults to 100, IVs to 31, no EVs).
- Nicknames: `Sparky (Pikachu) @ Light Ball`.

Turn the text into the simulator's compact *packed* format with `importTeam()`:

```ts
import { importTeam } from '../battle';

const team = importTeam(myTeamText);   // throws if nothing could be parsed
new BattleEngine({ p1: { team }, p2: { team: rivalTeam, ai: 'random' } });
```

`src/battle/teams.ts` has `SAMPLE_TEAM_P1` and `SAMPLE_TEAM_P2`. Edit them, or add your own
constants or files next to them.

> **Fan-made Pokémon/moves:** these need custom data registered with `Dex.mod()` from
> `@pkmn/sim`. That is the same mechanism `loadMod()` uses (see [Mods](#9-mods-pkmnmods)), but no
> custom data has been set up yet. See [Further reading](#15-further-reading).

---

## 8. Formats

Set the format with `formatid` (default `gen9customgame`):

```ts
new BattleEngine({ formatid: 'gen9customgame', p1, p2 });
```

| Format ID | Notes |
|-----------|-------|
| `gen9customgame` | Any team, no legality checks, Team Preview, exact HP for both sides. Best for a fan game. |
| `gen9doublescustomgame` | Same but double battles (two active Pokémon per side). |
| `gen9ou`, `gen9ubers`, … | Competitive formats with their clauses (Sleep Clause, HP percentage, etc.). |
| `gen1customgame` … `gen8customgame` | Older-generation mechanics. |
| `gen9randombattle` | **Not supported yet.** Random teams need the extra `@pkmn/randoms` package. |
| Mod formats (`gen7letsgoou`, `gen3frlgou`, …) | Load the mod first and pass its Dex. See [Mods](#9-mods-pkmnmods). |

If `formatid` doesn't exist, `new BattleEngine()` throws an error straight away instead of
quietly running a different format.

The engine does **not** validate teams. If you need legality checks, run `TeamValidator`
from `@pkmn/sim` on the team before starting.

---

## 9. Mods (`@pkmn/mods`)

A **mod** puts a different set of data or mechanics on top of a base generation. `@pkmn/mods`
includes these:

| Mod ID | What it is |
|--------|------------|
| `gen1jpn` | Gen 1 with Japanese-version mechanics |
| `gen1stadium` | Pokémon Stadium |
| `gen2stadium2` | Pokémon Stadium 2 |
| `gen3frlg` | FireRed / LeafGreen (+ Ruby / Sapphire) data |
| `gen3rs` | Ruby / Sapphire only |
| `gen4pt` | Diamond / Pearl / Platinum only |
| `gen5bw1` | Black / White (not B2W2) |
| `gen6xy` | X / Y (not ORAS) |
| `gen7sm` | Sun / Moon (not USUM) |
| `gen7letsgo` | Let's Go Pikachu / Eevee |
| `gen8dlc1` | Sword / Shield + Isle of Armor (no Crown Tundra) |
| `gen9dlc1` | Scarlet / Violet + Teal Mask (no Indigo Disk) |
| `gen9predlc` | Scarlet / Violet with no DLC (needs `gen9dlc1`; loaded automatically) |
| `champions` | Pokémon Champions |
| `championsregmb` | Champions Regulation M-B (needs `champions`; loaded automatically) |

(`gen8bdsp` and `gen8legends` are already built into `@pkmn/sim`.)

Load a mod with `loadMod()`. It is `async`, because each mod is a separate download, so
`await` it. Then pass the Dex it returns to `BattleEngine` to use that mod's formats:

```ts
import { BattleEngine, loadMod } from '../battle';

const letsGoDex = await loadMod('gen7letsgo');

const engine = new BattleEngine({
    formatid: 'gen7letsgoou',   // a format defined by the mod
    dex: letsGoDex,             // required for mod formats
    p1, p2,
});
```

- Calling `loadMod()` again for the same mod returns the same result without downloading it again.
- The returned Dex can look up that mod's data: `letsGoDex.species.get('Pikachu-Starter')`.
- `MOD_IDS` lists every mod ID (useful for a debug menu). The `ModID` type gives you autocomplete.
- Each mod's formats are listed in `node_modules/@pkmn/mods/build/<mod>/formats.d.ts`,
  for example `gen7letsgoou`, `gen3frlgou`, `gen4platinumou`, `gen9dlc1ou`.
- `engine.state` follows the battle's generation (e.g. Gen 7 for Let's Go). It uses the
  standard data for that generation, not the mod's own data, which matters only if a mod adds
  brand-new Pokémon or moves.

> **Build note:** the mods contain a lot of data (about 100 MB before minifying), so the
> production build needs more memory than Node's default. The `build` scripts in
> `package.json` already raise the limit to 4 GB (`--max-old-space-size=4096`). If your game
> will never use some mods, delete their lines from `MOD_LOADERS` in `src/battle/mods.ts` to
> speed up the build.

---

## 10. AI opponents

Give a side `ai: 'random'` and the built-in `RandomPlayerAI` from `@pkmn/sim` plays for it.
It picks random valid moves and switches. You get no `onRequest` calls for that side.

```ts
p2: { name: 'Wild Pidgey', team, ai: 'random' }
```

You can control **both** sides from your own code (local two-player, scripted battles,
your own AI) by leaving `ai` out for both. `onRequest` is then called with `'p1'` and `'p2'`.

To write a smarter AI, either handle `onRequest` for `'p2'` with your own logic, or subclass
`RandomPlayerAI` / `BattleStreams.BattlePlayer` from `@pkmn/sim` and add a new `AIKind` in
`BattleEngine.start()`.

---

## 11. Reproducible battles (seeds)

Damage rolls, crits and accuracy are random. Pass a `seed` to replay the same battle
exactly, which helps when chasing bugs:

```ts
new BattleEngine({ p1, p2, seed: 'gen5,1,2,3,4' });
```

The same seed, teams and choices give the same battle. (The random AI is seeded separately,
so for a full replay control both sides yourself.)

---

## 12. Using it from Phaser

The battle layer doesn't depend on Phaser, so a battle scene just owns an engine:

```ts
import { Scene } from 'phaser';
import { BattleEngine, importTeam, isMoveRequest, SAMPLE_TEAM_P1, SAMPLE_TEAM_P2 } from '../../battle';
import type { BattleRequest } from '../../battle';

export class Battle extends Scene
{
    private engine: BattleEngine;

    constructor () { super('Battle'); }

    create ()
    {
        this.engine = new BattleEngine({
            p1: { name: 'Player', team: importTeam(SAMPLE_TEAM_P1) },
            p2: { name: 'Rival', team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
        });
        this.engine.onProtocol = () => {
            // engine.state is already up to date here: redraw HP bars from it.
            const foe = this.engine.state.foe.active[0];
            if (foe) console.log(`${foe.name}: ${foe.hp}/${foe.maxhp}`);
        };
        this.engine.onRequest = (_side, req) => this.showMenu(req);
        this.engine.onEnd = (winner) => { /* show result, then this.scene.start('Overworld') */ };

        // Stop the simulator when the scene shuts down.
        this.events.once('shutdown', () => this.engine.destroy());

        this.engine.start();
    }

    private showMenu (req: BattleRequest)
    {
        if (!isMoveRequest(req)) return;
        req.active[0].moves.forEach((m, i) => {
            this.add.text(40, 500 + i * 40, `${m.move} (${m.pp}/${m.maxpp})`)
                .setInteractive()
                .on('pointerdown', () => this.engine.chooseMove('p1', i + 1));
        });
    }
}
```

Remember to add the scene to the `scene` list in `src/game/main.ts`.

---

## 13. API reference

### `new BattleEngine(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `p1`, `p2` | `PlayerOptions` | required | `{ name?, team, ai? }`. `team` is a packed string from `importTeam()`. |
| `formatid` | `string` | `'gen9customgame'` | Showdown format ID. |
| `seed` | `PRNGSeed` | random | e.g. `'gen5,1,2,3,4'`. |
| `perspective` | `'p1' \| 'p2' \| 'spectator' \| 'omniscient'` | `'p1'` | Point of view for `onProtocol`. |
| `debug` | `boolean` | `false` | Log raw simulator output. |
| `dex` | `ModdedDex` | standard Dex | Needed for mod formats: pass `await loadMod('<mod>')`. |

Throws if `formatid` does not exist in the chosen Dex.

### Callbacks

| Callback | Called when |
|----------|-------------|
| `onProtocol(lines: string[])` | New protocol lines are available. |
| `onRequest(side, request)` | A side controlled by your code must decide. |
| `onError(side, message)` | A choice was rejected. Defaults to `console.warn`. |
| `onEnd(winner: string \| null)` | The battle ended (`null` = tie). |

### Methods and properties

| Member | Description |
|--------|-------------|
| `start()` | Starts the battle (call once). |
| `chooseMove(side, slot, extra?)` | `move <slot> [extra]`. |
| `chooseSwitch(side, slot)` | `switch <slot>`. |
| `choose(side, choice)` | Any raw choice string. |
| `forfeit(side)` | That side loses immediately. |
| `destroy()` | Stops the simulator. Call when leaving the battle. |
| `requests` | Latest unanswered request per side. |
| `ended` | `true` after the battle finished. |
| `state` | `BattleState`: live battle model (see [Battle state](#6-battle-state-pkmnclient)). |

### `BattleState`

| Member | Description |
|--------|-------------|
| `me`, `foe` | Your side and the opponent's side. |
| `turn` | Current turn number. |
| `battle` | The underlying `@pkmn/client` `Battle`. |
| `player` | The side this state is viewed from. |
| `add(line)`, `addRequest(json)` | Feed data in (`BattleEngine` does this for you). |

### Helpers

| Where | Exports |
|-------|---------|
| `protocol.ts` | `parseLine`, `parseHP`, `parseIdent`, `describeLine`, `parseTyped`, `isMoveRequest`, `isSwitchRequest`, `isTeamPreviewRequest`, `isWaitRequest` |
| `@pkmn/protocol` (re-exported) | `Protocol`, `Handler` |
| `teams.ts` | `importTeam`, `SAMPLE_TEAM_P1`, `SAMPLE_TEAM_P2` |
| `BattleState.ts` | `BattleState`, `createGenerations` |
| `mods.ts` | `loadMod`, `isModLoaded`, `MOD_IDS`, `ModID` |

Each has TSDoc comments in its source file, so hovering over it in VS Code shows the docs.

---

## 14. Troubleshooting

| Problem | Likely cause / fix |
|---------|--------------------|
| Nothing happens after `start()` | Callbacks were set after `start()`, or a Team Preview request was never answered. Answer it with `choose(side, 'default')`. |
| Battle freezes mid-way | A request for your side wasn't answered. Check `engine.requests`. |
| `onError: [Invalid choice] …` | Wrong slot (slots start at **1**), disabled move, or switching while trapped/to a fainted Pokémon. |
| `importTeam: could not parse…` | Team text formatting. Paste it into the Showdown Teambuilder to check it. |
| `BattleEngine: unknown format "…"` | Typo in `formatid`, or the format comes from a mod: `await loadMod(...)` and pass it as `dex`. |
| `Unrecognized format` error | A random-battle format (needs `@pkmn/randoms`). |
| VS Code: "Cannot find module '@pkmn/…'" | Run `npm install` (needed after every pull that changes `package.json`). If it persists: *Ctrl/Cmd+Shift+P → TypeScript: Restart TS Server*. |
| Build fails with "JavaScript heap out of memory" | Use `npm run build` / `npm run build-nolog`, which raise Node's memory limit. If it still fails, raise `4096` in `package.json` or remove unused mods from `src/battle/mods.ts`. |
| Big bundle size warning on build | Expected. The sim contains all Pokémon data (about 6.5 MB unzipped, much smaller with gzip) and is split into its own `pkmn` chunk. |
| TypeScript errors | Run `npm run typecheck` to list them all. |

---

## 15. Further reading

- Showdown protocol (every line type): <https://github.com/smogon/pokemon-showdown/blob/master/sim/SIM-PROTOCOL.md>
- Simulator API / choice syntax: <https://github.com/smogon/pokemon-showdown/blob/master/sim/SIMULATOR.md>
- `@pkmn/sim` and related packages (`@pkmn/client`, `@pkmn/protocol`, `@pkmn/randoms`, `@pkmn/dex`): <https://github.com/pkmn/ps>
- Custom/fan-made data with `Dex.mod()`: see the `@pkmn/sim` and `@pkmn/mods` READMEs in the repository above.
- `@pkmn/client` state model: <https://www.npmjs.com/package/@pkmn/client>
- `@pkmn/protocol` types and helpers: <https://www.npmjs.com/package/@pkmn/protocol>
