/**
 * @file dialogue.ts
 * @brief Messages, choices and name input from the event system to the React UI.
 *
 * The overworld asks for text to be shown by emitting a request on the
 * `EventBus`; the React component `<EventDialogue>` (src/ui/EventDialogue.tsx)
 * draws it and answers through the request's callback. If nothing listens
 * (no UI mounted, a test page), requests answer themselves at once so a
 * script never waits forever.
 */
import { EventBus, GameEvents } from '../game/EventBus';

/** @brief A line of text to show. Call `done()` once the player has read it. */
export interface DialogueRequest
{
    text: string;
    /** Speaker name, already translated, or `undefined`. */
    speaker?: string;
    done: () => void;
}

/** @brief Options to pick from. Call `pick(index)` with the option chosen. */
export interface ChoiceRequest
{
    /** Question shown above the options, or `null`. */
    prompt: string | null;
    options: string[];
    /** Option the cancel button picks, or -1 if it cannot be cancelled. */
    cancel: number;
    pick: (index: number) => void;
}

/** @brief A name to type. Call `submit(name)` when done. */
export interface NameInputRequest
{
    prompt: string | null;
    current: string;
    max: number;
    /**
     * Language whose keyboard and name rules apply (src/i18n/nickname.ts):
     * the Pokémon's language for a nickname, the game's for anything else.
     * Default: the game's language.
     */
    language?: string;
    /** Species ID when naming a Pokémon (shown next to the name). */
    species?: string;
    submit: (name: string) => void;
}

/** @brief The New Game language menu. Call `pick(locale)` with the chosen locale. */
export interface LanguageRequest
{
    /** Locale the cursor starts on (the device's language). */
    initial: string;
    pick: (locale: string) => void;
}

/** @brief A Pokédex entry to show. Call `done()` when the player closes it. */
export interface PokedexEntryRequest
{
    /** Species ID. */
    species: string;
    /** Languages the player can switch between, the game's first (`GameState.pokedexLanguages()`). */
    languages: string[];
    done: () => void;
}

/**
 * @brief Show a line of text.
 * @param text The text.
 * @param speaker Who says it.
 * @return Resolves when the player has read it.
 */
export function showMessage (text: string, speaker?: string): Promise<void>
{
    return new Promise((resolve) =>
    {
        if (EventBus.listenerCount(GameEvents.DIALOGUE_MESSAGE) === 0)
        {
            console.info(`[dialogue] ${speaker ? `${speaker}: ` : ''}${text}`);
            resolve();
            return;
        }
        let answered = false;
        const request: DialogueRequest = {
            text, speaker,
            done: () =>
            {
                if (answered) return;
                answered = true;
                resolve();
            },
        };
        EventBus.emit(GameEvents.DIALOGUE_MESSAGE, request);
    });
}

/**
 * @brief Ask the player to pick an option.
 * @param prompt Question, or `null`.
 * @param options The options.
 * @param cancel Option the cancel button picks, or -1.
 * @return Index of the option picked.
 */
export function showChoice (prompt: string | null, options: string[], cancel: number): Promise<number>
{
    return new Promise((resolve) =>
    {
        if (EventBus.listenerCount(GameEvents.DIALOGUE_CHOICE) === 0)
        {
            resolve(Math.max(0, cancel));
            return;
        }
        let answered = false;
        EventBus.emit(GameEvents.DIALOGUE_CHOICE, {
            prompt, options, cancel,
            pick: (index: number) =>
            {
                if (answered) return;
                answered = true;
                resolve(index);
            },
        } satisfies ChoiceRequest);
    });
}

/**
 * @brief Ask the player to type a name.
 * @param prompt Question, or `null`.
 * @param current Name shown at first.
 * @param max Most characters.
 * @param options Keyboard language and the species being named.
 * @return The name typed (the current one if nothing listens).
 */
export function showNameInput (
    prompt: string | null, current: string, max: number, options: { language?: string; species?: string } = {},
): Promise<string>
{
    return new Promise((resolve) =>
    {
        if (EventBus.listenerCount(GameEvents.DIALOGUE_NAME_INPUT) === 0)
        {
            resolve(current);
            return;
        }
        let answered = false;
        EventBus.emit(GameEvents.DIALOGUE_NAME_INPUT, {
            prompt, current, max, ...options,
            submit: (name: string) =>
            {
                if (answered) return;
                answered = true;
                resolve(name.slice(0, max));
            },
        } satisfies NameInputRequest);
    });
}

/**
 * @brief Ask the player which language to play in (New Game).
 *
 * Resolves with `initial` at once if no UI is listening (tests, tools).
 * @param initial Locale the cursor starts on.
 * @return The chosen locale.
 */
export function showLanguageSelect (initial: string): Promise<string>
{
    return new Promise((resolve) =>
    {
        if (EventBus.listenerCount(GameEvents.DIALOGUE_LANGUAGE) === 0)
        {
            resolve(initial);
            return;
        }
        let answered = false;
        EventBus.emit(GameEvents.DIALOGUE_LANGUAGE, {
            initial,
            pick: (locale: string) =>
            {
                if (answered) return;
                answered = true;
                resolve(locale);
            },
        } satisfies LanguageRequest);
    });
}

/**
 * @brief Show a species' Pokédex entry and wait until the player closes it.
 * @param species Species ID.
 * @param languages Unlocked languages, the game's first.
 */
export function showPokedexEntry (species: string, languages: string[]): Promise<void>
{
    return new Promise((resolve) =>
    {
        if (EventBus.listenerCount(GameEvents.DIALOGUE_POKEDEX_ENTRY) === 0)
        {
            resolve();
            return;
        }
        let answered = false;
        EventBus.emit(GameEvents.DIALOGUE_POKEDEX_ENTRY, {
            species, languages,
            done: () =>
            {
                if (answered) return;
                answered = true;
                resolve();
            },
        } satisfies PokedexEntryRequest);
    });
}
