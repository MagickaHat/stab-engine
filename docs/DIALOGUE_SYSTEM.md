# Dialogue System

STAB-engine uses **[ink](https://www.inklestudios.com/ink/)**, inkle's narrative scripting
language, for dialogue, cutscenes and NPC scripts. Stories are written in `.ink` files and run
with **[inkjs](https://github.com/y-lohse/inkjs)**, the JavaScript port of the ink runtime.

You write the story; ink handles branching, choices, variables, conditions and "has the player
seen this already?" logic. The engine shows the lines and choices and runs game actions the
story asks for.

This page covers how the integration is built, how to write and load stories, and how to use
them from a Phaser scene.

---

## Contents

1. [Overview](#1-overview)
2. [File map](#2-file-map)
3. [Quick start](#3-quick-start)
4. [Driving the story: lines and choices](#4-driving-the-story-lines-and-choices)
5. [Tags (speaker, portrait, …)](#5-tags-speaker-portrait-)
6. [Variables](#6-variables)
7. [External functions (game actions)](#7-external-functions-game-actions)
8. [Calling ink functions and jumping to knots](#8-calling-ink-functions-and-jumping-to-knots)
9. [Saving and loading](#9-saving-and-loading)
10. [Splitting stories with INCLUDE](#10-splitting-stories-with-include)
11. [Compile errors](#11-compile-errors)
12. [Using it from Phaser](#12-using-it-from-phaser)
13. [API reference](#13-api-reference)
14. [Troubleshooting](#14-troubleshooting)
15. [Further reading](#15-further-reading)

---

## 1. Overview

```
  content/dialogue/*.ink                     build time (Node)                         game (browser)
┌──────────────────────┐  import   ┌──────────────────────────────┐  story JSON  ┌─────────────────────┐
│  intro.ink           │ ────────▶ │  vite/plugins/ink.mjs        │ ───────────▶ │   DialogueEngine    │
│  INCLUDE common.ink  │           │  (inkjs compiler)            │              │   (src/dialogue)    │
└──────────────────────┘           └──────────────────────────────┘              │   inkjs runtime     │
                                                                                 └──────────┬──────────┘
                                                                   onLine / onChoices /     │ ▲  advance() / choose()
                                                                   onEnd, variables         ▼ │  setVariable(), bindFunction()
                                                                                 ┌─────────────────────┐
                                                                                 │  Phaser scene /     │
                                                                                 │  your game code     │
                                                                                 └─────────────────────┘
```

- **The Vite plugin** (`vite/plugins/ink.mjs`) compiles each `.ink` file when it is imported,
  using the compiler that ships with inkjs. You don't need Inky or inklecate (though Inky is
  still the nicest editor for writing and play-testing ink). In `npm run dev` stories
  hot-reload when you save them, and compile errors appear in the browser overlay.
- **The compiler only runs in Node.** The game bundle contains only the inkjs runtime.
- **`DialogueEngine`** (`src/dialogue`) wraps the inkjs `Story`. It turns ink output into
  `DialogueLine` / `DialogueChoice` objects with parsed tags and reports them through callbacks.
  It doesn't depend on Phaser, so you decide how dialogue looks.

---

## 2. File map

| File | What it does |
|------|--------------|
| `src/dialogue/index.ts` | Public entry point. Import everything from here. |
| `src/dialogue/DialogueEngine.ts` | `DialogueEngine`: runs a story, reports lines/choices/end, variables, externals, save/load. |
| `src/dialogue/tags.ts` | `parseTags()`: turns `# speaker: Oak` tags into `{ speaker: 'Oak' }`. |
| `src/dialogue/types.ts` | `DialogueLine`, `DialogueChoice`, `DialogueEngineOptions`, `TagMap`, `InkValue`. |
| `src/vite-env.d.ts` | Tells TypeScript that importing a `.ink` file gives story JSON. |
| `vite/plugins/ink.mjs` | The Vite plugin that compiles `.ink` → JSON. |
| `content/dialogue/` | Story files. `sample.ink` + `common.ink` are a working example. |

inkjs lives in `node_modules/inkjs` and is listed in `package.json`. In production builds Vite
puts it in its own file (`ink-*.js`, set by `manualChunks` in `vite/config.*.mjs`).

> **After pulling changes, run `npm install`.** Until then VS Code shows
> "Cannot find module 'inkjs'".

---

## 3. Quick start

**1. Write a story** in `content/dialogue/`, e.g. `content/dialogue/nurse.ink`:

```ink
VAR healed_count = 0

=== nurse ===
Welcome to the Pokémon Center! # speaker: Nurse
* [Heal my Pokémon.]
    ~ healed_count += 1
    ~ heal_party()
    Your Pokémon are fighting fit! # speaker: Nurse
* [No thanks.]
    We hope to see you again! # speaker: Nurse
- -> END

EXTERNAL heal_party()
```

**2. Import and run it:**

```ts
import nurseStory from '../../content/dialogue/nurse.ink';
import { DialogueEngine } from '../../dialogue';

const dialogue = new DialogueEngine(nurseStory);
dialogue.bindFunction('heal_party', () => party.healAll());

dialogue.onLine = (line) => console.log(`${line.tagMap.speaker}: ${line.text}`);
dialogue.onChoices = (choices) => {
    choices.forEach((c) => console.log(`  [${c.index}] ${c.text}`));
    dialogue.choose(0);      // normally: wait for the player
    dialogue.run();
};
dialogue.onEnd = () => console.log('(conversation over)');

dialogue.goTo('nurse');
dialogue.run();
```

The path is relative to the file doing the import, as for any other import.

---

## 4. Driving the story: lines and choices

An ink story runs until it reaches a **choice** or the **end**. Along the way it produces
**lines** of text. `DialogueEngine` gives you two ways to read them:

| Method | Use it when | What happens |
|--------|-------------|--------------|
| `advance()` | A dialogue box that shows one line at a time | Reads **one** line → `onLine`. If there are no more lines, fires `onChoices` (if waiting for a choice) or `onEnd` (if finished). |
| `run()` | You want everything up to the next choice at once (logs, a chat-style UI, tests) | Calls `advance()` until it stops: `onLine` for every line, then `onChoices` or `onEnd`. |

After the player picks an option, call **`choose(index)`**, then `advance()` / `run()` again.
`choose()` doesn't continue the story by itself, so you can play an animation first.

Typical button-driven loop:

```ts
// Player presses A:
if (waitingForChoice) return;      // choices are clicked, not advanced
dialogue.advance();                // → onLine / onChoices / onEnd
```

If you'd rather not use callbacks, the same information is available directly:
`continue()` returns the next `DialogueLine` (or `null`), `continueMaximally()` returns all of
them up to the next choice, `choices` lists the current options, and `canContinue` / `isEnded`
tell you where you are.

**Lines with only tags.** A line that holds only tags and no text (such as the global tags at
the top of a file) is not returned as an empty line. Its tags are added to the next line that
has text.

`onEnd` fires once when the story ends. It fires again only after `reset()`, `goTo()` or `load()`.

---

## 5. Tags (speaker, portrait, …)

ink tags start with `#` and attach metadata to a line, a choice, a knot or the whole file. The
engine doesn't give tags any built-in meaning. Use whatever keys your UI needs. `key: value`
style is recommended because `DialogueEngine` parses it for you:

```ink
# title: Route 1                         // global tag (top of the main file)

=== professor ===
# location: lab                          // knot tag (first line of the knot)
Welcome to the lab! # speaker: Professor # portrait: professor_happy
* [Potions, please. # icon: potion]      // choice tag: INSIDE the brackets
```

```ts
line.tags      // ['location: lab', 'speaker: Professor', 'portrait: professor_happy']
line.tagMap    // { location: 'lab', speaker: 'Professor', portrait: 'professor_happy' }
choice.tagMap  // { icon: 'potion' }
dialogue.globalTags            // { title: 'Route 1' }
dialogue.tagsForPath('professor')  // { location: 'lab' }, without running the knot
```

A tag without a colon (`# shake`) becomes `{ shake: true }`. To parse tags yourself, use
`parseTags(tags)`.

> **Choice tags go inside the brackets.** In `* [Potions, please.] # icon: potion` the tag
> belongs to the line printed *after* the choice, not to the choice itself.

---

## 6. Variables

Global ink variables (`VAR name = value`) can be read and written from TypeScript. Use this to
pass game state into the story (player name, badges, items) and to read results back out.

```ts
const state = requireGameState();                         // from src/state, see SAVE_SYSTEM.md
dialogue.setVariable('player_name', state.getSnapshot().player.name);
dialogue.setVariable('badges', state.getVar('badges') ?? 0);

const gotStarter = dialogue.getVariable<boolean>('got_starter');
```

Variables must be declared with `VAR` in the ink file. A value is a `number`, `string`,
`boolean` or `InkList`.

To react when the story changes a variable:

```ts
const stop = dialogue.observeVariable('money', (_name, value) => hud.setMoney(value as number));
// later, e.g. on scene shutdown:
stop();
```

---

## 7. External functions (game actions)

For the story to *do* something in the game (give an item, start a battle, play a sound),
declare an `EXTERNAL` in ink and implement it in TypeScript:

```ink
EXTERNAL give_item(item, amount)

~ give_item("potion", 3)
{ give_item("rare_candy", 1): You got a Rare Candy! }   // return values work too
```

```ts
dialogue.bindFunction('give_item', (item: string, amount: number) => {
    bag.add(item, amount);
    return true;
});
```

- **Bind before you start the story.** inkjs checks that every `EXTERNAL` is bound on the first
  `continue()` / `advance()` / `run()`.
- **Fallbacks.** If the ink file also defines a normal function with the same name
  (`=== function give_item(item, amount) ===`), it is used when nothing is bound. This lets you
  play-test the story in Inky. It's on by default. Pass `{ externalFallbacks: false }` to the
  constructor to get an error for every unbound external instead.
- **`lookaheadSafe`** (third argument of `bindFunction`, default `false`). ink sometimes runs a
  little ahead to find where a line ends. Only set it to `true` for functions without side
  effects (pure queries like `has_badge(n)`), so they aren't called twice.

`content/dialogue/common.ink` has an example of an external with a fallback.

---

## 8. Calling ink functions and jumping to knots

```ts
dialogue.goTo('oak_lab');                 // start a specific knot
dialogue.goTo('oak_lab.after_battle');    // or a stitch
dialogue.goTo('greet', 'Ash');            // knots with parameters: === greet(name) ===

dialogue.callFunction('plural', 'potion', 3);   // → 'potions'  (=== function plural(...) ===)

dialogue.visitCount('oak_lab');           // how many times the player has been there
dialogue.reset();                         // back to the start, all variables reset
```

A common layout is **one `.ink` file per map or character, one knot per conversation**. Keep a
single `DialogueEngine` for the file and `goTo()` the knot when the player talks to someone.
Variables and visit counts are shared across the whole story, so `{ oak_lab: ... }` conditions
work across conversations.

`goTo()` throws if the knot doesn't exist.

---

## 9. Saving and loading

`save()` returns the story's position, variables and visit counts as a JSON string. Hand it
to the game state, which writes it to the save file with everything else (see
[SAVE_SYSTEM.md](SAVE_SYSTEM.md#11-dialogue)):

```ts
const state = requireGameState();                         // from src/state
state.setDialogueState('sample', dialogue.save());        // before saving the game

const dialogue = new DialogueEngine(story);
const json = state.getDialogueState('sample');            // after loading the game
if (json) dialogue.load(json);                            // must be the same story
```

Re-bind external functions and observers after creating the new engine. They aren't saved.

---

## 10. Splitting stories with INCLUDE

```ink
INCLUDE common.ink
INCLUDE characters/rival.ink
```

Paths are relative to the **file you import from TypeScript**. Included files are watched, so
editing one also hot-reloads the story in `npm run dev`.

Only import the *main* file from TypeScript. Included files are compiled as part of it.

---

## 11. Compile errors

Errors in a `.ink` file stop the build and show the file and line:

```
Failed to compile /…/content/dialogue/nurse.ink:
  ERROR: '/…/content/dialogue/nurse.ink' line 7: Divert target not found: '-> ned'
```

In `npm run dev` the same message appears as an overlay in the browser and goes away when you
fix the file. Warnings (and `TODO:` notes) are printed in the terminal without stopping the build.

**Runtime** errors (for example a `{…}` expression that fails while the game runs) go to the
`onError` option if you passed one. Otherwise errors throw and warnings are printed with
`console.warn`:

```ts
new DialogueEngine(story, {
    onError: (message, isWarning) => (isWarning ? console.warn : console.error)(message),
    debug: true,   // also log every line/choice
});
```

---

## 12. Using it from Phaser

The dialogue layer doesn't depend on Phaser, so a scene just owns an engine and draws what it
reports. A minimal text box:

```ts
import { Scene } from 'phaser';
import labStory from '../../../content/dialogue/sample.ink';
import { DialogueEngine } from '../../dialogue';
import type { DialogueChoice } from '../../dialogue';
import { input } from '../../input';

export class Lab extends Scene
{
    private dialogue: DialogueEngine;
    private textBox: Phaser.GameObjects.Text;
    private choiceTexts: Phaser.GameObjects.Text[] = [];

    constructor () { super('Lab'); }

    create ()
    {
        this.textBox = this.add.text(40, 600, '', { fontSize: 24, wordWrap: { width: 940 } });

        this.dialogue = new DialogueEngine(labStory);
        this.dialogue.setVariable('player_name', 'Ash');
        this.dialogue.bindFunction('give_item', (item: string, n: number) => {
            console.log(`Got ${n}x ${item}`);   // add to the bag here
            return true;
        });

        this.dialogue.onLine = (line) => {
            const speaker = line.tagMap.speaker;
            this.textBox.setText(speaker ? `${speaker}: ${line.text}` : line.text);
        };
        this.dialogue.onChoices = (choices) => this.showChoices(choices);
        this.dialogue.onEnd = () => this.textBox.setText('');

        //  The A button from any device (see docs/INPUT_SYSTEM.md).
        const offPress = input.on((event) => {
            if (event.type === 'press' && event.button === 'a' && this.choiceTexts.length === 0) this.dialogue.advance();
        });
        this.events.once('shutdown', offPress);

        this.dialogue.advance();   // show the first line
    }

    private showChoices (choices: DialogueChoice[])
    {
        this.choiceTexts = choices.map((c, i) =>
            this.add.text(60, 640 + i * 32, `▶ ${c.text}`, { fontSize: 22 })
                .setInteractive()
                .on('pointerdown', () => {
                    this.choiceTexts.forEach((t) => t.destroy());
                    this.choiceTexts = [];
                    this.dialogue.choose(c.index);
                    this.dialogue.advance();
                }));
    }
}
```

Remember to add the scene to the `scene` list in `src/game/main.ts`.

---

## 13. API reference

### `new DialogueEngine(storyJson, options?)`

| Option | Default | Meaning |
|--------|---------|---------|
| `debug` | `false` | Log every line, choice list and choice made. |
| `externalFallbacks` | `true` | Use ink fallback functions for unbound `EXTERNAL`s. |
| `onError` | throw errors / `console.warn` warnings | `(message, isWarning) => void` for runtime errors. |

`storyJson` is an imported `.ink` file, or ink JSON (object or string) exported by Inky/inklecate.

### Callbacks

| Callback | Fired by | Arguments |
|----------|----------|-----------|
| `onLine` | `advance()`, `run()` | `DialogueLine { text, tags, tagMap }` |
| `onChoices` | `advance()`, `run()` when waiting for a choice | `DialogueChoice[] { index, text, tags, tagMap }` |
| `onEnd` | `advance()`, `run()` when the story ends (once) | — |

### Methods and properties

| Member | Description |
|--------|-------------|
| `advance()` | Read one line → `onLine`; else `onChoices` / `onEnd`. Returns the line or `null`. |
| `run()` | `advance()` until a choice or the end. Returns the lines. |
| `continue()` | Read one line without callbacks. Returns `DialogueLine \| null`. |
| `continueMaximally()` | Read all lines up to the next choice without callbacks. |
| `choose(index)` | Pick a choice. Throws `RangeError` if out of range. |
| `canContinue` / `isEnded` | Whether another line is available / the story is over. |
| `choices` | Current `DialogueChoice[]`. |
| `goTo(path, ...args)` | Jump to a knot/stitch. |
| `reset()` | Restart from the beginning with fresh variables. |
| `getVariable(name)` / `setVariable(name, value)` | Global ink variables. |
| `observeVariable(name, fn)` | Watch a variable. Returns an unsubscribe function. |
| `bindFunction(name, fn, lookaheadSafe?)` / `unbindFunction(name)` | Implement ink `EXTERNAL`s. |
| `callFunction(name, ...args)` | Call an ink function and get its return value. |
| `visitCount(path)` | Times a knot/stitch was visited. |
| `globalTags` / `tagsForPath(path)` | Parsed global / knot tags. |
| `save()` / `load(json)` | Serialize / restore the story state. |
| `story` | The underlying inkjs `Story`, for anything not covered here. |

### Helpers

| Export | Description |
|--------|-------------|
| `parseTags(tags)` | `['speaker: Oak', 'shake']` → `{ speaker: 'Oak', shake: true }`. |
| `Story`, `InkList` | Re-exported from inkjs. |

---

## 14. Troubleshooting

| Problem | Likely cause / fix |
|---------|--------------------|
| `Failed to compile …ink` | Syntax error in the story. The message has the file and line. |
| `Missing function binding for external: '…'` | Bind it with `bindFunction()` **before** the first `advance()` / `run()`, or add an ink fallback function and keep `externalFallbacks` on. |
| `Failed to find content at path '…'` | Typo in `goTo()`, or the knot is in a file that isn't `INCLUDE`d. |
| A choice has no tags | The tag is outside the `[...]`. Move it inside. |
| An external runs twice | It isn't lookahead-safe. Leave `lookaheadSafe` as `false`, or avoid calling it mid-line. |
| `visitCount()` is always 0 | The story JSON wasn't built by the plugin. The plugin compiles with "count all visits"; with inklecate use `-c`. |
| `Cannot find module '…ink'` in TypeScript | Check the relative path. `src/vite-env.d.ts` must still contain the `declare module '*.ink'` block. |
| VS Code: "Cannot find module 'inkjs'" | Run `npm install`. |
| Story changes don't show up | Only the imported main file and its `INCLUDE`s are watched. Restart `npm run dev` if you renamed files. |

---

## 15. Further reading

- Writing with ink (the language guide): <https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md>
- Running ink in a game (runtime API concepts): <https://github.com/inkle/ink/blob/master/Documentation/RunningYourInk.md>
- inkjs (JavaScript runtime and compiler): <https://github.com/y-lohse/inkjs>
- Inky, the ink editor: <https://github.com/inkle/inky>
