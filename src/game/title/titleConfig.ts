/**
 * @file titleConfig.ts
 * @brief Everything the player sees from launch to the first map: the boot
 *        splashes, the opening movie, the title screen and the new game's start.
 *
 * **This is the file to edit to change the title screen.** It is plain data:
 * the scenes (`Boot`, `Splash`, `Title` in src/game/scenes/) and the React UI
 * read it, so no scene code has to change. See docs/TITLE_SCREEN.md.
 *
 * Images are paths relative to `public/` (`assets/img/titles/title.png`).
 * Positions and sizes are in game pixels (the game is 256×192, see
 * src/game/config.ts) and must be whole numbers, so pixel art stays sharp.
 *
 * @code
 * // A scrolling cloud band behind the logo, and the logo gently bobbing:
 * export const TITLE_SCREEN: TitleScreenConfig = {
 *     ...
 *     layers: [
 *         { kind: 'scroll', image: 'assets/img/titles/clouds.png', y: 40, speedX: -12 },
 *         { kind: 'bob', image: 'assets/img/titles/title.png', amplitude: 2, periodMs: 3000 },
 *         { kind: 'text', key: 'ui.title.press_start', y: 150, align: 'center', onMs: 500 },
 *     ],
 * };
 * @endcode
 */
import type {Button} from '../../input/buttons.ts';

// ---------------------------------------------------------------- Splashes

/** @brief One boot splash: a full-screen image faded in from black, held, and faded out. */
export interface SplashStep {
    /** Image, relative to `public/`. Missing images are skipped. */
    image: string;
    /** Fade-in time in milliseconds. */
    fadeInMs: number;
    /** How long it stays fully shown, in milliseconds. */
    holdMs: number;
    /** Fade-out time in milliseconds. */
    fadeOutMs: number;
    /** Whether A, Start or a tap skips to the next splash. */
    skippable: boolean;
}

/**
 * @brief The splashes shown at launch, in order. Two are reserved to show
 *        who made the engine (`splash1`) and the game (`splash2`).
 */
export const SPLASHES: SplashStep[] = [
    {image: 'assets/img/titles/splash1.png', fadeInMs: 400, holdMs: 2000, fadeOutMs: 400, skippable: true},
    {image: 'assets/img/titles/splash2.png', fadeInMs: 400, holdMs: 2000, fadeOutMs: 400, skippable: true},
];

// ------------------------------------------------------------ Opening movie

/** @brief The optional movie played after the splashes. */
export interface OpeningMovieConfig {
    /**
     * Files to look for, relative to `public/`, best first. The first one that
     * exists and the browser can play is shown; if none exists the movie is
     * skipped. No movie ships with the engine.
     */
    sources: string[];
    /** Whether A, B, Start or a tap ends the movie early. */
    skippable: boolean;
}

/** @brief Drop `public/assets/video/intro.webm` (or `.mp4`) in to get an opening movie. */
export const OPENING_MOVIE: OpeningMovieConfig = {
    sources: ['assets/video/intro.webm', 'assets/video/intro.mp4'],
    skippable: true,
};

// ------------------------------------------------------------ Title screen

/** @brief Settings every title layer has. */
interface LayerBase
{
    /** Left edge in game pixels (default 0). */
    x?: number;
    /** Top edge in game pixels (default 0). */
    y?: number;
}

/** @brief A still image. */
export interface ImageLayer extends LayerBase {
    kind: 'image';
    image: string;
}

/** @brief An image shown and hidden in turn, e.g. a "press start" bar. */
export interface BlinkLayer extends LayerBase {
    kind: 'blink';
    image: string;
    /** Milliseconds shown. */
    onMs: number;
    /** Milliseconds hidden. */
    offMs: number;
}

/** @brief An image repeated across the screen and scrolled, e.g. clouds or a pattern. */
export interface ScrollLayer extends LayerBase {
    kind: 'scroll';
    image: string;
    /** Pixels per second to the right (negative: to the left). */
    speedX?: number;
    /** Pixels per second down (negative: up). */
    speedY?: number;
    /** Height of the band in pixels (default: the image's height). The band is always as wide as the screen. */
    height?: number;
}

/** @brief An image that floats up and down by whole pixels, e.g. the logo. */
export interface BobLayer extends LayerBase {
    kind: 'bob';
    image: string;
    /** Largest offset in pixels. */
    amplitude: number;
    /** Milliseconds for one full up-and-down. */
    periodMs: number;
}

/** @brief Translated text drawn with the game's pixel font by the React UI. */
export interface TextLayer extends LayerBase {
    kind: 'text';
    /** Text key (content/locales/ui/<locale>.csv). */
    key: string;
    /** `center` centres the text on `x` (or on the screen when `x` is left out). */
    align?: 'left'|'center';
    /** Text colour, `#rrggbb`. */
    color?: string;
    /** Shadow colour, or `null` for none. */
    shadow?: string|null;
    /** Blink: milliseconds shown. Leave out to keep it shown. */
    onMs?: number;
    /** Blink: milliseconds hidden (default: as long as `onMs`). */
    offMs?: number;
}

/**
 * @brief A layer of the title screen. Layers are drawn in order, the first at
 *        the back. Phaser draws every kind but `text`, which the React UI draws.
 *
 * Add a kind of your own with `registerTitleLayer()` (src/game/title/layers.ts).
 */
export type TitleLayer = ImageLayer|BlinkLayer|ScrollLayer|BobLayer|TextLayer|CustomLayer;

/** @brief A layer of a kind added with `registerTitleLayer()`. */
export interface CustomLayer extends LayerBase {
    kind: string;
    image?: string;
    [setting: string]: unknown;
}

/** @brief The title screen. */
export interface TitleScreenConfig {
    /** Colour behind every layer, `#rrggbb`. */
    background: string;
    /** Layers, back to front. */
    layers: TitleLayer[];
    /** Music (assets/sound/bgm/<name>.ogg), or `null` for none. Missing files are skipped. */
    bgm: string|null;
    /** Buttons that open the New Game / Continue menu. A tap or click always does. */
    startButtons: Button[];
    /**
     * Milliseconds without input after which the intro (splashes, then the
     * movie) plays again, as on old consoles. `0` never does.
     */
    idleMs: number;
    /** What plays when the title sits idle: the whole `intro` (splashes and movie) or only the `movie`. */
    idleReplay: 'intro'|'movie';
}

/** @brief The title screen as shipped: the full-screen title image with a blinking "press start". */
export const TITLE_SCREEN: TitleScreenConfig = {
    background: '#ffffff',
    layers: [
        {kind: 'image', image: 'assets/img/titles/title.png'},
        {kind: 'blink', image: 'assets/img/titles/start.png', y: 158, onMs: 600, offMs: 400},
        {
            kind: 'text',
            key: 'ui.title.press_start',
            y: 140,
            align: 'center',
            color: '#505058',
            shadow: '#a0a0a8',
            onMs: 600,
            offMs: 400
        },
    ],
    bgm: null,
    startButtons: ['a', 'start'],
    idleMs: 0,
    idleReplay: 'intro',
};

// --------------------------------------------------------------- New game

/** @brief Where a new game starts, once its language has been picked. */
export interface NewGameConfig {
    /** Map ID (src/tiled/maps/<map>.tmj). The intro map plays the professor's speech. */
    map: string;
    /** `Spawn` object to start on. */
    spawn: string;
}

/** @brief New games start on the intro map, whose autorun event runs the opening speech. */
export const NEW_GAME: NewGameConfig = {
    map: 'intro',
    spawn: 'start',
};

// ------------------------------------------------------------ Helpers

/**
 * @brief Every image the title screen uses, so `Boot` can load them before it shows.
 * @param screen The title screen.
 * @return Image paths, without duplicates.
 */
export function titleImages(screen: TitleScreenConfig = TITLE_SCREEN): string[]
{
    const images = screen.layers.map((layer) => ('image' in layer ? layer.image : undefined));
    return [...new Set(images.filter((image): image is string => typeof image === 'string'))];
}
