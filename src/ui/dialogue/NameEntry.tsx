/**
 * @file NameEntry.tsx
 * @brief A simple name entry: the prompt in the message box and the name in a window above it.
 */
import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import { PixelText } from '../components/PixelText';
import { Window } from '../components/Window';
import { DEFAULT_SKINS, getSkin } from '../skins/skins';
import { playUiSound } from '../sounds';
import { useGameSize } from '../store/uiStore';
import { textWidth } from '../text/layout';
import { usePixelFont } from '../text/usePixelText';
import { useTicker } from './textSpeed';
import { messageBox } from './layout';
import { MessageBox } from './MessageBox';

/** @brief Props of `<NameEntry>`. */
export interface NameEntryProps
{
    /** Question shown in the message box, or `null`. */
    prompt: string | null;
    /** Name shown at first. */
    initial: string;
    /** Most characters. */
    max: number;
    /** Called with the name when the player confirms (Enter). Empty means "keep `initial`". */
    onSubmit: (name: string) => void;
}

/** @brief Stops a clipboard event, so the name cannot be copied out of the field. */
const block = (event: ClipboardEvent) => event.preventDefault();

/**
 * @brief Lets the player type a name with the keyboard (or the on-screen keyboard on phones).
 *
 * The typed text is drawn with `<PixelText>`; the real `<input>` that
 * receives the keys is invisible, so nothing can be selected or copied.
 * Enter confirms. Tapping the window brings the phone keyboard back.
 * A full FRLG-style letter grid can replace this later; only `onSubmit` matters.
 *
 * @param props See `NameEntryProps`.
 * @return The name entry UI.
 */
export function NameEntry ({ prompt, initial, max, onSubmit }: NameEntryProps)
{
    const { width: gameWidth, height: gameHeight } = useGameSize();
    const { font, advance, ready } = usePixelFont();
    const [name, setName] = useState(initial);
    const input = useRef<HTMLInputElement>(null);
    const caret = useTicker(400) % 2 === 0;
    useEffect(() => input.current?.focus(), []);

    const skin = DEFAULT_SKINS.choice;
    const frame = getSkin(skin);
    const box = messageBox(gameWidth, gameHeight);
    const fieldWidth = ready ? Math.max(advance('W') * max, textWidth(name, advance)) + 2 : 0;
    //  The choice skin leaves room on the left for a cursor; the name entry has none, so use that space.
    const shift = -7;
    const width = fieldWidth + frame.padding.left + frame.padding.right + shift;
    const height = font.lineHeight + frame.padding.top + frame.padding.bottom;
    const x = Math.round((gameWidth - width) / 2);
    const y = box.y - height - 8;

    const submit = () =>
    {
        playUiSound('select');
        onSubmit(name.trim());
    };

    return (
        <>
            {prompt && <MessageBox text={prompt} waitForInput={false} />}
            <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
                <Window skin={skin} x={x} y={y} width={width} height={height} interactive onPointerDown={() => input.current?.focus()}>
                    <PixelText text={name} skin={skin} x={shift} />
                    {ready && caret && name.length < max && (
                        <div className="name-entry-caret" style={{ left: shift + textWidth(name, advance), top: font.baseline + 1, width: advance('W') - 1 }} />
                    )}
                </Window>
                <input
                    ref={input}
                    className="name-entry-input ui-interactive"
                    value={name}
                    maxLength={max}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label={prompt ?? 'Name'}
                    onChange={(event) => setName(event.target.value.slice(0, max))}
                    onCopy={block}
                    onCut={block}
                    onBlur={() => setTimeout(() => input.current?.focus(), 0)}
                />
            </form>
        </>
    );
}
