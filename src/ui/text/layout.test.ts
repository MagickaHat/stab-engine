/**
 * @file layout.test.ts
 * @brief Tests for pixel text wrapping and paging. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageLength, paginate, textWidth, wrapText } from './layout.ts';

/** @brief Every character is 6 px wide, a space 4 px. */
const advance = (char: string) => (char === ' ' ? 4 : 6);

test('text width adds up whole-pixel advances', () =>
{
    assert.equal(textWidth('ab c', advance), 6 + 6 + 4 + 6);
});

test('lines break at spaces and never exceed the width', () =>
{
    const lines = wrapText('Hello there! Welcome to the world of POKéMON!', 80, advance);
    assert.deepEqual(lines, ['Hello there!', 'Welcome to the', 'world of', 'POKéMON!']);
    for (const line of lines) assert.ok(textWidth(line, advance) <= 80);
});

test('newlines always start a new line, and blank lines are kept', () =>
{
    assert.deepEqual(wrapText('A\n\nB', 100, advance), ['A', '', 'B']);
});

test('a word longer than a line is broken between letters', () =>
{
    assert.deepEqual(wrapText('ABCDEFGHIJ', 30, advance), ['ABCDE', 'FGHIJ']);
});

test('pages hold a fixed number of lines', () =>
{
    assert.deepEqual(paginate(['1', '2', '3'], 2), [['1', '2'], ['3']]);
    assert.deepEqual(paginate([], 2), [[]]);
    assert.equal(pageLength(['ab', 'c d']), 5);
});
