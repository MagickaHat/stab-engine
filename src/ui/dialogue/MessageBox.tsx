/**
 * @file MessageBox.tsx
 * @brief The FRLG-style message box: typed-out text, two lines per page, a pause arrow.
 */
import { useCallback, useEffect, useState } from 'react';
import { uiImageUrl } from '../assets/paths';
import { PixelText } from '../components/PixelText';
import { UiSprite } from '../components/UiSprite';
import { Window } from '../components/Window';
import { useInputPress } from '../useInput';
import { DEFAULT_SKINS, getSkin } from '../skins/skins';
import { playUiSound } from '../sounds';
import { useGameSize, useUiStore } from '../store/uiStore';
import { pageLength } from '../text/layout';
import { usePixelFont, useTextPages } from '../text/usePixelText';
import { messageBox, MESSAGE_LINES } from './layout';
import { NameBox } from './NameBox';
import { useTicker, useTypewriter } from './textSpeed';

/** @brief The pause arrow sheet: four 10×14 frames of a bouncing down arrow. */
export const PAUSE_ARROW = { name: 'pause_arrow', width: 10, height: 14, frames: 4, frameMs: 120 } as const;

/** @brief Props of `<MessageBox>`. */
export interface MessageBoxProps
{
    /** The text. Wrapped to the box and split into pages of two lines. `\n` forces a new line. */
    text: string;
    /** Speaker's name, shown in a small box above the left of the message box. */
    speaker?: string;
    /**
     * `true` (default): wait for A after the last page, then call `onDone`.
     * `false`: the last page stays up without a pause arrow and `onTyped` is
     * called once it is fully typed (for a question with a choice window).
     */
    waitForInput?: boolean;
    /** Called once the player closes the message (with `waitForInput`). */
    onDone?: () => void;
    /** Called once the last page is fully typed (without `waitForInput`). */
    onTyped?: () => void;
    /** Skin id; the default message skin if left out. */
    skin?: string;
    /** Font id; the default font if left out. */
    font?: string;
}

/**
 * @brief Shows a message the way FireRed / LeafGreen do.
 *
 * - The text is word-wrapped with the real font and split into pages of two lines.
 * - Each page is typed out at the player's text speed (`useUiStore(ui => ui.textSpeed)`).
 * - A or B while typing shows the whole page at once.
 * - When the page is complete the pause arrow bounces at the end of the
 *   text; A or B (or a tap on the box) plays the `select` blip and goes to
 *   the next page, or closes the message after the last one.
 *
 * Every button press is taken while the box waits for input, so the scene
 * underneath does not see it.
 *
 * @param props See `MessageBoxProps`.
 * @return The message box (and name box).
 */
export function MessageBox ({ text, speaker, waitForInput = true, onDone, onTyped, skin = DEFAULT_SKINS.message, font: fontId }: MessageBoxProps)
{
    const { width: gameWidth, height: gameHeight } = useGameSize();
    const speed = useUiStore((ui) => ui.textSpeed);
    const { ready } = usePixelFont(fontId);
    const frame = getSkin(skin);
    const box = messageBox(gameWidth, gameHeight);
    //  Lines stop short of the pause arrow's column, so text never runs under it.
    const innerWidth = box.width - frame.padding.left - frame.padding.right - PAUSE_ARROW.width - 2;
    const pages = useTextPages(text, innerWidth, MESSAGE_LINES, fontId);

    const [page, setPage] = useState(0);
    useEffect(() => setPage(0), [text]);
    const lines = pages[Math.min(page, pages.length - 1)] ?? [];
    const lastPage = page >= pages.length - 1;
    const typer = useTypewriter(pageLength(lines), speed, `${text}\u0000${page}`);

    const holding = !waitForInput && lastPage;
    const showArrow = ready && typer.finished && !holding;
    const tick = useTicker(PAUSE_ARROW.frameMs, showArrow);

    useEffect(() =>
    {
        if (holding && typer.finished && pages.length > 0) onTyped?.();
    }, [holding, typer.finished, pages.length, onTyped]);

    const advancePage = useCallback(() =>
    {
        if (!ready || pages.length === 0) return;
        if (!typer.finished)
        {
            typer.skip();
            return;
        }
        if (holding) return;
        playUiSound('select');
        if (lastPage) onDone?.();
        else setPage((value) => value + 1);
    }, [ready, pages.length, typer, holding, lastPage, onDone]);

    //  While typing or waiting, every press belongs to the message box. A question's last page
    //  lets presses through once typed, so the choice window gets them.
    const takesInput = !(holding && typer.finished);
    useInputPress((button) =>
    {
        if (button === 'a' || button === 'b') advancePage();
        return true;
    }, takesInput);

    //  Pause arrow: always in the bottom-right corner of the box, inside the skin's padding.
    const arrowX = box.width - frame.padding.right - PAUSE_ARROW.width;
    const arrowY = box.height - frame.padding.bottom - PAUSE_ARROW.height - 1;

    return (
        <>
            {speaker && <NameBox name={speaker} message={box} skin={skin} font={fontId} />}
            <Window
                skin={skin} x={box.x} y={box.y} width={box.width} height={box.height}
                interactive={takesInput}
                onPointerDown={(event) => { if (event.button === 0) advancePage(); }}
                className="message-box"
            >
                <PixelText lines={lines} skin={skin} font={fontId} maxChars={typer.shown} />
            </Window>
            {showArrow && (
                <UiSprite
                    src={uiImageUrl(PAUSE_ARROW.name)}
                    x={box.x + arrowX} y={box.y + arrowY}
                    width={PAUSE_ARROW.width} height={PAUSE_ARROW.height}
                    frame={tick % PAUSE_ARROW.frames}
                />
            )}
        </>
    );
}
