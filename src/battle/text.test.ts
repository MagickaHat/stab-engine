/**
 * @file text.test.ts
 * @brief Tests of translated battle text.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { parseTags, readLocaleCsv } from '../i18n/csv.ts';
import { Localizer } from '../i18n/Localizer.ts';
import { describeLine, parseLine } from './protocol.ts';
import { createBattleNarrator, decodeTextMessage, encodeTextMessage, englishMessage } from './text.ts';

/** @brief A localizer with the real battle text of some locales and a few names. */
function localizer (locale: string): Localizer
{
    const text = new Localizer({}, locale);
    for (const name of ['en', 'de', 'fr', 'es-es', 'es-mx'])
    {
        const file = readLocaleCsv(fs.readFileSync(new URL(`../../content/locales/battle/${name}.csv`, import.meta.url), 'utf-8'));
        text.add(name, Object.fromEntries(file.rows.map((row) => [row.key, row.text])), 'csv:battle',
            Object.fromEntries(file.rows.filter((row) => row.tags).map((row) => [row.key, parseTags(row.tags)])));
    }
    text.add('en', { 'pokemon.pikachu.name': 'Pikachu', 'pokemon.gengar.name': 'Gengar', 'moves.thunderbolt.name': 'Thunderbolt', 'moves.shadowball.name': 'Shadow Ball', 'abilities.static.name': 'Static' });
    text.add('de', { 'pokemon.pikachu.name': 'Pikachu', 'pokemon.gengar.name': 'Gengar', 'moves.thunderbolt.name': 'Donnerblitz', 'moves.shadowball.name': 'Spukball' });
    text.add('fr', { 'pokemon.gengar.name': 'Ectoplasma', 'moves.shadowball.name': 'Ball\'Ombre' });
    text.add('es-es', { 'moves.shadowball.name': 'Bola Sombra' });
    return text;
}

test('battle narration in the game\'s language, with nicknames kept and species translated', () =>
{
    const narrate = createBattleNarrator(localizer('de'));
    const lines = [
        '|player|p1|Red|', '|player|p2|Blau|',
        '|switch|p1a: Sparky|Pikachu, L50, M|100/100', '|switch|p2a: Gengar|Gengar, L50|100/100',
        '|move|p1a: Sparky|Thunderbolt|p2a: Gengar', '|-supereffective|p2a: Gengar',
        '|move|p2a: Gengar|Shadow Ball|p1a: Sparky', '|-unboost|p1a: Sparky|spd|2', '|faint|p2a: Gengar',
    ].map((raw) => narrate(parseLine(raw)));
    assert.deepEqual(lines, [
        null, null,
        'Los, Sparky!',
        'Blau schickt Gengar in den Kampf!',
        'Sparky setzt Donnerblitz ein!',
        'Das ist sehr effektiv!',
        'Das gegnerische Gengar setzt Spukball ein!',
        'Die Spezial-Verteidigung von Sparky sinkt stark!',
        'Das gegnerische Gengar wurde besiegt!',
    ]);
});

test('grammar tags pick articles; wild battles say "wild"; es-mx falls back to es-es', () =>
{
    const fr = createBattleNarrator(localizer('fr'), { wild: true });
    fr(parseLine('|switch|p2a: Gengar|Gengar, L5|100/100'));
    assert.equal(fr(parseLine('|-boost|p2a: Gengar|atk|1')), "L'Attaque de Ectoplasma sauvage augmente !");
    assert.equal(fr(parseLine('|-boost|p2a: Gengar|spe|3')), 'La Vitesse de Ectoplasma sauvage augmente énormément !');
    const mx = createBattleNarrator(localizer('es-mx'));
    assert.equal(mx(parseLine('|move|p1a: Pikachu|Shadow Ball|')), '¡Pikachu usó Bola Sombra!', 'es-mx has no battle.move: es-es text');
    assert.equal(mx(parseLine('|-weather|RainDance')), '¡Ha empezado a llover!');
    assert.equal(mx(parseLine('|-weather|none')), 'Ha dejado de llover.');
    assert.equal(mx(parseLine('|upkeep|')), null);
});

test('game messages travel as keys and are shown in English without a localizer', () =>
{
    const encoded = encodeTextMessage('battle.exp.gained', { pokemon: 'Sparky', exp: 1234 });
    assert.deepEqual(decodeTextMessage(encoded), { key: 'battle.exp.gained', params: { pokemon: 'Sparky', exp: '1234' } });
    assert.equal(englishMessage(encoded), 'Sparky gained 1234 Exp. Points!');
    assert.equal(describeLine(`|-message|${encoded}`), 'Sparky gained 1234 Exp. Points!');
    assert.equal(describeLine('|-message|Plain text'), 'Plain text');
    assert.equal(createBattleNarrator(localizer('de'))(parseLine(`|-message|${encoded}`)), 'Sparky erhält 1.234 E.-Punkte!');
});
