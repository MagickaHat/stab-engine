/**
 * @file PokedexEntry.tsx
 * @brief One species' Pokédex entry, readable in every language the player has unlocked.
 *
 * Owning a Pokémon from another language unlocks the entry in that language
 * (foreign Pokédex entries, as in Generation 4): `GameState.pokedexLanguages()`
 * lists them, the game's own language first. L and R (or tapping the
 * language label) switch between them; A or B closes the entry.
 *
 * The game's language falls back like any text (`es-mx` → `es-es` → `en`); a
 * foreign language shows only its own text, so an entry missing in it says so.
 */
import { useEffect, useState } from 'react';
import { languageInfo } from '../../i18n';
import { loadPbs } from '../../data';
import { loadDexText } from '../../world/text';
import { assetUrl, uiImageUrl } from '../assets/paths';
import { useImage } from '../assets/loader';
import { PixelText } from '../components/PixelText';
import { UiSprite } from '../components/UiSprite';
import { useLocalizer, useText } from '../i18n/useLocalizer';
import { playUiSound } from '../sounds';
import { useInputPress } from '../useInput';

/** @brief Props of `<PokedexEntry>`. */
export interface PokedexEntryProps
{
    /** Species ID. */
    species: string;
    /** Unlocked languages, the game's first. */
    languages: string[];
    /** Called when the player closes the entry. */
    onClose: () => void;
}

/** @brief Number, height and weight of a species. */
interface DexData
{
    num: number;
    heightm: number;
    weightkg: number;
}

const DARK = { color: '#404040', shadow: '#d8d8d0' } as const;
const LIGHT = { color: '#f8f8f8', shadow: '#a03838' } as const;

/**
 * @brief Shows a Pokédex entry.
 * @param props See `PokedexEntryProps`.
 * @return The screen.
 */
export function PokedexEntry ({ species, languages, onClose }: PokedexEntryProps)
{
    const text = useLocalizer();
    const t = useText();
    const [index, setIndex] = useState(0);
    const [data, setData] = useState<DexData | null>(null);
    const [, setLoaded] = useState(0);
    const sprite = useImage(assetUrl(`assets/img/pokemon/${species}/front.png`));
    const shown = languages[index] ?? text?.locale ?? 'en';
    const own = shown === text?.locale;

    useEffect(() =>
    {
        let live = true;
        void loadPbs(['pokedex']).then(({ pokedex }) =>
        {
            const entry = pokedex[species];
            if (live && entry) setData({ num: entry.num, heightm: entry.heightm, weightkg: entry.weightkg });
        });
        return () => { live = false; };
    }, [species]);

    useEffect(() =>
    {
        if (!text || own) return;
        let live = true;
        void loadDexText(text, shown).then(() => { if (live) setLoaded((n) => n + 1); });
        return () => { live = false; };
    }, [text, shown, own]);

    const turn = (delta: number) =>
    {
        if (languages.length < 2) return;
        setIndex((current) => (current + delta + languages.length) % languages.length);
        playUiSound('cursor');
    };
    useInputPress((button) =>
    {
        if (button === 'l' || button === 'left') turn(-1);
        else if (button === 'r' || button === 'right') turn(1);
        else if (button === 'a' || button === 'b')
        {
            playUiSound('cancel');
            onClose();
        }
        return true;
    });

    /** Text of a species field in the shown language: with fallbacks for the game's own, exact otherwise. */
    const field = (name: 'name' | 'genus' | 'flavor'): string | null =>
    {
        const found = text?.lookup(`pokemon.${species}.${name}`, shown);
        if (!found) return null;
        return own || found.locale === shown ? found.text : null;
    };
    const name = field('name') ?? text?.dataName('pokemon', species) ?? species;
    const genus = field('genus');
    const flavor = field('flavor');

    return (
        <div className="pokedex-entry ui-interactive" style={{ position: 'absolute', inset: 0 }}>
            <UiSprite src={uiImageUrl('pokedex/bg_info')} x={0} y={0} width={256} height={192} />
            {sprite && <img src={sprite.src} alt="" style={{ position: 'absolute', left: 50 - sprite.width / 2, top: 52 - sprite.height / 2 }} />}
            {data && <PixelText text={t('ui.pokedex.number', { number: String(data.num).padStart(3, '0') })} x={110} y={20} {...LIGHT} />}
            <PixelText text={name} x={110} y={36} {...DARK} />
            <div style={{ position: 'absolute', left: 104, top: 60 }} onPointerDown={() => turn(1)}>
                <PixelText text={languageInfo(shown).label} x={4} y={8} {...DARK} />
            </div>
            {genus && <PixelText text={genus} x={150} y={78} {...DARK} />}
            {data && <PixelText text={t('ui.pokedex.height', { height: data.heightm })} x={8} y={86} {...DARK} />}
            {data && <PixelText text={t('ui.pokedex.weight', { weight: data.weightkg })} x={8} y={100} {...DARK} />}
            <PixelText text={flavor ?? t('ui.pokedex.no_entry')} wrap={224} x={16} y={122} {...DARK} />
            {languages.length > 1 && <PixelText text={t('ui.pokedex.switch')} x={176} y={0} {...LIGHT} />}
        </div>
    );
}
