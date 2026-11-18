/**
 * @file ChoiceWindow.tsx
 * @brief A list of options with a cursor, in a skinned window.
 */
import { useEffect, useState } from 'react';
import { uiImageUrl } from '../assets/paths';
import { PixelText } from '../components/PixelText';
import { UiSprite } from '../components/UiSprite';
import { Window } from '../components/Window';
import { DEFAULT_SKINS, getSkin } from '../skins/skins';
import { playUiSound } from '../sounds';
import { useGameSize } from '../store/uiStore';
import { textWidth } from '../text/layout';
import { usePixelFont } from '../text/usePixelText';
import { useInputPress } from '../useInput';
import { choiceBox, messageBox } from './layout';

/** @brief The selection cursor image: one 6×14 frame. */
export const SELECT_ARROW = { name: 'sel_arrow', width: 6, height: 14 } as const;

/** @brief Props of `<ChoiceWindow>`. */
export interface ChoiceWindowProps
{
    /** The options, already translated. */
    options: string[];
    /** Called with the index of the option picked. */
    onPick: (index: number) => void;
    /** Option that B picks, or -1 (default) if the choice cannot be cancelled. */
    cancel?: number;
    /** Option the cursor starts on (default 0). */
    initial?: number;
    /** Left edge; by default the window is right-aligned above the message box. */
    x?: number;
    /** Top edge; by default the window sits on the message box. */
    y?: number;
    /** Skin id; the default choice skin if left out. */
    skin?: string;
    /** Font id. */
    font?: string;
    /** Take button presses (default `true`). */
    active?: boolean;
}

/**
 * @brief Lets the player pick one of several options.
 *
 * Up and down move the cursor (wrapping around) with the `cursor` sound; A
 * picks with the `select` sound; B picks `cancel`, if allowed, with the
 * `cancel` sound. Tapping an option picks it. The window is sized to the
 * widest option.
 *
 * @code
 * <ChoiceWindow options={['YES', 'NO']} cancel={1} onPick={(i) => answer(i === 0)} />
 * @endcode
 *
 * @param props See `ChoiceWindowProps`.
 * @return The window, or nothing until the font is ready.
 */
export function ChoiceWindow ({
    options, onPick, cancel = -1, initial = 0, x, y, skin = DEFAULT_SKINS.choice, font: fontId, active = true,
}: ChoiceWindowProps)
{
    const { width: gameWidth, height: gameHeight } = useGameSize();
    const { font, advance, ready } = usePixelFont(fontId);
    const [selected, setSelected] = useState(initial);
    const optionsKey = options.join('\u0000');
    useEffect(() => setSelected(initial), [optionsKey, initial]);

    const count = options.length;
    const move = (delta: number) =>
    {
        if (count < 2) return;
        setSelected((index) => (index + delta + count) % count);
        playUiSound('cursor');
    };
    const pick = (index: number) =>
    {
        playUiSound('select');
        onPick(index);
    };

    useInputPress((button) =>
    {
        if (button === 'up') move(-1);
        else if (button === 'down') move(1);
        else if (button === 'a') pick(selected);
        else if (button === 'b' && cancel >= 0)
        {
            playUiSound('cancel');
            onPick(cancel);
        }
        return true;
    }, active && count > 0);

    if (!ready || count === 0) return null;

    const frame = getSkin(skin);
    const widest = Math.max(...options.map((option) => textWidth(option, advance)));
    const width = widest + 1 + frame.padding.left + frame.padding.right;
    const height = count * font.lineHeight + frame.padding.top + frame.padding.bottom;
    const place = choiceBox(messageBox(gameWidth, gameHeight), gameWidth, width, height);

    return (
        <Window
            skin={skin} x={x ?? place.x} y={y ?? place.y} width={width} height={height}
            interactive className="choice-window"
        >
            {options.map((option, index) => (
                <div
                    key={index}
                    className="choice-option"
                    style={{ top: index * font.lineHeight, height: font.lineHeight, width: widest + 1 }}
                    onPointerEnter={(event) => { if (event.pointerType === 'mouse' && index !== selected) setSelected(index); }}
                    onPointerDown={(event) => { if (event.button === 0) pick(index); }}
                >
                    <PixelText text={option} skin={skin} font={fontId} />
                </div>
            ))}
            <UiSprite
                src={uiImageUrl(SELECT_ARROW.name)}
                x={-frame.padding.left + 7} y={selected * font.lineHeight + 1}
                width={SELECT_ARROW.width} height={SELECT_ARROW.height}
            />
        </Window>
    );
}
