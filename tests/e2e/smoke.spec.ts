/**
 * @file smoke.spec.ts
 * @brief Desktop smoke test: the production build starts and reaches its first scene.
 *
 * Run with `npm run test:desktop` after `npm run build-nolog`.
 */
import {expect, test} from '@playwright/test';

/** @brief Key of the scene the game starts in (src/game/scenes/Game.ts). */
const FIRST_SCENE = 'Game';

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

    //  Keyboard and pointer input reach the game without breaking it.
    await canvas.click();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    expect(errors).toEqual([]);
});
