/**
 * @file UiSprite.tsx
 * @brief Shows one frame of a UI image (arrows, icons), pixel perfect.
 */
import type { CSSProperties } from 'react';

/** @brief Props of `<UiSprite>`. */
export interface UiSpriteProps
{
    /** Image URL (see `uiImageUrl()`). */
    src: string;
    /** Left, in game pixels, inside the parent. */
    x: number;
    /** Top, in game pixels, inside the parent. */
    y: number;
    /** Width of one frame. */
    width: number;
    /** Height of one frame. */
    height: number;
    /** Frame to show, counted left to right then top to bottom (default 0). */
    frame?: number;
    /** Frames per row of the sheet (default 1 row holding every frame). */
    columns?: number;
    /** Extra class names. */
    className?: string;
    /** Extra styles. */
    style?: CSSProperties;
}

/**
 * @brief Shows one frame of a sprite sheet at 1×.
 *
 * The image is a CSS background, never resized: the UI layer's whole-number
 * scale is the only scaling it gets, and `image-rendering: pixelated` keeps it sharp.
 *
 * @code
 * <UiSprite src={uiImageUrl('pause_arrow')} x={200} y={170} width={10} height={14} frame={tick % 4} />
 * @endcode
 *
 * @param props See `UiSpriteProps`.
 * @return The sprite.
 */
export function UiSprite ({ src, x, y, width, height, frame = 0, columns, className, style }: UiSpriteProps)
{
    const col = columns ? frame % columns : frame;
    const row = columns ? Math.floor(frame / columns) : 0;
    return (
        <div
            aria-hidden="true"
            className={className ? `ui-sprite ${className}` : 'ui-sprite'}
            style={{
                left: Math.round(x), top: Math.round(y), width, height,
                backgroundImage: `url("${src}")`,
                backgroundPosition: `${-col * width}px ${-row * height}px`,
                ...style,
            }}
        />
    );
}
