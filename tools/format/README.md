# clang-format

JSON, JavaScript, TypeScript and Java files are formatted with
[clang-format](https://clang.llvm.org/docs/ClangFormat.html) when they are
committed. Settings are in `.clang-format`; `.clang-format-ignore` lists
files left alone (files written by tools, build output).

clang-format comes from the `clang-format-node` dev dependency, a pinned
build for Windows, macOS and Linux, so nothing has to be installed by hand
and everyone gets the same result.

## The pre-commit hook

`npm install` points Git at `.githooks` (`git config core.hooksPath .githooks`).
Before each commit, `.githooks/pre-commit` runs
`node tools/format/clang-format.ts --staged`, which:

- formats only the **lines the commit changes** in `.js`, `.mjs`, `.cjs`,
  `.ts`, `.mts`, `.cts` and `.java` files, so untouched code keeps its layout;
- formats **whole** `.json` files (clang-format always lays out a whole JSON
  document);
- stages the result. In a file that also has unstaged changes, those are
  formatted in the working copy but stay unstaged;
- does nothing while a merge is being committed.

Skip it for one commit with `git commit --no-verify`.

`.tsx` files are not formatted: clang-format does not understand JSX in
TypeScript and breaks it.

## Formatting by hand

```bash
npm run format -- src/game/scenes/Overworld.ts content/events/sample.json
```

```bash
npm run format -- --check src/game/scenes/Overworld.ts
```

The first formats whole files in place; the second only lists the files that
are not formatted (exit code 1 when there are any).

To format only what you changed, as the hook does:

```bash
npm run format -- --changed
```

```bash
npm run format:check
```

Both compare the working copy with a base revision: `--since <rev>` if given,
else the `FORMAT_BASE` environment variable, else `HEAD` when there are
uncommitted changes, else where the branch left `origin/main`, else the
previous commit. `format:check` only lists the files that need formatting.

## CI

`.github/workflows/clang-format.yml` runs `npm run format:check` on every
push to `main` and every pull request, against the commit before the push or
the pull request's target branch. Only changed lines are checked, so code
written before clang-format was added does not fail it.

## Ignored files

`.clang-format-ignore` takes one pattern per line, like `.gitignore`: a
pattern with no slash, or only a trailing one, matches at any depth
(`node_modules/`, `package.json`); a trailing slash matches a whole folder;
any other pattern is a glob from the repository root
(`content/animations/**`).

## Known clang-format quirks

clang-format's JavaScript support predates TypeScript, so some of its output
differs from the hand-written code: no space before a function's parentheses
(`main()`), no spaces around `|` in union types (`string|null`), no spaces
inside import braces (`import {x} from`), and object literals in top-level
`const` declarations always get one property per line. These cannot be
changed in `.clang-format`.
