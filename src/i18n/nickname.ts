/**
 * @file nickname.ts
 * @brief Rules for names the player types: Pokémon nicknames and the player's name.
 *
 * A Pokémon's nickname follows the rules of **the Pokémon's language**, not
 * the game's: a Japanese Pokémon allows 6 characters, an English one 12.
 * The keyboard shown is the one of that language when the game has a layout
 * and a font for it, else the game's own keyboard.
 *
 * Only the original trainer may nickname a Pokémon (traded Pokémon keep
 * their names), as in the official games.
 */
import { languageInfo } from './languages.ts';

/** @brief One page of an on-screen keyboard. */
export interface KeyboardPage
{
    /** Text key of the page's name ("UPPER", "lower"...). */
    label: string;
    /** Rows of keys. Each character of a row is a key; a space is an empty key (the keyboard has its own space button). */
    rows: string[];
}

/** @brief An on-screen keyboard layout (`content/locales/keyboards/<id>.json`). */
export interface KeyboardLayout
{
    /** Layout ID, the file name. */
    id: string;
    pages: KeyboardPage[];
}

/** @brief What decides how a name may look. */
export interface NameRules
{
    /** Most characters. */
    max: number;
    /** Characters that may be typed, or `null` for anything. */
    allowed: ReadonlySet<string> | null;
}

/**
 * @brief Every character a keyboard layout can type (always including the space).
 * @param layout The layout.
 */
export function keyboardCharacters (layout: KeyboardLayout): Set<string>
{
    const set = new Set<string>([' ']);
    for (const page of layout.pages) for (const row of page.rows) for (const char of row) if (!/\s/.test(char)) set.add(char);
    return set;
}

/**
 * @brief The rules for a Pokémon's nickname.
 * @param language The Pokémon's language.
 * @param layout Keyboard to type it on; its characters are the allowed ones. `null`: anything.
 * @param glyphs Characters the UI font can draw; others are not allowed. `null`: anything.
 */
export function nicknameRules (language: string, layout: KeyboardLayout | null = null, glyphs: ReadonlySet<string> | null = null): NameRules
{
    return { max: languageInfo(language).nicknameMax, allowed: allowedSet(layout, glyphs) };
}

/**
 * @brief The rules for the player's name.
 * @param locale The game's locale.
 * @param layout Keyboard; `null`: anything.
 * @param glyphs Characters the UI font can draw; `null`: anything.
 */
export function playerNameRules (locale: string, layout: KeyboardLayout | null = null, glyphs: ReadonlySet<string> | null = null): NameRules
{
    return { max: languageInfo(locale).playerNameMax, allowed: allowedSet(layout, glyphs) };
}

/** @brief Keyboard characters the font can draw. */
function allowedSet (layout: KeyboardLayout | null, glyphs: ReadonlySet<string> | null): ReadonlySet<string> | null
{
    if (!layout) return glyphs;
    const keys = keyboardCharacters(layout);
    if (!glyphs) return keys;
    return new Set([...keys].filter((char) => char === ' ' || glyphs.has(char)));
}

/**
 * @brief Clean up a typed name: drop characters that are not allowed, collapse
 *        spaces, trim, and cut it to the most characters.
 * @param name What was typed.
 * @param rules The rules.
 * @return The name to keep (may be empty: then keep the old one).
 */
export function sanitizeName (name: string, rules: NameRules): string
{
    const chars = [...name.normalize('NFC')].filter((char) => !/[\u0000-\u001f\u007f]/.test(char) && (!rules.allowed || char === ' ' || rules.allowed.has(char)));
    const collapsed = chars.join('').replace(/\s+/g, ' ').trim();
    return [...collapsed].slice(0, rules.max).join('').trimEnd();
}

/**
 * @brief Whether a typed name follows the rules as it is.
 * @param name The name.
 * @param rules The rules.
 */
export function isValidName (name: string, rules: NameRules): boolean
{
    return name.length > 0 && sanitizeName(name, rules) === name;
}

/**
 * @brief Whether the player may nickname a Pokémon.
 * @param pokemon Its original trainer.
 * @param player The player's trainer ID.
 * @return `true` if the player is its original trainer (same trainer ID).
 */
export function canNickname (pokemon: { ot: { id: number } }, player: { trainerId: number }): boolean
{
    return pokemon.ot.id === player.trainerId;
}

/**
 * @brief Which keyboard layout to show for a Pokémon's nickname.
 * @param pokemonLanguage The Pokémon's language.
 * @param gameLocale The game's locale.
 * @param available Layout IDs the game has (and can draw).
 * @return The Pokémon language's layout if available, else the game's.
 */
export function keyboardFor (pokemonLanguage: string, gameLocale: string, available: ReadonlySet<string>): string
{
    const own = languageInfo(pokemonLanguage).keyboard;
    return available.has(own) ? own : languageInfo(gameLocale).keyboard;
}
