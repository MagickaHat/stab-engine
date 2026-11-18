/**
 * @file inkText.test.ts
 * @brief Tests of translated ink lines.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Localizer } from '../i18n/Localizer.ts';
import { GameState } from '../state/GameState.ts';
import { translateInk, translateSpeaker } from './inkText.ts';

const line = (text: string, ...tags: string[]) => ({ text, tags, tagMap: {} });

test('ink lines show their translation, with ink variables and plurals', () =>
{
    const text = new Localizer({
        'en': { 'ink.s.k.1': 'Here are {ink:potions} potions.', 'ink.speaker.professor': 'Professor' },
        'de': { 'ink.s.k.1': 'Hier {ink:potions, plural, one {ist # Trank} other {sind # Tränke}}.', 'ink.s.k.2': 'Für {player}!', 'ink.speaker.professor': 'Professorin' },
    }, 'de');
    const state = GameState.create({ name: 'Rot', language: 'de' });
    const engine = { getVariable: (name: string) => (name === 'potions' ? 1 : null) } as never;
    assert.equal(translateInk(line('Here are 1 potions.', 'id: s.k.1'), text, engine, state), 'Hier ist 1 Trank.');
    assert.equal(translateInk(line('A', 'id:s.k.1', 'id:s.k.2'), text, engine, state), 'Hier ist 1 Trank. Für Rot!', 'joined lines show both');
    assert.equal(translateInk(line('No id'), text, engine, state), null);
    assert.equal(translateInk(line('Untranslated', 'id:s.k.9'), text, engine, state), null);
    assert.equal(translateSpeaker('Professor', text), 'Professorin');
    text.locale = 'en';
    assert.equal(translateInk(line('Here are 1 potions.', 'id:s.k.1'), text, engine, state), null, 'English is ink\'s own text');
    assert.equal(translateSpeaker('Professor', text), 'Professor');
});
