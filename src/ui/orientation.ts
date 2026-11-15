/**
 * @file orientation.ts
 * @brief Keeps the game in landscape on phones and tablets.
 *
 * The game is meant to be played horizontally on Android. Two things enforce it
 * from the web side:
 * - `lockLandscape()` asks the browser to lock the screen to landscape;
 * - `<RotateDevicePrompt>` (RotateDevicePrompt.tsx) covers the game with a
 *   "rotate your device" message whenever a touch device is held upright,
 *   for the cases where the lock is not allowed.
 *
 * A packaged Android app should also set `android:screenOrientation="sensorLandscape"`
 * on its activity (see docs/UI_SYSTEM.md).
 */

/**
 * @brief Asks the browser to lock the screen to landscape.
 *
 * Browsers only allow this in some situations (an installed web app, a WebView
 * that permits it, or fullscreen), and desktop browsers do not support it at
 * all. A refusal is expected and ignored: `<RotateDevicePrompt>` covers that case.
 */
export function lockLandscape (): void
{
    // `lock` is missing from some TypeScript DOM typings, so describe it here.
    const orientation = screen.orientation as (ScreenOrientation & {
        lock?: (orientation: 'landscape') => Promise<void>;
    }) | undefined;

    try
    {
        orientation?.lock?.('landscape').catch(() => { /* Not allowed here. */ });
    }
    catch
    {
        // Older browsers throw instead of rejecting.
    }
}
