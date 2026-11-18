/**
 * @file LanguageSelect.tsx
 * @brief The New Game language menu.
 *
 * Lists every UI locale by its own name ("Deutsch", "Español (Latinoamérica)")
 * with the title in the highlighted language, then asks to confirm, because
 * the language of a save can never change. The cursor starts on the device's
 * language. Text for every language is loaded here, since no save (and so no
 * game localizer) exists yet.
 */
import { useEffect, useMemo, useState } from 'react';
import { languageInfo, UI_LOCALES } from '../../i18n';
import type { Localizer } from '../../i18n';
import { loadMenuText } from '../../world/text';
import { uiImageUrl } from '../assets/paths';
import { PixelText } from '../components/PixelText';
import { UiSprite } from '../components/UiSprite';
import { Window } from '../components/Window';
import { ChoiceWindow, SELECT_ARROW } from '../dialogue/ChoiceWindow';
import { MessageBox } from '../dialogue/MessageBox';
import { DEFAULT_SKINS, getSkin } from '../skins/skins';
import { playUiSound } from '../sounds';
import { useGameSize } from '../store/uiStore';
import { usePixelFont } from '../text/usePixelText';
import { useInputPress } from '../useInput';

/** @brief Props of `<LanguageSelect>`. */
export interface LanguageSelectProps
{
    /** Locale the cursor starts on. */
    initial: string;
    /** Called with the confirmed locale. */
    onPick: (locale: string) => void;
}

/**
 * @brief Lets the player choose the language of a new game.
 * @param props See `LanguageSelectProps`.
 * @return The menu.
 */
export function LanguageSelect ({ initial, onPick }: LanguageSelectProps)
{
    const { width: gameWidth } = useGameSize();
    const { font, ready } = usePixelFont();
    const [text, setText] = useState<Localizer | null>(null);
    const [selected, setSelected] = useState(Math.max(0, UI_LOCALES.indexOf(initial as never)));
    const [confirming, setConfirming] = useState(false);
    useEffect(() =>
    {
        let live = true;
        void loadMenuText().then((store) => { if (live) setText(store); });
        return () => { live = false; };
    }, []);

    const locale = UI_LOCALES[selected];
    const say = useMemo(() => (key: string, params = {}) => text?.lookup(key, locale) ? text.formatText(text.lookup(key, locale)!.text, params) : key, [text, locale]);

    useInputPress((button) =>
    {
        const count = UI_LOCALES.length;
        if (button === 'up' || button === 'down')
        {
            setSelected((index) => (index + (button === 'up' ? -1 : 1) + count) % count);
            playUiSound('cursor');
        }
        else if (button === 'a')
        {
            playUiSound('select');
            setConfirming(true);
        }
        return true;
    }, !confirming && ready);

    if (!ready) return null;
    const skin = DEFAULT_SKINS.choice;
    const frame = getSkin(skin);
    const width = 168;
    const height = UI_LOCALES.length * font.lineHeight + frame.padding.top + frame.padding.bottom;
    const x = Math.round((gameWidth - width) / 2);

    return (
        <>
            <Window skin={skin} x={x} y={0} width={width} height={height} interactive>
                {UI_LOCALES.map((id, index) => (
                    <div
                        key={id} className="choice-option" style={{ top: index * font.lineHeight, height: font.lineHeight, width: width - frame.padding.left - frame.padding.right }}
                        onPointerDown={(event) =>
                        {
                            if (event.button !== 0 || confirming) return;
                            setSelected(index);
                            playUiSound('select');
                            setConfirming(true);
                        }}
                    >
                        <PixelText text={languageInfo(id).nativeName} skin={skin} />
                    </div>
                ))}
                <UiSprite
                    src={uiImageUrl(SELECT_ARROW.name)} x={-frame.padding.left + 7} y={selected * font.lineHeight + 1}
                    width={SELECT_ARROW.width} height={SELECT_ARROW.height}
                />
            </Window>
            {confirming
                ? (
                    <>
                        <MessageBox key={`q${locale}`} text={say('ui.language.confirm', { language: languageInfo(locale).nativeName })} waitForInput={false} />
                        <ChoiceWindow
                            options={[say('system.yes'), say('system.no')]} cancel={1}
                            onPick={(index) =>
                            {
                                setConfirming(false);
                                if (index === 0) onPick(locale);
                            }}
                        />
                    </>
                )
                : <MessageBox key={`t${locale}`} text={say('ui.language.title')} waitForInput={false} />}
        </>
    );
}
