/**
 * @file InputManager.ts
 * @brief Turns keyboard, gamepad, mouse and touch input into game buttons.
 *
 * There is one manager for the whole app, `input`. The game starts it when it
 * is created (src/game/main.ts) and calls `update()` once per frame, before
 * any scene runs. Scenes and React components then only read buttons:
 *
 * @code
 * import { input } from '../../input';
 *
 * update ()
 * {
 *     if (input.justPressed('a')) this.talk();
 *     if (input.isDown('left')) this.walk('left');
 * }
 * @endcode
 *
 * Where each button comes from:
 * - **Keyboard**: the keys in the current bindings (see bindings.ts). Keys
 *   typed into a text field are left alone.
 * - **Gamepad**: the buttons in the current bindings, plus the left stick as
 *   the D-pad. Every connected gamepad works at the same time.
 * - **Mouse and touch**: a left click or a tap on the game presses `a`; a
 *   right click anywhere presses `b`. Taps and clicks on UI elements (anything
 *   with the `ui-interactive` class) go to that element instead, so UI
 *   is used by touching it directly.
 * - **On-screen pad**: `<VirtualPad>` (src/ui/VirtualPad.tsx) calls `setVirtual()`.
 */
import { BUTTONS, DPAD } from './buttons.ts';
import type { Button, DpadButton, InputDevice } from './buttons.ts';
import {
    cloneBindings, loadBindings, rebind as rebindIn, resetBindings as resetSaved, saveBindings, STICK_DEADZONE,
} from './bindings.ts';
import type { BindingDevice, Bindings, BindingStorage } from './bindings.ts';
import { InputState } from './InputState.ts';
import type { ButtonListener, DeviceListener } from './InputState.ts';

/**
 * @brief Whether an event target is a place to type text, where keys must not become buttons.
 * @param target The event's target.
 * @return `true` for inputs, text areas and editable elements.
 */
function isTextField (target: EventTarget | null): boolean
{
    if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
    return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/**
 * @brief D-pad direction of a stick, or `null` inside the dead zone.
 * @param x Horizontal axis (-1 left to 1 right).
 * @param y Vertical axis (-1 up to 1 down).
 * @return The direction it points to most.
 */
export function stickDirection (x: number, y: number): DpadButton | null
{
    if (Math.max(Math.abs(x), Math.abs(y)) < STICK_DEADZONE) return null;
    if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'left' : 'right';
    return y < 0 ? 'up' : 'down';
}

export class InputManager
{
    /** The button state everything reads. */
    private readonly state = new InputState();
    private bindings: Bindings;
    /** `KeyboardEvent.code` → buttons it presses. */
    private keyMap = new Map<string, Button[]>();
    /** Buttons held by each gamepad (by index), from the last poll. */
    private readonly padHeld = new Map<number, Set<Button>>();
    /** Game button held by each pointer (by pointer ID). */
    private readonly pointers = new Map<number, { button: Button; device: InputDevice }>();
    /** Gamepads already warned about for not using the standard mapping. */
    private readonly warnedPads = new Set<string>();
    /** Removes the browser listeners of the current connection. */
    private disconnect: (() => void) | null = null;
    /** Where bindings are saved; `undefined` means `localStorage`. */
    private readonly storage: BindingStorage | null | undefined;

    /**
     * @brief Creates a manager. The game uses the shared `input`; make others only for tests or tools.
     * @param storage Where bindings are saved. Default: `localStorage`.
     */
    constructor (storage?: BindingStorage | null)
    {
        this.storage = storage;
        this.bindings = loadBindings(storage);
        this.buildKeyMap();
    }

    // ------------------------------------------------------------ Lifecycle

    /**
     * @brief Start listening to the browser.
     *
     * Starting again first stops the previous connection.
     *
     * @param container Element holding the game canvas; left clicks and taps on it press `a`.
     * @return Stops this connection. Does nothing if another `start()` replaced it since.
     */
    start (container: HTMLElement): () => void
    {
        this.stop();

        const onKeyDown = (event: KeyboardEvent) =>
        {
            if (isTextField(event.target)) return;
            const buttons = this.keyMap.get(event.code);
            if (!buttons) return;
            //  Bound keys must not scroll the page, move focus or go back.
            event.preventDefault();
            if (event.repeat) return;
            for (const button of buttons) this.state.press(button, `key:${event.code}`, 'keyboard');
        };
        const onKeyUp = (event: KeyboardEvent) =>
        {
            //  Released even in a text field, so a key pressed before focusing one does not stay held.
            for (const button of BUTTONS) this.state.release(button, `key:${event.code}`, 'keyboard');
        };
        const onPointerDown = (event: PointerEvent) =>
        {
            //  Left button, or any touch or pen contact: `a`, only on the game itself.
            if (event.button !== 0 || event.target !== container && !container.contains(event.target as Node)) return;
            this.pointerPress(event, 'a');
        };
        const onRightDown = (event: PointerEvent) =>
        {
            //  Right button: `b`, anywhere on the page.
            if (event.button !== 2 || isTextField(event.target)) return;
            this.pointerPress(event, 'b');
        };
        const onPointerUp = (event: PointerEvent) => this.pointerRelease(event.pointerId);
        const onContextMenu = (event: Event) =>
        {
            if (!isTextField(event.target)) event.preventDefault();
        };
        const releaseAll = () => this.releaseAll();
        const onVisibility = () =>
        {
            if (document.hidden) this.releaseAll();
        };

        container.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointerdown', onRightDown, true);
        window.addEventListener('pointerup', onPointerUp, true);
        window.addEventListener('pointercancel', onPointerUp, true);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('contextmenu', onContextMenu);
        window.addEventListener('blur', releaseAll);
        document.addEventListener('visibilitychange', onVisibility);

        const disconnect = () =>
        {
            if (this.disconnect !== disconnect) return;
            this.disconnect = null;
            container.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointerdown', onRightDown, true);
            window.removeEventListener('pointerup', onPointerUp, true);
            window.removeEventListener('pointercancel', onPointerUp, true);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('blur', releaseAll);
            document.removeEventListener('visibilitychange', onVisibility);
            this.releaseAll();
        };
        this.disconnect = disconnect;
        return disconnect;
    }

    /** @brief Stop listening to the browser and release every button. */
    stop (): void
    {
        this.disconnect?.();
    }

    /**
     * @brief Read the gamepads and start a new frame. Call once per frame, before scenes update.
     */
    update (): void
    {
        this.pollGamepads();
        this.state.tick();
    }

    // ------------------------------------------------------------ Reading buttons

    /**
     * @brief Whether a button is held.
     * @param button The button.
     * @return `true` while any device holds it.
     */
    isDown (button: Button): boolean
    {
        return this.state.isDown(button);
    }

    /**
     * @brief Whether a button went down since the last frame.
     * @param button The button.
     * @return `true` for one frame per press.
     */
    justPressed (button: Button): boolean
    {
        return this.state.justPressed(button);
    }

    /**
     * @brief Whether a button came up since the last frame.
     * @param button The button.
     * @return `true` for one frame per release.
     */
    justReleased (button: Button): boolean
    {
        return this.state.justReleased(button);
    }

    /**
     * @brief The D-pad direction held, if any (the first of up, down, left, right).
     * @return The direction, or `null`.
     */
    direction (): DpadButton | null
    {
        return DPAD.find((button) => this.state.isDown(button)) ?? null;
    }

    /**
     * @brief Mark a press as handled so scenes do not see it in `justPressed()`.
     * @param button The button.
     */
    consume (button: Button): void
    {
        this.state.consume(button);
    }

    /** @brief The kind of device used last, or `null` before any input. */
    get lastDevice (): InputDevice | null
    {
        return this.state.lastDevice;
    }

    /**
     * @brief Be told about each press and release as it happens. For UI.
     * @param listener Receives the button, `press` or `release`, and the device.
     * @return A function that removes the listener.
     */
    on (listener: ButtonListener): () => void
    {
        return this.state.on(listener);
    }

    /**
     * @brief Be told when the player switches between keyboard, gamepad, mouse and touch.
     * @param listener Receives the new device.
     * @return A function that removes the listener.
     */
    onDeviceChange (listener: DeviceListener): () => void
    {
        return this.state.onDeviceChange(listener);
    }

    // ------------------------------------------------------------ On-screen pad

    /**
     * @brief Press or release a button from on-screen controls.
     * @param button The button.
     * @param down `true` to press, `false` to release.
     * @param source Names the control (for example a touch ID), so two controls can hold one button.
     */
    setVirtual (button: Button, down: boolean, source = 'pad'): void
    {
        if (down) this.state.press(button, `virtual:${source}`, 'touch');
        else this.state.release(button, `virtual:${source}`, 'touch');
    }

    // ------------------------------------------------------------ Bindings

    /** @brief A copy of the bindings in use. */
    getBindings (): Bindings
    {
        return cloneBindings(this.bindings);
    }

    /**
     * @brief Use other bindings.
     * @param bindings The new bindings.
     * @param save Also save them for next time (default `true`).
     */
    setBindings (bindings: Bindings, save = true): void
    {
        this.bindings = cloneBindings(bindings);
        this.buildKeyMap();
        this.releaseAll();
        if (save) saveBindings(this.bindings, this.storage);
    }

    /**
     * @brief Change which keys or gamepad buttons press one game button, and save it.
     *
     * @code
     * input.rebind('keyboard', 'a', ['KeyJ', 'Space']);
     * input.rebind('gamepad', 'start', [9, 16]);
     * @endcode
     *
     * @param device `keyboard` or `gamepad`.
     * @param button The game button.
     * @param codes `KeyboardEvent.code` values, or standard-mapping gamepad button indices.
     */
    rebind<D extends BindingDevice> (device: D, button: Button, codes: Bindings[D][Button]): void
    {
        this.setBindings(rebindIn(this.bindings, device, button, codes));
    }

    /** @brief Go back to the default bindings and forget the saved ones. */
    resetBindings (): void
    {
        this.setBindings(resetSaved(this.storage), false);
    }

    // ------------------------------------------------------------ Internals

    /** @brief Rebuild the key → buttons table from the bindings. */
    private buildKeyMap (): void
    {
        this.keyMap = new Map();
        for (const button of BUTTONS)
        {
            for (const code of this.bindings.keyboard[button])
            {
                const list = this.keyMap.get(code) ?? [];
                list.push(button);
                this.keyMap.set(code, list);
            }
        }
    }

    /** @brief A pointer went down: hold `button` until it comes up. */
    private pointerPress (event: PointerEvent, button: Button): void
    {
        if (this.pointers.has(event.pointerId)) return;
        const device: InputDevice = event.pointerType === 'mouse' ? 'mouse' : 'touch';
        this.pointers.set(event.pointerId, { button, device });
        this.state.press(button, `pointer:${event.pointerId}`, device);
    }

    /** @brief A pointer came up. */
    private pointerRelease (pointerId: number): void
    {
        const held = this.pointers.get(pointerId);
        if (!held) return;
        this.pointers.delete(pointerId);
        this.state.release(held.button, `pointer:${pointerId}`, held.device);
    }

    /** @brief Read every connected gamepad and press or release buttons to match. */
    private pollGamepads (): void
    {
        let pads: (Gamepad | null)[] = [];
        try
        {
            pads = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : [];
        }
        catch
        {
            //  Blocked by a permissions policy: no gamepads.
        }

        const seen = new Set<number>();
        for (const pad of pads)
        {
            if (!pad || !pad.connected) continue;
            seen.add(pad.index);
            if (pad.mapping !== 'standard' && !this.warnedPads.has(pad.id))
            {
                this.warnedPads.add(pad.id);
                console.warn(`[input] gamepad "${pad.id}" has no standard mapping; its buttons may be in other places`);
            }

            const wanted = new Set<Button>();
            for (const button of BUTTONS)
            {
                for (const index of this.bindings.gamepad[button])
                {
                    const state = pad.buttons[index];
                    if (state && (state.pressed || state.value > 0.5)) wanted.add(button);
                }
            }
            const stick = stickDirection(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
            if (stick) wanted.add(stick);

            const source = `pad:${pad.index}`;
            const previous = this.padHeld.get(pad.index) ?? new Set<Button>();
            for (const button of previous) if (!wanted.has(button)) this.state.release(button, source, 'gamepad');
            for (const button of wanted) if (!previous.has(button)) this.state.press(button, source, 'gamepad');
            this.padHeld.set(pad.index, wanted);
        }

        //  Unplugged gamepads let go of everything.
        for (const index of [...this.padHeld.keys()])
        {
            if (seen.has(index)) continue;
            this.padHeld.delete(index);
            this.state.releaseSources(`pad:${index}`, 'gamepad');
        }
    }

    /** @brief Let go of every button (focus lost, page hidden, bindings changed). */
    private releaseAll (): void
    {
        this.pointers.clear();
        this.padHeld.clear();
        this.state.releaseSources('', this.state.lastDevice ?? 'keyboard');
    }
}

/** @brief The input manager shared by the whole game. */
export const input = new InputManager();
