/**
 * @file Splash.ts
 * @brief The intro: the boot splashes, then the opening movie if the game has one.
 *
 * Each splash in `SPLASHES` (src/game/title/titleConfig.ts) fades in from
 * black, stays, and fades out; A, Start or a tap skips one if it is
 * `skippable`. Then the first file of `OPENING_MOVIE.sources` that exists is
 * played by the React UI (`GameEvents.TITLE_MOVIE`), and the title screen starts.
 */
import {Cameras, Scene} from 'phaser';
import {input} from '../../input';
import {announceScene} from '../announceScene';
import {findOpeningMovie} from '../title/movie';
import {playMovie} from '../title/requests';
import {OPENING_MOVIE, SPLASHES} from '../title/titleConfig';
import type {SplashStep} from '../title/titleConfig';
import {SPLASH_SCENE_KEY, TITLE_SCENE_KEY} from '../title/sceneKeys';

/** @brief What the intro is started with. */
export interface SplashData {
    /** Leave out the splashes and only play the movie (the title screen sat idle). */
    movieOnly?: boolean;
}

export class Splash extends Scene
{
    private movieOnly = false;
    /** Set when the player presses a skip button; read by the step waiting for it. */
    private skipRequested = false;
    private left = false;

    constructor()
    {
        super(SPLASH_SCENE_KEY);
    }

    /**
     * @brief Receives how to start.
     * @param data See `SplashData`.
     */
    init(data: SplashData)
    {
        this.movieOnly = data?.movieOnly ?? false;
        this.skipRequested = false;
        this.left = false;
    }

    create()
    {
        this.cameras.main.setBackgroundColor('#000000');
        this.events.once('shutdown', () => {
            this.left = true;
        });
        announceScene(this);
        void this.play().catch((error) => console.error('[splash] intro failed:', error)).finally(() => {
            if (!this.left) this.scene.start(TITLE_SCENE_KEY);
        });
    }

    update()
    {
        if (input.justPressed('a') || input.justPressed('start'))
        {
            input.consume('a');
            input.consume('start');
            this.skipRequested = true;
        }
    }

    /** @brief Show every splash, then the movie. */
    private async play(): Promise<void>
    {
        if (!this.movieOnly)
        {
            for (const splash of SPLASHES)
            {
                if (this.left) return;
                await this.showSplash(splash);
            }
        }
        if (this.left) return;
        const movie = await findOpeningMovie();
        if (movie && !this.left) await playMovie(movie, OPENING_MOVIE.skippable);
    }

    /** @brief Fade one splash in, hold it, and fade it out. */
    private async showSplash(splash: SplashStep): Promise<void>
    {
        if (!this.textures.exists(splash.image)) return;
        const image = this.add.image(0, 0, splash.image).setOrigin(0, 0);
        this.skipRequested = false;
        const skippable = splash.skippable;
        const camera = this.cameras.main;
        //  A skip during the fade-in or the hold goes straight to the fade-out.
        await this.fade(camera, 'in', splash.fadeInMs, skippable);
        if (!(skippable && this.skipRequested)) await this.wait(splash.holdMs, skippable);
        this.skipRequested = false;
        await this.fade(camera, 'out', splash.fadeOutMs, false);
        image.destroy();
    }

    /**
     * @brief Fade the camera from or to black.
     * @param skippable Whether a skip ends the fade at once.
     */
    private fade(camera: Cameras.Scene2D.Camera, dir: 'in'|'out', ms: number, skippable: boolean): Promise<void>
    {
        if (ms <= 0)
        {
            camera.resetFX();
            if (dir === 'out') camera.fadeOut(1, 0, 0, 0);
            return dir === 'out' ? this.wait(1, false) : Promise.resolve();
        }
        return new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                this.events.off('update', check);
                resolve();
            };
            const check = () => {
                if (!skippable || !this.skipRequested) return;
                camera.resetFX();
                finish();
            };
            camera.once(
                dir === 'in' ? Cameras.Scene2D.Events.FADE_IN_COMPLETE : Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
                finish);
            this.events.on('update', check);
            if (dir === 'in')
                camera.fadeIn(ms, 0, 0, 0);
            else
                camera.fadeOut(ms, 0, 0, 0);
        });
    }

    /**
     * @brief Wait, or until the player skips.
     * @param skippable Whether a skip ends the wait.
     */
    private wait(ms: number, skippable: boolean): Promise<void>
    {
        return new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                timer.remove();
                this.events.off('update', check);
                resolve();
            };
            const check = () => {
                if (skippable && this.skipRequested) finish();
            };
            const timer = this.time.delayedCall(ms, finish);
            this.events.on('update', check);
        });
    }
}
