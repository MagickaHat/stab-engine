/**
 * @file inkIds.ts
 * @brief `npm run locales:ink-ids`: gives every line of every ink story a
 *        stable ID, and writes the English text to `content/locales/ink/en.csv`.
 *
 * ink stories are written in English. To translate them, each line and
 * choice gets an `#id:` tag:
 *
 * @code
 * Welcome to the lab, {player_name}! # speaker: Professor #id:sample.professor.1
 * * [Potions, please. #id:sample.professor.2]
 * @endcode
 *
 * The game shows `ink.<id>` from the player's locale when it has one, else
 * ink's own English line (src/world/ink.ts). IDs are never renumbered:
 * new lines get the next free number, so translations stay attached when
 * lines move. Speakers (`# speaker: Professor`) become `ink.speaker.<id>` keys.
 *
 * In the English text, `{variable}` becomes `{ink:variable}`; other ink
 * logic (`{a: b|c}`, function calls) is kept between `\{` and `\}` for
 * reference, and translators use plurals/selects on `{ink:...}` instead.
 *
 * Options: `--check` reports lines without IDs and exits with 1, changing nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { toID } from '../../src/data/integrity.ts';
import { writeLocaleCsv } from '../../src/i18n/csv.ts';
import { isMain, listFiles } from '../events/content.ts';
import { DIALOGUE_DIR, LOCALES_DIR } from './content.ts';

/** @brief One line of English text found in a story. */
export interface InkEntry
{
    /** Key: `ink.<id>`. */
    key: string;
    text: string;
    notes: string;
}

/** @brief Result of `stampInkIds()`. */
export interface StampResult
{
    /** The story with IDs added. */
    source: string;
    /** Every line's English text, in order. */
    entries: InkEntry[];
    /** How many IDs were added. */
    added: number;
}

/** @brief Statements that are never text. */
const NOT_TEXT = /^(INCLUDE|VAR|CONST|LIST|EXTERNAL|TODO:|~|->|<-|#|\/\/|=)/;

/** @brief Index of `->` outside braces, or -1. */
function divertIndex (line: string): number
{
    let depth = 0;
    for (let i = 0; i < line.length - 1; i++)
    {
        if (line[i] === '{') depth++;
        else if (line[i] === '}') depth--;
        else if (depth === 0 && line[i] === '-' && line[i + 1] === '>') return i;
    }
    return -1;
}

/** @brief Index of the first `#` outside braces (start of tags), or -1. */
function tagIndex (line: string): number
{
    let depth = 0;
    for (let i = 0; i < line.length; i++)
    {
        if (line[i] === '\\') { i++; continue; }
        if (line[i] === '{') depth++;
        else if (line[i] === '}') depth--;
        else if (depth === 0 && line[i] === '#') return i;
    }
    return -1;
}

/** @brief Change ink text to the message syntax: `{x}` → `{ink:x}`, other logic escaped. */
export function inkToMessage (text: string): string
{
    return text.replace(/\{([^{}]*)\}/g, (_, inner: string) =>
        (/^\s*[A-Za-z_][A-Za-z0-9_]*\s*$/.test(inner) ? `{ink:${inner.trim()}}` : `\\{${inner}\\}`)).replace(/<>/g, '').trim();
}

/** @brief Tags of a line as `name: value` pairs. */
function tagsOf (part: string): Map<string, string>
{
    const tags = new Map<string, string>();
    for (const tag of part.split('#').slice(1))
    {
        const colon = tag.indexOf(':');
        if (colon > 0) tags.set(tag.slice(0, colon).trim(), tag.slice(colon + 1).trim());
        else if (tag.trim()) tags.set(tag.trim(), '');
    }
    return tags;
}

/**
 * @brief Add `#id:` tags to a story's lines.
 * @param source The `.ink` file.
 * @param story Story name (file name without `.ink`), the start of every ID.
 * @return The new source, the English entries and how many IDs were added.
 */
export function stampInkIds (source: string, story: string): StampResult
{
    const lines = source.split('\n');
    const entries: InkEntry[] = [];
    let knot = 'start';
    let depth = 0;
    let comment = false;
    let added = 0;
    const counters = new Map<string, number>();
    for (const match of source.matchAll(/#\s*id:\s*([A-Za-z0-9_.-]+)\.(\d+)\b/g))
    {
        counters.set(match[1], Math.max(counters.get(match[1]) ?? 0, Number(match[2])));
    }
    const nextId = () =>
    {
        const prefix = `${story}.${knot}`;
        const n = (counters.get(prefix) ?? 0) + 1;
        counters.set(prefix, n);
        added++;
        return `${prefix}.${n}`;
    };
    const speakers = new Map<string, string>();
    const record = (id: string, text: string, tags: Map<string, string>) =>
    {
        const message = inkToMessage(text);
        if (!message) return;
        const speaker = tags.get('speaker');
        if (speaker) speakers.set(`ink.speaker.${toID(speaker)}`, speaker);
        const logic = /\\\{/.test(message) ? 'Uses ink logic between \\{ \\}: write it with {ink:…} plural/select placeholders.' : '';
        entries.push({ key: `ink.${id}`, text: message, notes: [speaker ? `Speaker: ${speaker}` : '', `${story}.ink`, logic].filter(Boolean).join('. ') });
    };

    for (let index = 0; index < lines.length; index++)
    {
        const raw = lines[index];
        const trimmed = raw.trim();
        if (comment)
        {
            if (trimmed.includes('*/')) comment = false;
            continue;
        }
        if (trimmed.startsWith('/*'))
        {
            comment = !trimmed.includes('*/');
            continue;
        }
        const header = /^={2,}\s*(?:function\s+)?([A-Za-z0-9_]+)/.exec(trimmed);
        if (header)
        {
            knot = header[1];
            continue;
        }
        const stitch = /^=\s*([A-Za-z0-9_]+)/.exec(trimmed);
        if (stitch)
        {
            knot = `${knot.split('.')[0]}.${stitch[1]}`;
            continue;
        }
        const opens = (trimmed.match(/\{/g) ?? []).length;
        const closes = (trimmed.match(/\}/g) ?? []).length;
        if (depth > 0 || (trimmed.startsWith('{') && opens > closes))
        {
            depth += opens - closes;
            continue;
        }
        if (!trimmed || NOT_TEXT.test(trimmed)) continue;

        //  Choice and gather markers, labels and conditions in front of the text.
        const lead = /^((?:[*+]\s*)+|(?:-\s*)+(?!>))?(\([A-Za-z0-9_]+\)\s*)?((?:\{[^{}]*\}\s*)*)/.exec(trimmed)!;
        const isChoice = !!lead[1] && /[*+]/.test(lead[1]);
        const indent = raw.slice(0, raw.length - raw.trimStart().length);
        let prefix = lead[0];
        if (!isChoice && lead[3]) prefix = prefix.slice(0, prefix.length - lead[3].length);
        let body = trimmed.slice(prefix.length);
        if (!isChoice && body.startsWith('{') && lead[3] === '') prefix = lead[0];

        if (isChoice && body.includes('['))
        {
            const open = body.indexOf('[');
            const close = body.indexOf(']', open);
            if (close < 0) continue;
            const before = body.slice(0, open);
            let inside = body.slice(open + 1, close);
            let after = body.slice(close + 1);
            const insideTags = tagIndex(inside) >= 0 ? inside.slice(tagIndex(inside)) : '';
            const insideText = tagIndex(inside) >= 0 ? inside.slice(0, tagIndex(inside)) : inside;
            if ((before + insideText).trim())
            {
                let id = tagsOf(insideTags).get('id');
                if (!id)
                {
                    id = nextId();
                    inside = `${inside.trimEnd()} #id:${id}`;
                }
                record(id, before + insideText, tagsOf(insideTags));
            }
            const divert = divertIndex(after);
            const afterBody = divert >= 0 ? after.slice(0, divert) : after;
            const tagsAt = tagIndex(afterBody);
            const afterText = tagsAt >= 0 ? afterBody.slice(0, tagsAt) : afterBody;
            if ((before + afterText).trim())
            {
                const tags = tagsOf(tagsAt >= 0 ? afterBody.slice(tagsAt) : '');
                let id = tags.get('id');
                if (!id)
                {
                    id = nextId();
                    const insertAt = divert >= 0 ? divert : after.length;
                    after = `${after.slice(0, insertAt).trimEnd()} #id:${id}${divert >= 0 ? ` ${after.slice(insertAt)}` : ''}`;
                }
                record(id, before + afterText, tags);
            }
            body = `${before}[${inside}]${after}`;
        }
        else
        {
            const divert = divertIndex(body);
            const textPart = divert >= 0 ? body.slice(0, divert) : body;
            const tagsAt = tagIndex(textPart);
            const text = tagsAt >= 0 ? textPart.slice(0, tagsAt) : textPart;
            if (!text.trim()) continue;
            const tags = tagsOf(tagsAt >= 0 ? textPart.slice(tagsAt) : '');
            let id = tags.get('id');
            if (!id)
            {
                id = nextId();
                const insertAt = divert >= 0 ? divert : body.length;
                body = `${body.slice(0, insertAt).trimEnd()} #id:${id}${divert >= 0 ? ` ${body.slice(insertAt)}` : ''}`;
            }
            record(id, text, tags);
        }
        lines[index] = indent + prefix + body;
    }
    for (const [key, name] of speakers) entries.push({ key, text: name, notes: 'Speaker name shown in the name box' });
    return { source: lines.join('\n'), entries, added };
}

if (isMain(import.meta.url))
{
    const check = process.argv.includes('--check');
    const all: InkEntry[] = [];
    let missing = 0;
    for (const file of listFiles(DIALOGUE_DIR, ['.ink']))
    {
        const story = path.basename(file, '.ink');
        const source = fs.readFileSync(file, 'utf-8');
        const result = stampInkIds(source, story);
        const seen = new Set(all.map((entry) => entry.key));
        all.push(...result.entries.filter((entry) => !seen.has(entry.key)));
        if (!result.added) continue;
        missing += result.added;
        if (check) console.warn(`! content/dialogue/${story}.ink: ${result.added} line(s) without an #id: tag`);
        else
        {
            fs.writeFileSync(file, result.source);
            console.log(`content/dialogue/${story}.ink: added ${result.added} ID(s)`);
        }
    }
    if (check)
    {
        if (missing) process.exit(1);
        console.log('✓ Every ink line has an ID.');
    }
    else
    {
        const out = path.join(LOCALES_DIR, 'ink', 'en.csv');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, writeLocaleCsv(all, ['key', 'text', 'notes']));
        console.log(`✓ Wrote ${all.length} line(s) to content/locales/ink/en.csv.`);
    }
}
