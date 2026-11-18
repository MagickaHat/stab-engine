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

/** @brief Port the build is served on, on this machine and on the device. */
const PORT = 4173;
/** @brief Key of the scene the game starts in (src/game/scenes/Game.ts). */
const FIRST_SCENE = 'Game';
/** @brief Chrome's package name. */
const CHROME = 'com.android.chrome';
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
    await device.shell(`am force-stop ${CHROME}`);

    const context = await device.launchBrowser();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => console.log(`[console.${message.type()}] ${message.text()}`));

    let failure: string|null = null;
    try
    {
        console.log(`Browser: ${await page.evaluate(() => navigator.userAgent)}`);
        await page.goto(`http://localhost:${PORT}/`);
        await page.waitForSelector(`canvas[data-scene="${FIRST_SCENE}"]`, { state: 'visible', timeout: 90_000 });
        //  A tap is the A button.
        await page.locator('canvas').first().tap();
        await page.waitForTimeout(1000);
        if (errors.length > 0) failure = `Page errors:\n${errors.join('\n')}`;
    }
    catch (error)
    {
        failure = error instanceof Error ? error.message : String(error);
    }
    finally
    {
        fs.mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
        fs.writeFileSync(SCREENSHOT, await device.screenshot());
        await context.close();
        await device.close();
    }

    if (failure)
    {
        console.error(`Android smoke test failed: ${failure}`);
        return 1;
    }
    console.log(`Android smoke test passed: the game reached the "${FIRST_SCENE}" scene.`);
    return 0;
}

main().then(
    (code) => {
        process.exitCode = code;
    },
    (error) => {
        console.error(error);
        process.exitCode = 1;
    },
);
