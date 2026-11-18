/**
 * @file text.ts
 * @brief Loads translated text into the game, keeps it up to date while
 *        developing, and shares the game's localizer.
 *
 * For a locale it loads every locale along its fallback chain (`es-mx` loads
 * `es-mx`, `es-es` and `en`), and for each of them:
 * 1. every generated category in `content/pbs/generated/locales/<locale>/`
 *    (abilities, items, moves, natures, pokemon, types — whatever the importer wrote);
 * 2. every `content/locales/<category>/<locale>.csv` on top, so translators
 *    can override anything (with their `tags` column as grammar tags).
 *
 * During `npm run dev`, editing a CSV replaces that file's text at once
 * (vite/plugins/locales.mjs → `stab:locale-csv`), without reloading the page,
 * and announces `GameEvents.LOCALE_CHANGED`.
 */
import { EventBus, GameEvents } from '../game/EventBus';
import {
    BASE_LOCALE, buildLocaleGraphicsMap, fallbackChain, localizedGraphic, parseTags, readLocaleCsv, TextOverlay, UI_LOCALES,
} from '../i18n';
import type { KeyboardLayout, Localizer, LocaleGraphicsMap } from '../i18n';
import { TextStore } from '../events/text';
import graphicFiles from 'virtual:stab-locale-graphics';

const CSV = import.meta.glob<string>('../../content/locales/*/*.csv', { query: '?raw', import: 'default' });
const GENERATED = import.meta.glob<Record<string, string>>('../../content/pbs/generated/locales/*/*.json', { import: 'default' });
const OVERLAYS = import.meta.glob<unknown>('../../content/locales/overlays/*.json', { import: 'default', eager: true });
const KEYBOARDS = import.meta.glob<Omit<KeyboardLayout, 'id'>>('../../content/locales/keyboards/*.json', { import: 'default', eager: true });

/** @brief `.../<category>/<locale>.csv` → category and locale. */
function csvPath (path: string): { category: string; locale: string }
{
    const parts = path.split('/');
    return { category: parts[parts.length - 2], locale: parts[parts.length - 1].replace(/\.csv$/, '') };
}

/**
 * @brief Read one locale CSV into a localizer as source `csv:<category>`.
 * @param store The localizer.
 * @param locale The file's locale.
 * @param category The file's category (folder).
 * @param text The file's contents.
 */
export function applyLocaleCsv (store: Localizer, locale: string, category: string, text: string): void
{
    const table: Record<string, string> = {};
    const tags: Record<string, Record<string, string>> = {};
    for (const row of readLocaleCsv(text).rows)
    {
        table[row.key] = row.text;
        if (row.tags) tags[row.key] = parseTags(row.tags);
    }
    store.replace(locale, `csv:${category}`, table, tags);
}

/**
 * @brief Load one locale's text (without its fallbacks) into a store.
 * @param store The localizer.
 * @param locale Locale.
 */
async function loadOne (store: Localizer, locale: string): Promise<void>
{
    for (const [path, load] of Object.entries(GENERATED))
    {
        const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
        if (match && match[1] === locale) store.add(locale, await load(), `data:${match[2]}`);
    }
    for (const [path, load] of Object.entries(CSV))
    {
        const { category, locale: fileLocale } = csvPath(path);
        if (fileLocale === locale) applyLocaleCsv(store, locale, category, await load());
    }
}

/**
 * @brief Load the text of a locale (and its fallbacks) into a store.
 * @param locale Locale to show, e.g. `de`. Default: English.
 * @param store Store to add to. Default: a new one.
 * @return The store, set to `locale`.
 */
export async function loadText (locale: string = BASE_LOCALE, store = new TextStore()): Promise<TextStore>
{
    const loaded = new Set(store.loadedLocales);
    for (const name of fallbackChain(locale)) if (!loaded.has(name)) await loadOne(store, name);
    if (!store.isLocked) store.locale = locale;
    watch(store);
    return store;
}

/** @brief The menu text of every locale, loaded once. */
let menuText: Promise<TextStore> | null = null;

/**
 * @brief Load the `ui` and `events` text of every UI locale, for menus shown
 *        before a save is loaded (the New Game language menu).
 * @return A store with every locale; look keys up with `lookup(key, locale)`.
 */
export function loadMenuText (): Promise<TextStore>
{
    menuText ??= (async () =>
    {
        const store = new TextStore();
        for (const [path, load] of Object.entries(CSV))
        {
            const { category, locale } = csvPath(path);
            if (category === 'ui' || category === 'events') applyLocaleCsv(store, locale, category, await load());
        }
        watch(store);
        return store;
    })();
    return menuText;
}

/**
 * @brief Load the Pokédex text of another language (for foreign Pokédex entries).
 * @param store The localizer.
 * @param language Language ID, e.g. `ja`.
 */
export async function loadDexText (store: Localizer, language: string): Promise<void>
{
    for (const [path, load] of Object.entries(GENERATED))
    {
        if (path.endsWith(`/locales/${language}/pokemon.json`)) store.add(language, await load(), 'data:pokemon');
    }
}

// ------------------------------------------------------------ The game's localizer

let current: TextStore | null = null;
const listeners = new Set<() => void>();

/** @brief The game's localizer, or `null` before the game has loaded its text. */
export function getLocalizer (): TextStore | null
{
    return current;
}

/**
 * @brief Make a localizer the game's own (the overworld does this when it starts).
 * @param store The localizer.
 */
export function setLocalizer (store: TextStore | null): void
{
    if (store === current) return;
    current = store;
    for (const listener of [...listeners]) listener();
}

/**
 * @brief Be told when the game's localizer is replaced.
 * @param listener Called with no arguments.
 * @return A function that removes the listener.
 */
export function subscribeLocalizer (listener: () => void): () => void
{
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

// ---------------------------------------------------------- Overlays, keyboards, graphics

/** @brief Every text overlay in `content/locales/overlays`, by graphic. */
export const TEXT_OVERLAYS: ReadonlyMap<string, TextOverlay> = new Map(
    Object.values(OVERLAYS).flatMap((raw) =>
    {
        const parsed = TextOverlay.safeParse(raw);
        if (!parsed.success)
        {
            console.error('[i18n] invalid text overlay (run npm run locales:validate)', parsed.error.issues);
            return [];
        }
        return [[parsed.data.graphic, parsed.data] as const];
    }),
);

/** @brief Every keyboard layout in `content/locales/keyboards`, by ID. */
export const KEYBOARDS_BY_ID: ReadonlyMap<string, KeyboardLayout> = new Map(
    Object.entries(KEYBOARDS).map(([path, layout]) =>
    {
        const id = path.split('/').pop()!.replace(/\.json$/, '');
        return [id, { id, pages: layout.pages }];
    }),
);

/** @brief Which file each locale shows for each translated graphic, decided at build time. */
export const LOCALE_GRAPHICS: LocaleGraphicsMap = buildLocaleGraphicsMap(graphicFiles, UI_LOCALES);

/**
 * @brief The file a graphic shows in the game's locale.
 * @param graphic Path under `assets/img/` without `.png`, e.g. `ui/battle/cursor_command`.
 * @param locale Locale. Default: the game's localizer's.
 * @return The path to load (also without `.png`).
 */
export function graphicFor (graphic: string, locale: string = current?.locale ?? BASE_LOCALE): string
{
    return localizedGraphic(LOCALE_GRAPHICS, locale, graphic);
}

// ------------------------------------------------------------------- Hot reload

const watched = new Set<Localizer>();

/** @brief Keep a store up to date with edited CSV files (development only). */
function watch (store: Localizer): void
{
    if (!import.meta.hot || watched.has(store)) return;
    watched.add(store);
}

if (import.meta.hot)
{
    import.meta.hot.on('stab:locale-csv', (data: { category: string; locale: string; text: string }) =>
    {
        for (const store of watched)
        {
            if (!store.loadedLocales.includes(data.locale)) continue;
            applyLocaleCsv(store, data.locale, data.category, data.text);
            EventBus.emit(GameEvents.LOCALE_CHANGED, { locale: store.locale, reason: 'reload' });
        }
        console.info(`[i18n] reloaded content/locales/${data.category}/${data.locale}.csv`);
    });
}
