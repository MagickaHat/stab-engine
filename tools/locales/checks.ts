/**
 * @file checks.ts
 * @brief Every localization check, as pure functions over loaded content.
 *
 * `checkLocales()` takes everything already read (see content.ts), so tests
 * can run it on small made-up inputs. It returns findings and a report:
 *
 * | Check                | Level   | What                                                                          |
 * |----------------------|---------|-------------------------------------------------------------------------------|
 * | CSV syntax           | error   | Unclosed quotes, duplicate keys in a file or across categories of a locale.   |
 * | Message syntax       | error   | Unbalanced braces, plural/select without `other`.                             |
 * | Placeholders         | error / warning | A translation uses a placeholder English does not have / leaves one out. |
 * | Plural forms         | warning | A plural lacks a form the locale needs (`many` in French...).                 |
 * | Grammar tags         | error   | A `tags` value or `@tag` not declared in `grammar.json` for the locale.       |
 * | Length               | warning | Text wider/longer than its `max` column or `limits.json` rule.                |
 * | Font                 | warning | Characters the UI font cannot draw.                                           |
 * | Missing              | warning | English keys with no translation along the locale's chain.                    |
 * | Stale                | warning | Translations whose `hash` no longer matches the English text.                 |
 * | Unused               | warning | English keys nothing uses; translations of keys English does not have.        |
 * | Keyboards, overlays, graphics | error / warning | Layout glyphs, overlay keys/graphics/fit, translated image sizes. |
 */
import type { CsvIssue, LocaleRow } from '../../src/i18n/csv.ts';
import { parseLimit, parseTags, textHash } from '../../src/i18n/csv.ts';
import { fallbackChain, isUiLocale, languageInfo, LANGUAGES, UI_LOCALES } from '../../src/i18n/languages.ts';
import { inspectMessage, parseMessage, pluralCategories } from '../../src/i18n/message.ts';
import type { MessageNode } from '../../src/i18n/message.ts';
import type { KeyboardLayout } from '../../src/i18n/nickname.ts';
import { keyboardCharacters } from '../../src/i18n/nickname.ts';
import { placeOverlay, TextOverlay } from '../../src/i18n/overlays.ts';
import { wrapText } from '../../src/ui/text/layout.ts';
import type { GrammarSpec, LimitsSpec, LocaleFileInfo } from './content.ts';
import { hasGlyph, pixelAdvance } from './font.ts';
import type { FontMetrics } from './font.ts';

/** @brief One finding. */
export interface LocaleFinding
{
    level: 'error' | 'warning';
    /** Where: a file and line, a locale, a key. */
    where: string;
    message: string;
}

/** @brief Everything the checks need. */
export interface LocaleCheckInput
{
    files: LocaleFileInfo[];
    /** Generated PokeAPI text: locale → key → text. */
    generated: Record<string, Record<string, string>>;
    /** Keys the content and engine use (events, maps, ink, overlays...). */
    usedKeys: Set<string>;
    /** Keys and key prefixes found in source code. */
    code: { keys: Set<string>; prefixes: Set<string> };
    grammar: GrammarSpec;
    limits: LimitsSpec;
    /** The UI font; `null` skips width and glyph checks. */
    font: { metrics: FontMetrics; size: number; letterSpacing: number } | null;
    keyboards: KeyboardLayout[];
    overlays: { rel: string; raw: unknown }[];
    /** Translated graphics: paths under `img/locales/` without `.png`. */
    localeGraphics: string[];
    /** Size of an image under `img/` (path without `.png`), or `null` if missing. */
    imageSize: (graphic: string) => [number, number] | null;
}

/** @brief How complete one locale is. */
export interface LocaleStats
{
    locale: string;
    /** English keys from CSV files. */
    total: number;
    /** Translated in this locale's own files. */
    translated: number;
    /** Not translated here, but shown from a sister locale (`es-mx` → `es-es`). */
    fromSister: string[];
    /** Shown in English. */
    missing: string[];
    /** Translated, but English changed since. */
    stale: string[];
    /** Translated without a `hash`: cannot tell whether it is current. */
    unverified: string[];
    /** Keys in this locale's files that English does not have. */
    orphans: string[];
}

/** @brief Result of `checkLocales()`. */
export interface LocaleReport
{
    findings: LocaleFinding[];
    stats: LocaleStats[];
    /** English CSV keys nothing uses. */
    unused: string[];
}

/** @brief A row with the file it came from. */
interface Entry
{
    row: LocaleRow;
    info: LocaleFileInfo;
}

/** @brief `file:line`. */
function at (entry: Entry): string
{
    return `${entry.info.rel}:${entry.row.line}`;
}

/** @brief Whether a key matches a `limits.json` pattern (`*` one part, `**` any). */
export function keyMatches (pattern: string, key: string): boolean
{
    const regex = new RegExp(`^${pattern.split('.').map((part) => (part === '**' ? '.+' : part === '*' ? '[^.]+' : part.replace(/[-/\\^$+?()|[\]{}]/g, '\\$&'))).join('\\.')}$`);
    return regex.test(key);
}

/** @brief The longest text a message can turn into, with sample values for placeholders. */
export function worstCase (source: string, samples: Record<string, string>): string
{
    const sample = (name: string) => samples[name] ?? samples[name.split(':')[0]] ?? samples['*'] ?? 'WWWW';
    const longest = (nodes: readonly MessageNode[]): string => nodes.map((node) =>
    {
        if (typeof node === 'string') return node;
        if (node.type === 'pound') return samples['#'] ?? '99';
        if (node.type === 'arg') return sample(node.name);
        const options = Object.values(node.cases).map(longest);
        return options.reduce((best, option) => (option.length > best.length ? option : best), '');
    }).join('');
    return longest(parseMessage(source));
}

/** @brief Allowed grammar tags of a locale: its own entry merged over its language family's. */
function grammarFor (grammar: GrammarSpec, locale: string): Record<string, string[]>
{
    return { ...grammar[languageInfo(locale).family], ...grammar[locale] };
}

/**
 * @brief Run every localization check.
 * @param input Loaded content.
 * @return Findings (errors first) and the coverage report.
 */
export function checkLocales (input: LocaleCheckInput): LocaleReport
{
    const findings: LocaleFinding[] = [];
    const error = (where: string, message: string) => findings.push({ level: 'error', where, message });
    const warn = (where: string, message: string) => findings.push({ level: 'warning', where, message });
    const issue = (rel: string, item: CsvIssue) => (item.severity === 'error' ? error : warn)(`${rel}:${item.line}`, item.message);

    // ------------------------------------------------------------ Files and keys
    const byLocale = new Map<string, Map<string, Entry>>();
    for (const info of input.files)
    {
        for (const item of info.file.issues) issue(info.rel, item);
        if (!isUiLocale(info.locale)) warn(info.rel, `"${info.locale}" is not a UI locale (${UI_LOCALES.join(', ')}); the game never loads it`);
        let table = byLocale.get(info.locale);
        if (!table) byLocale.set(info.locale, table = new Map());
        for (const row of info.file.rows)
        {
            const previous = table.get(row.key);
            if (previous && previous.info !== info) error(`${info.rel}:${row.line}`, `key "${row.key}" is also in ${at(previous)}; keys must be unique across categories`);
            table.set(row.key, { row, info });
        }
    }
    const english = byLocale.get('en') ?? new Map<string, Entry>();
    const englishText = (key: string) => english.get(key)?.row.text ?? input.generated.en?.[key];

    // ------------------------------------------------------------ Font helpers
    const advance = input.font ? pixelAdvance(input.font.metrics, input.font.size, input.font.letterSpacing) : null;
    const width = (line: string) => [...line].reduce((sum, char) => sum + advance!(char), 0);
    const undrawable = new Map<string, Map<string, string[]>>();
    const noteGlyphs = (locale: string, key: string, text: string) =>
    {
        if (!input.font) return;
        let literal = text;
        try
        {
            literal = worstCase(text, { '*': '', '#': '' });
        }
        catch
        {
            //  Syntax errors are reported elsewhere.
        }
        for (const char of new Set(literal))
        {
            if (hasGlyph(input.font.metrics, char)) continue;
            let chars = undrawable.get(locale);
            if (!chars) undrawable.set(locale, chars = new Map());
            const keys = chars.get(char) ?? [];
            if (keys.length < 3) keys.push(key);
            chars.set(char, keys);
        }
    };

    // ------------------------------------------------------------ Limits
    const limitOf = (key: string) =>
    {
        const own = english.get(key)?.row.max;
        if (own) return parseLimit(own);
        const rule = input.limits.rules.find((candidate) => keyMatches(candidate.keys, key));
        return rule ? parseLimit(rule.max) : null;
    };
    const checkLength = (where: string, locale: string, key: string, text: string) =>
    {
        const limit = limitOf(key);
        if (!limit) return;
        let longest: string;
        try
        {
            longest = worstCase(text, input.limits.samples);
        }
        catch
        {
            return;
        }
        if (limit.chars !== undefined && [...longest].length > limit.chars)
        {
            warn(where, `${locale} "${key}" can be ${[...longest].length} characters; the limit is ${limit.chars}`);
        }
        if (limit.width !== undefined && advance)
        {
            const lines = wrapText(longest, limit.width, advance);
            const widest = Math.max(...longest.split('\n').map(width));
            if ((limit.lines ?? 1) === 1 && widest > limit.width) warn(where, `${locale} "${key}" can be ${widest}px wide; the limit is ${limit.width}px`);
            else if (limit.lines !== undefined && lines.length > limit.lines) warn(where, `${locale} "${key}" can need ${lines.length} lines of ${limit.width}px; the limit is ${limit.lines}`);
        }
    };

    // ------------------------------------------------------------ English
    for (const [key, entry] of english)
    {
        try
        {
            inspectMessage(entry.row.text);
        }
        catch (problem)
        {
            error(at(entry), `"${key}": ${(problem as Error).message}`);
            continue;
        }
        if (entry.row.max && !parseLimit(entry.row.max)) warn(at(entry), `"${key}": max "${entry.row.max}" is not understood (use 120px, 12 or 2x120px)`);
        checkGrammarTags(entry, 'en');
        //  English ink text is only a reference: the game shows ink's own line.
        if (key.startsWith('ink.') && !key.startsWith('ink.speaker.')) continue;
        checkLength(at(entry), 'en', key, entry.row.text);
        noteGlyphs('en', key, entry.row.text);
    }

    function checkGrammarTags (entry: Entry, locale: string): void
    {
        if (!entry.row.tags) return;
        const allowed = grammarFor(input.grammar, locale);
        for (const [tag, value] of Object.entries(parseTags(entry.row.tags)))
        {
            if (!(tag in allowed)) error(at(entry), `"${entry.row.key}": grammar tag "${tag}" is not declared for ${locale} in content/locales/grammar.json`);
            else if (allowed[tag].length && !allowed[tag].includes(value)) error(at(entry), `"${entry.row.key}": ${tag}=${value} is not allowed for ${locale} (${allowed[tag].join(', ')})`);
        }
    }

    // ------------------------------------------------------------ Translations
    const stats: LocaleStats[] = [];
    const csvKeys = [...english.keys()];
    for (const locale of UI_LOCALES)
    {
        if (locale === 'en') continue;
        const table = byLocale.get(locale) ?? new Map<string, Entry>();
        const stat: LocaleStats = { locale, total: csvKeys.length, translated: 0, fromSister: [], missing: [], stale: [], unverified: [], orphans: [] };
        const allowedTags = grammarFor(input.grammar, locale);
        const pluralForms = new Set(pluralCategories(locale));
        const ordinalForms = new Set(pluralCategories(locale, true));
        for (const [key, entry] of table)
        {
            const source = englishText(key);
            if (source === undefined)
            {
                stat.orphans.push(key);
                continue;
            }
            if (!entry.row.text.trim()) continue;
            let info;
            try
            {
                info = inspectMessage(entry.row.text);
            }
            catch (problem)
            {
                error(at(entry), `"${key}": ${(problem as Error).message}`);
                continue;
            }
            const sourceInfo = (() =>
            {
                try
                {
                    return inspectMessage(source);
                }
                catch
                {
                    return null;
                }
            })();
            if (sourceInfo)
            {
                for (const name of info.names)
                {
                    if (!sourceInfo.names.has(name) && !name.includes(':')) error(at(entry), `"${key}": placeholder {${name}} is not in the English text`);
                }
                for (const name of sourceInfo.names)
                {
                    if (!info.names.has(name)) warn(at(entry), `"${key}": placeholder {${name}} of the English text is not used`);
                }
            }
            for (const [name, plural] of info.plurals)
            {
                //  Exact cases (=0, =1...) mean the writer chose the numbers that matter.
                if (plural.cases.some((form) => form.startsWith('='))) continue;
                const needed = plural.ordinal ? ordinalForms : pluralForms;
                const lacking = [...needed].filter((form) => form !== 'other' && !plural.cases.includes(form));
                if (lacking.length) warn(at(entry), `"${key}": {${name}, ${plural.ordinal ? 'selectordinal' : 'plural'}} has no ${lacking.join('/')} form, which ${locale} uses`);
            }
            for (const tag of info.tags)
            {
                if (!(tag in allowedTags) && !(tag in grammarFor(input.grammar, 'en'))) warn(at(entry), `"${key}": reads grammar tag "${tag}", which no ${locale} text declares in grammar.json`);
            }
            checkGrammarTags(entry, locale);
            checkLength(at(entry), locale, key, entry.row.text);
            noteGlyphs(locale, key, entry.row.text);
            if (!english.has(key)) continue;   // a generated name overridden: not part of the CSV coverage
            stat.translated++;
            if (!entry.row.hash) stat.unverified.push(key);
            else if (entry.row.hash !== textHash(source)) stat.stale.push(key);
        }
        for (const key of csvKeys)
        {
            if (table.get(key)?.row.text.trim()) continue;
            const sister = fallbackChain(locale).slice(1).find((name) => name !== 'en' && byLocale.get(name)?.get(key)?.row.text.trim());
            if (sister) stat.fromSister.push(key);
            else stat.missing.push(key);
        }
        const list = (keys: string[]) => `${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ` and ${keys.length - 5} more` : ''}`;
        if (stat.stale.length) warn(`locale ${locale}`, `${stat.stale.length} stale translation(s) (the English text changed since): ${list(stat.stale)}`);
        if (stat.missing.length && table.size) warn(`locale ${locale}`, `${stat.missing.length} key(s) not translated (English is shown): ${list(stat.missing)}`);
        if (stat.unverified.length) warn(`locale ${locale}`, `${stat.unverified.length} translation(s) have no hash, so staleness cannot be checked (npm run locales:import stamps them): ${list(stat.unverified)}`);
        if (stat.orphans.length) warn(`locale ${locale}`, `${stat.orphans.length} key(s) are not in English (renamed or removed?): ${list(stat.orphans)}`);
        stats.push(stat);
    }
    for (const [locale, chars] of undrawable)
    {
        const detail = [...chars].map(([char, keys]) => `"${char}" (${keys.join(', ')})`).join('; ');
        warn(`locale ${locale}`, `the UI font cannot draw ${chars.size} character(s): ${detail}`);
    }

    // ------------------------------------------------------------ Unused
    const prefixes = [...input.code.prefixes];
    const unused = csvKeys.filter((key) => !input.usedKeys.has(key) && !input.code.keys.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)));
    if (unused.length) warn('locale en', `${unused.length} key(s) are not used by any event, map, ink story, overlay or source file: ${unused.slice(0, 8).join(', ')}${unused.length > 8 ? '…' : ''}`);

    // ------------------------------------------------------------ Keyboards
    const keyboardIds = new Set(input.keyboards.map((layout) => layout.id));
    for (const layout of input.keyboards)
    {
        const where = `content/locales/keyboards/${layout.id}.json`;
        layout.pages.forEach((page, p) =>
        {
            if (!englishText(page.label)) error(where, `page ${p} label "${page.label}" is not in any content/locales/*/en.csv`);
            page.rows.forEach((row, r) => { if ([...row].length > 10) warn(where, `page ${p} row ${r} has ${[...row].length} keys; the keyboard shows 10`); });
        });
        if (input.font)
        {
            const missing = [...keyboardCharacters(layout)].filter((char) => !hasGlyph(input.font!.metrics, char));
            if (missing.length) warn(where, `the UI font cannot draw ${missing.join(' ')}; those keys cannot be typed`);
        }
    }
    for (const info of Object.values(LANGUAGES))
    {
        if (info.ui && !keyboardIds.has(info.keyboard)) error('content/locales/keyboards', `no "${info.keyboard}.json" keyboard for ${info.id}`);
    }

    // ------------------------------------------------------------ Overlays
    const overlayGraphics = new Map<string, string>();
    for (const { rel, raw } of input.overlays)
    {
        const parsed = TextOverlay.safeParse(raw);
        if (!parsed.success)
        {
            for (const problem of parsed.error.issues) error(rel, `${problem.path.join('.') || '(root)'}: ${problem.message}`);
            continue;
        }
        const overlay = parsed.data;
        if (overlayGraphics.has(overlay.graphic)) error(rel, `"${overlay.graphic}" already has an overlay in ${overlayGraphics.get(overlay.graphic)}`);
        overlayGraphics.set(overlay.graphic, rel);
        const size = input.imageSize(overlay.graphic);
        if (!size)
        {
            error(rel, `graphic "${overlay.graphic}" is not in public/assets/img`);
            continue;
        }
        const placed = placeOverlay(overlay);
        for (const box of [...placed.erase, ...placed.text])
        {
            const right = box.x + box.width;
            const bottom = 'height' in box ? box.y + box.height : box.y;
            if (box.x < 0 || box.y < 0 || right > size[0] || bottom > size[1]) error(rel, `a box at ${box.x},${box.y} lies outside the ${size[0]}×${size[1]} graphic`);
        }
        for (const slot of placed.text)
        {
            if (!englishText(slot.key))
            {
                error(rel, `text key "${slot.key}" is not in any content/locales/*/en.csv`);
                continue;
            }
            if (!advance) continue;
            for (const locale of UI_LOCALES)
            {
                const chain = fallbackChain(locale);
                const text = chain.map((name) => byLocale.get(name)?.get(slot.key)?.row.text).find((value) => value?.trim()) ?? englishText(slot.key)!;
                const wide = width(worstCase(text, input.limits.samples));
                if (wide > slot.width) warn(rel, `${locale} "${slot.key}" is ${wide}px wide but its space is ${slot.width}px`);
            }
        }
    }

    // ------------------------------------------------------------ Translated graphics
    for (const file of input.localeGraphics)
    {
        const slash = file.indexOf('/');
        const locale = file.slice(0, slash);
        const graphic = file.slice(slash + 1);
        const where = `public/assets/img/locales/${file}.png`;
        if (!isUiLocale(locale)) warn(where, `"${locale}" is not a UI locale`);
        const base = input.imageSize(graphic);
        const own = input.imageSize(`locales/${file}`);
        if (!base) error(where, `there is no original "img/${graphic}.png" to translate`);
        else if (own && (own[0] !== base[0] || own[1] !== base[1])) warn(where, `is ${own[0]}×${own[1]} but the original is ${base[0]}×${base[1]}`);
        if (overlayGraphics.has(graphic)) warn(where, `"${graphic}" also has a text overlay; the overlay is drawn on top of the translated image`);
    }

    findings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
    return { findings, stats, unused };
}
