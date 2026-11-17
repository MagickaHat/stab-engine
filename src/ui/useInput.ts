/**
 * @file useInput.ts
 * @brief React hooks for the input system (src/input, docs/INPUT_SYSTEM.md).
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { input } from '../input';
import type { Button, ButtonEvent, InputDevice } from '../input';

/**
 * @brief What a `useInputPress` handler returns: `true` if it used the press.
 *
 * A used press is consumed (see `InputManager.consume()`), so the scene under
 * the UI does not act on it too.
 */
export type InputPressHandler = (button: Button, event: ButtonEvent) => boolean | void;

/**
 * @brief Calls `handler` each time a game button is pressed, from any device.
 *
 * The handler always sees the latest props and state; it does not need to be
 * wrapped in `useCallback`. Return `true` when the press was used.
 *
 * @code
 * useInputPress((button) =>
 * {
 *     if (button === 'a') { confirm(); return true; }
 *     if (button === 'b') { close(); return true; }
 *     return false;
 * }, isOpen);
 * @endcode
 *
 * @param handler Receives the button and the full event.
 * @param active Listen only while this is `true` (default `true`).
 */
export function useInputPress (handler: InputPressHandler, active = true): void
{
    const latest = useRef(handler);
    useLayoutEffect(() =>
    {
        latest.current = handler;
    });

    useEffect(() =>
    {
        if (!active) return undefined;
        return input.on((event) =>
        {
            if (event.type !== 'press') return;
            if (latest.current(event.button, event) === true) input.consume(event.button);
        });
    }, [active]);
}

/** @brief `subscribe` for `useSyncExternalStore`. */
const subscribeDevice = (onChange: () => void) => input.onDeviceChange(onChange);

/** @brief `getSnapshot` for `useSyncExternalStore`. */
const getDevice = () => input.lastDevice;

/**
 * @brief The kind of device the player used last, for button prompts.
 * @return `keyboard`, `gamepad`, `mouse`, `touch`, or `null` before any input.
 */
export function useLastDevice (): InputDevice | null
{
    return useSyncExternalStore(subscribeDevice, getDevice, getDevice);
}
