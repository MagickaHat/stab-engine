/**
 * @file overlay.ts
 * @brief Draws translated text over a graphic (src/i18n/overlays.ts), for React and Phaser alike.
 *
 * The graphic is drawn into a canvas, the painted-in English words are
 * covered (`erase`), and each text slot is written with the pixel font, so
 * the result stays pixel-perfect. React shows the canvas
 * (`<LocalizedGraphic>`); Phaser registers it as a texture under the
 * graphic's own key (src/game/localizedTextures.ts).
 */
import type { TextOverlay } from '../../i18n';
import { placeOverlay } from '../../i18n';
import { getFont } from '../text/fonts';
import { textWidth } from '../text/layout';
import { drawPixelText, fontAdvance } from '../text/render';

/**
 * @brief Draw a graphic with its overlay.
 * @param image The original graphic (loaded).
 * @param overlay The overlay.
 * @param text Translates a text key.
 * @param target Canvas to draw into. Default: a new one. Its size becomes the image's.
 * @return The canvas. The fonts the overlay uses must be loaded first.
 */
export function renderOverlay (
    image: HTMLImageElement | HTMLCanvasElement, overlay: TextOverlay, text: (key: string) => string, target?: HTMLCanvasElement,
): HTMLCanvasElement
{
    const canvas = target ?? document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const original = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colourAt = (x: number, y: number) =>
    {
        const i = (Math.min(canvas.height - 1, Math.max(0, y)) * canvas.width + Math.min(canvas.width - 1, Math.max(0, x))) * 4;
        return `rgba(${original[i]}, ${original[i + 1]}, ${original[i + 2]}, ${original[i + 3] / 255})`;
    };

    const placed = placeOverlay(overlay);
    for (const box of placed.erase)
    {
        if (box.fill === 'row')
        {
            const sampleX = box.sampleX ?? box.x - 1;
            for (let y = box.y; y < box.y + box.height; y++)
            {
                context.fillStyle = colourAt(sampleX, y);
                context.fillRect(box.x, y, box.width, 1);
            }
        }
        else
        {
            context.fillStyle = box.fill;
            context.fillRect(box.x, box.y, box.width, box.height);
        }
    }

    const layer = document.createElement('canvas');
    for (const slot of placed.text)
    {
        const font = getFont(slot.font);
        const advance = fontAdvance(font);
        const line = text(slot.key);
        const width = textWidth(line, advance) + (slot.shadow ? 1 : 0);
        const height = font.lineHeight + (slot.shadow ? 1 : 0);
        const offset = slot.align === 'center' ? Math.floor((slot.width - width) / 2) : slot.align === 'right' ? slot.width - width : 0;
        drawPixelText(layer, [line], { font, color: slot.color, shadow: slot.shadow }, Infinity, Math.max(1, width), height);
        context.drawImage(layer, slot.x + offset, slot.y);
    }
    return canvas;
}
