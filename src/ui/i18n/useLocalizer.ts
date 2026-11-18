/**
 * @file useLocalizer.ts
 * @brief React access to the game's localizer.
 *
 * Components re-render when the game's localizer is replaced (a save with
 * another language was loaded) or its text changes (a CSV was edited during
 * `npm run dev`), so translated text is never stale on screen.
 *
 * @code
 * const t = useText();
 * <PixelText text={t('ui.keyboard.ok')} />
 * @endcode
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Localizer, MessageParams } from '../../i18n';
import { getLocalizer, subscribeLocalizer } from '../../world/text';

/**
 * @brief Subscribe to a localizer's changes for as long as a component shows.
 * @param store The localizer, or `null`.
 * @return A number that changes on every change (use it as a dependency).
 */
function useLocalizerVersion (store: Localizer | null): number
{
    const [version, setVersion] = useState(0);
    useEffect(() => store?.subscribe(() => setVersion((v) => v + 1)), [store]);
    return version;
}

/**
 * @brief The game's localizer, or `null` before the game has loaded its text.
 * @return The localizer.
 */
export function useLocalizer (): Localizer | null
{
    const store = useSyncExternalStore(subscribeLocalizer, getLocalizer);
    useLocalizerVersion(store);
    return store;
}

/**
 * @brief A function that translates a key with the game's localizer.
 * @param override Localizer to use instead of the game's (e.g. the language menu's).
 * @return `t(key, params)`; the key itself if no localizer is ready.
 */
export function useText (override?: Localizer | null): (key: string, params?: MessageParams) => string
{
    const game = useLocalizer();
    const store = override ?? game;
    const version = useLocalizerVersion(override ?? null);
    return useCallback(
        (key: string, params?: MessageParams) => (store ? store.format(key, params) : key),
        [store, version, store?.locale],
    );
}
