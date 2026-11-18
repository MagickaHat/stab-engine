/**
 * @file OpeningMovie.tsx
 * @brief Plays the opening movie over the game.
 *
 * The movie fills the game screen, letterboxed on black so its aspect ratio is
 * kept. It starts with sound; if the browser refuses to play sound before the
 * player has touched the page, it plays muted instead. A, B, Start or a tap
 * end it when it is skippable. It also ends if the file cannot be played.
 */
import { useEffect, useRef } from 'react';
import { useModal } from '../store/uiStore';
import { useInputPress } from '../useInput';

/** @brief Props of `<OpeningMovie>`. */
export interface OpeningMovieProps
{
    /** URL of the movie. */
    src: string;
    /** Whether the player may end it early. */
    skippable: boolean;
    /** Called once when it ends, is skipped or fails. */
    onDone: () => void;
}

/**
 * @brief The opening movie, full screen.
 * @param props See `OpeningMovieProps`.
 * @return The video.
 */
export function OpeningMovie ({ src, skippable, onDone }: OpeningMovieProps)
{
    const video = useRef<HTMLVideoElement>(null);
    const finished = useRef(false);
    useModal(true);

    const finish = () =>
    {
        if (finished.current) return;
        finished.current = true;
        video.current?.pause();
        onDone();
    };

    useEffect(() =>
    {
        const element = video.current;
        if (!element) return;
        element.play().catch(() =>
        {
            //  Autoplay with sound blocked: play muted rather than not at all.
            element.muted = true;
            element.play().catch(finish);
        });
    }, [src]);

    useInputPress((button) =>
    {
        if (skippable && (button === 'a' || button === 'b' || button === 'start')) finish();
        return true;
    });

    return (
        <div className="opening-movie ui-interactive" style={{ position: 'absolute', inset: 0, background: '#000' }}
            onPointerDown={() => { if (skippable) finish(); }}>
            <video
                ref={video} src={src} playsInline preload="auto" onEnded={finish} onError={finish}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
        </div>
    );
}
