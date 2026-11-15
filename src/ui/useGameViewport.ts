/**
 * @file useGameViewport.ts
 * @brief React hook that tracks where the game canvas is on screen and how
 *        much it is scaled.
 */
import { useEffect, useState } from 'react';
import { Scale } from 'phaser';
import type { Game } from 'phaser';

/** @brief Size and on-screen placement of the game. */
export interface GameViewport
{
    /** Width of the game, in game pixels (e.g. 256). */
    gameWidth: number;
    /** Height of the game, in game pixels (e.g. 192). */
    gameHeight: number;
    /** Left edge of the canvas, in CSS pixels from the left of the window. */
    left: number;
    /** Top edge of the canvas, in CSS pixels from the top of the window. */
    top: number;
    /** CSS pixels per game pixel, horizontally. */
    scaleX: number;
    /** CSS pixels per game pixel, vertically. Equal to `scaleX` in `Scale.FIT`. */
    scaleY: number;
}

/**
 * @brief Reads the current viewport from the game's Scale Manager and canvas.
 * @param game The running game.
 * @return The viewport, or `null` if the canvas has no size yet.
 */
function measure (game: Game): GameViewport | null
{
    const gameWidth = game.scale.gameSize.width;
    const gameHeight = game.scale.gameSize.height;
    const rect = game.canvas.getBoundingClientRect();
    if (gameWidth <= 0 || gameHeight <= 0 || rect.width <= 0 || rect.height <= 0) return null;
    return {
        gameWidth,
        gameHeight,
        left: rect.left,
        top: rect.top,
        scaleX: rect.width / gameWidth,
        scaleY: rect.height / gameHeight,
    };
}

/**
 * @brief Compares two viewports.
 * @param a First viewport.
 * @param b Second viewport.
 * @return `true` if every field is equal (or both are `null`).
 */
function sameViewport (a: GameViewport | null, b: GameViewport | null): boolean
{
    if (a === null || b === null) return a === b;
    return a.gameWidth === b.gameWidth && a.gameHeight === b.gameHeight
        && a.left === b.left && a.top === b.top
        && a.scaleX === b.scaleX && a.scaleY === b.scaleY;
}

/**
 * @brief Tracks the game's resolution and where its canvas is on screen.
 *
 * Nothing here is tied to a fixed resolution. The values are measured again
 * whenever:
 * - the Scale Manager emits `resize`. This happens when the window or screen
 *   changes (phone rotation, Android split-screen, a desktop window being
 *   resized) and when the game resolution itself changes through
 *   `game.scale.setGameSize()` or `game.scale.resize()`;
 * - the canvas element changes size on the page;
 * - the window is resized or scrolled.
 *
 * So a future "resizable desktop window" or "resolution" option only has to
 * call the Scale Manager. Any UI built on this hook follows by itself.
 *
 * @param game The running game, or `null` while it is being created.
 * @return The current viewport, or `null` until the game canvas is laid out.
 */
export function useGameViewport (game: Game | null): GameViewport | null
{
    const [viewport, setViewport] = useState<GameViewport | null>(null);

    useEffect(() =>
    {
        if (!game) return;

        const update = () =>
        {
            const next = measure(game);
            setViewport((previous) => sameViewport(previous, next) ? previous : next);
        };

        update();
        game.scale.on(Scale.Events.RESIZE, update);
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        const observer = new ResizeObserver(update);
        observer.observe(game.canvas);

        return () =>
        {
            // The Scale Manager is already gone if the game was destroyed first.
            game.scale?.off(Scale.Events.RESIZE, update);
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
            observer.disconnect();
            setViewport(null);
        };
    }, [game]);

    return viewport;
}
