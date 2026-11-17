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
    submit: (name: string) => void;
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
 * @return The name typed (the current one if nothing listens).
 */
export function showNameInput (prompt: string | null, current: string, max: number): Promise<string>
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
            prompt, current, max,
            submit: (name: string) =>
            {
                if (answered) return;
                answered = true;
                resolve(name.slice(0, max));
            },
        } satisfies NameInputRequest);
    });
}
