/**
 * @file locales.test.ts
 * @brief Tests of the localization tools: checks, translator sheets, ink IDs and the font reader.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { readLocaleCsv, textHash } from '../../src/i18n/csv.ts';
import { checkLocales, keyMatches, worstCase } from './checks.ts';
import type { LocaleCheckInput } from './checks.ts';
import { FONTS_DIR } from './content.ts';
import type { LocaleFileInfo } from './content.ts';
import { exportSheet, importSheet, stampHashes } from './exchange.ts';
import { hasGlyph, pixelAdvance, readFontMetrics } from './font.ts';
import { inkToMessage, stampInkIds } from './inkIds.ts';

const font = readFontMetrics(path.join(FONTS_DIR, 'pokemon-frlg.woff2'));

/** @brief A locale file from CSV text. */
function file (category: string, locale: string, csv: string): LocaleFileInfo
{
    return { category, locale, rel: `content/locales/${category}/${locale}.csv`, file: readLocaleCsv(csv) };
}

/** @brief Check input with defaults for everything not given. */
function input (files: LocaleFileInfo[], extra: Partial<LocaleCheckInput> = {}): LocaleCheckInput
{
    return {
        files, generated: {}, usedKeys: new Set(), code: { keys: new Set(), prefixes: new Set() },
        grammar: { de: { gender: ['m', 'f', 'n'] } }, limits: { samples: { '*': 'WWWW' }, rules: [] },
        font: { metrics: font, size: 14, letterSpacing: 0 }, keyboards: [{ id: 'en', pages: [] }, { id: 'de', pages: [] }, { id: 'fr', pages: [] }, { id: 'it', pages: [] }, { id: 'es', pages: [] }, { id: 'pt', pages: [] }],
        overlays: [], localeGraphics: [], imageSize: () => [100, 100], ...extra,
    };
}

const messages = (report: ReturnType<typeof checkLocales>, level?: 'error' | 'warning') =>
    report.findings.filter((f) => !level || f.level === level).map((f) => `${f.where}: ${f.message}`).join('\n');

test('the font reader agrees with the browser\'s widths', () =>
{
    const advance = pixelAdvance(font, 14);
    assert.deepEqual([...'AWi .é'].map(advance), [6, 6, 4, 6, 5, 6], 'measured in Chromium with canvas measureText');
    assert.equal(hasGlyph(font, 'あ'), true);
    assert.equal(hasGlyph(font, '한'), false);
    assert.equal(hasGlyph(font, 'ã'), false);
});

test('checks: syntax, placeholders, grammar tags, cross-category duplicates', () =>
{
    const report = checkLocales(input([
        file('ui', 'en', 'key,text\nui.a,Hello {player}\nui.b,"{n, plural, one {#} other {#}}"\nui.c,Broken {\nui.d,Twice\n'),
        file('battle', 'en', 'key,text\nui.d,Again\n'),
        file('ui', 'de', 'key,text,tags\nui.a,Hallo {spieler},gender=x\nui.b,"{n, plural, other {#}}",case=nom\n'),
    ], { usedKeys: new Set(['ui.a', 'ui.b', 'ui.c']) }));
    const errors = messages(report, 'error');
    assert.match(errors, /"ui\.c": "\{" is never closed/);
    assert.match(errors, /also in content\/locales\/ui\/en\.csv/);
    assert.match(errors, /placeholder \{spieler\} is not in the English text/);
    assert.match(errors, /gender=x is not allowed for de/);
    assert.match(errors, /grammar tag "case" is not declared for de/);
    assert.match(messages(report, 'warning'), /placeholder \{player\} of the English text is not used/);
});

test('checks: plural forms the locale needs, unless exact cases are used', () =>
{
    const report = checkLocales(input([
        file('ui', 'en', 'key,text\nx,"{n, plural, one {#} other {#}}"\ny,"{n, plural, =1 {a} other {b}}"\n'),
        file('ui', 'fr', 'key,text\nx,"{n, plural, one {#} other {#}}"\ny,"{n, plural, =1 {a} other {b}}"\n'),
    ], { usedKeys: new Set(['x', 'y']) }));
    const warnings = messages(report, 'warning');
    assert.match(warnings, /"x": \{n, plural\} has no many form, which fr uses/);
    assert.doesNotMatch(warnings, /"y":/);
});

test('checks: missing, sister fallback, stale, unverified, orphans and unused keys', () =>
{
    const hash = textHash('Run');
    const report = checkLocales(input([
        file('ui', 'en', 'key,text\nui.run,Run\nui.bag,Bag\nui.old,Old\nui.dyn.a,A\n'),
        file('ui', 'es-es', `key,text,hash\nui.run,Huir,${hash}\nui.bag,Mochila,00000000\nui.gone,Ya no\n`),
        file('ui', 'es-mx', 'key,text\n'),
    ], { usedKeys: new Set(['ui.run', 'ui.bag']), code: { keys: new Set(), prefixes: new Set(['ui.dyn.']) } }));
    const es = report.stats.find((stat) => stat.locale === 'es-es')!;
    assert.deepEqual(es.stale, ['ui.bag']);
    assert.deepEqual(es.orphans, ['ui.gone']);
    assert.deepEqual(es.missing, ['ui.old', 'ui.dyn.a']);
    const mx = report.stats.find((stat) => stat.locale === 'es-mx')!;
    assert.deepEqual(mx.fromSister, ['ui.run', 'ui.bag'], 'es-mx shows es-es text');
    assert.deepEqual(report.unused, ['ui.old'], 'keys built at run time (`ui.dyn.${x}`) count as used');
    assert.match(messages(report), /1 stale translation\(s\)/);
});

test('checks: length limits in pixels, characters and lines, and the font', () =>
{
    const report = checkLocales(input([
        file('ui', 'en', 'key,text,max\nui.ok,OK,20px\nui.name,Name,4\nui.msg,Short,2x60px\n'),
        file('ui', 'de', 'key,text\nui.ok,Bestätigen\nui.name,Namen\nui.msg,Ein sehr langer Satz der nicht in zwei Zeilen passt\n'),
        file('ui', 'pt-br', 'key,text\nui.ok,Não\n'),
    ], { usedKeys: new Set(['ui.ok', 'ui.name', 'ui.msg']) }));
    const warnings = messages(report, 'warning');
    assert.match(warnings, /de "ui\.ok" can be \d+px wide; the limit is 20px/);
    assert.match(warnings, /de "ui\.name" can be 5 characters; the limit is 4/);
    assert.match(warnings, /de "ui\.msg" can need \d+ lines of 60px; the limit is 2/);
    assert.match(warnings, /pt-br: the UI font cannot draw 1 character\(s\): "ã"/);
    assert.equal(worstCase('{n, plural, one {a} other {bbbb}} {x}', { '*': 'WW' }), 'bbbb WW');
    assert.ok(keyMatches('ui.keyboard.*', 'ui.keyboard.ok'));
    assert.ok(!keyMatches('ui.keyboard.*', 'ui.keyboard.ok.x'));
    assert.ok(keyMatches('ink.**', 'ink.a.b.c'));
});

test('checks: keyboards, overlays and translated graphics', () =>
{
    const report = checkLocales(input([file('ui', 'en', 'key,text\nui.tab,TAB\nui.title,TITLE\n')], {
        keyboards: [{ id: 'en', pages: [{ label: 'ui.tab', rows: ['AB#'] }, { label: 'ui.nope', rows: [] }] }],
        overlays: [
            { rel: 'o1.json', raw: { graphic: 'ui/card', text: [{ key: 'ui.title', x: 0, y: 0, width: 10, color: '#fff' }] } },
            { rel: 'o2.json', raw: { graphic: 'ui/missing', text: [{ key: 'ui.title', x: 0, y: 0, width: 10, color: '#fff' }] } },
            { rel: 'o3.json', raw: { graphic: 'ui/other', text: [{ key: 'ui.none', x: 95, y: 0, width: 10, color: '#fff' }] } },
        ],
        localeGraphics: ['de/ui/card', 'de/ui/ghost'],
        imageSize: (graphic) => ({ 'ui/card': [100, 50], 'ui/other': [100, 50], 'locales/de/ui/card': [90, 50] } as Record<string, [number, number]>)[graphic] ?? null,
    }));
    const all = messages(report);
    assert.match(all, /page 1 label "ui\.nope" is not in any/);
    assert.match(all, /the UI font cannot draw #/);
    assert.match(all, /no "de\.json" keyboard for de/);
    assert.match(all, /o1\.json: en "ui\.title" is \d+px wide but its space is 10px/);
    assert.match(all, /o2\.json: graphic "ui\/missing" is not in public\/assets\/img/);
    assert.match(all, /o3\.json: a box at 95,0 lies outside/);
    assert.match(all, /o3\.json: text key "ui\.none" is not in any/);
    assert.match(all, /de\/ui\/card\.png: is 90×50 but the original is 100×50/);
    assert.match(all, /de\/ui\/ghost\.png: there is no original/);
});

test('translator sheets: export, translate, import with hashes, stamp', () =>
{
    const files = [
        file('ui', 'en', 'key,text,notes,max\nui.run,Run,Battle button,40px\nui.bag,Bag,,\n'),
        file('battle', 'en', 'key,text\nbattle.crit,A critical hit!\n'),
        file('ui', 'de', `key,text,hash\nui.run,Flucht,${textHash('Run (old)')}\n`),
    ];
    const sheet = exportSheet(files, { en: { 'items.potion.name': 'Potion' } }, { locale: 'de', todo: true, data: true });
    const rows = readLocaleCsv(sheet.replace(/^key,category,english/, 'key,category,english')).rows;
    assert.deepEqual(rows.map((row) => row.key), ['ui.run', 'ui.bag', 'battle.crit', 'items.potion.name']);
    assert.match(sheet, /ui\.run,ui,Run,Battle button,40px,stale,Flucht/);

    const filled = sheet.replace('ui.bag,ui,Bag,,,missing,,,', 'ui.bag,ui,Bag,,,missing,Beutel,gender=m,Tasche?')
        .replace('battle.crit,battle,A critical hit!,,,missing,,,', 'battle.crit,battle,A critical hit!,,,missing,Volltreffer!,,')
        .replace('items.potion.name,items,Potion,,,missing,,,', 'items.potion.name,items,Potion,,,missing,Trank,,')
        + 'ui.unknown,ui,,,,,Was?,,\n';
    const result = importSheet(filled, files, { en: { 'items.potion.name': 'Potion' } }, 'de');
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.unknown, ['ui.unknown']);
    assert.equal(result.added, 3);
    assert.equal(result.updated, 1, 'Flucht gets the current hash');
    const ui = readLocaleCsv(result.files.get('ui')!).rows;
    assert.deepEqual(ui.map((row) => [row.key, row.text, row.hash, row.tags ?? '', row.notes ?? '']), [
        ['ui.run', 'Flucht', textHash('Run'), '', ''],
        ['ui.bag', 'Beutel', textHash('Bag'), 'gender=m', 'Tasche?'],
    ]);
    assert.equal(readLocaleCsv(result.files.get('items')!).rows[0].text, 'Trank');
    assert.equal(readLocaleCsv(result.files.get('battle')!).rows[0].hash, textHash('A critical hit!'));

    const stamped = stampHashes([...files, file('battle', 'de', 'key,text\nbattle.crit,Volltreffer!\n')], 'de');
    assert.equal(stamped.stamped, 1);
    assert.equal(readLocaleCsv(stamped.files.get('battle')!).rows[0].hash, textHash('A critical hit!'));
});

test('ink IDs: lines, choices and diverts get stable IDs; existing ones are kept', () =>
{
    const source = [
        '=== lab ===', 'Hi {name}! # speaker: Oak', '* [Yes please #id:s.lab.7] Great.', '* No thanks -> bye',
        '~ x = 1', '{ x > 0:', '    Hidden branch', '}', '- Done. -> END', '= bye', 'Bye!', '// comment', 'VAR a = 1',
    ].join('\n');
    const result = stampInkIds(source, 's');
    assert.equal(result.source, [
        '=== lab ===', 'Hi {name}! # speaker: Oak #id:s.lab.8', '* [Yes please #id:s.lab.7] Great. #id:s.lab.9',
        '* No thanks #id:s.lab.10 -> bye', '~ x = 1', '{ x > 0:', '    Hidden branch', '}', '- Done. #id:s.lab.11 -> END',
        '= bye', 'Bye! #id:s.lab.bye.1', '// comment', 'VAR a = 1',
    ].join('\n'));
    assert.equal(result.added, 5);
    assert.deepEqual(result.entries.map((entry) => [entry.key, entry.text]), [
        ['ink.s.lab.8', 'Hi {ink:name}!'], ['ink.s.lab.7', 'Yes please'], ['ink.s.lab.9', 'Great.'], ['ink.s.lab.10', 'No thanks'],
        ['ink.s.lab.11', 'Done.'], ['ink.s.lab.bye.1', 'Bye!'], ['ink.speaker.oak', 'Oak'],
    ]);
    assert.equal(stampInkIds(result.source, 's').added, 0, 'running again changes nothing');
    assert.equal(inkToMessage('You have {n} {plural("x", n)}'), 'You have {ink:n} \\{plural("x", n)\\}');
});
