# Localization

All text the player reads lives in **locale files**, never in code or scripts. Scripts and
game data only hold **text keys** such as `events.lab_aide.hello` or `items.potion.name`.

## Files

| Where                                                | What                                                        |
|------------------------------------------------------|-------------------------------------------------------------|
| `content/locales/<category>/<locale>.csv`            | Hand-written text: events, trainers, UI… One file per language. |
| `content/pbs/generated/locales/<locale>/<category>.json` | Names and descriptions imported from PokeAPI (items, Pokémon, moves…). |

Locales: `en`, `de`, `fr`, `es-es`, `es-mx`, `pt-br`, `pt-pt` (`LOCALES` in `src/data/i18n.ts`).
English is the fallback: a key missing in another language shows the English text, and a key
missing everywhere shows the key itself, so a gap is visible but never crashes the game.

## CSV format

A header row `key,text`, then one row per line of text. Quote fields that contain commas,
quotes or line breaks, writing a quote as `""` (what spreadsheet programs export):

```csv
key,text
events.lab_aide.hello,"Hello, {player}! Take this {item:potion}."
events.lab_aide.again,"Good luck out there."
system.yes,Yes
```

Any folder name under `content/locales` works as a category; the event system reads them all.
Keys must be unique across categories of one language.

## Placeholders

| Placeholder       | Shows                                                           |
|-------------------|-----------------------------------------------------------------|
| `{player}`        | The player's name.                                              |
| `{money}`         | The player's money.                                             |
| `{var:name}`      | A variable.                                                     |
| `{item:id}`       | An item's translated name (`items.<id>.name`).                  |
| `{species:id}`    | A Pokémon's translated name (`pokemon.<id>.name`).              |
| `{move:id}`       | A move's translated name (`moves.<id>.name`).                   |
| `{text:key}`      | Another line of text.                                           |
| `{name}`          | The command's `params.name` (a number, text, `{ "var": … }`…). |

## Event text

Event commands (`message`, `choice`, `yesNo`, `nameInput`), trainers (`name`, `defeat`) and
Tiled objects (`text` of Signs and Npcs, `intro`/`after` of Trainers) take text keys. The
engine itself shows a few `system.*` keys (item obtained, bag full, prize money…), defined in
`content/locales/events/en.csv`.

`npm run events:validate` reports every key a script or map uses that is missing from the
English files (an error) and, for each other language that has a file, how many keys are not
translated yet (a warning). `npm run events:sync-tiled` offers every English key as a drop-down
list in Tiled.

## Ink stories

ink dialogue (`content/dialogue`) is written in one language per story file. For translated
ink, keep one story per language or move the lines into keys and show them from events with
`message` commands.
