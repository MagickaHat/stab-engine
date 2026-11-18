/**
 * @file nineSlice.test.ts
 * @brief Tests for windowskin planning: windows of any size, nothing ever stretched. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { centredSlice, fitWindowSize, planNineSlice } from './nineSlice.ts';
import type { DrawOp } from './nineSlice.ts';
import { getSkin, planWindow } from './skins.ts';

/**
 * @brief Counts how many times each window pixel is drawn.
 * @param ops The copies.
 * @param width Window width.
 * @param height Window height.
 * @return Draw count per pixel.
 */
function coverage (ops: DrawOp[], width: number, height: number): number[]
{
    const hits = new Array<number>(width * height).fill(0);
    for (const op of ops)
    {
        for (let y = op.dy; y < op.dy + op.h; y++) for (let x = op.dx; x < op.dx + op.w; x++) hits[y * width + x]++;
    }
    return hits;
}

test('the default slice centres an 8×8 tile', () =>
{
    assert.deepEqual(centredSlice(40, 40), { left: 16, top: 16, right: 16, bottom: 16 });
    assert.deepEqual(centredSlice(24, 24), { left: 8, top: 8, right: 8, bottom: 8 });
    assert.deepEqual(centredSlice(48, 24), { left: 20, top: 8, right: 20, bottom: 8 });
});

test('a nine-slice covers every pixel exactly once, at awkward sizes too', () =>
{
    const slice = centredSlice(40, 40);
    for (const [width, height] of [[256, 48], [37, 41], [32, 32], [101, 77]])
    {
        const ops = planNineSlice({ x: 0, y: 0, w: 40, h: 40 }, slice, width, height);
        const hits = coverage(ops, width, height);
        assert.ok(hits.every((count) => count === 1), `${width}×${height}`);
        for (const op of ops)
        {
            assert.ok(Number.isInteger(op.dx) && Number.isInteger(op.dy) && Number.isInteger(op.w) && Number.isInteger(op.h));
            //  Copies never read outside the source part they belong to.
            assert.ok(op.sx >= 0 && op.sx + op.w <= 40 && op.sy >= 0 && op.sy + op.h <= 40);
        }
    }
});

test('edges are tiled from their own part of the image, never stretched', () =>
{
    const ops = planNineSlice({ x: 0, y: 0, w: 24, h: 24 }, centredSlice(24, 24), 100, 24);
    //  Top edge: from x = 8, 8 px wide tiles, the last one cut short.
    const top = ops.filter((op) => op.dy === 0 && op.sx === 8);
    assert.deepEqual(top.map((op) => op.w), [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 4]);
});

test('windows are never smaller than their corners and always whole pixels', () =>
{
    const slice = centredSlice(40, 40);
    assert.deepEqual(fitWindowSize(slice, 10, 10.6), { width: 32, height: 32 });
    assert.deepEqual(fitWindowSize(slice, 100.4, 48), { width: 100, height: 48 });
});

test('an RPG Maker skin tiles its background inside a hollow frame', () =>
{
    const plan = planWindow(getSkin('windowskin'), 96, 64, 150, 70);
    const hits = coverage(plan.ops, plan.width, plan.height);
    //  Every pixel is drawn at least once (background or frame), and the background never leaves its inset.
    assert.ok(hits.every((count) => count >= 1));
    const background = plan.ops.filter((op) => op.sx < 64 && op.sy < 64);
    assert.ok(background.every((op) => op.dx >= 1 && op.dy >= 1 && op.dx + op.w <= 149 && op.dy + op.h <= 69));
});

test('built-in skins exist for the default UI', () =>
{
    assert.equal(getSkin('speech_frlg').format, 'frame');
    assert.equal(getSkin('choice_1').format, 'frame');
    assert.throws(() => getSkin('no_such_skin'), /Unknown windowskin/);
});
