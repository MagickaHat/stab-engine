/**
 * @file format.test.ts
 * @brief Tests for the clang-format pre-commit helper.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ignoreGlobs, isFormattable, parseChangedLines, parseIgnore} from './clang-format.ts';

test('parseChangedLines reads the new-file side of every hunk', () => {
    const diff = [
        'diff --git a/a.ts b/a.ts',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -3 +3 @@ x',
        '@@ -10,0 +11,4 @@',
        '@@ -20,2 +24,0 @@',
        '@@ -30,2 +30,2 @@',
    ].join('\n');
    assert.deepEqual(parseChangedLines(diff), [
        { first: 3, last: 3 },
        { first: 11, last: 14 },
        { first: 30, last: 31 },
    ]);
});

test('parseChangedLines covers a new file', () => {
    assert.deepEqual(parseChangedLines('--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,7 @@\n'), [{ first: 1, last: 7 }]);
});

test('parseIgnore skips comments and blank lines', () => {
    assert.deepEqual(parseIgnore('# comment\n\ncontent/animations/**\r\n  dist/  \n'), [
        'content/animations/**',
        'content/animations/**/**',
        '**/dist/**',
    ]);
});

test('ignoreGlobs follows .gitignore rules', () => {
    assert.deepEqual(ignoreGlobs('node_modules/'), ['**/node_modules/**']);
    assert.deepEqual(ignoreGlobs('package.json'), ['**/package.json', '**/package.json/**']);
    assert.deepEqual(
        ignoreGlobs('/content/events/schema.json'), ['content/events/schema.json', 'content/events/schema.json/**']);
});

test('isFormattable checks extensions and ignore globs', () => {
    const ignore = parseIgnore('content/animations/**\npackage-lock.json\nnode_modules/\n.cache/\n');
    assert.equal(isFormattable('src/game/main.ts', ignore), true);
    assert.equal(isFormattable('vite/plugins/ink.mjs', ignore), true);
    assert.equal(isFormattable('content/events/sample.json', ignore), true);
    assert.equal(isFormattable('android/app/src/Main.java', ignore), false);
    assert.equal(isFormattable('src/App.tsx', ignore), false);
    assert.equal(isFormattable('README.md', ignore), false);
    assert.equal(isFormattable('content/animations/moves/tackle.json', ignore), false);
    assert.equal(isFormattable('package-lock.json', ignore), false);
    assert.equal(isFormattable('node_modules/zod/package.json', ignore), false);
    assert.equal(isFormattable('tools/assets/.cache/state.json', ignore), false);
});
