/**
 * @file devtools.ts
 * @brief Development helpers, only loaded by `npm run dev` (never in a build).
 *
 * Adds `window.stab` so dialogue can be tried from the browser console
 * without a map or an event script:
 *
 * @code
 * await stab.say('Hello there!', 'OAK');
 * await stab.ask('Are you a boy or a girl?', ['BOY', 'GIRL']);
 * await stab.name('Your name?');
 * stab.textSpeed('fast');
 * stab.demo();
 * @endcode
 */
import type { TextSpeed } from './bus/EventBus';
import { setTextSpeed } from './ui/store/uiStore';
import { showChoice, showLanguageSelect, showMessage, showNameInput, showPokedexEntry } from './world/dialogue';
import { deviceLocale } from './world/newGame';
import { getLocalizer } from './world/text';

/** @brief What `window.stab` holds. */
export interface StabDevtools
{
    /** Shows a message; resolves when it is closed. */
    say: (text: string, speaker?: string) => Promise<void>;
    /** Asks a question; resolves with the index picked. */
    ask: (prompt: string | null, options: string[], cancel?: number) => Promise<number>;
    /** Asks for a name; resolves with it. */
    name: (prompt: string | null, current?: string, max?: number) => Promise<string>;
    /** Changes the text speed. */
    textSpeed: (speed: TextSpeed) => void;
    /** Runs a short conversation that shows every dialogue window. */
    demo: () => Promise<void>;
    /** Opens the New Game language menu; resolves with the locale picked (nothing changes). */
    language: () => Promise<string>;
    /** Opens a Pokédex entry with these languages unlocked, e.g. `stab.dex('pikachu', ['en', 'ja', 'fr'])`. */
    dex: (species: string, languages?: string[]) => Promise<void>;
    /** Opens the naming keyboard for a Pokémon of a language, e.g. `stab.nickname('pikachu', 'ja')`. */
    nickname: (species: string, language?: string) => Promise<string>;
    /** The game's locale, or `null` before text is loaded. */
    locale: () => string | null;
}

declare global
{
    interface Window
    {
        /** Development helpers (see src/devtools.ts). */
        stab?: StabDevtools;
    }
}

/**
 * @brief Runs a short conversation using every dialogue window.
 */
async function demo (): Promise<void>
{
    await showMessage('Hello there! Welcome to the world of POKéMON!', 'PROF. OAK');
    await showMessage(
        'This world is inhabited by creatures called POKéMON! For some people, POKéMON are pets. '
        + 'Others use them for fights. Myself... I study POKéMON as a profession.',
        'PROF. OAK',
    );
    const pick = await showChoice('Are you a boy or a girl?', ['BOY', 'GIRL'], -1);
    const name = await showNameInput('Your name?', pick === 0 ? 'RED' : 'LEAF', 7);
    await showMessage(`Right! So your name is ${name}!`, 'PROF. OAK');
}

/**
 * @brief Puts the helpers on `window.stab`.
 */
export function installDevtools (): void
{
    window.stab = {
        say: showMessage,
        ask: (prompt, options, cancel = -1) => showChoice(prompt, options, cancel),
        name: (prompt, current = '', max = 10) => showNameInput(prompt, current, max),
        textSpeed: setTextSpeed,
        demo,
        language: () => showLanguageSelect(deviceLocale()),
        dex: (species, languages) => showPokedexEntry(species, languages ?? [getLocalizer()?.locale ?? 'en']),
        nickname: (species, language) => showNameInput(null, '', 12, { language: language ?? getLocalizer()?.locale, species }),
        locale: () => getLocalizer()?.locale ?? null,
    };
    console.info('[stab] dev helpers ready: stab.demo(), stab.say(text, speaker), stab.ask(prompt, options), stab.name(prompt), stab.language(), stab.dex(species, languages), stab.nickname(species, language).');
}
