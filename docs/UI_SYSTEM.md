# UI System (React)

The game is drawn by Phaser on a canvas. The UI (menus, HUD, dialogue boxes, battle
menus) is drawn by [React](https://react.dev) on top of that canvas, with the
Pokémon Essentials windowskins and the FRLG font, pixel perfect at every screen size.

This is plain web technology (`react-dom`), so it runs anywhere the game runs: desktop
browsers, mobile browsers, and Android through a WebView wrapper such as
[Capacitor](https://capacitorjs.com). It is not React Native.

---

## Contents

1. [How it fits together](#1-how-it-fits-together)
2. [The event bus](#2-the-event-bus)
3. [Reading game state in React](#3-reading-game-state-in-react)
4. [Pixel-perfect rules](#4-pixel-perfect-rules)
5. [Assets: paths and loading](#5-assets-paths-and-loading)
6. [Windowskins](#6-windowskins)
7. [Text and fonts](#7-text-and-fonts)
8. [UI sounds](#8-ui-sounds)
9. [Dialogue: message box, name box, choices](#9-dialogue-message-box-name-box-choices)
10. [Building a new window or menu](#10-building-a-new-window-or-menu)
11. [Battles](#11-battles)
12. [Resolution and scaling](#12-resolution-and-scaling)
13. [No selecting or copying](#13-no-selecting-or-copying)
14. [Trying it out](#14-trying-it-out)
15. [Android notes](#15-android-notes)

---

## 1. How it fits together

```
index.html
└── src/main.tsx              connects the UI store and copy blocking, mounts <App />
    └── src/App.tsx
        └── <PhaserGame>      creates / destroys the Phaser game   (src/PhaserGame.tsx)
            ├── #game-container   Phaser puts its canvas here
            └── <UiLayer>     sits exactly on top of the canvas   (src/ui/UiLayer.tsx)
                └── <UiAssetGate>  waits for the font and skins (src/ui/assets/UiAssetGate.tsx)
                    └── your components
```

React and Phaser never hold references to each other. **Everything goes through the event
bus**, and React reads what the game publishes from small stores:

```
 Phaser scene ──emit──▶ EventBus ──▶ UI store ──useUiStore()──▶ React component
 Phaser scene ◀──on──── EventBus ◀──────────emit─────────────── React component
```

| Path | What it is |
|------|------------|
| `src/bus/EventBus.ts` | `EventBus`, `GameEvents` and `GameEventMap`: the typed bus. No Phaser or React inside. |
| `src/game/EventBus.ts` | Re-export of the bus for game code. |
| `src/game/announceScene.ts` | `announceScene(this)`: what every scene calls at the end of `create()`. |
| `src/game/config.ts` | `GAME_WIDTH` / `GAME_HEIGHT`: the game resolution (256×192). |
| `src/game/pixelScale.ts`, `src/game/viewport.ts` | Whole-device-pixel scaling of the canvas; publishes `VIEWPORT_CHANGED`. |
| `src/game/uiSounds.ts` | Plays the UI's sound cues for it. |
| `src/game/uiModal.ts` | `isUiModalOpen()` for scenes. |
| `src/PhaserGame.tsx` | `<PhaserGame>`: creates and destroys the game. Nothing else. |
| `src/ui/store/uiStore.ts` | The UI store: `useUiStore()`, `useGameSize()`, `useModal()`, `setTextSpeed()`. |
| `src/ui/UiLayer.tsx` | `<UiLayer>`: the container for all UI. |
| `src/ui/assets/` | `paths.ts` (URLs), `loader.ts` (image/font cache, `useImage()`), `UiAssetGate.tsx`. |
| `src/ui/skins/` | `skins.ts` (windowskin registry), `nineSlice.ts` (tiling maths). |
| `src/ui/text/` | `fonts.ts` (font registry), `layout.ts` (wrapping, pages), `render.ts` (canvas text), `usePixelText.ts`. |
| `src/ui/components/` | `<Window>`, `<PixelText>`, `<UiSprite>`: the building blocks. |
| `src/ui/dialogue/` | `<MessageBox>`, `<NameBox>`, `<ChoiceWindow>`, `<NameEntry>`, text speed and layout. |
| `src/ui/EventDialogue.tsx` | Connects the event system's dialogue requests to the dialogue windows. |
| `src/ui/sounds.ts` | `playUiSound()` and the cue registry. |
| `src/ui/noCopy.ts` | `blockTextCopy()`. |
| `src/ui/useBattle.ts`, `src/ui/useGameState.ts` | The battle in progress, and the save data (party, bag, flags). |
| `src/ui/useInput.ts`, `src/ui/VirtualPad.tsx` | Game buttons from any device. See `docs/INPUT_SYSTEM.md`. |
| `src/ui/orientation.ts`, `src/ui/RotateDevicePrompt.tsx` | Landscape lock and the "rotate your device" message. |
| `src/ui/ui.css` | Layer and building-block styles. |
| `src/devtools.ts` | `window.stab` helpers in `npm run dev` only. |

Everything public is exported from `src/ui/index.ts`.

## 2. The event bus

`src/bus/EventBus.ts` holds the bus and the list of events. Each event name is in
`GameEvents`, and the data it carries is declared in `GameEventMap`, so sending the wrong
data is a type error on both sides. Payloads are **plain data** (or request objects with
callbacks), never Phaser or React objects — the one exception is `SCENE_READY`, which is
for game code only.

| Event | Direction | Payload |
|-------|-----------|---------|
| `SCENE_READY` | Phaser → Phaser | The `Phaser.Scene` (game code only). |
| `SCENE_CHANGED` | Phaser → React | `{ key }` of the scene now active. |
| `VIEWPORT_CHANGED` | Phaser → React | `{ gameWidth, gameHeight, left, top, scale, deviceScale }`. |
| `UI_MODAL_CHANGED` | React → Phaser | `{ open }`: a message or menu has the player's input. |
| `UI_SOUND` | React → Phaser | `{ cue, url, volume }`: play a UI sound. |
| `TEXT_SPEED_CHANGED` | anyone | `{ speed }`: `'slow'`, `'mid'`, `'fast'` or `'instant'`. |
| `UI_SHAKE` | React → Phaser | none (sample). |
| `DIALOGUE_MESSAGE`, `DIALOGUE_CHOICE`, `DIALOGUE_NAME_INPUT` | Phaser → React | Requests from `src/world/dialogue.ts`. |
| `BATTLE_START`, `BATTLE_RESULT`, `BATTLE_EVOLUTIONS`, `BATTLE_END` | Phaser → anyone | See `docs/BATTLE_SYSTEM.md`. |
| `INPUT_DEVICE_CHANGED` | input → anyone | `InputDevice`. |

**Adding an event:** add the name to `GameEvents` and its payload to `GameEventMap`:

```ts
// src/bus/EventBus.ts
export const GameEvents = {
    // ...
    /** Phaser → React. The player's money changed. Argument: `{ money }`. */
    MONEY_CHANGED: 'money-changed',
} as const;

export interface GameEventMap
{
    // ...
    [GameEvents.MONEY_CHANGED]: { money: number };
}
```

**React → Phaser**

```tsx
<Window skin="choice_1" x={8} y={8} width={60} height={30} interactive
    onPointerDown={() => EventBus.emit(GameEvents.UI_SHAKE)}>
    <PixelText text="SHAKE" skin="choice_1" />
</Window>
```

```ts
// Scene, in create()
EventBus.on(GameEvents.UI_SHAKE, this.shake, this);
this.events.once('shutdown', () => EventBus.off(GameEvents.UI_SHAKE, this.shake, this));
```

**Phaser → React**: emit plain data, then either add it to the UI store (section 3) or
listen in a component:

```tsx
const [money, setMoney] = useState(0);
useEffect(() =>
{
    const onMoney = ({ money }: { money: number }) => setMoney(money);
    EventBus.on(GameEvents.MONEY_CHANGED, onMoney);
    return () => { EventBus.off(GameEvents.MONEY_CHANGED, onMoney); };
}, []);
```

Always remove listeners (scene `shutdown`, effect cleanup). Every scene ends its
`create()` with `announceScene(this)`.

## 3. Reading game state in React

React reads the game through stores, never through the game object:

| Hook | Gives | Fed by |
|------|-------|--------|
| `useUiStore(selector)` | `sceneKey`, `viewport`, `textSpeed`, `modalCount` | The bus (`src/ui/store/uiStore.ts`) |
| `useGameSize()` | `{ width, height }` of the game, in game pixels | `VIEWPORT_CHANGED` |
| `useGameState()` | The save data: party, bag, money, flags | `src/state` (see `docs/SAVE_SYSTEM.md`) |
| `useBattle()` | The battle in progress and the player's choices | `src/battle` |

```tsx
function SceneLabel ()
{
    const sceneKey = useUiStore((ui) => ui.sceneKey);
    return <PixelText text={sceneKey ?? ''} x={4} y={4} />;
}
```

A selector must return a value that stays `===` while nothing changes (a field, or a
number/string worked out from fields), not a new object.

**To add something to the UI store:** add the field to `UiState`, give it a starting value
in `INITIAL`, and set it from a bus listener in `connectUiStore()`.

**Modal UI.** While a message or menu takes the player's input, call `useModal(true)` in
it. The store sends `UI_MODAL_CHANGED`, and the overworld stops moving the player until
the last modal UI closes. Scenes can also ask `isUiModalOpen()` (`src/game/uiModal.ts`).

## 4. Pixel-perfect rules

The engine guarantees that every game pixel, in Phaser *and* in the UI, is drawn as an
exact square of whole screen pixels, with no blurred edges and no uneven "mixels". It
works because of these rules; follow them in new UI:

1. **Whole device pixels only.** The game is scaled by the largest whole number of
   *physical* pixels that fits the screen (section 12). The rest of the screen is a
   black border.
2. **Lay out in whole game pixels.** Inside `<UiLayer>`, 1 CSS pixel = 1 game pixel.
   Positions and sizes must be whole numbers. `<Window>`, `<PixelText>` and `<UiSprite>`
   round for you.
3. **Never stretch pixel art.** Windows are nine-slices whose edges and centre are
   **tiled** (repeated as they are, the last copy cut short), never scaled — so a window
   can be any size (section 6). Show images with `<UiSprite>` at 1×.
4. **Draw text with `<PixelText>`.** Fonts are drawn at their native size on whole pixels
   and every pixel is forced fully on or off (section 7).
5. **No CSS `scale()`, `zoom`, `border-radius`, gradients or `opacity` fades on pixel
   art.** They resample it. Animate by changing frames or whole-pixel positions instead.

## 5. Assets: paths and loading

All UI files live under `public/assets/` and are served next to the page. Build URLs with
the helpers in `src/ui/assets/paths.ts`, never by hand, so they keep working with Vite's
`base` and inside an Android WebView:

| Helper | Folder | Example |
|--------|--------|---------|
| `windowskinUrl(name)` | `assets/img/windowskins/` | `windowskinUrl('speech_frlg')` |
| `uiImageUrl(name)` | `assets/img/ui/` | `uiImageUrl('pause_arrow')`, `uiImageUrl('party/bg')` |
| `fontUrl(file)` | `assets/fonts/` | `fontUrl('pokemon-frlg.woff2')` |
| `uiSoundUrl(file)` | `assets/sound/se/ui/` | `uiSoundUrl('select.ogg')` |
| `assetUrl(path)` | anything under `public/` | `assetUrl('assets/img/pictures/map.png')` |

The windowskins and UI graphics were imported from Essentials by `npm run assets:graphics`
and halved to 1× (see `docs/ASSET_PIPELINE.md`). Browse `public/assets/img/ui/` for what
each future screen (bag, party, summary, Pokédex…) will be built from.

Loading (`src/ui/assets/loader.ts`):

| Function | What it does |
|----------|--------------|
| `loadImage(url)` | Loads an image once; the same promise for the same URL. |
| `getLoadedImage(url)` | The image if it has finished loading, else `null`. |
| `useImage(url)` | Hook: the image, or `null` while it loads. |
| `loadFont(family, url)` | Loads a font with `FontFace` and adds it to the page. |
| `preloadUi({ images, fonts })` | Loads several at once; failures are logged, not thrown. |
| `<UiAssetGate preload={...}>` | Renders its children once the default font, skins and arrows (plus `preload`) are ready. |

Screens with many images should preload them when they open, for example with
`preloadUi({ images: [uiImageUrl('bag/bg'), ...] })` in an effect, and show nothing until it resolves.

## 6. Windowskins

A windowskin is registered once in `src/ui/skins/skins.ts` and used by id:

```tsx
<Window skin="speech_frlg" x={0} y={144} width={256} height={48}>
    ...
</Window>
```

```ts
interface WindowSkin
{
    id: string;            // what <Window skin="..."> uses
    url: string;           // windowskinUrl('...')
    format: 'frame' | 'rmxp';
    slice?: Insets;        // corner sizes (optional, see below)
    padding: Insets;       // where content starts, from the window's outer edge
    textColor: string;     // colours for <PixelText skin="...">
    shadowColor: string | null;
}
```

**Formats**

- `frame` — Essentials speech and choice frames (`speech_frlg`, `speech_hgss_1`…`20`,
  `speech_dp_*`, `speech_pl_*`, `speech_em`, `speech_rs`, `choice_1`…`28`, `choice_dp`).
  The whole image is a nine-slice. Without `slice`, the centre is the middle 8×8 pixels
  (16 px corners for the 40×40 FRLG frame, 8 px for the 24×24 choice frames).
- `rmxp` — an RPG Maker XP skin (`windowskin`), at 1×: a 64×64 background at (0, 0),
  tiled inside the window 1 px from its edge; a 32×32 frame at (64, 0) drawn as a
  nine-slice with an empty centre (8 px corners unless `slice` says otherwise); a 16×16
  cursor at (64, 32) (`RMXP_LAYOUT`).

All of these are already registered. `DEFAULT_SKINS` says which ones the default UI uses
(`message: 'speech_frlg'`, `choice: 'choice_1'`); change it to restyle every message box or
menu at once, for example from a future options menu.

**Adding a skin:** put the PNG (at 1×) in `public/assets/img/windowskins/` and register it:

```ts
registerSkin({
    id: 'my_frame', url: windowskinUrl('my_frame'), format: 'frame',
    slice: { left: 12, top: 12, right: 12, bottom: 12 },   // only if the default is wrong
    padding: { left: 12, top: 8, right: 12, bottom: 8 },
    ...ESSENTIALS_DARK_TEXT,
});
```

`padding` is measured from the window's outer edge, including any transparent margin in
the image (the FRLG frame has 5 px of it at the sides and 3 at top and bottom).

**How it is drawn.** `planWindow()` turns a skin and a size into a list of copies
(`DrawOp`), each copying a rectangle of the image at exactly its own size: corners once,
edges and centre tiled with the last tile cut short. `<Window>` draws them into a 1×
canvas. Nothing is scaled, so a window of any size — 37×41, 256×48 — has no mixels. A window
is never smaller than its corners (`fitWindowSize()`); ask for a size that fits your content
and read back the real size from `planWindow()` if you need to place things around it.

## 7. Text and fonts

**All game text is drawn with `<PixelText>`**, never as DOM text:

```tsx
<PixelText text="POKéMON" x={8} y={4} skin="choice_1" />
<PixelText text={description} wrap={200} color="#f8f8f8" shadow="#686868" />
<PixelText lines={page} maxChars={typed} skin="speech_frlg" />
```

| Prop | Meaning |
|------|---------|
| `text` / `lines` | The text (`\n` breaks lines), or lines already laid out. |
| `wrap` | Word-wrap `text` to this many pixels. |
| `x`, `y` | Position in the parent, in game pixels. |
| `skin` | Take the colours from a windowskin. |
| `color`, `shadow` | Override the colours (`shadow={null}` for none). |
| `font` | Font id (default `frlg`). |
| `maxChars` | Draw only the first N characters (typewriter). |

How it stays sharp: a pixel font only has crisp edges at the size its outlines were drawn
on. The FRLG font (`public/assets/fonts/pokemon-frlg.woff2`, "Pokemon FRLG" by
aztecwarrior28, CC BY-SA) has 2000 units per em on a 1/14 em grid, so its **native size is
14 px**; tested in Chromium, it then has no partly covered pixels at all. `<PixelText>`
draws each character at a whole-pixel position at that size into a 1× canvas, forces every
pixel fully on or off, and adds the GBA/Essentials shadow (one pixel right, down and
diagonal). Lines are 16 px apart.

Layout helpers (`src/ui/text/`), useful for menus:

| Function | What it does |
|----------|--------------|
| `usePixelFont(id?)` | `{ font, advance, ready }`; `advance(char)` is a character's width in whole pixels. |
| `textWidth(line, advance)` | Width of a line. |
| `wrapText(text, width, advance)` | Word-wraps; long words break between letters. |
| `paginate(lines, n)` | Pages of `n` lines. |
| `useTextPages(text, width, n)` | Both, as a hook, once the font is ready. |

**Adding a font:** put the file in `public/assets/fonts/`, find its native size (draw it
at several sizes, e.g. 7–16 px, and keep the one where every pixel's alpha is 0 or 255),
and register it:

```ts
registerFont('small', {
    family: 'STAB Small', url: fontUrl('my-small-font.woff2'),
    size: 8, lineHeight: 10, baseline: 7, letterSpacing: 0,
});
```

`<UiAssetGate>` loads every registered font before the UI appears.

## 8. UI sounds

UI sounds are cues, played through the game so they follow its volume and mute settings:

```ts
playUiSound('select');   // React only emits UI_SOUND; src/game/uiSounds.ts plays it
```

| Cue | Played when | File (in `public/assets/sound/se/ui/`) | Essentials equivalent |
|-----|-------------|------|-----------------------|
| `select` | A advances or closes a message (the text blip), an option is picked, a name is confirmed | `select.ogg` | `GUI sel decision` |
| `cursor` | The cursor moves to another option | `cursor.ogg` | `GUI sel cursor` |
| `cancel` | B cancels a choice | `cancel.ogg` | `GUI sel cancel` |

The sound files are not in the repository yet. Drop them in that folder with those names
and they play — no code change. Until then each cue logs one console line and stays
silent. To use other files or volumes:

```ts
registerUiSound('select', { url: uiSoundUrl('frlg_select.ogg'), volume: 0.8 });
```

## 9. Dialogue: message box, name box, choices

`<EventDialogue>` listens for the event system's requests (`src/world/dialogue.ts`) and
shows the windows in `src/ui/dialogue/`. They can also be used on their own.

**`<MessageBox text speaker? onDone? waitForInput? onTyped? skin? font?>`** — FRLG-style:

- full-width `speech_frlg` box along the bottom, 48 px high;
- text word-wrapped with the real font and split into **pages of two lines**, leaving room
  for the pause arrow;
- each page **typed out** at the text speed (`slow` 15, `mid` 30, `fast` 60 characters a
  second, or `instant`; `TEXT_SPEED_CPS` in `src/ui/dialogue/textSpeed.ts`). Change it
  with `setTextSpeed('fast')` (sends `TEXT_SPEED_CHANGED`);
- A or B while typing shows the page at once; when the page is done the **pause arrow**
  (`pause_arrow.png`, four 10×14 frames) bounces after the text, and A, B or a tap plays
  the `select` blip and goes on;
- with `waitForInput={false}` the last page stays up without an arrow and `onTyped` fires
  when it is typed — used for a question followed by a choice.

**`<NameBox>`** — when a message has a `speaker`, their name appears in a small window of
the same skin, sized to the name, sitting slightly above the left-hand side of the message
box (`nameBox()` and `NAME_BOX_INDENT` in `src/ui/dialogue/layout.ts`).

**`<ChoiceWindow options onPick cancel? initial? x? y? skin?>`** — a `choice_1` window
sized to the widest option, right-aligned on top of the message box, with the `sel_arrow`
cursor. Up/down move (wrapping, `cursor` sound), A picks (`select`), B picks `cancel` if
allowed (`cancel` sound), a tap picks an option.

**`<NameEntry>`** — the prompt in the message box and the typed name in a window above it.
The name is drawn with `<PixelText>`; an invisible text field takes the keys (and brings up
the phone keyboard). Enter confirms. A full letter grid can replace it later.

All of them call `useModal()`, so the player cannot walk while they are up, and take every
button press while they wait for one.

## 10. Building a new window or menu

A small pause menu, end to end:

```tsx
import { useState } from 'react';
import {
    PixelText, UiSprite, Window, playUiSound, uiImageUrl, useGameSize, useInputPress, useModal,
    usePixelFont, SELECT_ARROW,
} from './ui';

const ITEMS = ['POKéDEX', 'POKéMON', 'BAG', 'SAVE', 'EXIT'];

export function PauseMenu ({ open, onClose }: { open: boolean; onClose: () => void })
{
    const { width } = useGameSize();
    const { font } = usePixelFont();
    const [index, setIndex] = useState(0);
    useModal(open);                                   // the player stops walking

    useInputPress((button) =>
    {
        if (button === 'up') { setIndex((i) => (i + ITEMS.length - 1) % ITEMS.length); playUiSound('cursor'); }
        else if (button === 'down') { setIndex((i) => (i + 1) % ITEMS.length); playUiSound('cursor'); }
        else if (button === 'b' || button === 'start') { playUiSound('cancel'); onClose(); }
        else if (button === 'a') { playUiSound('select'); /* open ITEMS[index] */ }
        return true;                                  // the scene never sees these presses
    }, open);

    if (!open) return null;
    const height = ITEMS.length * font.lineHeight + 14;
    return (
        <Window skin="choice_1" x={width - 84} y={2} width={82} height={height}>
            {ITEMS.map((item, i) => (
                <PixelText key={item} text={item} y={i * font.lineHeight} skin="choice_1" />
            ))}
            <UiSprite src={uiImageUrl(SELECT_ARROW.name)} x={-8} y={index * font.lineHeight + 1}
                width={SELECT_ARROW.width} height={SELECT_ARROW.height} />
        </Window>
    );
}
```

Checklist:

1. Pick or register a skin (section 6); use `getSkin(id).padding` to size around content.
2. Text through `<PixelText>`, images through `<UiSprite>` or a `<Window>`, all at whole pixels.
3. Place from the edges with `useGameSize()`, so a different resolution still fits.
4. `useModal(open)` and `useInputPress(..., open)`; `ui-interactive` (or `interactive` on
   `<Window>`) on what can be tapped.
5. Talk to the game only through `EventBus` events and read it only through stores.
6. Preload big images when the screen opens (section 5).
7. Doxygen comments (`@file`, `@brief`, `@param`, `@return`) like the rest of the code.

## 11. Battles

During a battle, components read the battle and send the player's choices with the
`useBattle()` hook (`src/ui/useBattle.ts`). It returns `null` when no battle is running.

```tsx
function MoveMenu ()
{
    const battle = useBattle();
    if (battle?.snapshot.choice?.kind !== 'move') return null;

    return (
        <Window skin="choice_1" x={0} y={144} width={256} height={48} interactive>
            {battle.snapshot.choice.moves.map((move, i) => (
                <div key={move.slot} className="ui-interactive" style={{ position: 'absolute', top: i * 16 }}
                    onPointerDown={() => battle.chooseMove(move.slot)}>
                    <PixelText text={`${move.name} ${move.pp}/${move.maxpp}`} skin="choice_1" />
                </div>
            ))}
        </Window>
    );
}
```

| Returned | What it is |
|----------|------------|
| `snapshot` | The battle as it is being shown: `phase`, `me`, `foe`, `turn`, `step`, `choice`, `error`, `winner`. |
| `chooseMove(slot, extra?)` | Use a move from `snapshot.choice.moves`. |
| `chooseSwitch(slot)` | Send out a party member from `snapshot.choice.switches`. |
| `chooseTeam(order?)` | Answer Team Preview. |
| `forfeit()` | Give up. |
| `bridge` | The `BattleBridge`, for anything else. |

The component is rendered again after every step the battle scene shows, so a HP bar drawn
from `snapshot.foe.active[0]` moves when the hit is shown and not before. `snapshot.choice`
is only set once the turn has finished playing, so use it to decide when to show a menu.
`snapshot.step?.text` is a sentence for the current step, for a message box.

The fields are described in
[BATTLE_SYSTEM.md](BATTLE_SYSTEM.md#12-the-battle-bridge-phaser-and-react). No battle UI
exists yet; the hook is what it will be built on.

## 12. Resolution and scaling

The base resolution is set in one place, `src/game/config.ts`. The game uses
`Scale.NONE` and `pixelArt: true`; `attachPixelScale()` (`src/game/viewport.ts`) does the
scaling:

- the scale is the largest **whole number of device pixels** per game pixel that fits
  (`computePixelScale()` in `src/game/pixelScale.ts`). On a desktop at 100% that is 3× in a
  1280×720 window; on a phone with a device pixel ratio of 2.75 it is often 5 device pixels,
  i.e. 1.818… CSS pixels per game pixel. The rest of the screen is a black border;
- the canvas and `<UiLayer>` are placed with a CSS **transform**
  (`pixelTransform()`), not `left`/`width`: browsers round CSS lengths to 1/64 px, which at
  ratios like 1.25 or 2.75 puts the game a fraction of a pixel off and blends one column of
  every pixel. Transforms keep full precision;
- it runs again on window resize, rotation, device pixel ratio changes (browser zoom,
  another monitor) and game resolution changes (`game.scale.setGameSize(w, h)`), and each
  time publishes `VIEWPORT_CHANGED`, which `<UiLayer>` follows.

`<UiLayer>` sets these CSS variables: `--game-width`, `--game-height` (plain numbers),
`--ui-scale` (CSS pixels per game pixel) and `--device-scale` (screen pixels per game pixel).

Checked with Playwright at 1280×720 @1, 1366×768 @1.25, 844×390 @2.75 and 700×500 @2: every
game pixel of both the canvas and the UI is a uniform k×k block of screen pixels.

In scenes, take positions from `this.scale.width` / `this.scale.height`, not fixed numbers.
In the UI, place from the edges with `useGameSize()`.

## 13. No selecting or copying

Game text cannot be highlighted or copied:

- it is drawn into canvases by `<PixelText>`, so there is no DOM text to select (screen
  readers still get it through `aria-label`);
- `public/style.css` and `ui.css` set `user-select: none` and turn off image dragging and
  the long-press callout;
- `blockTextCopy()` (`src/ui/noCopy.ts`, called in `src/main.tsx`) cancels `selectstart`,
  `copy`, `cut`, `dragstart` and the context menu on the whole page, and clears any
  selection that still appears. The name entry's hidden text field can be typed in, but
  copying or cutting from it is blocked too.

Rule for new UI: never put game text in the page as text. Use `<PixelText>`.

## 14. Trying it out

`npm run dev`, then in the browser console:

```js
stab.demo();                                   // message with a speaker, paging, choice, name entry
stab.say('Hello!', 'MOM');                     // one message
stab.ask('Heal your POKéMON?', ['YES', 'NO'], 1);
stab.name('Your name?', 'RED', 7);
stab.textSpeed('slow');                        // 'slow' | 'mid' | 'fast' | 'instant'
```

The dev build also shows a sample HUD (the scene name, and a SHAKE button that sends
`UI_SHAKE` to the scene). Neither is in production builds.

## 15. Android notes

- **Landscape only.** The game is played horizontally on Android. `lockLandscape()`
  (`src/ui/orientation.ts`) asks the browser to lock the screen, and
  `<RotateDevicePrompt>` covers the game with a "rotate your device" message whenever a
  touch device is held upright, because browsers often refuse the lock. Desktop windows
  are never blocked. When the Android app is packaged, also set
  `android:screenOrientation="sensorLandscape"` on its activity so the app never rotates
  to portrait in the first place.
- **Touch targets.** A finger needs about 48 CSS pixels. On a phone in landscape one game
  pixel is roughly 2 CSS pixels, so make buttons at least ~24 game pixels in their
  smaller dimension.
- **No hover.** Touch screens have none. Do not hide information or actions behind `:hover`.
- **Small text.** Game text is pixels in a canvas, so Android's minimum font size does not
  apply to it.
- **Gestures.** `ui.css` and `public/style.css` turn off text selection, the tap
  highlight, pull-to-refresh and browser zoom so they do not interfere with play.
- **Notches.** `index.html` sets `viewport-fit=cover`. If the game is ever drawn under a
  notch, pad with `env(safe-area-inset-top)` and friends.
- **Rotation.** `attachPixelScale()` measures again on the next animation frame after a
  resize, which also works around Phaser 4.0.0 keeping the old size after a rotation.
- **Packaging.** The repository has no Android project yet. `npm run build` produces a
  static site in `dist/` with relative paths, which is what Capacitor and similar tools wrap.
