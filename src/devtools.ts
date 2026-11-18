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
import { showChoice, showMessage, showNameInput } from './world/dialogue';

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
    };
    console.info('[stab] dev helpers ready: stab.demo(), stab.say(text, speaker), stab.ask(prompt, options), stab.name(prompt).');
}
