/**
 * @file textSpeed.ts
 * @brief How fast message text is typed out, for each text speed setting.
 */
import { useEffect, useRef, useState } from 'react';
import type { TextSpeed } from '../../bus/EventBus';

/**
 * @brief Characters typed per second at each setting.
 *
 * FireRed / LeafGreen wait 8, 4 and 1 frames per letter; these are a little
 * quicker at the slow end, as modern players expect. Change freely.
 */
export const TEXT_SPEED_CPS: Record<TextSpeed, number> = {
    slow: 15,
    mid: 30,
    fast: 60,
    instant: Infinity,
};

/** @brief What `useTypewriter()` returns. */
export interface Typewriter
{
    /** Characters to show right now. */
    shown: number;
    /** Whether every character is shown. */
    finished: boolean;
    /** Show every character at once. */
    skip: () => void;
}

/**
 * @brief Types `length` characters out over time.
 * @param length Characters on the page.
 * @param speed Text speed setting.
 * @param resetKey Starts over from 0 whenever this changes (e.g. the page number).
 * @return The typewriter state.
 */
export function useTypewriter (length: number, speed: TextSpeed, resetKey: unknown): Typewriter
{
    const cps = TEXT_SPEED_CPS[speed];
    const instant = !Number.isFinite(cps) || length === 0;
    //  The count is stored with the page it belongs to, so a new page never shows the old
    //  page's count for a frame before the effect below resets it.
    const [state, setState] = useState<{ key: unknown; shown: number }>({ key: resetKey, shown: instant ? length : 0 });
    const skipped = useRef(false);
    const shown = instant ? length : (Object.is(state.key, resetKey) ? Math.min(state.shown, length) : 0);

    useEffect(() =>
    {
        skipped.current = false;
        if (instant) return undefined;
        setState({ key: resetKey, shown: 0 });
        const start = performance.now();
        let frame = 0;
        const step = (now: number) =>
        {
            if (skipped.current) return;
            const count = Math.min(length, Math.floor(((now - start) / 1000) * cps));
            setState({ key: resetKey, shown: count });
            if (count < length) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [length, cps, instant, resetKey]);

    return {
        shown,
        finished: shown >= length,
        skip: () =>
        {
            skipped.current = true;
            setState({ key: resetKey, shown: length });
        },
    };
}

/**
 * @brief A counter that goes up every `ms` milliseconds, for small looping animations.
 * @param ms Time per tick.
 * @param active Count only while this is `true`.
 * @return The tick count.
 */
export function useTicker (ms: number, active = true): number
{
    const [tick, setTick] = useState(0);
    useEffect(() =>
    {
        if (!active) return undefined;
        setTick(0);
        const id = setInterval(() => setTick((value) => value + 1), ms);
        return () => clearInterval(id);
    }, [ms, active]);
    return tick;
}
