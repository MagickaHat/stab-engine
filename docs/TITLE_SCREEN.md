# Intro, Title Screen and New Game / Continue

Everything from launching the game to the first map: the boot splashes, an optional opening
movie, the title screen, the New Game / Continue menu, the New Game language menu and the intro
map where the professor's speech runs.

Almost everything here is changed in **one file of plain data,
`src/game/title/titleConfig.ts`**: no scene code needs to change.

---

## Contents

1. [The flow](#1-the-flow)
2. [File map](#2-file-map)
3. [Splashes](#3-splashes)
4. [The opening movie](#4-the-opening-movie)
5. [The title screen](#5-the-title-screen)
6. [New layer kinds](#6-new-layer-kinds)
7. [The New Game / Continue menu](#7-the-new-game--continue-menu)
8. [New game: language, then the intro map](#8-new-game-language-then-the-intro-map)
9. [Writing the opening speech](#9-writing-the-opening-speech)
10. [Testing and development shortcuts](#10-testing-and-development-shortcuts)

---

## 1. The flow

```
Boot ──▶ Splash ───────────────────────────────▶ Title ──────────────▶ Overworld
 │        splash1 → splash2 → opening movie        │ A / Start / tap
 │        (each skippable)    (if a file exists)   ▼
 │                                          New Game / Continue menu
 │                                           ├─ CONTINUE ─▶ load the slot ─▶ saved map and position
 │                                           ├─ NEW GAME ─▶ language menu ─▶ intro map (speech)
 │                                           └─ B ────────▶ back to the title
 └── ?map=<id> (npm run dev only) ─────────────────────────────────────▶ that map
```

Phaser scenes drive the flow; the React UI draws the movie, the title text and the menus. As
everywhere else they only talk through the event bus (`docs/UI_SYSTEM.md` §2):

| Scene | Key | Does |
|-------|-----|------|
| `src/game/scenes/Boot.ts` | `Boot` | Loads the images of the splashes and title screen, then starts `Splash`. |
| `src/game/scenes/Splash.ts` | `Splash` | Fades each splash in and out, then asks the UI to play the movie (`TITLE_MOVIE`). |
| `src/game/scenes/Title.ts` | `Title` | Draws the title layers, waits for Start, asks for the menu (`TITLE_LOAD_MENU`), starts the game. |

If the title screen sits idle for `TITLE_SCREEN.idleMs`, the intro plays again (`idleReplay`:
the whole `intro` or only the `movie`).

## 2. File map

| File | What it is |
|------|------------|
| `src/game/title/titleConfig.ts` | **Edit this.** `SPLASHES`, `OPENING_MOVIE`, `TITLE_SCREEN`, `NEW_GAME`. |
| `src/game/title/layers.ts` | The title layer kinds and `registerTitleLayer()` for new ones. |
| `src/game/title/timing.ts` | Blink, bob and scroll maths, play time format (shared by Phaser, React and tests). |
| `src/game/title/movie.ts` | `findOpeningMovie()`: looks for the movie file once. |
| `src/game/title/requests.ts` | `playMovie()`, `showLoadMenu()`, `continueSlots()`: the bus requests and their payloads. |
| `src/game/title/sceneKeys.ts` | Scene keys (`Boot`, `Splash`, `Title`). |
| `src/game/scenes/Boot.ts`, `Splash.ts`, `Title.ts` | The scenes. |
| `src/ui/title/TitleUi.tsx` | Shows the movie, the title text or the menu when asked. Mounted in `src/App.tsx`. |
| `src/ui/title/OpeningMovie.tsx` | The movie player. |
| `src/ui/title/TitleOverlay.tsx` | The title screen's `text` layers, in the pixel font. |
| `src/ui/title/useMenuText.ts` | Translated text before a save is loaded (the device's language). |
| `src/ui/menus/LoadMenu.tsx` | The New Game / Continue menu. `LOAD_MENU_ENTRIES` lists its one-line entries. |
| `src/ui/menus/loadMenuLayout.ts` | **Edit this** to reskin the menu: graphics, panel rectangles, text positions. |
| `src/state/saves.ts` | `getSaveManager()`: the save slots the menu lists. |
| `src/world/newGame.ts` | `startNewGame()`: the language menu, then a new `GameState`. |
| `src/tiled/maps/intro.tmj`, `content/events/intro.json` | The intro map and its speech script. |
| `public/assets/img/titles/` | `splash1.png`, `splash2.png`, `title.png`, `start.png`. |
| `public/assets/img/ui/load/` | `bg.png`, `panels.png`: the menu's graphics. |
| `public/assets/video/` | Not in the repository: put `intro.webm` or `intro.mp4` here for an opening movie. |

## 3. Splashes

```ts
export const SPLASHES: SplashStep[] = [
    { image: 'assets/img/titles/splash1.png', fadeInMs: 400, holdMs: 2000, fadeOutMs: 400, skippable: true },
    { image: 'assets/img/titles/splash2.png', fadeInMs: 400, holdMs: 2000, fadeOutMs: 400, skippable: true },
];
```

Two splashes are reserved to show who made the engine and the game. Replace the 256×192 images
in `public/assets/img/titles/`, add more entries, change their timing, or remove them all to go
straight to the movie or title. Each one fades in from black, stays for `holdMs` and fades out;
with `skippable`, A, Start or a tap jumps to the fade-out. Missing images are skipped.

## 4. The opening movie

Drop a video at `public/assets/video/intro.webm` (or `intro.mp4`) and it plays after the
splashes. No movie ships with the engine and none is needed: without a file the intro goes
straight to the title screen.

```ts
export const OPENING_MOVIE: OpeningMovieConfig = {
    sources: ['assets/video/intro.webm', 'assets/video/intro.mp4'],   // first that exists and plays wins
    skippable: true,                                                   // A, B, Start or a tap end it
};
```

- The files are looked for once per page load, with a `HEAD` request; a browser that cannot play
  WebM (older Safari) gets the MP4.
- The movie fills the 256×192 game screen, letterboxed on black, so any resolution works; render
  it at 256×192 (or a whole multiple) for the sharpest result.
- It starts with sound. Browsers refuse sound before the player has touched the page, so when
  they do it plays muted instead.
- A file that cannot be played ends the movie at once.

## 5. The title screen

```ts
export const TITLE_SCREEN: TitleScreenConfig = {
    background: '#ffffff',
    layers: [
        { kind: 'image', image: 'assets/img/titles/title.png' },
        { kind: 'blink', image: 'assets/img/titles/start.png', y: 158, onMs: 600, offMs: 400 },
        { kind: 'text', key: 'ui.title.press_start', y: 140, align: 'center', color: '#505058', shadow: '#a0a0a8', onMs: 600, offMs: 400 },
    ],
    bgm: null,                       // e.g. 'title' → assets/sound/bgm/title.ogg
    startButtons: ['a', 'start'],    // a tap or click always works too
    idleMs: 0,                       // e.g. 30000 to replay the intro after 30 s
    idleReplay: 'intro',             // or 'movie'
};
```

Layers are drawn in order, the first at the back. Positions are whole game pixels from the top
left; images are paths under `public/` and are never scaled.

| Kind | Settings | Draws |
|------|----------|-------|
| `image` | `image`, `x`, `y` | A still image. |
| `blink` | `image`, `x`, `y`, `onMs`, `offMs` | An image shown and hidden in turn. |
| `scroll` | `image`, `x`, `y`, `speedX`, `speedY` (px/s), `height` | The image repeated across the screen and scrolled (clouds, patterns). |
| `bob` | `image`, `x`, `y`, `amplitude` (px), `periodMs` | An image floating up and down by whole pixels (a logo). |
| `text` | `key`, `x`, `y`, `align` (`left`/`center`), `color`, `shadow`, `onMs`, `offMs` | Translated text in the game's pixel font, drawn by the React UI. |

Text keys live in `content/locales/ui/<locale>.csv` (`docs/LOCALIZATION.md`). Before a save is
loaded the game's language is not known yet, so the title shows the device's language.

Some recipes:

```ts
//  A scrolling sky behind a bobbing logo.
{ kind: 'scroll', image: 'assets/img/titles/sky.png', speedX: -8 },
{ kind: 'bob', image: 'assets/img/titles/logo.png', x: 40, y: 12, amplitude: 2, periodMs: 3000 },

//  A copyright line that never blinks.
{ kind: 'text', key: 'ui.title.copyright', x: 4, y: 176, color: '#f8f8f8', shadow: null },
```

## 6. New layer kinds

A kind is a factory that draws one layer with Phaser and returns an `update(timeMs)` called
every frame. Register it once (for example at the top of `src/game/title/layers.ts` or in a file
imported by `src/game/main.ts`) and use it in the config:

```ts
import { registerTitleLayer } from './layers';

//  An image whose frames are side by side, played as an animation.
registerTitleLayer('frames', (scene, layer, ctx) =>
{
    const key = ctx.texture(layer.image as string);
    if (!key) return null;                                      // image missing: draw nothing
    const size = layer.frameWidth as number;
    const texture = scene.textures.get(key);
    const count = Math.floor(texture.getSourceImage().width / size);
    for (let i = 0; i < count; i++) texture.add(i, 0, i * size, 0, size, texture.getSourceImage().height);
    const image = scene.add.image(layer.x ?? 0, layer.y ?? 0, key, 0).setOrigin(0, 0).setDepth(ctx.depth);
    return { update: (time) => image.setFrame(Math.floor(time / (layer.frameMs as number)) % count) };
});

// titleConfig.ts
{ kind: 'frames', image: 'assets/img/titles/flame.png', frameWidth: 32, frameMs: 120, x: 112, y: 100 },
```

`ctx` gives the game size, the layer's depth and `texture(image)`, which returns the texture key of
an image from the config (loaded by `Boot`) or `null` if it is missing. Images used only by a
custom kind's own settings must be listed in a layer's `image` field to be loaded by `Boot`.

## 7. The New Game / Continue menu

Start on the title screen opens the menu, which lists the slots of the shared save manager
(`getSaveManager().list()`, `docs/SAVE_SYSTEM.md` §7):

- one **CONTINUE** panel per save, most recent first, showing the player's name, badges (the
  `badges` variable), Pokédex (species owned), play time and the party. Party icons come from
  each species' own folder, `public/assets/img/pokemon/<species>[/<forme>]/icon[_shiny].png`
  (two 32×32 frames, animated), found through `manifest.json` like battle sprites, so any
  Pokémon imported with `npm run assets:import` shows up. When there are several saves the slot
  number is shown in the header;
- a save that cannot be read shows why (damaged, or from a newer version) and cannot be picked;
- then the one-line entries, `LOAD_MENU_ENTRIES` in `src/ui/menus/LoadMenu.tsx` (just
  **NEW GAME** for now; add OPTIONS or MYSTERY GIFT there with a new `LoadMenuChoice`).

Up/down choose, A or Start pick, B goes back to the title, and a tap picks a panel. The list
scrolls when it does not fit.

The graphics are Essentials' load screen, `ui/load/bg.png` and `ui/load/panels.png`. Every
position, the panel rectangles in the sheet and the text colours are in
`src/ui/menus/loadMenuLayout.ts`, so another skin is a matter of new images and numbers.

Picking **CONTINUE** loads the slot (`setGameState(saves.load(slot))`) and opens the overworld
where the player saved. The overworld adds play time to the save as the game is played.

## 8. New game: language, then the intro map

Picking **NEW GAME**:

1. clears any game in progress (`setGameState(null)`);
2. calls `startNewGame()` (`src/world/newGame.ts`), which shows the **language menu** first: every
   language by its own name, the cursor on the device's language, then a confirmation, since a
   save's language never changes. The new `GameState` is made in that language and the game's
   text is locked to it;
3. opens the overworld on `NEW_GAME.map` at the `Spawn` named `NEW_GAME.spawn`:

```ts
export const NEW_GAME: NewGameConfig = {
    map: 'intro',     // src/tiled/maps/intro.tmj
    spawn: 'start',
};
```

So the professor's speech is always in the language the player chose.

## 9. Writing the opening speech

The intro map, `src/tiled/maps/intro.tmj`, is an ordinary Tiled map with two objects: the `Spawn`
`start`, and an `Event` whose `script` is `intro_professor`. That script, in
`content/events/intro.json`, has one **autorun** page that runs as soon as the map has loaded,
blocking the player, until the story milestone `intro` is reached:

```json
{
    "trigger": "autorun",
    "conditions": { "story": "intro", "op": "before" },
    "commands": [
        { "cmd": "fade", "dir": "out", "ms": 0 },
        { "cmd": "hide", "target": "player" },
        { "cmd": "showPicture", "id": 1, "name": "introbg" },
        { "cmd": "showPicture", "id": 2, "name": "introbase", "x": 128, "y": 124, "origin": "center" },
        { "cmd": "fade", "dir": "in", "ms": 600 },
        { "cmd": "showPicture", "id": 3, "name": "introoak", "x": 128, "y": 85, "origin": "center", "ms": 400 },
        { "cmd": "message", "key": "events.intro.placeholder", "speaker": "events.intro.professor" },
        …
        { "cmd": "setStory", "milestone": "intro" }
    ]
}
```

Replace the placeholder message with the speech. Everything in `docs/EVENT_SYSTEM.md` is
available; the commands most useful here:

| For | Commands |
|-----|----------|
| Backdrops, the professor, the player's portraits | `showPicture`, `movePicture`, `erasePicture` with the files in `public/assets/img/pictures/` (`introbg`, `introbase`, `introoak`, `introboy`, `introgirl`, `intromarill`…). |
| Lines of the speech | `message` with text keys in `content/locales/events/<locale>.csv`, or a whole `ink` story. |
| The player's name | `{ "cmd": "nameInput", "var": "...", "max": 7 }` then `{ "cmd": "setPlayerName", "name": { "var": "..." } }` (add the variable to `src/events/registry/variables.ts`). |
| Boy or girl, the rival's name | `choice` / `yesNo`, `setVar`, `nameInput` into `rival_name`. |
| Music and effects | `bgm`, `se`, `cry`, `fade`, `tint`, `flash`, `wait`. |
| The end | `setStory` (`intro`), then `warp` to the first real map (for example the player's room). |

The page's condition turns itself off when it ends (the milestone is reached), so the speech never
plays twice, even if the player saves on the intro map. Run `npm run events:validate` after
editing: it checks the commands, text keys, maps and picture names.

The map itself can be decorated in Tiled like any other (`docs/EVENT_SYSTEM.md` §13). It is
normally hidden behind the pictures; leave it plain if the speech covers the whole screen.

## 10. Testing and development shortcuts

- `npm run dev`, then `http://localhost:8080/?map=intro` skips the splashes and title and opens a
  map (with the language menu first when no game is loaded); `&spawn=<name>` picks a `Spawn`.
- To try the Continue menu without playing, make a save from the browser console:

  ```js
  const s = await import('/src/state/index.ts');
  const game = s.GameState.create({ name: 'Red' });
  game.setPosition({ map: 'intro', x: 14, y: 9, facing: 'down' });
  s.getSaveManager().save(0, game);
  ```

  and `localStorage.clear()` to get rid of it.
- `npm test` covers the config (every image exists, the new-game map and its spawn exist),
  the layer timing, the movie lookup and the menu's slot order (`src/game/title/title.test.ts`).
- `npm run test:desktop` boots the production build, skips the splashes and checks that the title
  screen is reached.
