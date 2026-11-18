/**
 * @file languages.ts
 * @brief Every language the engine knows: the UI locales the game is translated
 *        into, and the languages a Pokémon can carry.
 *
 * Two lists, because they are not the same thing:
 *
 * - **UI locales** (`UI_LOCALES`) are the languages the game can be played in.
 *   Each has a folder of text in `content/locales/<category>/<locale>.csv`.
 *   A save file picks one when the game is started and keeps it for good.
 * - **Pokémon languages** (`POKEMON_LANGUAGES`) are the languages a Pokémon can
 *   come from, as in the official games. Every UI locale is one, and some are
 *   Pokémon-only (Japanese, Korean, Chinese): such Pokémon arrive by gifts,
 *   trades or events, never from playing in that language.
 *
 * Regional variants of one language (`es-es`/`es-mx`, `pt-br`/`pt-pt`) are
 * **dialects**: they share a `family`, fall back to each other before
 * English, and count as the same language for the Masuda method.
 *
 * Nothing here imports Phaser, React or the game state, so tools and tests use it too.
 */

/** @brief Locales the game can be played in (folder names in `content/locales`). */
export const UI_LOCALES = ['en', 'de', 'fr', 'it', 'es-es', 'es-mx', 'pt-br', 'pt-pt'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

/** @brief Every language a Pokémon can carry. The order is the order menus list them in. */
export const POKEMON_LANGUAGE_IDS = [
    'ja', 'en', 'fr', 'it', 'de', 'es-es', 'es-mx', 'ko', 'zh-hans', 'zh-hant', 'pt-br', 'pt-pt',
] as const;
export type PokemonLanguage = (typeof POKEMON_LANGUAGE_IDS)[number];

/** @brief The locale every other locale ends up falling back to. */
export const BASE_LOCALE: UiLocale = 'en';

/** @brief Everything the engine knows about one language. */
export interface LanguageInfo
{
    /** Language ID, e.g. `es-mx`. */
    id: PokemonLanguage;
    /**
     * Languages with the same family are dialects of one language: they count
     * as the same language for the Masuda method. E.g. `es` for both Spanish locales.
     */
    family: string;
    /** `true` if the game can be played in this language (it is in `UI_LOCALES`). */
    ui: boolean;
    /** The language's name in itself, shown in the language menu: "Deutsch". */
    nativeName: string;
    /** Short label for Pokémon summary screens and the Pokédex, as in the official games: "GER". */
    label: string;
    /** BCP 47 tag for `Intl` (numbers, plural rules): `es-MX`. */
    intl: string;
    /** Language to try next when a text key is missing, or `null` for the base locale. */
    fallback: PokemonLanguage | null;
    /** Most characters in a nickname of a Pokémon from this language. */
    nicknameMax: number;
    /** Most characters in a player name typed in this language. */
    playerNameMax: number;
    /** Keyboard layout file in `content/locales/keyboards/` (without `.json`). */
    keyboard: string;
}

/** @brief The language table. Add a language here, then to `UI_LOCALES` if the game is translated into it. */
export const LANGUAGES: Readonly<Record<PokemonLanguage, LanguageInfo>> = {
    'ja': { id: 'ja', family: 'ja', ui: false, nativeName: '日本語', label: 'JPN', intl: 'ja-JP', fallback: 'en', nicknameMax: 6, playerNameMax: 6, keyboard: 'ja' },
    'en': { id: 'en', family: 'en', ui: true, nativeName: 'English', label: 'ENG', intl: 'en-US', fallback: null, nicknameMax: 12, playerNameMax: 12, keyboard: 'en' },
    'fr': { id: 'fr', family: 'fr', ui: true, nativeName: 'Français', label: 'FRE', intl: 'fr-FR', fallback: 'en', nicknameMax: 12, playerNameMax: 12, keyboard: 'fr' },
    'it': { id: 'it', family: 'it', ui: true, nativeName: 'Italiano', label: 'ITA', intl: 'it-IT', fallback: 'en', nicknameMax: 12, playerNameMax: 12, keyboard: 'it' },
    'de': { id: 'de', family: 'de', ui: true, nativeName: 'Deutsch', label: 'GER', intl: 'de-DE', fallback: 'en', nicknameMax: 12, playerNameMax: 12, keyboard: 'de' },
    'es-es': { id: 'es-es', family: 'es', ui: true, nativeName: 'Español (España)', label: 'SPA', intl: 'es-ES', fallback: 'en', nicknameMax: 12, playerNameMax: 12, keyboard: 'es' },
    'es-mx': { id: 'es-mx', family: 'es', ui: true, nativeName: 'Español (Latinoamérica)', label: 'SP-LA', intl: 'es-MX', fallback: 'es-es', nicknameMax: 12, playerNameMax: 12, keyboard: 'es' },
    'ko': { id: 'ko', family: 'ko', ui: false, nativeName: '한국어', label: 'KOR', intl: 'ko-KR', fallback: 'en', nicknameMax: 6, playerNameMax: 6, keyboard: 'ko' },
    'zh-hans': { id: 'zh-hans', family: 'zh-hans', ui: false, nativeName: '简体中文', label: 'CHS', intl: 'zh-Hans', fallback: 'zh-hant', nicknameMax: 6, playerNameMax: 6, keyboard: 'zh' },
    'zh-hant': { id: 'zh-hant', family: 'zh-hant', ui: false, nativeName: '繁體中文', label: 'CHT', intl: 'zh-Hant', fallback: 'en', nicknameMax: 6, playerNameMax: 6, keyboard: 'zh' },
    'pt-br': { id: 'pt-br', family: 'pt', ui: true, nativeName: 'Português (Brasil)', label: 'POR-BR', intl: 'pt-BR', fallback: 'en', nicknameMax: 12, playerNameMax: 12, keyboard: 'pt' },
    'pt-pt': { id: 'pt-pt', family: 'pt', ui: true, nativeName: 'Português (Portugal)', label: 'POR', intl: 'pt-PT', fallback: 'pt-br', nicknameMax: 12, playerNameMax: 12, keyboard: 'pt' },
};

/**
 * @brief Whether a string is a UI locale.
 * @param value Any string.
 */
export function isUiLocale (value: string): value is UiLocale
{
    return (UI_LOCALES as readonly string[]).includes(value);
}

/**
 * @brief Whether a string is a Pokémon language.
 * @param value Any string.
 */
export function isPokemonLanguage (value: string): value is PokemonLanguage
{
    return (POKEMON_LANGUAGE_IDS as readonly string[]).includes(value);
}

/**
 * @brief Information about a language.
 * @param id Language ID.
 * @return The entry, or the base locale's entry for an unknown ID.
 */
export function languageInfo (id: string): LanguageInfo
{
    return isPokemonLanguage(id) ? LANGUAGES[id] : LANGUAGES[BASE_LOCALE];
}

/**
 * @brief The locales to look a text key up in, in order.
 *
 * Dialects first fall back to their sister locale, then to English:
 * `es-mx → es-es → en`, `pt-pt → pt-br → en`, `de → en`.
 *
 * @param locale Starting locale. An unknown one gives `[locale, 'en']`.
 * @return The chain, without repeats, always ending in `BASE_LOCALE`.
 */
export function fallbackChain (locale: string): string[]
{
    const chain: string[] = [];
    let next: string | null = locale;
    while (next && !chain.includes(next))
    {
        chain.push(next);
        next = isPokemonLanguage(next) ? LANGUAGES[next].fallback : null;
    }
    if (!chain.includes(BASE_LOCALE)) chain.push(BASE_LOCALE);
    return chain;
}

/**
 * @brief Whether two languages are dialects of one language (or the same language).
 * @param a Language ID.
 * @param b Language ID.
 */
export function sameLanguageFamily (a: string, b: string): boolean
{
    return languageInfo(a).family === languageInfo(b).family;
}

/** @brief Spanish regions that use Latin American Spanish (`es-mx`). Everything else uses `es-es`. */
const LATAM_REGIONS = new Set([
    '419', 'mx', 'ar', 'bo', 'cl', 'co', 'cr', 'cu', 'do', 'ec', 'gt', 'hn', 'ni', 'pa', 'pe', 'pr', 'py', 'sv', 'us', 'uy', 've',
]);

/**
 * @brief Pick the UI locale that best fits the device's languages.
 *
 * Used before a save file is loaded (title screen, language menu default).
 *
 * @param preferred Language tags, most wanted first (`navigator.languages`).
 * @return The best UI locale; `BASE_LOCALE` if none fits.
 */
export function matchDeviceLocale (preferred: readonly string[]): UiLocale
{
    for (const raw of preferred)
    {
        const tag = raw.toLowerCase().replace(/_/g, '-');
        if (isUiLocale(tag)) return tag;
        const [lang, ...rest] = tag.split('-');
        const region = rest.find((part) => part.length === 2 || part === '419');
        if (lang === 'es') return region && LATAM_REGIONS.has(region) ? 'es-mx' : 'es-es';
        if (lang === 'pt') return region === 'br' ? 'pt-br' : 'pt-pt';
        if (isUiLocale(lang)) return lang;
    }
    return BASE_LOCALE;
}

/**
 * @brief The `Intl` tag of a language, for number formats and plural rules.
 * @param id Language ID; unknown IDs are passed through.
 */
export function intlTag (id: string): string
{
    return isPokemonLanguage(id) ? LANGUAGES[id].intl : id;
}
