# Localization

All text the player reads lives in **locale files**, never in code or scripts. Scripts,
game data and the engine only hold **text keys** such as `events.lab_aide.hello` or
`items.potion.name`. This document covers the whole localization system: languages,
files, the message syntax, the tools translators use, battle and ink text, Pokémon
languages, name entry, and translated graphics.

## Contents

1. [Languages](#1-languages)
2. [Files](#2-files)
3. [CSV format](#3-csv-format)
4. [Message syntax: placeholders, plurals, grammar, numbers](#4-message-syntax)
5. [Fallbacks](#5-fallbacks)
6. [The save's language](#6-the-saves-language)
7. [Battle text](#7-battle-text)
8. [Ink stories](#8-ink-stories)
9. [Pokémon languages: Masuda method, foreign Pokédex entries](#9-pokémon-languages)
10. [Names: keyboards and nickname rules](#10-names-keyboards-and-nickname-rules)
11. [Translated graphics and text over graphics](#11-translated-graphics-and-text-over-graphics)
12. [Tools](#12-tools)
13. [Hot reload](#13-hot-reload)
14. [Code reference](#14-code-reference)
15. [Known limits](#15-known-limits)

---

## 1. Languages

There are two lists (`src/i18n/languages.ts`):

| List | Languages | What they are |
|------|-----------|---------------|
| `UI_LOCALES` | `en`, `de`, `fr`, `it`, `es-es`, `es-mx`, `pt-br`, `pt-pt` | Languages the game can be played in. Each has CSV files. |
| `POKEMON_LANGUAGE_IDS` | the eight above, plus `ja`, `ko`, `zh-hans`, `zh-hant` | Languages a Pokémon can come from (the official set). The extra four are Pokémon-only: they arrive by gifts, trades and events. |

Each language has an entry in `LANGUAGES` with its own name (`nativeName`, shown in the
language menu), a short label (`label`: `GER`, `JPN`…), its `Intl` tag, the language it
falls back to, nickname and player-name lengths, and its keyboard layout.

**Dialects.** `es-es`/`es-mx` and `pt-br`/`pt-pt` share a `family`. They fall back to
each other before English, and count as the same language for the Masuda method.
Simplified and Traditional Chinese are separate families, as in the official games.

To add a language: add it to `LANGUAGES` (and to `UI_LOCALES` if the game is translated
into it), add a keyboard in `content/locales/keyboards/`, map it in
`tools/pokeapi/config.ts` and run `npm run pokeapi:import`.

## 2. Files

| Where | What |
|-------|------|
| `content/locales/<category>/<locale>.csv` | Hand-written text: `battle`, `events`, `ui`, `ink`, `trainers`… Any folder is a category. |
| `content/pbs/generated/locales/<lang>/<category>.json` | Names, Pokédex categories and entries from PokeAPI (abilities, items, moves, natures, pokemon, types), for every Pokémon language. Do not edit; override in a CSV. |
| `content/locales/grammar.json` | Grammar tags each language may use (§4). |
| `content/locales/limits.json` | Length rules and sample values for the length check (§12). |
| `content/locales/keyboards/<id>.json` | On-screen keyboard layouts (§10). |
| `content/locales/overlays/*.json` | Text drawn over graphics (§11). |
| `public/assets/img/locales/<locale>/…` | Translated copies of graphics (§11). |

The game loads, for its locale and every locale it falls back to, **all** generated
categories first, then every CSV on top, so translators can override anything.

Keys must be unique across the categories of one language.

## 3. CSV format

A header row, then one row per key. Only `key` and `text` are required; columns may come
in any order. Fields with commas, quotes or line breaks are quoted, with `""` for a quote
(what spreadsheet programs export).

| Column | Meaning |
|--------|---------|
| `key` | Text key. |
| `text` | The text, with placeholders (§4). |
| `notes` | Context for translators: who speaks, where it is shown. Never shown in game. |
| `max` | English files only: the longest the text may be. `120px` (one line), `2x120px` (lines × width) or `12` (characters). |
| `tags` | Grammar tags of this text in this language: `gender=f; article=elided`. |
| `hash` | Translations only: the hash of the English text it was translated from. Written by `npm run locales:import`. When the English changes, the hashes differ and the translation is reported **stale**. |

```csv
key,text,notes,max
ui.battle.command.run,RUN,Battle command button,52px
battle.move,"{side, select, foe {The opposing {pokemon}} wild {The wild {pokemon}} other {{pokemon}}} used {move}!",A Pokémon uses a move.,
```

```csv
key,text,tags,hash
battle.stat.def,Défense,article=f,8e3d…
```

## 4. Message syntax

| Placeholder | Shows |
|-------------|-------|
| `{player}`, `{money}` | The player's name and money. |
| `{var:name}` | A game variable. |
| `{item:id}`, `{species:id}`, `{move:id}`, `{ability:id}`, `{nature:id}`, `{type:id}` | A translated game-data name (`items.<id>.name`…), with its grammar tags. |
| `{text:key}` | Another line. |
| `{ink:name}` | An ink variable (ink translations only). |
| `{name}` | A value the code or event passes (`params.name`). A value that is a text key is shown translated. Numbers are written the locale's way. |
| `{n, number}`, `{n, number, integer}`, `{n, number, percent}` | A number in the locale's format: `1,234.5` / `1.234,5`. |
| `{n, plural, =0 {none} one {# Potion} other {# Potions}}` | Plural forms of the locale (`zero one two few many other`); `=n` matches exactly; `#` is the number. `other` is required. |
| `{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}` | Ordinal forms. |
| `{who, select, rival {…} other {…}}` | Picks by the value. |
| `{stat@gender, select, f {La} other {El}}` | Picks by a **grammar tag** of the value. |

Write `\{` and `\}` for literal braces. A placeholder nobody fills stays as written, and
malformed text is shown as it is, so a mistake is visible but never crashes the game.

**Grammar tags** describe a word in one language: the gender of a stat name in Spanish,
whether a French word takes `l'`. They go in the `tags` column of the row that defines
the word, and any text that receives that word as a value reads them with `@`:

```csv
# content/locales/battle/fr.csv
battle.stat.atk,Attaque,article=elided
battle.stat.def,Défense,article=f
battle.boost,"{stat@article, select, elided {L'{stat}} f {La {stat}} other {Le {stat}}} de {pokemon} augmente !"
```

Which tags and values each language may use is declared in `content/locales/grammar.json`
(by locale or by family: `es` covers both Spanish locales).

## 5. Fallbacks

A key is looked up along the locale's chain (`fallbackChain()`), then shown as the key
itself:

| Locale | Chain |
|--------|-------|
| `es-mx` | `es-mx` → `es-es` → `en` |
| `pt-pt` | `pt-pt` → `pt-br` → `en` |
| any other | the locale → `en` |

So `es-mx` and `pt-pt` files only need the lines that differ from their sister locale.

## 6. The save's language

The language is chosen once, on the **New Game language menu** (`<LanguageSelect>`), and
kept in the save as `SaveData.language`. `GameState` has a `language` getter and no
setter. The game's localizer is **locked** to it (`Localizer.lock()`): setting another
locale afterwards throws.

`startNewGame()` (`src/world/newGame.ts`) shows the menu with the cursor on the device's
language (`matchDeviceLocale(navigator.languages)`), creates the save, loads the text and
makes it the game's localizer (`setLocalizer()`). The overworld calls it when no game is
loaded; a loaded save uses its own language.

```ts
const state = await startNewGame({ name: 'Red' });
state.language;   // e.g. 'es-mx', for good
```

## 7. Battle text

The simulator speaks English. A **narrator** (`createBattleNarrator()` in
`src/battle/text.ts`) turns each protocol line into a sentence from the `battle.*` keys:

- Pokémon without a nickname show their species name in the game's language, with the
  species' grammar tags; nicknames are shown as they are;
- moves, abilities, items and types are translated by ID; stats come from
  `battle.stat.*`, effects ("poison", "the recoil") from `battle.effect.*`;
- templates get `side` = `own`, `foe` or `wild`, so one key covers "Pikachu", "the
  opposing Pikachu" and "the wild Pikachu".

The battle scene passes a narrator to `BattleBridge` (option `narrate`) whenever the game
has a localizer, so `step.text` is in the game's language. Without one, `describeLine()`
still gives English.

Text the game itself adds (experience, level-ups, new moves; `src/state/battle.ts`)
travels as a `|-message|` line made by `encodeTextMessage(key, params)` instead of English
words. `englishMessage()` and `describeLine()` still show it in English.

## 8. Ink stories

Stories are written in English. To translate one:

1. Run `npm run locales:ink-ids`. Every line and choice gets a stable `#id:` tag, and
   the English text is written to `content/locales/ink/en.csv`:
   ```ink
   Welcome to the lab, {player_name}! # speaker: Professor #id:sample.professor.1
   * [Potions, please. #id:sample.professor.3]
   ```
   IDs are never renumbered; new lines get the next free number. Speakers become
   `ink.speaker.<id>` keys.
2. Translate `ink.<id>` keys in `content/locales/ink/<locale>.csv`. Ink variables are
   `{ink:name}`. Ink logic (`{plural("potion", n)}`) appears as `\{…\}` in the English for
   reference; write it with message syntax instead:
   ```csv
   ink.sample.professor.4,"Hier {ink:potions, plural, one {ist # Trank} other {sind # Tränke}}."
   ```

At run time (`translateInk()` in `src/world/inkText.ts`) a line shows its translation
when the game's locale (or its sister) has one, and ink's own English otherwise. A line
that glue or a divert joined from several tagged lines shows their translations one after
the other. `npm run locales:ink-ids -- --check` fails if a line has no ID.

## 9. Pokémon languages

Every Pokémon has `language` (`SavedPokemon.language`):

- a Pokémon the player obtains as their own (no original trainer yet) takes the **save's**
  language in `GameState.addToParty()`;
- a Pokémon from another trainer keeps its own. Give one with `givePokemon` and both
  `language` and `ot`:
  ```json
  { "cmd": "givePokemon", "species": "ditto", "level": 30, "language": "ja", "ot": { "name": "サトシ", "id": 12345 } }
  ```

**Masuda method.** `isMasuda(a, b)` is `true` for different language families.
`eggShinyRolls(a, b, { shinyCharm })` gives 1 roll, plus 5 for Masuda, plus 2 for the
Shiny Charm; `rollShiny(rolls)` rolls them at 1/4096 each. `es-es` × `es-mx` is not
Masuda. The engine has no day care yet; it is ready for one.

**Foreign Pokédex entries.** The save's `pokedex` records, per species, `seen`, `owned`
and the `languages` of the Pokémon owned (`GameState.registerOwned()`, called by
`addToParty()` and evolution; `markSeen()`, called by the battle scene).
`pokedexLanguages(species)` lists the unlocked languages, the save's first.
`<PokedexEntry>` shows the name, category, height, weight and entry in each, switched
with L/R; the event command `{ "cmd": "pokedexEntry", "species": "pikachu" }` opens it. A
foreign language shows only its own text (no fallback), so a missing entry says so.

## 10. Names: keyboards and nickname rules

`<NameEntryKeyboard>` (the naming screen for every `nameInput`) shows an on-screen letter
grid. A Pokémon's nickname follows **the Pokémon's language** (`src/i18n/nickname.ts`):

| Rule | Where |
|------|-------|
| Length: 12 characters, 6 for Japanese, Korean and Chinese | `LANGUAGES[…].nicknameMax`, `playerNameMax` |
| Keyboard: the Pokémon language's layout if the game has one, else the game's | `keyboardFor()` |
| Allowed characters: the keys of that layout (plus space) | `nicknameRules()`, `sanitizeName()` |
| Only the original trainer may nickname | `canNickname()` |

The event command `{ "cmd": "nickname", "slot": 0 }` names a party Pokémon (the last one
by default), or says `system.cannot_nickname` if the player is not its trainer.

Layouts are `content/locales/keyboards/<id>.json`: pages with a label key and rows of up
to 10 keys (a space is an empty key). The game ships `en`, `de`, `fr`, `it`, `es`, `pt`
and `ja` (hiragana and katakana pages). Controls: D-pad, A types, B deletes, L/R or
Select change page, Start confirms; clicking the name field switches to typing on a
physical or phone keyboard.

## 11. Translated graphics and text over graphics

**Translated files, decided at build time.** Put a translated copy at
`public/assets/img/locales/<locale>/<same path>.png`, e.g.
`img/locales/de/ui/title/start.png`. At build time (`vite/plugins/locales.mjs`) every
locale's choice is made along its fallback chain (`es-mx` uses an `es-es` copy), so at run
time it is one lookup: `graphicFor('ui/title/start')`. `npm run locales:graphics` prints
the decisions.

**Stable texture keys.** In Phaser, `loadLocalizedTexture(scene, 'ui/battle/cursor_command',
{ frameWidth: 65, frameHeight: 23 })` (`src/game/localizedTextures.ts`) loads the right
file under the graphic's **original path as texture key**, in every language. Sprites and
code never change. Asking again in another locale replaces the texture, frames included,
under the same key.

**Text over graphics.** Some graphics have English words painted in. An overlay
(`content/locales/overlays/*.json`) says where: the engine paints over them (`erase`) and
writes the translated text there (`text`), with the pixel font:

```json
{
  "graphic": "ui/trainer_card/card",
  "erase": [{ "x": 29, "y": 15, "width": 89, "height": 13, "fill": "#5090e0" }],
  "text": [{ "key": "ui.trainer_card.title", "x": 29, "y": 13, "width": 89, "align": "center", "color": "#f8f8f8", "shadow": "#2860a8" }]
}
```

- `fill: "row"` repaints each row with the colour at column `sampleX`, keeping gradients;
- `cells` repeats `erase` and `text` over a sprite sheet; `keys` gives one key per row (`by: "row"`), column or cell;
- `skip` lists locales that need no overlay (default `["en"]`).

React draws it with `<LocalizedGraphic graphic="ui/battle/cursor_command" x={…} y={…} cell={…} />`;
Phaser with `loadLocalizedTexture()`. Both use `renderOverlay()` (`src/ui/i18n/overlay.ts`).
The game ships overlays for the battle command buttons and the Trainer Card header.

## 12. Tools

| Command | Does |
|---------|------|
| `npm run locales:validate` | Every check below. Errors exit with 1; `--strict` fails on warnings too. |
| `npm run locales:report` | Coverage per locale: translated, from sister, missing, stale, no hash, not in English; unused English keys. `--locale de` lists every key; `--json`. |
| `npm run locales:export -- --locale de [--todo] [--data] [--category ui] [--out file.csv]` | A translator sheet: key, category, English, notes, max, status, then `text`, `tags`, `translator_notes` to fill. `--todo`: only missing, stale and unhashed rows; `--data`: also PokeAPI names. |
| `npm run locales:import -- file.csv --locale de [--dry-run]` | Writes the sheet's translations into the locale's CSV files and stamps their `hash`. |
| `npm run locales:import -- --locale de --stamp` | Stamps translations that have no hash (after a review). |
| `npm run locales:ink-ids` | Gives ink lines IDs and writes `content/locales/ink/en.csv` (§8). |
| `npm run locales:graphics` | Prints which file each locale shows for each translated graphic. |

What `locales:validate` checks:

| Check | Level |
|-------|-------|
| CSV syntax: unclosed quotes, duplicate keys (also across categories), unknown columns | error / warning |
| Message syntax: unbalanced braces, plural/select without `other` | error |
| Placeholders a translation uses that English does not have / leaves out | error / warning |
| Plural forms the locale needs (`many` in French, Spanish, Italian, Portuguese) | warning (skipped when `=n` cases are used) |
| Grammar tags not declared in `grammar.json` | error |
| **Length**: `max` column or `limits.json` rule, measured in pixels with the real font file | warning |
| **Font**: characters the UI font cannot draw | warning |
| Missing translations (shown in English), **stale** translations (hash differs), no hash | warning |
| **Unused** English keys (not used by events, trainers, maps, ink, overlays, keyboards or source code) | warning |
| Translations of keys English does not have | warning |
| Keyboards: labels exist, rows fit, keys the font can draw, a layout for every UI language | error / warning |
| Overlays: valid, graphic exists, boxes inside it, keys exist, text fits in every locale | error / warning |
| Translated graphics: original exists, same size | error / warning |

Keys built at run time count as used when the source has a template such as
`` `battle.status.${id}` ``. The length check fills placeholders with `limits.json`
`samples` and takes the longest plural/select case. The font check reads the WOFF2 file
itself (`tools/locales/font.ts`); its widths match the browser's exactly.

`npm run events:validate` also reports keys the events use that are missing from English,
and untranslated ones per locale (counting sister locales).

## 13. Hot reload

During `npm run dev`, saving a `content/locales/<category>/<locale>.csv` replaces that
file's text in the running game at once, without reloading the page. The localizer
notifies its subscribers, `GameEvents.LOCALE_CHANGED` is emitted, and React components
using `useText()` / `useLocalizer()` re-render. Adding or removing a translated image
reloads the page (the build-time map changes).

## 14. Code reference

| Where | What |
|-------|------|
| `src/i18n/languages.ts` | `UI_LOCALES`, `LANGUAGES`, `fallbackChain()`, `matchDeviceLocale()`, `sameLanguageFamily()` |
| `src/i18n/csv.ts` | `readLocaleCsv()`, `writeLocaleCsv()`, `parseTags()`, `parseLimit()`, `textHash()` |
| `src/i18n/message.ts` | `formatMessage()`, `parseMessage()`, `inspectMessage()`, `formatNumber()`, `pluralCategory()` |
| `src/i18n/Localizer.ts` | `Localizer`: `format`, `formatText`, `raw`, `lookup`, `tagged`, `dataName`, `pokemonName`, `number`, `add`, `replace`, `lock`, `subscribe` |
| `src/events/text.ts` | `TextStore`: a `Localizer` that fills `{player}`, `{var:…}`, event params from the game state |
| `src/i18n/masuda.ts`, `nickname.ts`, `graphics.ts`, `overlays.ts` | Masuda, name rules, graphics map, overlay schema |
| `src/world/text.ts` | `loadText()`, `loadMenuText()`, `loadDexText()`, `getLocalizer()` / `setLocalizer()`, `graphicFor()`, `TEXT_OVERLAYS`, `KEYBOARDS_BY_ID`, hot reload |
| `src/world/newGame.ts` | `startNewGame()`, `deviceLocale()` |
| `src/battle/text.ts` | `createBattleNarrator()`, `encodeTextMessage()`, `englishMessage()` |
| `src/world/inkText.ts` | `translateInk()`, `translateSpeaker()` |
| `src/ui/i18n/` | `useLocalizer()`, `useText()`, `renderOverlay()` |
| `src/ui/menus/`, `src/ui/dialogue/NameEntryKeyboard.tsx`, `src/ui/components/LocalizedGraphic.tsx` | The language menu, Pokédex entry, naming screen and localized graphics |
| `src/game/localizedTextures.ts` | `loadLocalizedTexture()` for Phaser |
| `tools/locales/` | The tools of §12 |

Dev console helpers (`npm run dev`): `stab.language()`, `stab.dex('pikachu', ['en', 'ja'])`,
`stab.nickname('pikachu', 'ja')`, `stab.locale()`.

## 15. Known limits

- The FRLG font has no `ã`/`õ` (needed by Portuguese), no Hangul (Korean) and no currency
  signs or square brackets. The validator reports them; text uses other wording where it
  can. Korean Pokédex entries fall back to the browser's font.
- Translated Trainer Card titles in Italian, Spanish and Portuguese are wider than the
  space between the header icons; the validator reports them.
- The sample event text (`events.sample.*`) is not translated.
