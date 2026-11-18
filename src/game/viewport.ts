/**
 * @file viewport.ts
 * @brief Scales the game canvas pixel-perfectly and tells the UI where it is.
 */
import { Core, Scale } from 'phaser';
import type { Game } from 'phaser';
import { EventBus, GameEvents } from '../bus/EventBus';
import type { ViewportInfo } from '../bus/EventBus';
import { computePixelScale, pixelTransform } from './pixelScale';

/**
 * @brief Keeps the canvas at a whole number of device pixels per game pixel.
 *
 * The game config uses `Scale.NONE`; this function scales the canvas by
 * `deviceScale / devicePixelRatio` (see `computePixelScale()`) and centres it
 * on a whole device pixel, using a CSS transform. It runs again when:
 * - the window is resized or the phone is rotated;
 * - the device pixel ratio changes (browser zoom, moving the window to
 *   another monitor);
 * - the game resolution changes (`game.scale.setGameSize()`).
 *
 * Every time, the new placement is sent as `GameEvents.VIEWPORT_CHANGED`, so
 * the React UI follows without reading the canvas itself.
 *
 * It also works around Phaser 4.0.0 keeping the old size after a rotation by
 * measuring again on the next animation frame.
 *
 * @param game The running game.
 * @param container Element the canvas lives in; the game is centred in it.
 */
export function attachPixelScale (game: Game, container: HTMLElement): void
{
    let frame = 0;
    let last = '';
    let dprQuery: MediaQueryList | null = null;

    const apply = () =>
    {
        const canvas = game.canvas;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const area = container.getBoundingClientRect();
        if (area.width <= 0 || area.height <= 0) return;
        const { width: gameWidth, height: gameHeight } = game.scale.gameSize;
        const fit = computePixelScale(area.left, area.top, area.width, area.height, dpr, gameWidth, gameHeight);

        //  The canvas keeps its 1× CSS size and is placed and scaled with a transform. CSS lengths
        //  are rounded to 1/64 px by the browser, which at a fractional device pixel ratio (1.25,
        //  2.75…) leaves the canvas a fraction of a pixel off and blends one column of every
        //  pixel. Transforms keep full precision, so each game pixel lands on exactly
        //  `deviceScale` × `deviceScale` screen pixels.
        if (game.scale.zoom !== 1) game.scale.setZoom(1);
        canvas.style.display = 'block';
        canvas.style.width = `${gameWidth}px`;
        canvas.style.height = `${gameHeight}px`;
        canvas.style.margin = '0';
        canvas.style.transformOrigin = '0 0';
        canvas.style.transform = pixelTransform(fit.left - area.left, fit.top - area.top, fit.cssScale);

        const info: ViewportInfo = {
            gameWidth, gameHeight, left: fit.left, top: fit.top, scale: fit.cssScale, deviceScale: fit.deviceScale,
        };
        const key = JSON.stringify(info);
        if (key === last) return;
        last = key;
        //  Let Phaser measure the canvas again (pointer positions use it).
        game.scale.refresh();
        EventBus.emit(GameEvents.VIEWPORT_CHANGED, info);
    };

    const schedule = () =>
    {
        apply();
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(apply);
    };

    //  Device pixel ratio changes are only reported through a media query for the current value.
    const watchDpr = () =>
    {
        dprQuery?.removeEventListener('change', onDpr);
        dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        dprQuery.addEventListener('change', onDpr);
    };
    const onDpr = () =>
    {
        watchDpr();
        schedule();
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    screen.orientation?.addEventListener('change', schedule);
    game.scale.on(Scale.Events.RESIZE, schedule);
    watchDpr();
    if (game.isBooted) schedule();
    else game.events.once(Core.Events.READY, schedule);

    game.events.once(Core.Events.DESTROY, () =>
    {
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener('resize', schedule);
        window.removeEventListener('orientationchange', schedule);
        screen.orientation?.removeEventListener('change', schedule);
        dprQuery?.removeEventListener('change', onDpr);
        game.scale?.off(Scale.Events.RESIZE, schedule);
    });
}
