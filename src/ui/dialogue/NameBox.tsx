/**
 * @file NameBox.tsx
 * @brief The speaker's name, in a small window just above the left of the message box.
 */
import { PixelText } from '../components/PixelText';
import { Window } from '../components/Window';
import { useImage } from '../assets/loader';
import { fitWindowSize } from '../skins/nineSlice';
import { getSkin, skinSlice } from '../skins/skins';
import { textWidth } from '../text/layout';
import { usePixelFont } from '../text/usePixelText';
import { nameBox } from './layout';
import type { Box } from './layout';

/** @brief Props of `<NameBox>`. */
export interface NameBoxProps
{
    /** The speaker's name, already translated. */
    name: string;
    /** The message box it belongs to (see `messageBox()`). */
    message: Box;
    /** Skin id; usually the message box's. */
    skin: string;
    /** Font id. */
    font?: string;
}

/**
 * @brief Shows who is speaking.
 *
 * The window is as wide as the name (plus the skin's padding) and sits
 * slightly above the left-hand side of the message box (see `nameBox()` in
 * src/ui/dialogue/layout.ts to move it).
 *
 * @param props See `NameBoxProps`.
 * @return The name box, or nothing until the font is ready.
 */
export function NameBox ({ name, message, skin, font: fontId }: NameBoxProps)
{
    const { font, advance, ready } = usePixelFont(fontId);
    const frame = getSkin(skin);
    const image = useImage(frame.url);
    if (!ready || !image) return null;
    //  A window is never smaller than its corners, so work out its real size before placing it.
    const size = fitWindowSize(
        skinSlice(frame, image.naturalWidth, image.naturalHeight),
        textWidth(name, advance) + 1 + frame.padding.left + frame.padding.right,
        font.lineHeight + frame.padding.top + frame.padding.bottom,
    );
    const box = nameBox(message, size.width, size.height);
    return (
        <Window skin={skin} x={box.x} y={box.y} width={box.width} height={box.height} className="name-box">
            <PixelText text={name} skin={skin} font={fontId} />
        </Window>
    );
}
