/**
 * @file Window.tsx
 * @brief A window drawn from a windowskin, at any size, without stretching a pixel.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties, PointerEventHandler, ReactNode } from 'react';
import { useImage } from '../assets/loader';
import { getSkin, planWindow } from '../skins/skins';

/** @brief Props of `<Window>`. */
export interface WindowProps
{
    /** Skin id (see src/ui/skins/skins.ts). */
    skin: string;
    /** Left, in game pixels, inside the parent. */
    x: number;
    /** Top, in game pixels, inside the parent. */
    y: number;
    /** Width in game pixels. Rounded, and never smaller than the skin's corners. */
    width: number;
    /** Height in game pixels. Rounded, and never smaller than the skin's corners. */
    height: number;
    /** Content, placed inside the skin's padding (child coordinates start there). */
    children?: ReactNode;
    /** Receive taps and clicks (adds `ui-interactive`). */
    interactive?: boolean;
    /** Pointer handler for the whole window. */
    onPointerDown?: PointerEventHandler<HTMLDivElement>;
    /** Extra class names. */
    className?: string;
    /** Extra styles for the outer element. */
    style?: CSSProperties;
}

/**
 * @brief Draws a skinned window.
 *
 * The frame is drawn into a canvas at 1× from the skin's nine-slice (see
 * src/ui/skins/nineSlice.ts): corners copied once, edges and centre tiled,
 * nothing scaled. The canvas is then scaled by the UI layer by a whole number
 * of screen pixels, so every pixel of the skin stays square.
 *
 * @code
 * <Window skin="choice_1" x={160} y={96} width={88} height={46} interactive>
 *     <PixelText text="YES" skin="choice_1" />
 * </Window>
 * @endcode
 *
 * @param props See `WindowProps`.
 * @return The window.
 */
export function Window ({ skin: skinId, x, y, width, height, children, interactive, onPointerDown, className, style }: WindowProps)
{
    const skin = getSkin(skinId);
    const image = useImage(skin.url);
    const canvas = useRef<HTMLCanvasElement>(null);

    const plan = useMemo(
        () => (image ? planWindow(skin, image.naturalWidth, image.naturalHeight, width, height) : null),
        [image, skin, width, height],
    );
    const w = plan?.width ?? Math.round(width);
    const h = plan?.height ?? Math.round(height);

    useLayoutEffect(() =>
    {
        const target = canvas.current;
        if (!target || !image || !plan) return;
        const context = target.getContext('2d')!;
        context.imageSmoothingEnabled = false;
        context.clearRect(0, 0, target.width, target.height);
        for (const op of plan.ops) context.drawImage(image, op.sx, op.sy, op.w, op.h, op.dx, op.dy, op.w, op.h);
    }, [image, plan]);

    const classes = ['ui-window', interactive ? 'ui-interactive' : '', className ?? ''].filter(Boolean).join(' ');
    return (
        <div className={classes} style={{ left: Math.round(x), top: Math.round(y), width: w, height: h, ...style }} onPointerDown={onPointerDown}>
            <canvas ref={canvas} className="ui-window-frame" width={w} height={h} style={{ width: w, height: h }} />
            <div
                className="ui-window-content"
                style={{ left: skin.padding.left, top: skin.padding.top, right: skin.padding.right, bottom: skin.padding.bottom }}
            >
                {children}
            </div>
        </div>
    );
}
