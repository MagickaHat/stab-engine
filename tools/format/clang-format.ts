/**
 * @file clang-format.ts
 * @brief Runs clang-format on JSON, JavaScript, TypeScript and Java files.
 *
 * Usage:
 * - `node tools/format/clang-format.ts --staged`: what the pre-commit hook
 *   runs. Formats the lines staged for the commit (whole files for JSON) and
 *   stages the result. In a file that also has unstaged changes, those are
 *   formatted in the working copy but stay unstaged.
 * - `npm run format -- <files...>`: formats whole files in place.
 * - `npm run format -- --check <files...>`: lists the files that are not
 *   formatted, without changing them. Exit code 1 when there are any.
 * - `npm run format -- --changed [--since <rev>]`: formats the lines that
 *   differ from `<rev>` in the working copy (whole files for JSON).
 * - `npm run format:check [-- --since <rev>]`: the same, but only lists the
 *   files that need it (exit code 1 when there are any). Used by CI.
 *
 * Without `--since`, `<rev>` is the `FORMAT_BASE` environment variable, else
 * where the branch left `origin/main`, else the previous commit.
 *
 * clang-format comes from the `clang-format-node` package (a pinned
 * clang-format build for Windows, macOS and Linux), so everyone formats the
 * same way. Settings are in `.clang-format`; files matching a glob in
 * `.clang-format-ignore` are skipped.
 *
 * `.tsx` files are not formatted: clang-format does not understand JSX in
 * TypeScript and breaks it.
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** @brief Git's empty tree, to compare against before the first commit. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** @brief Repository root. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @brief Extensions clang-format handles well, and whether it can format only some lines of them. */
const EXTENSIONS: Readonly<Record<string, { lines: boolean }>> = {
    '.js': { lines: true },
    '.mjs': { lines: true },
    '.cjs': { lines: true },
    '.ts': { lines: true },
    '.mts': { lines: true },
    '.cts': { lines: true },
    '.java': { lines: true },
    //  clang-format always lays out a whole JSON document, whatever `--lines` says.
    '.json': { lines: false },
};

/** @brief A 1-based, inclusive line range, as clang-format's `--lines` takes it. */
export interface LineRange {
    first: number;
    last: number;
}

/**
 * @brief Whether clang-format should format this file at all.
 * @param file Path relative to the repository root, with `/` separators.
 * @param ignore Globs from `parseIgnore()`.
 * @return True for a supported extension that no ignore glob matches.
 */
export function isFormattable(file: string, ignore: readonly string[]): boolean
{
    const ext = path.extname(file).toLowerCase();
    if (!(ext in EXTENSIONS)) return false;
    return !ignore.some((glob) => path.posix.matchesGlob(file, glob));
}

/**
 * @brief Turn one `.clang-format-ignore` pattern into globs over repository paths.
 *
 * Like `.gitignore`: a pattern with no slash, or only a trailing one, matches
 * at any depth (`node_modules/`, `package.json`); a trailing slash matches a
 * folder and everything in it; any other pattern is relative to the root.
 *
 * @param pattern One line of the ignore file.
 * @return Globs for `path.posix.matchesGlob()`.
 */
export function ignoreGlobs(pattern: string): string[]
{
    const folder = pattern.endsWith('/');
    const trimmed = pattern.replace(/\/+$/, '');
    const anchored = trimmed.includes('/');
    const base = anchored ? trimmed.replace(/^\/+/, '') : `**/${trimmed}`;
    return folder ? [`${base}/**`] : [base, `${base}/**`];
}

/**
 * @brief Read the patterns of an ignore file.
 * @param text Content of `.clang-format-ignore`.
 * @return Globs for every non-empty line (see `ignoreGlobs()`); `#` starts a comment line.
 */
export function parseIgnore(text: string): string[]
{
    return text.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
        .flatMap(ignoreGlobs);
}

/**
 * @brief Find the lines a unified diff adds or changes in the new file.
 * @param diff Output of `git diff -U0` for one file.
 * @return The changed line ranges of the new file, in order. Hunks that only remove lines add none.
 */
export function parseChangedLines(diff: string): LineRange[]
{
    const ranges: LineRange[] = [];
    for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm))
    {
        const first = Number(match[1]);
        const count = match[2] === undefined ? 1 : Number(match[2]);
        if (count > 0) ranges.push({ first, last: first + count - 1 });
    }
    return ranges;
}

/**
 * @brief Find the clang-format executable.
 * @return Absolute path of the binary shipped by `clang-format-node`.
 * @throws Error when the package is not installed.
 */
function clangFormatBinary(): string
{
    try
    {
        const require = createRequire(import.meta.url);
        return (require('clang-format-node') as { clangFormatPath: string }).clangFormatPath;
    }
    catch (error)
    {
        throw new Error(`clang-format is not installed. Run \`npm install\` first.\n${String(error)}`);
    }
}

/**
 * @brief Run a command in the repository root.
 * @param command Program to run.
 * @param args Its arguments.
 * @param input Text sent to its standard input.
 * @param allowFailure Return a non-zero exit status instead of throwing.
 * @return Its standard output and exit status.
 * @throws Error when it cannot start, or exits with an error and `allowFailure` is false.
 */
function run(command: string, args: string[], input?: string, allowFailure = false): { stdout: string; status: number }
{
    const result = spawnSync(command, args, { cwd: ROOT, input, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });
    if (result.error) throw result.error;
    const status = result.status ?? 1;
    if (status !== 0 && !allowFailure)
    {
        throw new Error(`${path.basename(command)} ${args.join(' ')} failed:\n${result.stderr}`);
    }
    return { stdout: result.stdout, status };
}

/**
 * @brief Format a file's content with clang-format.
 * @param binary clang-format executable.
 * @param file Path relative to the repository root (picks the language and `.clang-format`).
 * @param content The text to format.
 * @param lines Only format these lines; all of them when left out.
 * @return The formatted text.
 */
function format(binary: string, file: string, content: string, lines?: readonly LineRange[]): string
{
    const args = ['--style=file', `--assume-filename=${path.join(ROOT, file)}`];
    for (const range of lines ?? []) args.push(`--lines=${range.first}:${range.last}`);
    return run(binary, args, content).stdout;
}

/** @brief Read `.clang-format-ignore`. */
function loadIgnore(): string[]
{
    const file = path.join(ROOT, '.clang-format-ignore');
    return fs.existsSync(file) ? parseIgnore(fs.readFileSync(file, 'utf-8')) : [];
}

/**
 * @brief Format the lines of a working copy that differ from the last commit.
 *
 * Used for a file with unstaged changes, so after the commit the working copy
 * does not look like it undoes the formatting of the staged lines.
 *
 * @param binary clang-format executable.
 * @param file Path relative to the repository root.
 * @param byLine Format only changed lines (false: the whole file, as for JSON).
 */
function formatWorkingCopy(binary: string, file: string, byLine: boolean): void
{
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) return;
    let lines: LineRange[]|undefined;
    if (byLine)
    {
        const hasHead = run('git', ['rev-parse', '-q', '--verify', 'HEAD'], undefined, true).status === 0;
        const diff = hasHead ?
            run('git', ['diff', 'HEAD', '-U0', '--no-color', '--no-ext-diff', '--', file]).stdout :
            run('git', ['diff', '--no-index', '-U0', '--no-color', '--', '/dev/null', file], undefined, true).stdout;
        lines = parseChangedLines(diff);
        if (lines.length === 0) return;
    }
    const content = fs.readFileSync(full, 'utf-8');
    const formatted = format(binary, file, content, lines);
    if (formatted !== content) fs.writeFileSync(full, formatted);
}

/**
 * @brief Pre-commit mode: format the staged lines and stage the result.
 * @return Exit code.
 */
function formatStaged(): number
{
    //  A merge brings in other people's lines; leave them as they are.
    if (run('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], undefined, true).status === 0) return 0;

    const ignore = loadIgnore();
    const files = run('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
                      .stdout.split('\0')
                      .filter((file) => file !== '' && isFormattable(file, ignore));
    if (files.length === 0) return 0;

    const binary = clangFormatBinary();
    const changed: string[] = [];
    for (const file of files)
    {
        let lines: LineRange[]|undefined;
        if (EXTENSIONS[path.extname(file).toLowerCase()]!.lines)
        {
            lines = parseChangedLines(
                run('git', ['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--', file]).stdout);
            if (lines.length === 0) continue;
        }

        const [mode] = run('git', ['ls-files', '-s', '--', file]).stdout.split(' ');
        const staged = run('git', ['cat-file', 'blob', `:${file}`]).stdout;
        const formatted = format(binary, file, staged, lines);
        if (formatted === staged) continue;

        const clean = run('git', ['diff', '--quiet', '--', file], undefined, true).status === 0;
        const blob = run('git', ['hash-object', '-w', '--stdin', `--path=${file}`], formatted).stdout.trim();
        run('git', ['update-index', '--cacheinfo', `${mode},${blob},${file}`]);
        //  Without unstaged changes, the working copy gets the formatted file too.
        if (clean)
            run('git', ['checkout-index', '-f', '--', file]);
        else
            formatWorkingCopy(binary, file, lines !== undefined);
        changed.push(clean ? file : `${file} (unstaged changes formatted too, left unstaged)`);
    }

    if (changed.length > 0)
    {
        console.log(`clang-format reformatted ${changed.length} staged file(s):`);
        for (const file of changed) console.log(`  ${file}`);
    }
    return 0;
}

/**
 * @brief Pick the revision `--changed` compares the working copy with.
 * @param since Revision given with `--since`, if any.
 * @return A revision, or the empty tree when there is nothing to compare with.
 */
function changedBase(since: string|undefined): string
{
    const verify = (rev: string) => run('git', ['rev-parse', '-q', '--verify', `${rev}^{commit}`], undefined, true);
    for (const rev of [since, process.env.FORMAT_BASE])
    {
        //  GitHub sends all zeros as the "before" of a new branch.
        if (rev && !/^0+$/.test(rev)) return rev;
    }
    const head = verify('HEAD');
    if (head.status !== 0) return EMPTY_TREE;
    //  Uncommitted changes: check those.
    if (run('git', ['diff', '--quiet', 'HEAD'], undefined, true).status !== 0) return 'HEAD';
    if (verify('origin/main').status === 0)
    {
        const fork = run('git', ['merge-base', 'HEAD', 'origin/main'], undefined, true);
        if (fork.status === 0 && fork.stdout.trim() !== head.stdout.trim()) return fork.stdout.trim();
    }
    return verify('HEAD~1').status === 0 ? 'HEAD~1' : EMPTY_TREE;
}

/**
 * @brief Format the lines of the working copy that differ from a revision, or list the files that need it.
 * @param since Revision given with `--since`, if any.
 * @param check Only report, do not write.
 * @return Exit code.
 */
function formatChanged(since: string|undefined, check: boolean): number
{
    const base = changedBase(since);
    console.log(`Checking the lines changed since ${base}.`);
    const ignore = loadIgnore();
    const files = run('git', ['diff', '--name-only', '--diff-filter=ACMR', '-z', base])
                      .stdout.split('\0')
                      .filter((file) => file !== '' && isFormattable(file, ignore));
    if (files.length === 0) return 0;

    const binary = clangFormatBinary();
    let unformatted = 0;
    for (const file of files)
    {
        let lines: LineRange[]|undefined;
        if (EXTENSIONS[path.extname(file).toLowerCase()]!.lines)
        {
            lines =
                parseChangedLines(run('git', ['diff', '-U0', '--no-color', '--no-ext-diff', base, '--', file]).stdout);
            if (lines.length === 0) continue;
        }
        const full = path.join(ROOT, file);
        const content = fs.readFileSync(full, 'utf-8');
        const formatted = format(binary, file, content, lines);
        if (formatted === content) continue;
        unformatted++;
        if (check)
            console.log(`Not formatted: ${file}`);
        else
        {
            fs.writeFileSync(full, formatted);
            console.log(`Formatted: ${file}`);
        }
    }
    if (check && unformatted > 0)
    {
        console.log(`\n${unformatted} file(s) need formatting. Run \`npm run format -- --changed --since ${
            base}\` and commit the result.`);
        return 1;
    }
    return 0;
}

/**
 * @brief Format whole files, or list those that need it.
 * @param files Paths given on the command line.
 * @param check Only report, do not write.
 * @return Exit code.
 */
function formatFiles(files: readonly string[], check: boolean): number
{
    const ignore = loadIgnore();
    const binary = clangFormatBinary();
    let unformatted = 0;
    for (const given of files)
    {
        const file = path.relative(ROOT, path.resolve(given)).split(path.sep).join('/');
        if (!isFormattable(file, ignore)) continue;
        const content = fs.readFileSync(path.join(ROOT, file), 'utf-8');
        const formatted = format(binary, file, content);
        if (formatted === content) continue;
        unformatted++;
        if (check)
            console.log(`Not formatted: ${file}`);
        else
        {
            fs.writeFileSync(path.join(ROOT, file), formatted);
            console.log(`Formatted: ${file}`);
        }
    }
    return check && unformatted > 0 ? 1 : 0;
}

/**
 * @brief Command-line entry point.
 * @param args Arguments after the script name.
 * @return Exit code.
 */
function main(args: readonly string[]): number
{
    if (args.includes('--staged')) return formatStaged();
    const check = args.includes('--check');
    const sinceAt = args.indexOf('--since');
    const since = sinceAt >= 0 ? args[sinceAt + 1] : undefined;
    if (args.includes('--changed')) return formatChanged(since, check);
    const files = args.filter((arg, i) => !arg.startsWith('--') && (sinceAt < 0 || i !== sinceAt + 1));
    if (files.length === 0)
    {
        console.error(
            'Usage: node tools/format/clang-format.ts --staged | [--check] --changed [--since <rev>] | [--check] <files...>');
        return 2;
    }
    return formatFiles(files, check);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
    try
    {
        process.exitCode = main(process.argv.slice(2));
    }
    catch (error)
    {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
