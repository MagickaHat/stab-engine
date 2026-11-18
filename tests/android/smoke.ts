/**
 * @file smoke.ts
 * @brief Android smoke test: opens the production build in Chrome on an
 *        Android device or emulator and waits for the first scene.
 *
 * Needs `adb` with one device connected (USB debugging on) and Chrome
 * installed on it. The build must be served on port 4173 of this machine
 * (`npx vite preview --config vite/config.prod.mjs --port 4173`); the port
 * is forwarded to the device with `adb reverse`.
 *
 * Run with `npm run test:android`. Exit code 1 when the test fails; a
 * screenshot is saved to `test-results/android-smoke.png` either way.
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {_android} from '@playwright/test';
import type {AndroidDevice, BrowserContext, Page} from '@playwright/test';

/** @brief Port the build is served on, on this machine and on the device. */
const PORT = 4173;
/**
 * @brief Key of the first scene that stays on screen: `Boot` loads the intro's
 *        images and hands over to the splashes at once (src/game/title/sceneKeys.ts).
 */
const FIRST_SCENE = 'Splash';
/** @brief Chrome's package name. */
const CHROME = 'com.android.chrome';
/** @brief The whole test fails after this long (ms), rather than hang the CI job. */
const WATCHDOG_MS = 5 * 60_000;
/** @brief Where the screenshot goes. */
const SCREENSHOT = path.join('test-results', 'android-smoke.png');

/**
 * @brief Run an adb command.
 * @param args Its arguments.
 * @return Its standard output.
 * @throws Error when it fails.
 */
function adb(...args: string[]): string
{
    const result = spawnSync('adb', args, { encoding: 'utf-8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`adb ${args.join(' ')} failed:\n${result.stderr}`);
    return result.stdout;
}

/**
 * @brief Start Chrome and get a tab, trying twice.
 *
 * Chrome opens with a tab of its own; using it avoids `newPage()`, which
 * sometimes fails on Android while Chrome is still starting.
 *
 * @param device The device.
 * @return The browser and its tab.
 */
async function openPage(device: AndroidDevice): Promise<{ context: BrowserContext; page: Page }>
{
    for (let attempt = 1;; attempt++)
    {
        await device.shell(`am force-stop ${CHROME}`);
        const context = await device.launchBrowser();
        try
        {
            const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 15_000 });
            return { context, page };
        }
        catch (error)
        {
            await context.close().catch(() => {});
            if (attempt >= 2) throw error;
            console.log(`Could not get a Chrome tab (${String(error)}); trying again.`);
        }
    }
}

/**
 * @brief Load the game, wait for the first scene and tap it.
 * @param page Chrome's tab.
 * @return Why the test failed, or null.
 */
async function playGame(page: Page): Promise<string|null>
{
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => console.log(`[console.${message.type()}] ${message.text()}`));

    console.log(`Browser: ${await page.evaluate(() => navigator.userAgent)}`);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector(`canvas[data-scene="${FIRST_SCENE}"]`, { state: 'visible', timeout: 90_000 });
    //  A real touch in the middle of the screen (the A button). Playwright's
    //  page.tap() needs touch emulation, which Chrome on Android does not take.
    const [width, height] = adb('shell', 'wm', 'size').match(/(\d+)x(\d+)/)!.slice(1).map(Number);
    const x = Math.round(Math.max(width!, height!) / 2);
    const y = Math.round(Math.min(width!, height!) / 2);
    adb('shell', 'input', 'tap', String(x), String(y));
    await page.waitForTimeout(1000);
    return errors.length > 0 ? `Page errors:\n${errors.join('\n')}` : null;
}

/**
 * @brief Run the test.
 * @return Exit code.
 */
async function main(): Promise<number>
{
    if (!adb('shell', 'pm', 'list', 'packages', CHROME).includes(`package:${CHROME}`))
    {
        console.error(`${CHROME} is not installed on the device. Use an emulator image with Google APIs.`);
        return 1;
    }
    //  Lets Chrome read the command line Playwright writes (no "enable command line" flag needed).
    adb('shell', 'am', 'set-debug-app', '--persistent', CHROME);
    adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
    //  The game is played in landscape (docs/UI_SYSTEM.md, "Android notes").
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '1');

    const [device] = await _android.devices();
    if (!device) throw new Error('No Android device found.');
    console.log(`Device: ${device.model()} (${device.serial()})`);

    let failure: string|null = null;
    let context: BrowserContext|undefined;
    try
    {
        const opened = await openPage(device);
        context = opened.context;
        failure = await playGame(opened.page);
    }
    catch (error)
    {
        failure = error instanceof Error ? error.message : String(error);
    }
    finally
    {
        try
        {
            fs.mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
            fs.writeFileSync(SCREENSHOT, await device.screenshot());
        }
        catch (error)
        {
            console.error(`No screenshot: ${String(error)}`);
        }
        await context?.close().catch(() => {});
        await device.close().catch(() => {});
    }

    if (failure)
    {
        console.error(`Android smoke test failed: ${failure}`);
        return 1;
    }
    console.log(`Android smoke test passed: the game reached the "${FIRST_SCENE}" scene.`);
    return 0;
}

const watchdog = setTimeout(() => {
    console.error(`Android smoke test failed: no result after ${WATCHDOG_MS / 1000} s.`);
    process.exit(1);
}, WATCHDOG_MS);

//  Exit explicitly: a lost adb connection can keep Node running.
main().then(
    (code) => {
        clearTimeout(watchdog);
        process.exit(code);
    },
    (error) => {
        console.error(error);
        process.exit(1);
    },
);
