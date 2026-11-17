/**
 * @file text.ts
 * @brief Loads translated text for the event system in the game.
 *
 * Reads every `content/locales/<category>/<locale>.csv` and, for names of
 * items, Pokémon and moves, the generated text in
 * `content/pbs/generated/locales/<locale>/`. English is always loaded, as
 * the fallback.
 */
import { loadGeneratedText } from '../data';
import { FALLBACK_LOCALE, parseLocaleCsv, TextStore } from '../events/text';

const CSV = import.meta.glob<string>('../../content/locales/*/*.csv', { query: '?raw', import: 'default' });

/**
 * @brief Load the text of a locale (and English) into a store.
 * @param locale Locale to show, e.g. `de`. Default: English.
 * @param store Store to add to. Default: a new one.
 * @return The store, set to `locale`.
 */
export async function loadText (locale: string = FALLBACK_LOCALE, store = new TextStore()): Promise<TextStore>
{
    for (const name of new Set([FALLBACK_LOCALE, locale]))
    {
        for (const category of ['items', 'pokemon', 'moves'] as const)
        {
            store.add(name, await loadGeneratedText(name, category));
        }
        for (const [path, load] of Object.entries(CSV))
        {
            if (path.endsWith(`/${name}.csv`)) store.add(name, parseLocaleCsv(await load()));
        }
    }
    store.locale = locale;
    return store;
}
