/**
 * @file LocalizedGraphic.tsx
 * @brief A UI graphic in the game's language: the translated file chosen at
 *        build time, with translated text drawn over it where an overlay says so.
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { BASE_LOCALE, overlayApplies } from '../../i18n';
import { graphicFor, TEXT_OVERLAYS } from '../../world/text';
import { assetUrl } from '../assets/paths';
import { useImage } from '../assets/loader';
import { renderOverlay } from '../i18n/overlay';
import { useLocalizer } from '../i18n/useLocalizer';
import { useFontReady } from '../text/usePixelText';

/** @brief Props of `<LocalizedGraphic>`. */
export interface LocalizedGraphicProps
{
    /** Path under `assets/img/` without `.png`, e.g. `ui/trainer_card/card`. */
    graphic: string;
    /** Left, in game pixels. */
    x: number;
    /** Top, in game pixels. */
    y: number;
    /** Show one cell of a sprite sheet: its column, row and size. Default: the whole graphic. */
    cell?: { col: number; row: number; width: number; height: number };
    /** Locale; default: the game's. */
    locale?: string;
    className?: string;
    style?: CSSProperties;
}

/**
 * @brief Draws a graphic in the game's language.
 *
 * The file comes from the build-time map (`img/locales/<locale>/...` when a
 * translation exists along the locale's fallback chain); if
 * `content/locales/overlays` has an overlay for the graphic, its painted-in
 * words are covered and the translated text is written in their place.
 *
 * @code
 * <LocalizedGraphic graphic="ui/battle/cursor_command" x={126} y={140} cell={{ col: 1, row: 0, width: 65, height: 23 }} />
 * @endcode
 *
 * @param props See `LocalizedGraphicProps`.
 * @return The graphic, or nothing until it is loaded.
 */
export function LocalizedGraphic ({ graphic, x, y, cell, locale, className, style }: LocalizedGraphicProps)
{
    const text = useLocalizer();
    const shownLocale = locale ?? text?.locale ?? BASE_LOCALE;
    const image = useImage(assetUrl(`assets/img/${graphicFor(graphic, shownLocale)}.png`));
    const overlay = TEXT_OVERLAYS.get(graphic);
    const fontsReady = useFontReady();
    const canvas = useRef<HTMLCanvasElement>(null);
    const draws = !!overlay && overlayApplies(overlay, shownLocale);

    useEffect(() =>
    {
        if (!image || !canvas.current) return;
        if (draws && fontsReady && text) renderOverlay(image, overlay!, (key) => text.format(key), canvas.current);
        else
        {
            const target = canvas.current;
            target.width = image.width;
            target.height = image.height;
            const context = target.getContext('2d')!;
            context.clearRect(0, 0, target.width, target.height);
            context.drawImage(image, 0, 0);
        }
    }, [image, overlay, draws, fontsReady, text, text?.locale]);

    if (!image) return null;
    const width = cell?.width ?? image.width;
    const height = cell?.height ?? image.height;
    return (
        <div className={className} style={{ position: 'absolute', left: x, top: y, width, height, overflow: 'hidden', ...style }}>
            <canvas
                ref={canvas}
                style={{
                    position: 'absolute', imageRendering: 'pixelated',
                    left: -(cell ? cell.col * cell.width : 0), top: -(cell ? cell.row * cell.height : 0),
                    width: image.width, height: image.height,
                }}
            />
        </div>
    );
}
