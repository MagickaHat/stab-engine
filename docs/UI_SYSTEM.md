# UI System (React)

The game is drawn by Phaser on a canvas. The UI (menus, HUD, dialogue boxes, battle
menus) is drawn by [React](https://react.dev) as normal HTML on top of that canvas.

This is plain web technology (`react-dom`), so it runs anywhere the game runs: desktop
browsers, mobile browsers, and Android through a WebView wrapper such as
[Capacitor](https://capacitorjs.com). It is not React Native.

## 1. How it fits together

```
index.html
└── src/main.tsx              mounts <App /> into #app
    └── src/App.tsx
        └── <PhaserGame>      creates / destroys the Phaser game   (src/PhaserGame.tsx)
            ├── #game-container   Phaser puts its canvas here
            └── <UiLayer>     sits exactly on top of the canvas   (src/ui/UiLayer.tsx)
                └── your components
```

| Path | What it is |
|------|------------|
| `src/game/config.ts` | `GAME_WIDTH` / `GAME_HEIGHT`: the game resolution (256×192). |
| `src/PhaserGame.tsx` | `<PhaserGame>`, `useGame()`, `useCurrentScene()`. |
| `src/game/EventBus.ts` | `EventBus` and `GameEvents`: messages between React and Phaser. |
| `src/ui/UiLayer.tsx` | `<UiLayer>`: the container for all UI. |
| `src/ui/useGameViewport.ts` | Hook that tracks the game's resolution and on-screen size. |
| `src/ui/orientation.ts`, `src/ui/RotateDevicePrompt.tsx` | Landscape lock and the "rotate your device" message. |
| `src/ui/ui.css` | Styles for the layer and the sample HUD. |

## 2. Adding UI

Write a component and render it inside `<UiLayer>` in `src/App.tsx`:

```tsx
function MoneyCounter ()
{
    return <div style={{ position: 'absolute', right: 4, top: 4 }}>$ 3000</div>;
}

<PhaserGame>
    <UiLayer>
        <MoneyCounter />
    </UiLayer>
</PhaserGame>
```

### Sizes are in game pixels

`<UiLayer>` is as large as the game resolution and is scaled as a whole to cover the
canvas. So inside it, **1 CSS pixel = 1 game pixel**. `right: 4` above means 4 game pixels
from the right edge of the game on every screen. The coordinate space is the same one the
scenes use (256×192 today), so UI lines up with sprites.

Text and borders are scaled by the browser, so they stay sharp. `<img>` elements in the
layer are scaled without smoothing, like the game.

### Input

The layer ignores touches and clicks so they reach the game underneath. Add the
`ui-interactive` class to anything the player should be able to press:

```tsx
<button className="ui-interactive" onClick={openMenu}>Menu</button>
```

## 3. Talking to Phaser

React and the scenes do not hold references to each other. They send events through the
shared `EventBus`. Add the event name to `GameEvents` in `src/game/EventBus.ts` first.

**React → Phaser**

```tsx
// Component
<button className="ui-interactive" onClick={() => EventBus.emit(GameEvents.UI_SHAKE)}>Shake</button>
```

```ts
// Scene, in create()
EventBus.on(GameEvents.UI_SHAKE, this.shake, this);
this.events.once('shutdown', () => EventBus.off(GameEvents.UI_SHAKE, this.shake, this));
```

**Phaser → React**

```ts
// Scene
EventBus.emit('player-hp', 42);
```

```tsx
// Component
const [hp, setHp] = useState(0);
useEffect(() =>
{
    EventBus.on('player-hp', setHp);
    return () => { EventBus.off('player-hp', setHp); };
}, []);
```

Always remove listeners (scene `shutdown`, effect cleanup). Otherwise they keep running
after the scene or component is gone.

Every scene should end its `create()` with
`EventBus.emit(GameEvents.SCENE_READY, this);`. That is what `useCurrentScene()` returns.
`useGame()` returns the `Phaser.Game` when you need it directly.

## 4. Resolution and scaling

The base resolution is set in one place, `src/game/config.ts`. The game uses
`Scale.FIT`, so the canvas grows to fill the screen while keeping its shape, and
`pixelArt: true`, so it is scaled without smoothing.

The UI never assumes a resolution. `useGameViewport()` reads the current game size and
canvas position from Phaser's Scale Manager and measures again when:

- the screen or window changes (phone rotation, Android split-screen, browser resize);
- the game resolution changes at runtime: `game.scale.setGameSize(w, h)` or
  `game.scale.resize(w, h)`.

`<UiLayer>` then moves and rescales itself. It also sets these CSS variables:
`--game-width`, `--game-height` (plain numbers) and `--ui-scale` (CSS pixels per game pixel).

### Resizable desktop window (not implemented yet)

Nothing in the UI needs to change for this. A future desktop build only has to decide the
new size and tell the Scale Manager, for example `game.scale.setGameSize(w, h)` for a
different resolution, or just letting the window resize for the same resolution at a
different scale. The UI follows either way.

Two things to keep in mind when that is built:

- In scenes, take positions from `this.scale.width` / `this.scale.height` (as
  `src/game/scenes/Game.ts` does), not from fixed numbers.
- If the resolution can change, position UI from the edges (`left`, `right`, `top`,
  `bottom`, percentages) instead of assuming a 256×192 box.

## 5. Android notes

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
- **Small text.** Android WebView does not draw fonts smaller than 8px. Keep `font-size`
  at 8 (game pixels) or more inside the layer.
- **Gestures.** `ui.css` and `public/style.css` already turn off text selection, the tap
  highlight, pull-to-refresh and browser zoom so they do not interfere with play.
- **Notches.** `index.html` sets `viewport-fit=cover`. If the game is ever drawn under a
  notch, pad with `env(safe-area-inset-top)` and friends.
- **Rotation.** `src/game/main.ts` contains a small workaround (`keepFitted`) for Phaser
  4.0.0 keeping the old canvas size after a rotation (it still matters when the player
  turns the phone from upright to landscape). Remove it once Phaser fixes this.
- **Packaging.** The repository has no Android project yet. `npm run build` produces a
  static site in `dist/` with relative paths, which is what Capacitor and similar tools wrap.
