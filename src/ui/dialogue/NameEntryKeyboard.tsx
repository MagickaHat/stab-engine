/**
 * @file NameEntryKeyboard.tsx
 * @brief The naming screen: an on-screen letter grid in the language of the
 *        name being typed, with that language's name rules.
 *
 * A Pokémon's nickname uses **its own** language's keyboard and length
 * (a Japanese Pokémon: kana pages, 6 characters; see src/i18n/nickname.ts);
 * anything else uses the game's language. Layouts come from
 * `content/locales/keyboards/<id>.json`; a language without one (Korean,
 * Chinese) uses the game's keyboard.
 *
 * Controls: the D-pad moves, A types the key (or presses a button), B deletes,
 * L/R or Select change page, Start confirms. Clicking or tapping the name
 * switches to typing with a physical (or phone) keyboard; keys the layout
 * does not have are ignored. Clicking the grid switches back.
 */
import { useMemo, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import { keyboardFor, languageInfo, nicknameRules, playerNameRules, sanitizeName } from '../../i18n';
import type { KeyboardLayout, NameRules } from '../../i18n';
import { KEYBOARDS_BY_ID } from '../../world/text';
import { uiImageUrl } from '../assets/paths';
import { PixelText } from '../components/PixelText';
import { UiSprite } from '../components/UiSprite';
import { useLocalizer, useText } from '../i18n/useLocalizer';
import { playUiSound } from '../sounds';
import { textWidth } from '../text/layout';
import { usePixelFont } from '../text/usePixelText';
import { useInputPress } from '../useInput';
import { useTicker } from './textSpeed';

/** @brief Props of `<NameEntryKeyboard>`. */
export interface NameEntryKeyboardProps
{
    /** Question at the top, or `null`. */
    prompt: string | null;
    /** Name shown at first. */
    initial: string;
    /** Most characters; the language's limit applies if it is lower. */
    max: number;
    /** Language whose keyboard and rules to use. Default: the game's. */
    language?: string;
    /** `true` when naming a Pokémon (nickname rules), else player-name rules. */
    pokemon?: boolean;
    /** Called with the cleaned-up name (may be empty: keep the old one). */
    onSubmit: (name: string) => void;
}

/** @brief Grid geometry, in game pixels. */
const GRID = { x: 22, y: 74, cell: 22, row: 16, cols: 10, rows: 5 } as const;
/** @brief The buttons under the grid. */
const BUTTONS = ['ui.keyboard.space', 'ui.keyboard.back', 'ui.keyboard.ok'] as const;
/** @brief The grid column the cursor lands on for each button. */
const BUTTON_COLS = [1, 5, 8] as const;
/** @brief Which button a grid column is under. */
const buttonOf = (col: number) => Math.min(2, Math.floor((col * 3) / 10));
const DARK = { color: '#404040', shadow: '#d0d0c8' } as const;

/** @brief Stops a clipboard event, so the name cannot be copied out of the field. */
const block = (event: ClipboardEvent) => event.preventDefault();

/**
 * @brief The naming screen.
 * @param props See `NameEntryKeyboardProps`.
 * @return The screen, or nothing until the font is ready.
 */
export function NameEntryKeyboard ({ prompt, initial, max, language, pokemon = false, onSubmit }: NameEntryKeyboardProps)
{
    const text = useLocalizer();
    const t = useText();
    const { font, advance, ready } = usePixelFont();
    const gameLocale = text?.locale ?? 'en';
    const nameLanguage = language ?? gameLocale;

    const layout: KeyboardLayout | undefined = useMemo(
        () => KEYBOARDS_BY_ID.get(keyboardFor(nameLanguage, gameLocale, new Set(KEYBOARDS_BY_ID.keys()))) ?? KEYBOARDS_BY_ID.get('en'),
        [nameLanguage, gameLocale],
    );
    const rules: NameRules = useMemo(() =>
    {
        const base = pokemon ? nicknameRules(nameLanguage, layout ?? null) : playerNameRules(nameLanguage, layout ?? null);
        return { ...base, max: Math.min(base.max, max) };
    }, [pokemon, nameLanguage, layout, max]);

    const [name, setName] = useState(() => sanitizeName(initial, rules));
    const [page, setPage] = useState(0);
    const [cursor, setCursor] = useState({ row: 0, col: 0 });
    const input = useRef<HTMLInputElement>(null);
    const caret = useTicker(400) % 2 === 0;
    const startTyping = () => input.current?.focus();
    const stopTyping = () => input.current?.blur();

    const pages = layout?.pages ?? [];
    const rows = pages[page]?.rows ?? [];
    const length = [...name].length;

    const type = (char: string) =>
    {
        if (length >= rules.max)
        {
            playUiSound('cancel');
            return;
        }
        setName((current) => sanitizeName(current + char, rules) || current);
        playUiSound('select');
    };
    const erase = () =>
    {
        if (!length) return;
        setName((current) => [...current].slice(0, -1).join(''));
        playUiSound('cancel');
    };
    const submit = () =>
    {
        playUiSound('select');
        onSubmit(sanitizeName(name, rules));
    };
    const press = (row: number, col: number) =>
    {
        if (row === rows.length)
        {
            const button = BUTTONS[buttonOf(col)];
            if (button === 'ui.keyboard.space') type(' ');
            else if (button === 'ui.keyboard.back') erase();
            else submit();
            return;
        }
        const char = [...rows[row]][col];
        if (char && !/\s/.test(char)) type(char);
    };
    const turnPage = (delta: number) =>
    {
        if (pages.length < 2) return;
        setPage((current) => (current + delta + pages.length) % pages.length);
        setCursor((current) => ({ ...current, row: Math.min(current.row, (pages[(page + delta + pages.length) % pages.length]?.rows.length ?? 1)) }));
        playUiSound('cursor');
    };

    useInputPress((button, event) =>
    {
        //  Letters typed on a physical keyboard go into the hidden field instead.
        const fromKeys = event.device === 'keyboard' && document.activeElement === input.current;
        if (button === 'up' || button === 'down')
        {
            setCursor((current) => ({ ...current, row: (current.row + (button === 'up' ? -1 : 1) + rows.length + 1) % (rows.length + 1) }));
            playUiSound('cursor');
        }
        else if (button === 'left' || button === 'right')
        {
            setCursor((current) => ({ ...current, col: (current.col + (button === 'left' ? -1 : 1) + GRID.cols) % GRID.cols }));
            playUiSound('cursor');
        }
        else if (button === 'a' && !fromKeys) press(cursor.row, cursor.col);
        else if (button === 'b' && !fromKeys) erase();
        else if (button === 'l') turnPage(-1);
        else if (button === 'r' || button === 'select') turnPage(1);
        else if (button === 'start' && !fromKeys) submit();
        return true;
    }, ready);

    if (!ready) return null;
    const slot = advance('W') + 1;
    const fieldX = 20;
    const buttonWidth = 66;

    return (
        <div className="name-entry-screen" style={{ position: 'absolute', inset: 0 }}>
            <UiSprite src={uiImageUrl('naming/bg')} x={0} y={0} width={256} height={192} />
            {prompt && <PixelText text={prompt} x={fieldX} y={6} {...DARK} />}
            <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
                <div className="ui-interactive" style={{ position: 'absolute', left: fieldX - 4, top: 20, width: rules.max * slot + 8, height: 24 }} onPointerDown={startTyping} />
                {Array.from({ length: rules.max }, (_, i) => (
                    <div key={i} className="name-entry-slot" style={{ left: fieldX + i * slot, top: 39, width: slot - 2 }} />
                ))}
                {[...name].map((char, i) => (
                    <PixelText key={i} text={char} x={fieldX + i * slot + Math.floor((slot - 1 - textWidth(char, advance)) / 2)} y={24} {...DARK} />
                ))}
                {caret && length < rules.max && <div className="name-entry-caret" style={{ left: fieldX + length * slot, top: 24 + font.baseline + 1, width: slot - 2 }} />}
                <PixelText text={t('ui.keyboard.count', { count: length, max: rules.max })} x={206} y={24} {...DARK} />
                <input
                    ref={input} className="name-entry-input ui-interactive" value={name} maxLength={rules.max * 2}
                    autoComplete="off" autoCorrect="off" spellCheck={false} aria-label={prompt ?? 'Name'}
                    onChange={(event) => setName(sanitizeName(event.target.value, rules))}
                    onCopy={block} onCut={block}
                />
            </form>
            {pages.map((entry, i) => (
                <div key={entry.label} className="ui-interactive" style={{ position: 'absolute', left: 12 + i * 48, top: 50 }} onPointerDown={() => { setPage(i); playUiSound('cursor'); }}>
                    <PixelText text={t(entry.label)} color={i === page ? '#f8f8f8' : '#e0e0d8'} shadow={i === page ? '#d05040' : '#888880'} />
                </div>
            ))}
            <UiSprite src={uiImageUrl(`naming/overlay_tab_${(page % 3) + 1}`)} x={10} y={66} width={236} height={110} />
            {rows.map((row, r) => [...row].map((char, c) => (/\s/.test(char) ? null : (
                <div
                    key={`${r}:${c}`} className="name-key ui-interactive"
                    style={{ left: GRID.x + c * GRID.cell, top: GRID.y + r * GRID.row, width: GRID.cell, height: GRID.row }}
                    onPointerDown={() => { stopTyping(); setCursor({ row: r, col: c }); press(r, c); }}
                >
                    <PixelText text={char} x={Math.floor((GRID.cell - textWidth(char, advance)) / 2)} {...DARK} />
                </div>
            ))))}
            {BUTTONS.map((key, i) => (
                <div
                    key={key} className="name-key ui-interactive"
                    style={{ left: GRID.x + i * (buttonWidth + 4), top: GRID.y + GRID.rows * GRID.row + 2, width: buttonWidth, height: GRID.row }}
                    onPointerDown={() => { stopTyping(); setCursor({ row: rows.length, col: BUTTON_COLS[i] }); press(rows.length, BUTTON_COLS[i]); }}
                >
                    <PixelText text={t(key)} x={Math.floor((buttonWidth - textWidth(t(key), advance)) / 2)} {...DARK} />
                </div>
            ))}
            <div
                className="name-key-cursor"
                style={cursor.row >= rows.length
                    ? { left: GRID.x + buttonOf(cursor.col) * (buttonWidth + 4) - 1, top: GRID.y + GRID.rows * GRID.row + 1, width: buttonWidth + 2, height: GRID.row + 2 }
                    : { left: GRID.x + cursor.col * GRID.cell - 1, top: GRID.y + cursor.row * GRID.row - 1, width: GRID.cell + 2, height: GRID.row + 2 }}
            />
            {language && language !== gameLocale && (
                <PixelText text={languageInfo(language).label} x={206} y={6} {...DARK} />
            )}
        </div>
    );
}
