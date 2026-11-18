/**
 * @file install-hook.ts
 * @brief `npm install` runs this (the `prepare` script): points Git at the
 *        hooks in `.githooks`, so commits are formatted by clang-format.
 *
 * Does nothing outside a Git checkout (for example in a downloaded archive or
 * when the package is installed as a dependency).
 */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** @brief Repository root. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const inside = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT, encoding: 'utf-8' });
if (inside.status === 0 && path.resolve(inside.stdout.trim()) === ROOT)
{
    const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT, stdio: 'inherit' });
    if (result.status === 0) console.log('Git hooks installed (.githooks): commits are formatted with clang-format.');
}
