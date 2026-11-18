/**
 * @file i18n.test.ts
 * @brief Tests of the localization core: languages, CSV, messages, localizer, Masuda and names.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    buildLocaleGraphicsMap, canNickname, eggShinyRolls, fallbackChain, formatMessage, inspectMessage, isMasuda,
    keyboardCharacters, keyboardFor, localizedGraphic, Localizer, matchDeviceLocale, nicknameRules, parseLimit,
    parseMessage, parseTags, placeOverlay, readLocaleCsv, rollShiny, sameLanguageFamily, sanitizeName, TextOverlay,
    textHash, writeLocaleCsv,
} from './index.ts';

test('fallback chains go to the sister locale, then English', () =>
{
    assert.deepEqual(fallbackChain('es-mx'), ['es-mx', 'es-es', 'en']);
    assert.deepEqual(fallbackChain('pt-pt'), ['pt-pt', 'pt-br', 'en']);
    assert.deepEqual(fallbackChain('de'), ['de', 'en']);
    assert.deepEqual(fallbackChain('en'), ['en']);
    assert.deepEqual(fallbackChain('xx'), ['xx', 'en']);
});

test('device languages pick the closest UI locale', () =>
{
    assert.equal(matchDeviceLocale(['de-AT', 'en']), 'de');
    assert.equal(matchDeviceLocale(['es-AR']), 'es-mx');
    assert.equal(matchDeviceLocale(['es-419']), 'es-mx');
    assert.equal(matchDeviceLocale(['es']), 'es-es');
    assert.equal(matchDeviceLocale(['pt-BR']), 'pt-br');
    assert.equal(matchDeviceLocale(['pt']), 'pt-pt');
    assert.equal(matchDeviceLocale(['ja-JP', 'it-IT']), 'it');
    assert.equal(matchDeviceLocale(['ja-JP']), 'en');
});

test('Masuda method: dialects of one language are the same language', () =>
{
    assert.ok(sameLanguageFamily('es-es', 'es-mx'));
    assert.ok(sameLanguageFamily('pt-br', 'pt-pt'));
    assert.equal(isMasuda('es-es', 'es-mx'), false);
    assert.equal(isMasuda('pt-pt', 'pt-br'), false);
    assert.equal(isMasuda('en', 'ja'), true);
    assert.equal(isMasuda('zh-hans', 'zh-hant'), true, 'Simplified and Traditional Chinese count as different, as in the official games');
    assert.equal(eggShinyRolls('en', 'en'), 1);
    assert.equal(eggShinyRolls('en', 'ja'), 6);
    assert.equal(eggShinyRolls('en', 'ja', { shinyCharm: true }), 8);
    assert.equal(rollShiny(6, () => 0), true);
    assert.equal(rollShiny(6, () => 0.5), false);
});

test('locale CSV: optional columns, duplicates, unclosed quotes, round trip', () =>
{
    const file = readLocaleCsv('﻿key,text,notes,max,tags,hash,extra\na,"Hi, ""you""",who,12,gender=f; elision,abc,\nb,x\na,again\nc,"never closed\n');
    assert.deepEqual(file.rows.map((row) => row.key), ['a', 'b', 'c']);
    assert.equal(file.rows[0].text, 'again', 'the later duplicate wins');
    assert.ok(file.issues.some((issue) => issue.severity === 'error' && /duplicate key "a"/.test(issue.message)));
    assert.ok(file.issues.some((issue) => /never closed/.test(issue.message)));
    assert.ok(file.issues.some((issue) => /unknown column "extra"/.test(issue.message)));
    const first = readLocaleCsv('key,text,notes,max,tags,hash\na,"Hi, ""you""",who,12,gender=f,abc\n').rows[0];
    assert.deepEqual({ ...first, line: 0 }, { key: 'a', text: 'Hi, "you"', notes: 'who', max: '12', tags: 'gender=f', hash: 'abc', line: 0 });
    const again = readLocaleCsv(writeLocaleCsv([first])).rows[0];
    assert.equal(again.text, first.text);
    assert.deepEqual(parseTags('gender=f; elision'), { gender: 'f', elision: 'true' });
    assert.deepEqual(parseLimit('2x120px'), { lines: 2, width: 120 });
    assert.deepEqual(parseLimit('120px'), { width: 120, lines: 1 });
    assert.deepEqual(parseLimit('12'), { chars: 12 });
    assert.equal(textHash('a\r\nb'), textHash('a\nb'));
    assert.notEqual(textHash('a'), textHash('b'));
});

test('messages: plurals per locale, exact cases, ordinals and numbers', () =>
{
    const potions = '{n, plural, =0 {no Potions} one {# Potion} other {# Potions}}';
    assert.equal(formatMessage(potions, 'en', () => 0), 'no Potions');
    assert.equal(formatMessage(potions, 'en', () => 1), '1 Potion');
    assert.equal(formatMessage(potions, 'en', () => 1234), '1,234 Potions');
    assert.equal(formatMessage(potions, 'de', () => 1234), '1.234 Potions');
    assert.equal(formatMessage('{n, plural, one {# Potion} many {# de Potions} other {# Potions}}', 'fr', () => 1000000), `${new Intl.NumberFormat('fr-FR').format(1000000)} de Potions`);
    assert.equal(formatMessage('{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}', 'en', () => 23), '23rd');
    assert.equal(formatMessage('{h, number} m', 'de', () => 0.7), '0,7 m');
    assert.equal(formatMessage('{p, number, percent}', 'en', () => 0.5), '50%');
    assert.equal(formatMessage('Hello \\{literal\\} {who}', 'en', (name) => (name === 'who' ? 'you' : undefined)), 'Hello {literal} you');
    assert.equal(formatMessage('{unknown} stays', 'en', () => undefined), '{unknown} stays');
    assert.equal(formatMessage('{broken', 'en', () => 'x'), '{broken', 'malformed text is shown as written');
    assert.throws(() => parseMessage('{n, plural, one {x}}'), /other/);
    const info = inspectMessage('{a} {b@gender, select, f {x} other {y}} {c, plural, one {#} other {#}}');
    assert.deepEqual([...info.names].sort(), ['a', 'b', 'c']);
    assert.deepEqual([...info.tags], ['gender']);
});

test('messages: selects on values and on grammar tags', () =>
{
    const stat = '{stat@article, select, elided {L\'{stat}} f {La {stat}} other {Le {stat}}} de {who}';
    const values: Record<string, unknown> = { who: 'Pikachu' };
    values.stat = { text: 'Attaque', tags: { article: 'elided' } };
    assert.equal(formatMessage(stat, 'fr', (name) => values[name] as never), "L'Attaque de Pikachu");
    values.stat = { text: 'Défense', tags: { article: 'f' } };
    assert.equal(formatMessage(stat, 'fr', (name) => values[name] as never), 'La Défense de Pikachu');
    values.stat = { text: 'Truc', tags: {} };
    assert.equal(formatMessage(stat, 'fr', (name) => values[name] as never), 'Le Truc de Pikachu');
    assert.equal(formatMessage('{side, select, foe {The opposing {p}} other {{p}}}', 'en', (name) => ({ side: 'foe', p: 'Gengar' })[name]), 'The opposing Gengar');
});

test('Localizer: sister fallback, tags, data names, hot replace and locking', () =>
{
    const text = new Localizer({
        'en': { 'a': 'English A', 'b': 'English B', 'c': 'English C', 'items.potion.name': 'Potion' },
        'es-es': { 'a': 'A de España', 'b': 'B de España', 'items.potion.name': 'Poción' },
        'es-mx': { 'a': 'A de México' },
    }, 'es-mx');
    assert.equal(text.raw('a'), 'A de México');
    assert.equal(text.raw('b'), 'B de España', 'missing in es-mx: the sister locale');
    assert.equal(text.raw('c'), 'English C');
    assert.equal(text.raw('d'), 'd');
    assert.equal(text.lookup('b')?.locale, 'es-es');
    assert.equal(text.format('{n, plural, one {# {item:potion}} other {# × {item:potion}}}' as never), '{n, plural, one {# {item:potion}} other {# × {item:potion}}}', 'format() takes keys');
    assert.equal(text.formatText('{n, plural, one {# {item:potion}} other {# × {item:potion}}}', { n: 3 }), '3 × Poción');
    assert.equal(text.formatText('{player} has {money}', {}, { player: 'Rojo', money: 12345 }), 'Rojo has 12,345');

    text.add('es-es', { 'battle.stat.def': 'Defensa' }, 'csv:battle', { 'battle.stat.def': { gender: 'f' } });
    assert.deepEqual(text.tagged('battle.stat.def'), { text: 'Defensa', tags: { gender: 'f' } });
    assert.equal(text.formatText('{s@gender, select, f {La} other {El}} {s}', { s: 'battle.stat.def' }), 'La Defensa', 'a key as a value brings its tags');

    let changes = 0;
    const stop = text.subscribe(() => changes++);
    text.replace('es-es', 'csv:battle', { 'battle.stat.atk': 'Ataque' });
    assert.equal(text.raw('battle.stat.def'), 'battle.stat.def', 'replacing a source drops the keys it no longer has');
    assert.equal(text.raw('battle.stat.atk'), 'Ataque');
    assert.equal(changes, 1);
    stop();

    text.lock();
    assert.throws(() => { text.locale = 'de'; }, /locked/);
    text.locale = 'es-mx';
    assert.equal(text.isLocked, true);
});

test('names: rules of the Pokémon\'s language, keyboard choice and the original trainer', () =>
{
    assert.equal(nicknameRules('ja').max, 6);
    assert.equal(nicknameRules('en').max, 12);
    const layout = { id: 'en', pages: [{ label: 'ui.keyboard.upper', rows: ['ABC', 'DEF  '] }] };
    assert.deepEqual([...keyboardCharacters(layout)].sort(), [' ', 'A', 'B', 'C', 'D', 'E', 'F']);
    const rules = nicknameRules('en', layout);
    assert.equal(sanitizeName('  AB  CxZ  ', rules), 'AB C');
    assert.equal(sanitizeName('ABCABCABCABCABC', { max: 12, allowed: null }), 'ABCABCABCABC');
    assert.equal(sanitizeName('ピカチュウでんき', nicknameRules('ja')), 'ピカチュウで');
    assert.equal(keyboardFor('ja', 'de', new Set(['de', 'ja'])), 'ja');
    assert.equal(keyboardFor('ko', 'de', new Set(['de', 'ja'])), 'de', 'no Korean layout: the game\'s keyboard');
    assert.equal(canNickname({ ot: { id: 7 } }, { trainerId: 7 }), true);
    assert.equal(canNickname({ ot: { id: 8 } }, { trainerId: 7 }), false);
});

test('translated graphics are decided per locale along its fallback chain', () =>
{
    const map = buildLocaleGraphicsMap(['es-es/ui/title', 'de/ui/title', 'de/ui/card'], ['en', 'de', 'es-es', 'es-mx', 'fr']);
    assert.equal(localizedGraphic(map, 'es-mx', 'ui/title'), 'locales/es-es/ui/title', 'es-mx uses the Spanish one');
    assert.equal(localizedGraphic(map, 'de', 'ui/card'), 'locales/de/ui/card');
    assert.equal(localizedGraphic(map, 'fr', 'ui/title'), 'ui/title', 'no translation: the original');
    assert.equal(map.en, undefined);
});

test('overlays repeat over cells and pick a key per row', () =>
{
    const overlay = TextOverlay.parse({
        graphic: 'ui/x', cells: { width: 10, height: 5, cols: 2, rows: 2 },
        erase: [{ x: 1, y: 1, width: 8, height: 3, fill: 'row', sampleX: 0 }],
        text: [{ keys: ['k.one', 'k.two'], x: 1, y: 0, width: 8, color: '#fff' }],
    });
    const placed = placeOverlay(overlay);
    assert.equal(placed.erase.length, 4);
    assert.deepEqual(placed.erase.map((box) => [box.x, box.y, box.sampleX]), [[1, 1, 0], [11, 1, 10], [1, 6, 0], [11, 6, 10]]);
    assert.deepEqual(placed.text.map((slot) => [slot.key, slot.x, slot.y]), [['k.one', 1, 0], ['k.one', 11, 0], ['k.two', 1, 5], ['k.two', 11, 5]]);
    assert.throws(() => TextOverlay.parse({ graphic: 'g', text: [{ x: 0, y: 0, width: 1, color: '#fff' }] }));
});
