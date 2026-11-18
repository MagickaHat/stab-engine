/**
 * @file newGame.ts
 * @brief Starting a new game: the player picks the language, which the save keeps for good.
 */
import { matchDeviceLocale } from '../i18n';
import type { UiLocale } from '../i18n';
import { GameState, setGameState } from '../state';
import type { NewGameOptions } from '../state';
import { showLanguageSelect } from './dialogue';
import { loadText, setLocalizer } from './text';

/**
 * @brief The UI locale that best fits the device (`navigator.languages`).
 * @return A UI locale; `en` outside a browser.
 */
export function deviceLocale (): UiLocale
{
    const languages = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? [navigator.language])];
    return matchDeviceLocale(languages);
}

/**
 * @brief Start a new game: ask for the language (New Game language menu), make the
 *        save with it, and make the game's localizer, locked to it.
 *
 * Without a UI listening (tests, tools) the device's language is used.
 *
 * @param options Player name, PC size... (`language` is what the player picks).
 * @return The new game, already the current one (`getGameState()`).
 */
export async function startNewGame (options: Omit<NewGameOptions, 'language'> = {}): Promise<GameState>
{
    const picked = await showLanguageSelect(deviceLocale());
    const state = GameState.create({ ...options, language: picked as UiLocale });
    const text = await loadText(state.language);
    text.lock(state.language);
    setLocalizer(text);
    setGameState(state);
    return state;
}
