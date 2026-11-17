/**
 * @file InputState.ts
 * @brief Which buttons are held, and which went down or up this frame.
 *
 * This class knows nothing about the browser: input sources call `press()`
 * and `release()`, and the game loop calls `tick()` once per frame. That
 * makes it easy to test and to feed from anything (keyboard, gamepad,
 * touch, a replay...).
 *
 * A button is held while at least one *source* holds it. A source is any
 * string naming what holds the button, such as `key:KeyZ`, `pad:0` or
 * `pointer:3`, so the Z key and the gamepad can both hold A and A is only
 * released once both let go.
 *
 * `justPressed()` / `justReleased()` describe what happened between the last
 * two `tick()` calls. A press is never lost, even if the button went down and
 * up again between two frames (a quick tap).
 */
import { BUTTONS } from './buttons.ts';
import type { Button, InputDevice } from './buttons.ts';

/** @brief What a listener added with `InputState.on()` receives. */
export interface ButtonEvent
{
    /** The button. */
    button: Button;
    /** `press` when the button goes down, `release` when it comes back up. */
    type: 'press' | 'release';
    /** The device that caused it. */
    device: InputDevice;
}

/** @brief Called as soon as a button goes down or up. */
export type ButtonListener = (event: ButtonEvent) => void;

/** @brief Called when the player switches to another kind of device. */
export type DeviceListener = (device: InputDevice) => void;

export class InputState
{
    /** Sources holding each button. */
    private readonly holders = new Map<Button, Set<string>>();
    /** Buttons pressed / released since the last `tick()`. */
    private pressedSince = new Set<Button>();
    private releasedSince = new Set<Button>();
    /** What `justPressed()` / `justReleased()` report this frame. */
    private pressedFrame = new Set<Button>();
    private releasedFrame = new Set<Button>();
    private readonly listeners = new Set<ButtonListener>();
    private readonly deviceListeners = new Set<DeviceListener>();
    private device: InputDevice | null = null;

    constructor ()
    {
        for (const button of BUTTONS) this.holders.set(button, new Set());
    }

    /**
     * @brief A source starts holding a button.
     * @param button The button.
     * @param source What holds it (`key:KeyZ`, `pad:0`...). Pressing twice with one source does nothing.
     * @param device The kind of device, for `lastDevice` and listeners.
     */
    press (button: Button, source: string, device: InputDevice): void
    {
        this.setDevice(device);
        const holders = this.holders.get(button)!;
        if (holders.has(source)) return;
        holders.add(source);
        if (holders.size > 1) return;
        this.pressedSince.add(button);
        this.emit({ button, type: 'press', device });
    }

    /**
     * @brief A source stops holding a button.
     * @param button The button.
     * @param source The same source given to `press()`.
     * @param device The kind of device.
     */
    release (button: Button, source: string, device: InputDevice): void
    {
        const holders = this.holders.get(button)!;
        if (!holders.delete(source) || holders.size > 0) return;
        this.releasedSince.add(button);
        this.emit({ button, type: 'release', device });
    }

    /**
     * @brief Release everything held by sources whose name starts with `prefix`.
     *
     * Used when the window loses focus (keys released elsewhere never reach
     * the page) or a gamepad is unplugged.
     *
     * @param prefix Source prefix, such as `key:`. Empty releases everything.
     * @param device Device reported to listeners.
     */
    releaseSources (prefix: string, device: InputDevice): void
    {
        for (const [button, holders] of this.holders)
        {
            for (const source of [...holders])
            {
                if (source.startsWith(prefix)) this.release(button, source, device);
            }
        }
    }

    /**
     * @brief Start a new frame. Call once per frame, before game code reads the buttons.
     */
    tick (): void
    {
        this.pressedFrame = this.pressedSince;
        this.releasedFrame = this.releasedSince;
        this.pressedSince = new Set();
        this.releasedSince = new Set();
    }

    /**
     * @brief Whether a button is held right now.
     * @param button The button.
     * @return `true` while any source holds it.
     */
    isDown (button: Button): boolean
    {
        return this.holders.get(button)!.size > 0;
    }

    /**
     * @brief Whether a button went down during the last frame.
     * @param button The button.
     * @return `true` on the one frame after it was pressed, unless it was consumed.
     */
    justPressed (button: Button): boolean
    {
        return this.pressedFrame.has(button);
    }

    /**
     * @brief Whether a button came up during the last frame.
     * @param button The button.
     * @return `true` on the one frame after it was released.
     */
    justReleased (button: Button): boolean
    {
        return this.releasedFrame.has(button);
    }

    /**
     * @brief Mark a press as handled, so `justPressed()` does not report it again.
     *
     * Call this when UI reacts to a press from a listener, so the scene
     * underneath does not act on the same press on its next frame.
     *
     * @param button The button.
     */
    consume (button: Button): void
    {
        this.pressedSince.delete(button);
        this.pressedFrame.delete(button);
    }

    /** @brief The kind of device used last, or `null` before any input. */
    get lastDevice (): InputDevice | null
    {
        return this.device;
    }

    /**
     * @brief Be told about every press and release as it happens (not once per frame).
     * @param listener Receives a `ButtonEvent`.
     * @return A function that removes the listener.
     */
    on (listener: ButtonListener): () => void
    {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * @brief Be told when the player switches device (for button prompts or the on-screen pad).
     * @param listener Receives the new device.
     * @return A function that removes the listener.
     */
    onDeviceChange (listener: DeviceListener): () => void
    {
        this.deviceListeners.add(listener);
        return () => this.deviceListeners.delete(listener);
    }

    /** @brief Remember the device used last and tell listeners if it changed. */
    private setDevice (device: InputDevice): void
    {
        if (device === this.device) return;
        this.device = device;
        for (const listener of [...this.deviceListeners]) listener(device);
    }

    /** @brief Send an event to every listener; one failing listener does not stop the others. */
    private emit (event: ButtonEvent): void
    {
        for (const listener of [...this.listeners])
        {
            try
            {
                listener(event);
            }
            catch (error)
            {
                console.error('[input] listener failed:', error);
            }
        }
    }
}
