/**
 * @file pixelScale.test.ts
 * @brief Tests for the pixel-perfect scale calculation. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computePixelScale } from './pixelScale.ts';

test('desktop at DPR 1 gets the largest whole scale that fits', () =>
{
    const fit = computePixelScale(0, 0, 1280, 720, 1, 256, 192);
    assert.equal(fit.deviceScale, 3);
    assert.equal(fit.cssScale, 3);
    assert.equal(fit.width, 768);
    assert.equal(fit.left, 256);
    assert.equal(fit.top, 72);
});

test('a phone at DPR 2.75 scales by whole device pixels, not whole CSS pixels', () =>
{
    //  844 × 390 CSS px landscape at DPR 2.75 → 2321 × 1072.5 device px → 5×.
    const fit = computePixelScale(0, 0, 844, 390, 2.75, 256, 192);
    assert.equal(fit.deviceScale, 5);
    assert.ok(Math.abs(fit.cssScale - 5 / 2.75) < 1e-9);
    //  Each game pixel is exactly 5 device pixels.
    assert.ok(Math.abs(fit.width * 2.75 - 256 * 5) < 1e-6);
    //  The game starts on a whole device pixel.
    assert.ok(Math.abs(fit.left * 2.75 - Math.round(fit.left * 2.75)) < 1e-9);
    assert.ok(Math.abs(fit.top * 2.75 - Math.round(fit.top * 2.75)) < 1e-9);
});

test('never smaller than 1×, even in a tiny window', () =>
{
    const fit = computePixelScale(0, 0, 100, 80, 1, 256, 192);
    assert.equal(fit.deviceScale, 1);
});

test('float noise does not lose a whole step', () =>
{
    const fit = computePixelScale(0, 0, 768 / 1.1 * 1.1, 576, 1, 256, 192);
    assert.equal(fit.deviceScale, 3);
});
