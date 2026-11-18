/**
 * @file playwright.config.ts
 * @brief End-to-end smoke tests of the production build in desktop browsers.
 *
 * `npm run test:desktop` builds nothing by itself: run `npm run build-nolog`
 * first. The build is served by `vite preview` on port 4173. The Android
 * test (tests/android/smoke.ts) uses the same server but its own runner.
 */
import {defineConfig, devices} from '@playwright/test';

/** @brief Port `vite preview` serves the build on. */
const PORT = 4173;

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 60_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : 'list',
    use: {
        baseURL: `http://localhost:${PORT}`,
        screenshot: 'only-on-failure',
        trace: 'off',
    },
    projects: [
        {name: 'chromium', use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 720}}},
        {name: 'firefox', use: {...devices['Desktop Firefox'], viewport: {width: 1280, height: 720}}},
        {name: 'webkit', use: {...devices['Desktop Safari'], viewport: {width: 1280, height: 720}}},
    ],
    webServer: {
        command: `npx vite preview --config vite/config.prod.mjs --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
});
