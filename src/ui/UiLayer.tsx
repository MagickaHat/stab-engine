/**
 * @file UiLayer.tsx
 * @brief Container that places React UI exactly on top of the game canvas.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useGame } from '../PhaserGame';
import { useGameViewport } from './useGameViewport';
import './ui.css';

/** @brief Props of `<UiLayer>`. */
export interface UiLayerProps
{
    /** The UI to draw over the game. */
    children?: ReactNode;
}

/**
 * @brief Draws its children over the game canvas, in game coordinates.
 *
 * The layer is as large as the game resolution (256×192 CSS pixels today) and
 * is scaled with a CSS transform to cover the canvas. Children are therefore
 * positioned and sized in game pixels: `left: 8px` is 8 game pixels from the
 * left edge of the game at any screen size, and stays correct if the game
 * resolution changes (see `useGameViewport`).
 *
 * The layer ignores pointer input so touches reach the game underneath. Add
 * the `ui-interactive` class to elements that should receive input.
 *
 * These CSS variables are set on the layer for use in stylesheets:
 * - `--game-width`, `--game-height`: game resolution, as plain numbers;
 * - `--ui-scale`: CSS pixels per game pixel.
 *
 * Must be rendered inside `<PhaserGame>`.
 *
 * @param props See `UiLayerProps`.
 * @return The layer, or `null` until the game canvas is on screen.
 */
export function UiLayer ({ children }: UiLayerProps)
{
    const viewport = useGameViewport(useGame());
    if (!viewport) return null;

    const style = {
        left: viewport.left,
        top: viewport.top,
        width: viewport.gameWidth,
        height: viewport.gameHeight,
        transform: `scale(${viewport.scaleX}, ${viewport.scaleY})`,
        '--game-width': viewport.gameWidth,
        '--game-height': viewport.gameHeight,
        '--ui-scale': viewport.scaleX,
    } as CSSProperties;

    return (
        <div className="ui-layer" style={style}>
            {children}
        </div>
    );
}
