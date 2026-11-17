/**
 * @file animations.test.ts
 * @brief Tests for the battle animation importer. Run with `npm test`.
 *
 * `fixtures/sample.rxdata` is a tiny PkmnAnimations.rxdata made by
 * `fixtures/make-sample.rb` (Ruby's own Marshal.dump).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { patternRect } from '../../src/battle/animation/format.ts';
import { convertCel, convertFrame, formatAnimation, placeAnimation } from './convert.ts';
import type { NameResolver } from './convert.ts';
import { convertFile, packResolver } from './import.ts';
import type { Report } from './import.ts';
import { RubyObject, readMarshal, rgssColor } from './marshal.ts';

const SAMPLE = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures/sample.rxdata');

/** @brief Resolver that knows every name and lower-cases it. */
const names: NameResolver = {
    graphic: (name) => ({ name: name.replace(/\.png$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '_'), found: true }),
    sound: (name) => ({ file: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.ogg`, found: true }),
};

/** @brief An empty report. */
const newReport = (): Report => ({ missingGraphics: [], missingSounds: [], unknownMoves: [], duplicates: [] });

test('marshal: integers, floats, symbols and strings as Ruby writes them', () =>
{
    // Marshal.dump([-1, -129, -70000, -2**31, 2**31, 300, -5, 1.5, :sym, "str"])
    const bytes = Buffer.from('04085b0f69fa69ff7f69fd90eefe6c2d07000000806c2b070000008069022c0169f66608312e353a0873796d492208737472063a064546', 'hex');
    assert.deepEqual(readMarshal(bytes), [-1, -129, -70000, -(2 ** 31), 2 ** 31, 300, -5, 1.5, 'sym', 'str']);
    assert.throws(() => readMarshal(Buffer.from('not marshal')), /Marshal 4.8/);
    assert.throws(() => readMarshal(Buffer.from([4, 8, 0x5b, 0x07])), /ends too early/);
});

test('marshal: Array subclasses, objects, _dump colours and repeated objects', () =>
{
    const root = readMarshal(fs.readFileSync(SAMPLE)) as RubyObject;
    assert.equal(root.className, 'PBAnimations');
    const list = root.ivars.array as RubyObject[];
    assert.equal(list.length, 4);
    assert.equal(list[1].className, 'PBAnimation');
    assert.equal(list[1].ivars.name, "Move:KING'SSHIELD");
    assert.equal(list[3], list[1], 'the same object twice is one object (a Marshal link)');
    const timing = (list[1].ivars.timing as RubyObject[])[0];
    assert.equal(timing.className, 'PBAnimTiming');
    assert.deepEqual(rgssColor(timing.ivars.flashColor), [255, 255, 255, 255]);
});

test('convert: names decide kind, ID and file', () =>
{
    assert.deepEqual(placeAnimation('Move:TACKLE'), { kind: 'move', id: 'tackle', opponent: false, path: 'moves/tackle' });
    assert.deepEqual(placeAnimation('OppMove: KING\'SSHIELD'), { kind: 'move', id: 'kingsshield', opponent: true, path: 'moves/kingsshield_opp' });
    assert.deepEqual(placeAnimation('Common:HealthUp'), { kind: 'common', id: 'healthup', opponent: false, path: 'common/healthup' });
    assert.deepEqual(placeAnimation('Barrage hit 2'), { kind: 'other', opponent: false, path: 'other/barrage_hit_2' });
    assert.equal(placeAnimation('~ Gen 1 Moves ~'), null);
    assert.equal(placeAnimation('  '), null);
});

test('convert: cels get named fields, game-pixel positions and no defaults', () =>
{
    const battler = [128, 224, 100, 0, 0, 0, 1, -1, 255, null, null, 100, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 2];
    assert.deepEqual(convertCel(battler), { x: 64, y: 112, pattern: 'user', focus: 'user', locked: true });
    const effect = [301, -20, 150, 45, 1, 2, 0, 4, 128, null, null, 90, 255, 0, 0, 100, 0, -50, 0, 0, 0, 0, 0, 0, 0, 2, 3];
    assert.deepEqual(convertCel(effect), {
        x: 150.5, y: -10, pattern: 4, focus: 'userAndTarget', zoomX: 150, zoomY: 90, angle: 45, mirror: true,
        blend: 'subtract', opacity: 128, color: [255, 0, 0, 100], tone: [0, -50, 0, 0], priority: 'behindFocus', hidden: true,
    });
    assert.equal(convertCel(null), null);
    assert.deepEqual(convertFrame([battler, null, null]), [convertCel(battler)], 'trailing empty slots dropped');
    assert.deepEqual(convertFrame([null, battler]), [null, convertCel(battler)], 'slots keep their place');
    assert.deepEqual(patternRect(7), { x: 192, y: 96, width: 96, height: 96 });
});

test('convert: a whole .rxdata file, with timings, sections and duplicate names', () =>
{
    const report = newReport();
    const skipped: string[] = [];
    const out = convertFile(SAMPLE, names, report, skipped);
    assert.deepEqual([...out.keys()], ['moves/kingsshield_dup1', 'common/burn', 'moves/kingsshield']);
    assert.deepEqual(skipped, ['#0 ~ Gen 1 Moves ~ (section divider)']);
    assert.equal(report.duplicates.length, 1);
    const shield = out.get('moves/kingsshield')!;
    assert.equal(shield.graphic, 'pras_strike');
    assert.equal(shield.hue, 20);
    assert.equal(shield.defaultFocus, 'userAndTarget');
    assert.deepEqual(shield.timings, [
        { frame: 0, type: 'background', graphic: 'black_bg', x: 5, opacity: 0 },
        { frame: 1, type: 'sound', sound: 'hit_sound.ogg', volume: 80 },
        { frame: 2, type: 'backgroundMove', duration: 8, opacity: 255, color: [0, null, null, null] },
    ]);
    assert.equal(shield.frames.length, 2);
    assert.deepEqual(shield.frames[1][2], {
        x: 150, y: -10, pattern: 4, focus: 'userAndTarget', zoomX: 150, angle: 45, blend: 'add', opacity: 128,
        color: [255, 0, 0, 100], priority: 'behindFocus', locked: true,
    });
    // The file is valid JSON and reads back to the same animation.
    const { $schema, ...parsed } = JSON.parse(formatAnimation(shield, '../schema.json')) as Record<string, unknown>;
    assert.equal($schema, '../schema.json');
    assert.deepEqual(parsed, JSON.parse(JSON.stringify(shield)));
});

test('import: sheet and sound names match the asset importer, extensions are resolved', () =>
{
    const pack = fs.mkdtempSync(path.join(os.tmpdir(), 'stab-anim-'));
    try
    {
        for (const file of ['Graphics/Animations/PRAS- Strike.png', 'Graphics/Animations/!.png', 'Audio/SE/Anim/PRSFX- King\'s Shield1.wav',
            'Audio/SE/Anim/Acupressure.mp3', 'Audio/SE/Anim/Acupressure.ogg', 'Audio/SE/Anim/LOUD.WAV'])
        {
            fs.mkdirSync(path.dirname(path.join(pack, file)), { recursive: true });
            fs.writeFileSync(path.join(pack, file), '');
        }
        const resolve = packResolver([pack]);
        assert.deepEqual(resolve.graphic('PRAS- Strike.png'), { name: 'pras_strike', found: true });
        assert.deepEqual(resolve.graphic('pras- strike'), { name: 'pras_strike', found: true });
        assert.deepEqual(resolve.graphic('!'), { name: 'exclamation', found: true });
        assert.deepEqual(resolve.graphic('Missing.png'), { name: 'missing', found: false });
        assert.deepEqual(resolve.sound("PRSFX- King's Shield1.wav"), { file: 'prsfx_kings_shield1.wav', found: true });
        assert.deepEqual(resolve.sound('Acupressure'), { file: 'acupressure.ogg', found: true }, 'no extension: .ogg preferred');
        assert.deepEqual(resolve.sound('Acupressure.mp3'), { file: 'acupressure.mp3', found: true });
        assert.deepEqual(resolve.sound('loud.wav'), { file: 'loud.wav', found: true });
        assert.deepEqual(resolve.sound('Gone.ogg'), { file: 'gone.ogg', found: false });
    }
    finally
    {
        fs.rmSync(pack, { recursive: true, force: true });
    }
});
