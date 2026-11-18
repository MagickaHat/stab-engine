/**
 * @file content.ts
 * @brief Finds and reads everything the localization tools work on.
 *
 * - `content/locales/<category>/<locale>.csv`: hand-written text;
 * - `content/pbs/generated/locales/<locale>/<category>.json`: names and descriptions from PokeAPI;
 * - `content/locales/grammar.json`, `limits.json`: grammar tags and length limits;
 * - `content/locales/keyboards/*.json`, `overlays/*.json`;
 * - `public/assets/img/locales/<locale>/**.png`: translated graphics;
 * - the keys the game uses: event files, maps, the engine, ink stories and source code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readLocaleCsv } from '../../src/i18n/csv.ts';
import type { LocaleFile } from '../../src/i18n/csv.ts';
import type { KeyboardLayout } from '../../src/i18n/nickname.ts';
import { getFont } from '../../src/ui/text/fonts.ts';
import { listFiles, ROOT, relative } from '../events/content.ts';
import { readFontMetrics } from './font.ts';
import type { FontMetrics } from './font.ts';

export { ROOT, relative };

/** @brief Folder of the locale CSV files. */
export const LOCALES_DIR = path.join(ROOT, 'content/locales');

/** @brief Folder of the generated PokeAPI text. */
export const GENERATED_LOCALES_DIR = path.join(ROOT, 'content/pbs/generated/locales');

/** @brief Folder of the game's images. */
export const IMG_DIR = path.join(ROOT, 'public/assets/img');

/** @brief Folder of translated images. */
export const LOCALE_IMG_DIR = path.join(IMG_DIR, 'locales');

/** @brief Folder of the fonts. */
export const FONTS_DIR = path.join(ROOT, 'public/assets/fonts');

/** @brief One locale CSV file, read. */
export interface LocaleFileInfo
{
    category: string;
    locale: string;
    /** Path relative to the repository. */
    rel: string;
    file: LocaleFile;
}

/**
 * @brief Read every locale CSV file.
 * @param dir Root folder. Default: `content/locales`.
 * @return The files, sorted by path.
 */
export function loadLocaleFiles (dir = LOCALES_DIR): LocaleFileInfo[]
{
    return listFiles(dir, ['.csv']).flatMap((file) =>
    {
        const parts = path.relative(dir, file).split(path.sep);
        if (parts.length !== 2) return [];
        return [{
            category: parts[0], locale: parts[1].replace(/\.csv$/, ''), rel: relative(file),
            file: readLocaleCsv(fs.readFileSync(file, 'utf-8')),
        }];
    });
}

/**
 * @brief Read the generated PokeAPI text.
 * @return Locale → key → text.
 */
export function loadGeneratedText (): Record<string, Record<string, string>>
{
    const out: Record<string, Record<string, string>> = {};
    for (const file of listFiles(GENERATED_LOCALES_DIR, ['.json']))
    {
        const locale = path.basename(path.dirname(file));
        Object.assign(out[locale] ??= {}, JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, string>);
    }
    return out;
}

/** @brief Allowed grammar tags: locale or language family → tag → allowed values (`[]`: any value). */
export type GrammarSpec = Record<string, Record<string, string[]>>;

/** @brief A length rule of `limits.json`. */
export interface LimitRule
{
    /** Key pattern; `*` matches one key part, `**` any number of parts. */
    keys: string;
    /** A `max` value: `120px`, `12`, `2x120px`. */
    max: string;
}

/** @brief `limits.json`. */
export interface LimitsSpec
{
    /** Text used for a placeholder when measuring, by placeholder name; `*` for the others. */
    samples: Record<string, string>;
    rules: LimitRule[];
}

/**
 * @brief Read a JSON file of `content/locales`, or a default if it is missing.
 * @param name File name.
 * @param fallback Value if the file does not exist.
 */
export function readLocaleJson<T> (name: string, fallback: T): T
{
    const file = path.join(LOCALES_DIR, name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) as T : fallback;
}

/** @brief Read every keyboard layout. */
export function loadKeyboards (): KeyboardLayout[]
{
    return listFiles(path.join(LOCALES_DIR, 'keyboards'), ['.json']).map((file) => ({
        id: path.basename(file, '.json'),
        pages: (JSON.parse(fs.readFileSync(file, 'utf-8')) as Omit<KeyboardLayout, 'id'>).pages,
    }));
}

/** @brief Read every overlay file, unparsed. */
export function loadOverlayFiles (): { rel: string; raw: unknown }[]
{
    return listFiles(path.join(LOCALES_DIR, 'overlays'), ['.json']).map((file) => ({
        rel: relative(file), raw: JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown,
    }));
}

/**
 * @brief Translated graphics on disk.
 * @return Paths relative to `img/locales/`, without `.png`: `de/ui/battle/cursor_command`.
 */
export function listLocaleGraphics (): string[]
{
    return listFiles(LOCALE_IMG_DIR, ['.png']).map((file) => path.relative(LOCALE_IMG_DIR, file).split(path.sep).join('/').replace(/\.png$/, ''));
}

/**
 * @brief Size of a PNG image under `public/assets/img`.
 * @param graphic Path relative to `img/`, without `.png`.
 * @return `[width, height]`, or `null` if there is no such image.
 */
export function pngSize (graphic: string): [number, number] | null
{
    const file = path.join(IMG_DIR, `${graphic}.png`);
    if (!fs.existsSync(file)) return null;
    const header = Buffer.alloc(24);
    const fd = fs.openSync(file, 'r');
    try
    {
        fs.readSync(fd, header, 0, 24, 0);
    }
    finally
    {
        fs.closeSync(fd);
    }
    return [header.readUInt32BE(16), header.readUInt32BE(20)];
}

/** @brief The UI font, read from disk. */
export interface UiFont
{
    id: string;
    metrics: FontMetrics;
    size: number;
    letterSpacing: number;
}

/**
 * @brief Read a UI font registered in src/ui/text/fonts.ts.
 * @param id Font id. Default: the default font.
 * @return The font, or `null` if its file is missing.
 */
export function loadUiFont (id?: string): UiFont | null
{
    const font = getFont(id);
    const file = path.join(FONTS_DIR, decodeURIComponent(font.url.split('/').pop() ?? ''));
    if (!fs.existsSync(file)) return null;
    return { id: id ?? 'default', metrics: readFontMetrics(file), size: font.size, letterSpacing: font.letterSpacing };
}

/** @brief Folder of the ink stories. */
export const DIALOGUE_DIR = path.join(ROOT, 'content/dialogue');

/**
 * @brief Text keys of every ink line with an `#id:` tag (`ink.<id>`).
 * @return The keys.
 */
export function inkKeys (): Set<string>
{
    const keys = new Set<string>();
    for (const file of listFiles(DIALOGUE_DIR, ['.ink']))
    {
        for (const match of fs.readFileSync(file, 'utf-8').matchAll(/#\s*id:\s*([A-Za-z0-9_.-]+)/g)) keys.add(`ink.${match[1]}`);
    }
    return keys;
}

/** @brief What the source code uses: keys written out, and prefixes of keys built at run time. */
export interface CodeKeys
{
    keys: Set<string>;
    prefixes: Set<string>;
}

/**
 * @brief Find text keys in the source code.
 *
 * A quoted string that looks like a key (`'ui.bag.title'`) is a use; a
 * template that starts like a key (`` `battle.status.${id}` ``) makes every key
 * with that prefix used.
 *
 * @param dirs Folders to scan. Default: `src`.
 * @return Keys and prefixes.
 */
export function scanCodeKeys (dirs = [path.join(ROOT, 'src')]): CodeKeys
{
    const keys = new Set<string>();
    const prefixes = new Set<string>();
    for (const file of dirs.flatMap((dir) => listFiles(dir, ['.ts', '.tsx'])))
    {
        if (file.endsWith('.test.ts')) continue;
        const text = fs.readFileSync(file, 'utf-8');
        for (const match of text.matchAll(/['"`]([a-z][a-z0-9_]*(?:\.[A-Za-z0-9_-]+)+)['"`]/g)) keys.add(match[1]);
        for (const match of text.matchAll(/`([a-z][a-z0-9_]*(?:\.[A-Za-z0-9_-]+)*\.)\$\{/g)) prefixes.add(match[1]);
    }
    return { keys, prefixes };
}
