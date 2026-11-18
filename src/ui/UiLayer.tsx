/**
 * @file UiLayer.tsx
 * @brief Container that places React UI exactly on top of the game canvas.
 */
import type { CSSProperties, ReactNode } from 'react';
import { pixelTransform } from '../game/pixelScale';
import { useUiStore } from './store/uiStore';
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
 * left edge of the game at any screen size.
 *
 * The placement comes from `GameEvents.VIEWPORT_CHANGED` through the UI store;
 * the layer never reads the Phaser canvas. The scale is always a whole number
 * of device pixels per game pixel (see src/game/pixelScale.ts) and the layer
 * starts on a whole device pixel, so 1× canvases and images inside it stay
 * pixel perfect.
 *
 * The layer ignores pointer input so touches reach the game underneath. Add
 * the `ui-interactive` class to elements that should receive input.
 *
 * These CSS variables are set on the layer for use in stylesheets:
 * - `--game-width`, `--game-height`: game resolution, as plain numbers;
 * - `--ui-scale`: CSS pixels per game pixel;
 * - `--device-scale`: screen pixels per game pixel (a whole number).
 *
 * @param props See `UiLayerProps`.
 * @return The layer, or `null` until the game canvas has been placed.
 */
export function UiLayer ({ children }: UiLayerProps)
{
    const viewport = useUiStore((ui) => ui.viewport);
    if (!viewport) return null;

    const style = {
        //  Placed with a transform, not left/top: see pixelTransform() in src/game/pixelScale.ts.
        left: 0,
        top: 0,
        width: viewport.gameWidth,
        height: viewport.gameHeight,
        transform: pixelTransform(viewport.left, viewport.top, viewport.scale),
        '--game-width': viewport.gameWidth,
        '--game-height': viewport.gameHeight,
        '--ui-scale': viewport.scale,
        '--device-scale': viewport.deviceScale,
    } as CSSProperties;

    return (
        <div className="ui-layer" style={style}>
            {children}
        </div>
    );
}
