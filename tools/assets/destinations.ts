/**
 * @file destinations.ts
 * @brief Where an imported file is written on disk.
 *
 * Most outputs go inside the output folder (`public/assets` by default), at
 * their planned path (`img/ui/bag/bg.png`). Some must live elsewhere in the
 * repository; tileset images, for example, belong to the Tiled project in
 * `src/tiled/tilesets/` so maps can use them. An `OutputRedirect` sends every
 * output under one folder to another one.
 */
import path from 'node:path';

/** @brief Send the outputs under one folder somewhere else. */
export interface OutputRedirect {
    /** Output folder to redirect, without a trailing slash, e.g. `'img/tilesets'`. */
    prefix: string;
    /** Absolute folder its contents are written to instead. */
    dir: string;
}

/**
 * @brief The redirect that applies to an output, if any.
 * @param dest Planned output path, e.g. `'img/tilesets/outside.png'`.
 * @param redirects Redirects to try, in order.
 * @return The first redirect whose prefix is a folder containing `dest`, or `null`.
 */
export function redirectFor(dest: string, redirects: readonly OutputRedirect[]): OutputRedirect|null
{
    return redirects.find((redirect) => dest.startsWith(`${redirect.prefix}/`)) ?? null;
}

/**
 * @brief Absolute path an output is written to.
 * @param outDir Output folder.
 * @param dest Planned output path inside it.
 * @param redirects Redirects to apply (pass `[]` for none).
 * @return E.g. `<repo>/src/tiled/tilesets/outside.png` for `img/tilesets/outside.png`.
 */
export function outputPath(outDir: string, dest: string, redirects: readonly OutputRedirect[]): string
{
    const redirect = redirectFor(dest, redirects);
    return redirect ? path.join(redirect.dir, dest.slice(redirect.prefix.length + 1)) : path.join(outDir, dest);
}

/**
 * @brief The folder an output's empty parent folders may be removed up to.
 * @param outDir Output folder.
 * @param dest Planned output path inside it.
 * @param redirects Redirects to apply.
 * @return The redirect's folder, or `outDir`.
 */
export function outputRoot(outDir: string, dest: string, redirects: readonly OutputRedirect[]): string
{
    return redirectFor(dest, redirects)?.dir ?? outDir;
}
