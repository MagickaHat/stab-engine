/**
 * @file graphics.ts
 * @brief Translated graphics: which file each locale shows for a graphic.
 *
 * A graphic with words in it can have a translated copy at
 * `public/assets/img/locales/<locale>/<same path>`, e.g.
 * `img/locales/de/ui/battle/cursor_command.png`. The decision is made **at
 * build time**: `npm run locales:graphics` (also run by `npm run dev` and
 * `npm run build`) follows every locale's fallback chain and writes
 * `public/assets/locale-graphics.json`:
 *
 * @code
 * { "de": { "ui/battle/cursor_command": "locales/de/ui/battle/cursor_command" },
 *   "es-mx": { "ui/title": "locales/es-es/ui/title" } }
 * @endcode
 *
 * At run time a lookup is one object access, and a graphic without an entry
 * is the original. Code always names graphics by their original path, which
 * is also the Phaser texture key, so keys stay the same in every language.
 */
import { fallbackChain } from './languages.ts';

/** @brief The build-time map: locale → original path → translated path (both without `.png`, relative to `img/`). */
export type LocaleGraphicsMap = Record<string, Record<string, string>>;

/** @brief Folder of translated graphics, relative to `public/assets/img`. */
export const LOCALE_GRAPHICS_DIR = 'locales';

/**
 * @brief Build the map from the translated files that exist.
 * @param files Paths relative to `img/locales/`, without `.png`: `de/ui/battle/cursor_command`.
 * @param locales Every UI locale.
 * @return For each locale, the file to show for every graphic that has a translation along its fallback chain.
 */
export function buildLocaleGraphicsMap (files: readonly string[], locales: readonly string[]): LocaleGraphicsMap
{
    const byLocale = new Map<string, Set<string>>();
    for (const file of files)
    {
        const slash = file.indexOf('/');
        if (slash < 0) continue;
        const locale = file.slice(0, slash);
        let set = byLocale.get(locale);
        if (!set) byLocale.set(locale, set = new Set());
        set.add(file.slice(slash + 1));
    }
    const graphics = new Set([...byLocale.values()].flatMap((set) => [...set]));
    const map: LocaleGraphicsMap = {};
    for (const locale of locales)
    {
        const entries: Record<string, string> = {};
        for (const graphic of [...graphics].sort())
        {
            const from = fallbackChain(locale).find((name) => byLocale.get(name)?.has(graphic));
            if (from) entries[graphic] = `${LOCALE_GRAPHICS_DIR}/${from}/${graphic}`;
        }
        if (Object.keys(entries).length) map[locale] = entries;
    }
    return map;
}

/**
 * @brief The file to show for a graphic in a locale.
 * @param map The build-time map.
 * @param locale The game's locale.
 * @param graphic Original path relative to `img/`, without `.png`: `ui/battle/cursor_command`.
 * @return The translated path, or `graphic` itself.
 */
export function localizedGraphic (map: LocaleGraphicsMap, locale: string, graphic: string): string
{
    return map[locale]?.[graphic] ?? graphic;
}
