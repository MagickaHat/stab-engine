/**
 * @file VirtualPad.tsx
 * @brief On-screen controls for touch screens: D-pad, A/B/X/Y, L/R, Start and Select.
 *
 * Every control presses the same game buttons as the keyboard and gamepads
 * (through `input.setVirtual()`), so nothing else in the game needs to know
 * the player is on a touch screen. Several fingers can hold controls at once,
 * and a finger can slide around the D-pad to change direction.
 *
 * The engine ships no art for it: the controls are plain elements with class
 * names (`.virtual-pad`, `.virtual-pad-dpad`, `.virtual-pad-button`,
 * `.virtual-pad-a`, `.virtual-pad-start`...) and only minimal layout in ui.css.
 * Style or replace them in your game's stylesheet. Held controls get the
 * `pressed` class.
 *
 * Render it inside `<UiLayer>`, after other UI so it is drawn on top.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { input } from '../input';
import type { Button, DpadButton } from '../input';
import { useLastDevice } from './useInput';

/** @brief When the pad is shown. */
export type VirtualPadVisibility = 'auto' | 'always' | 'never';

/** @brief Props of `<VirtualPad>`. */
export interface VirtualPadProps
{
    /**
     * `auto` (default): on touch screens, and whenever the player last used
     * touch; hidden once they use a keyboard or gamepad. `always` / `never`
     * force it.
     */
    visible?: VirtualPadVisibility;
}

/** @brief Fraction of the D-pad's size around its centre that presses nothing. */
const DPAD_DEAD_CENTRE = 0.15;

/** @brief Whether the main pointer is a finger (a phone or tablet). */
function hasCoarsePointer (): boolean
{
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/**
 * @brief Follows whether the device's main pointer is a finger.
 * @return `true` on touch screens.
 */
function useCoarsePointer (): boolean
{
    const [coarse, setCoarse] = useState(hasCoarsePointer);
    useEffect(() =>
    {
        if (typeof matchMedia !== 'function') return undefined;
        const query = matchMedia('(pointer: coarse)');
        const onChange = () => setCoarse(query.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);
    return coarse;
}

/** @brief Props of one on-screen button. */
interface PadButtonProps
{
    button: Button;
    label: string;
}

/**
 * @brief One on-screen button, held while a finger is on it.
 * @param props The game button and its label.
 * @return The button element.
 */
function PadButton ({ button, label }: PadButtonProps)
{
    const fingers = useRef(new Set<number>());
    const [pressed, setPressed] = useState(false);

    //  Let go if the pad disappears while held.
    useEffect(() => () =>
    {
        for (const id of fingers.current) input.setVirtual(button, false, `button:${id}`);
        fingers.current.clear();
    }, [button]);

    const down = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        fingers.current.add(event.pointerId);
        input.setVirtual(button, true, `button:${event.pointerId}`);
        setPressed(true);
    };
    const up = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        if (!fingers.current.delete(event.pointerId)) return;
        input.setVirtual(button, false, `button:${event.pointerId}`);
        setPressed(fingers.current.size > 0);
    };

    return (
        <div
            className={`virtual-pad-button virtual-pad-${button} ui-interactive${pressed ? ' pressed' : ''}`}
            role="button"
            aria-label={label}
            onPointerDown={down}
            onPointerUp={up}
            onPointerCancel={up}
            onLostPointerCapture={up}
        >
            {label}
        </div>
    );
}

/**
 * @brief The D-pad: the direction is taken from where the finger is, so it can slide.
 * @return The D-pad element.
 */
function Dpad ()
{
    const held = useRef(new Map<number, DpadButton | null>());
    const [pressed, setPressed] = useState<DpadButton | null>(null);

    useEffect(() => () =>
    {
        for (const [id, dir] of held.current) if (dir) input.setVirtual(dir, false, `dpad:${id}`);
        held.current.clear();
    }, []);

    /** @brief Show the direction of the most recent finger. */
    const refresh = () =>
    {
        const dirs = [...held.current.values()];
        setPressed(dirs[dirs.length - 1] ?? null);
    };

    const track = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        const rect = event.currentTarget.getBoundingClientRect();
        const dx = (event.clientX - rect.left) / rect.width - 0.5;
        const dy = (event.clientY - rect.top) / rect.height - 0.5;
        const dir: DpadButton | null = Math.hypot(dx, dy) < DPAD_DEAD_CENTRE ? null
            : Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right')
                : (dy < 0 ? 'up' : 'down');
        const previous = held.current.get(event.pointerId) ?? null;
        if (dir === previous) return;
        if (previous) input.setVirtual(previous, false, `dpad:${event.pointerId}`);
        if (dir) input.setVirtual(dir, true, `dpad:${event.pointerId}`);
        held.current.set(event.pointerId, dir);
        refresh();
    };
    const down = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        held.current.set(event.pointerId, null);
        track(event);
    };
    const move = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        if (held.current.has(event.pointerId)) track(event);
    };
    const up = (event: ReactPointerEvent<HTMLDivElement>) =>
    {
        if (!held.current.has(event.pointerId)) return;
        const dir = held.current.get(event.pointerId);
        if (dir) input.setVirtual(dir, false, `dpad:${event.pointerId}`);
        held.current.delete(event.pointerId);
        refresh();
    };

    return (
        <div
            className={`virtual-pad-dpad ui-interactive${pressed ? ` pressed-${pressed}` : ''}`}
            role="group"
            aria-label="D-pad"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onLostPointerCapture={up}
        >
            <div className="virtual-pad-dpad-up" />
            <div className="virtual-pad-dpad-down" />
            <div className="virtual-pad-dpad-left" />
            <div className="virtual-pad-dpad-right" />
        </div>
    );
}

/**
 * @brief Draws the on-screen controls when they are wanted.
 * @param props See `VirtualPadProps`.
 * @return The pad, or nothing when hidden.
 */
export function VirtualPad ({ visible = 'auto' }: VirtualPadProps)
{
    const device = useLastDevice();
    const coarse = useCoarsePointer();
    const shown = visible === 'always' ? true
        : visible === 'never' ? false
            : device === 'touch' ? true
                : device === 'keyboard' || device === 'gamepad' ? false
                    : coarse;
    if (!shown) return null;

    return (
        <div className="virtual-pad">
            <Dpad />
            <div className="virtual-pad-face">
                <PadButton button="x" label="X" />
                <PadButton button="y" label="Y" />
                <PadButton button="a" label="A" />
                <PadButton button="b" label="B" />
            </div>
            <PadButton button="l" label="L" />
            <PadButton button="r" label="R" />
            <div className="virtual-pad-menu">
                <PadButton button="select" label="Select" />
                <PadButton button="start" label="Start" />
            </div>
        </div>
    );
}
