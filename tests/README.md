# Tests

| Command | What it runs |
|---------|--------------|
| `npm test` | Unit tests (`tools/**/*.test.ts`, `src/**/*.test.ts`) with Node's test runner. |
| `npm run test:desktop` | Smoke test of the production build in Chromium, Firefox and WebKit (`tests/e2e`). |
| `npm run test:android` | Smoke test of the production build in Chrome on an Android device or emulator (`tests/android`). |

Both smoke tests load the production build, wait until the first scene is
running (`announceScene()` writes its key on the canvas as `data-scene`),
press a button and fail on any uncaught page error.

## Running them locally

```bash
npm run build-nolog
npx playwright install chromium firefox webkit
npm run test:desktop
```

`test:desktop` starts `vite preview` on port 4173 by itself. Add
`--project=chromium` to try one browser.

For Android, start an emulator (an image with Google APIs, so Chrome is
installed) or connect a phone with USB debugging, then serve the build and
run the test:

```bash
npx vite preview --config vite/config.prod.mjs --port 4173
```

```bash
npm run test:android
```

The test forwards port 4173 to the device (`adb reverse`), turns the screen
to landscape and saves a screenshot to `test-results/android-smoke.png`.

## Weekly runs

`.github/workflows/weekly-tests.yml` runs every Monday at 06:17 UTC, and
on demand from the repository's Actions tab ("Weekly tests", "Run workflow"):

- **Desktop**: on Windows, macOS and Linux: type check, unit tests, the
  data/event/locale validators, the production build and the desktop smoke
  test in all three browsers.
- **Android**: the unit tests, the production build and the Android smoke
  test in Chrome on an API 34 emulator (Pixel 6 profile).

Failed runs upload the Playwright report and screenshots as artifacts.
