/**
 * @file TitleOverlay.tsx
 * @brief Draws the title screen's `text` layers (titleConfig.ts) with the pixel font.
 *
 * Phaser draws the other layers; text is drawn here so it uses the game's
 * font and is translated. It shows only on the title screen, and hides while
 * a menu is open.
 */
import { useEffect, useState } from 'react';
import { TITLE_SCENE_KEY } from '../../game/title/sceneKeys';
import { blinkVisible } from '../../game/title/timing';
import { TITLE_SCREEN } from '../../game/title/titleConfig';
import type { TextLayer } from '../../game/title/titleConfig';
import { PixelText } from '../components/PixelText';
import { useGameSize, useUiStore } from '../store/uiStore';
import { textWidth } from '../text/layout';
import { usePixelFont } from '../text/usePixelText';
import { useMenuText } from './useMenuText';

/** @brief Milliseconds between redraws of blinking text. */
const FRAME_MS = 50;

/**
 * @brief The title screen's text layers.
 * @return The text, or `null` away from the title screen.
 */
export function TitleOverlay ()
{
    const onTitle = useUiStore((ui) => ui.sceneKey === TITLE_SCENE_KEY);
    const busy = useUiStore((ui) => ui.modalCount > 0);
    if (!onTitle || busy) return null;
    return <TitleText />;
}

/**
 * @brief The text layers, blinking from when the title screen appeared.
 * @return The text.
 */
function TitleText ()
{
    const t = useMenuText();
    const { width } = useGameSize();
    const { advance, ready } = usePixelFont();
    const [start] = useState(() => performance.now());
    const [now, setNow] = useState(start);
    const layers = TITLE_SCREEN.layers.filter((layer): layer is TextLayer => layer.kind === 'text');
    const blinks = layers.some((layer) => layer.onMs !== undefined);
    useEffect(() =>
    {
        if (!blinks) return undefined;
        const id = setInterval(() => setNow(performance.now()), FRAME_MS);
        return () => clearInterval(id);
    }, [blinks]);
    if (!ready) return null;

    return (
        <>
            {layers.map((layer, index) =>
            {
                if (layer.onMs !== undefined && !blinkVisible(now - start, layer.onMs, layer.offMs ?? layer.onMs)) return null;
                const text = t(layer.key);
                const x = layer.align === 'center'
                    ? Math.round((layer.x ?? width / 2) - textWidth(text, advance) / 2)
                    : layer.x ?? 0;
                return (
                    <PixelText key={index} text={text} x={x} y={layer.y ?? 0}
                        color={layer.color} shadow={layer.shadow} />
                );
            })}
        </>
    );
}
