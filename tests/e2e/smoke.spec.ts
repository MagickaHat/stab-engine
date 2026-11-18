/**
 * @file smoke.spec.ts
 * @brief Desktop smoke test: the production build starts and reaches its first scene.
 *
 * Run with `npm run test:desktop` after `npm run build-nolog`.
 */
import {expect, test} from '@playwright/test';

/**
 * @brief Key of the first scene that stays on screen: `Boot` loads the intro's
 *        images and hands over to the splashes at once (src/game/title/sceneKeys.ts).
 */
const FIRST_SCENE = 'Splash';

/** @brief Key of the title screen, reached once the splashes are skipped. */
const TITLE_SCENE = 'Title';

test('the game boots to its first scene without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    //  announceScene() writes the active scene's key on the canvas.
    const canvas = page.locator(`canvas[data-scene="${FIRST_SCENE}"]`);
    await expect(canvas).toBeVisible({ timeout: 30_000 });

    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);

    //  Keyboard and pointer input reach the game without breaking it: a click and
    //  Start skip the two splashes, which leads to the title screen.
    await canvas.click();
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await expect(page.locator(`canvas[data-scene="${TITLE_SCENE}"]`)).toBeVisible({ timeout: 15_000 });

    expect(errors).toEqual([]);
});
