/**
 * @file movie.ts
 * @brief Finds the optional opening movie.
 *
 * No movie ships with the engine: the files in `OPENING_MOVIE.sources` are
 * looked for once, and the first one that exists and the browser can play is
 * used. Without one, the intro goes straight from the splashes to the title.
 */
import {assetUrl} from '../../ui/assets/paths.ts';
import {OPENING_MOVIE} from './titleConfig.ts';

/** @brief What `findOpeningMovie()` needs from the browser, so tests can stand in for it. */
export interface MovieProbe {
    /** Whether a file exists (a `HEAD` request that succeeds with a video, not an HTML page). */
    exists: (url: string) => Promise<boolean>;
    /** Whether the browser can play a file of this type (`HTMLVideoElement.canPlayType`). */
    canPlay: (mimeType: string) => boolean;
}

/** @brief MIME type of each movie file extension. */
const MIME_TYPES: Record<string, string> = {
    webm: 'video/webm',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    ogv: 'video/ogg',
    mov: 'video/quicktime',
};

/**
 * @brief The browser's probe: a `HEAD` request, and a video element's `canPlayType()`.
 * @return The probe.
 */
export function browserProbe(): MovieProbe
{
    return {
        exists: async (url) => {
            try
            {
                const response = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
                //  A dev server answers a missing file with its HTML page and status 200.
                return response.ok && !(response.headers.get('content-type') ?? '').includes('text/html');
            }
            catch
            {
                return false;
            }
        },
        canPlay: (mimeType) =>
            typeof document !== 'undefined' && document.createElement('video').canPlayType(mimeType) !== '',
    };
}

/**
 * @brief Find the first movie file that exists and can be played.
 * @param sources Paths relative to `public/`, best first.
 * @param probe How to check files (default: the browser).
 * @param toUrl Turns a path into a URL (default: `assetUrl`).
 * @return The movie's URL, or `null` if there is none.
 */
export async function findMovie(
    sources: readonly string[],
    probe: MovieProbe = browserProbe(),
    toUrl: (path: string) => string = assetUrl,
    ): Promise<string|null>
{
    for (const source of sources)
    {
        const extension = source.split('.').pop()?.toLowerCase() ?? '';
        const mimeType = MIME_TYPES[extension];
        if (mimeType && !probe.canPlay(mimeType)) continue;
        const url = toUrl(source);
        if (await probe.exists(url)) return url;
    }
    return null;
}

let cached: Promise<string|null>|null = null;

/**
 * @brief The opening movie's URL (`OPENING_MOVIE.sources`), looked for once per page load.
 * @return The URL, or `null` if the game has no opening movie.
 */
export function findOpeningMovie(): Promise<string|null>
{
    cached ??= findMovie(OPENING_MOVIE.sources);
    return cached;
}
