# Input System

Keyboards, gamepads, mice, touch screens and the on-screen pad all press the same **game
buttons**. Scenes and UI never ask about keys, gamepad indices or touches: they ask whether
`a` is pressed. This makes every control scheme work on every platform (desktop browsers,
mobile browsers and Android WebViews).

The code is in `src/input/`; the React parts are in `src/ui/useInput.ts` and
`src/ui/VirtualPad.tsx`.

## 1. The buttons

| Button | Meaning (by convention) |
|--------|-------------------------|
| `up`, `down`, `left`, `right` | The D-pad: walking, moving through menus. |
| `a` | Confirm, talk, interact. |
| `b` | Cancel, back. Held in the overworld to run. |
| `x`, `y` | Extra face buttons (free for your game). |
| `l`, `r` | The left and right triggers. |
| `start` | Open the main menu. |
| `select` | Secondary menu / shortcut. |

The engine itself only uses the D-pad, `a` and `b` today. The others are free for your menus.

## 2. Default controls

| Button | Keyboard | Gamepad (standard layout) | Mouse / touch |
|--------|----------|---------------------------|---------------|
| D-pad | Arrow keys, WASD | D-pad, left stick | On-screen D-pad |
| `a` | Z, Space | Bottom face button (Xbox A, PlayStation ✕, Switch B) | Left click or tap on the game; on-screen A |
| `b` | X, Escape, Backspace | Right face button | Right click (anywhere); on-screen B |
| `x` | C | Left face button | On-screen X |
| `y` | V | Top face button | On-screen Y |
| `l` | Q | Left bumper and left trigger | On-screen L |
| `r` | E | Right bumper and right trigger | On-screen R |
| `start` | Enter | Start / Menu / + | On-screen Start |
| `select` | Tab, Right Shift | Back / View / Share / − | On-screen Select |

- Keys are matched by **physical position** (`KeyboardEvent.code`), so WASD stays in place on
  AZERTY or QWERTZ keyboards.
- Gamepad buttons are matched by **position** in the browser's
  [standard gamepad layout](https://w3c.github.io/gamepad/#remapping): `a` is always the
  bottom face button, whatever is printed on it. Every connected gamepad works at once.
  Gamepads without the standard layout still work, but their buttons may be in other places
  (a warning is logged once).
- The left stick counts as the D-pad once pushed past `STICK_DEADZONE` (half way).
- Keys typed into a text field (the name entry box) are left alone.
- When the window loses focus every button is released, so nothing stays stuck.

## 3. Mouse and touch

Touch and clicking mean the same thing:

- **Tapping or left-clicking UI** (anything with the `ui-interactive` class) uses that element
  directly: tapping an option in a choice picks it, tapping the message box moves on.
- **Tapping or left-clicking the game** (outside UI) presses `a`.
- **Right-clicking anywhere** presses `b`. The browser's context menu is turned off (except in
  text fields).

So on a touch screen, tapping anywhere moves past a message, the same as pressing A.

UI handlers for `onPointerDown` should only react to the left button
(`event.button === 0`), so a right click stays `b`. `<EventDialogue>` does this.

## 4. The on-screen pad

`<VirtualPad>` (`src/ui/VirtualPad.tsx`) draws a D-pad, A/B/X/Y, L/R, Start and Select over
the game. It is rendered in `src/App.tsx` inside `<UiLayer>`, after the other UI.

```tsx
<VirtualPad />                    // default: 'auto'
<VirtualPad visible="always" />
<VirtualPad visible="never" />
```

With `auto` it shows on touch screens (`(pointer: coarse)`) and whenever the player last used
touch, and hides as soon as they use a keyboard or gamepad.

- Several fingers can hold controls at once (walk and hold B to run).
- A finger can slide around the D-pad to change direction; the centre presses nothing.

**The engine ships no art for the pad.** Controls are outlined boxes with letters, laid out in
`src/ui/ui.css` (`.virtual-pad…` classes). Restyle them in your game's stylesheet:

| Class | Element |
|-------|---------|
| `.virtual-pad` | The whole pad. Sets `--pad-size`, `--pad-button`, `--pad-bottom`, `--pad-line`. |
| `.virtual-pad-dpad` | The D-pad. Gets `pressed-up` / `pressed-down` / … while held. |
| `.virtual-pad-dpad-up`, `-down`, `-left`, `-right` | Its four arms. |
| `.virtual-pad-face` | The A/B/X/Y group. |
| `.virtual-pad-button` | Every button; also `.virtual-pad-a`, `.virtual-pad-start`, … Gets `pressed` while held. |
| `.virtual-pad-menu` | The Start/Select group. |

Other on-screen controls can press buttons too: `input.setVirtual('a', true, 'my-control')`,
then `input.setVirtual('a', false, 'my-control')`.

## 5. Reading buttons in a scene

```ts
import { input } from '../../input';

update ()
{
    if (input.justPressed('start')) this.openMenu();
    if (input.justPressed('a')) this.interact();

    const dir = input.direction();     // 'up' | 'down' | 'left' | 'right' | null
    if (dir) this.walk(dir, input.isDown('b'));
}
```

| Method | Returns |
|--------|---------|
| `isDown(button)` | Whether it is held right now, by any device. |
| `justPressed(button)` | `true` on the one frame after it went down. |
| `justReleased(button)` | `true` on the one frame after it came up. |
| `direction()` | The D-pad direction held, or `null`. |
| `consume(button)` | Hides the current press from `justPressed()`. |
| `lastDevice` | `keyboard`, `gamepad`, `mouse`, `touch` or `null`. |
| `on(listener)` | Calls `listener({ button, type, device })` on every press and release, as it happens. Returns a function that removes it. |
| `onDeviceChange(listener)` | Calls `listener(device)` when the player switches device. |

The game starts a new input frame before every game step (`src/game/main.ts`), so every scene
sees the same `justPressed()` within a frame, and a quick tap between two frames is never lost.

The input system replaces Phaser's own keyboard and gamepad plugins, which are turned off in
`src/game/main.ts`. Phaser pointer input (`setInteractive()`, `pointerdown`) still works.

## 6. Reading buttons in React

```tsx
import { useInputPress, useLastDevice } from './ui';

function PauseMenu ({ open, onClose }: { open: boolean; onClose: () => void })
{
    useInputPress((button) =>
    {
        if (button === 'b' || button === 'start') { onClose(); return true; }
        return false;
    }, open);
    const device = useLastDevice();
    return open ? <div>{device === 'gamepad' ? 'Ⓑ Back' : 'B: Back'}</div> : null;
}
```

- `useInputPress(handler, active)` calls `handler(button, event)` for each press while `active`.
  Return `true` when the press was used: it is then **consumed**, so the scene under the menu
  does not act on it too. The handler always sees the latest props; no `useCallback` needed.
- `useLastDevice()` re-renders when the player switches device, for button prompts.
- `GameEvents.INPUT_DEVICE_CHANGED` on the `EventBus` carries the same news to scenes.

## 7. Changing the controls

Bindings can be changed while the game runs and are saved in `localStorage`
(`stab-input-bindings`). Only changes are saved, so buttons the player never touched follow
the defaults in `src/input/bindings.ts`.

```ts
input.rebind('keyboard', 'a', ['KeyJ', 'Space']);  // KeyboardEvent.code values
input.rebind('gamepad', 'start', [9, 16]);         // standard-layout button indices
input.resetBindings();                             // back to the defaults

const bindings = input.getBindings();              // a copy, to show in a controls menu
input.setBindings(bindings);                       // replace all of them (and save)
```

A key or gamepad button given to one game button is taken away from any other, so one key
never presses two buttons. Saved data that is broken or from another version is ignored with
a warning.

There is no controls menu yet. To build one, listen for the next `keydown` (read
`event.code`) or poll `navigator.getGamepads()` for the next pressed index, then call
`input.rebind()`.

To change the defaults for your game, edit `DEFAULT_KEYBOARD` and `DEFAULT_GAMEPAD` in
`src/input/bindings.ts`.

## 8. Files

| Path | What it is |
|------|------------|
| `src/input/buttons.ts` | `BUTTONS`, `Button`, `DPAD`, `InputDevice`. |
| `src/input/InputState.ts` | Held / just pressed / just released state, with no browser code (tested). |
| `src/input/bindings.ts` | Default bindings, `rebind()`, loading and saving. |
| `src/input/InputManager.ts` | `input`: listens to the keyboard, gamepads, mouse and touch. |
| `src/input/input.test.ts` | Unit tests (`npm test`). |
| `src/ui/useInput.ts` | `useInputPress()`, `useLastDevice()`. |
| `src/ui/VirtualPad.tsx` | `<VirtualPad>`. |
