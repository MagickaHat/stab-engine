/**
 * @file useMenuText.ts
 * @brief Translated text for screens shown before a save is loaded (title, Continue menu).
 *
 * Until a game is loaded there is no game localizer, so these screens use the
 * menu text (`loadMenuText()`) in the device's language, falling back to English.
 */
import {useCallback, useEffect, useState} from 'react';
import type {Localizer, MessageParams} from '../../i18n';
import {getGameState} from '../../state';
import {deviceLocale} from '../../world/newGame';
import {loadMenuText} from '../../world/text';

/**
 * @brief A function that translates a key for the title screens.
 * @param locale Locale to show (default: the loaded game's, else the device's).
 * @return `t(key, params)`; the key itself until the text has loaded.
 */
export function useMenuText(locale?: string): (key: string, params?: MessageParams) => string
{
    const [store, setStore] = useState<Localizer|null>(null);
    const [version, setVersion] = useState(0);
    useEffect(() => {
        let live = true;
        let unsubscribe: (() => void)|undefined;
        void loadMenuText().then((text) => {
            if (!live) return;
            setStore(text);
            unsubscribe = text.subscribe(() => setVersion((v) => v + 1));
        });
        return () => {
            live = false;
            unsubscribe?.();
        };
    }, []);
    const shown = locale ?? getGameState()?.language ?? deviceLocale();
    return useCallback((key: string, params: MessageParams = {}) => {
        const found = store?.lookup(key, shown);
        return found ? store!.formatText(found.text, params) : key;
    }, [store, shown, version]);
}
