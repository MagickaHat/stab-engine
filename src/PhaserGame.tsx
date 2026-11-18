/**
 * @file PhaserGame.tsx
 * @brief React component that owns the Phaser game.
 *
 * `<PhaserGame>` creates the game when it mounts and destroys it when it
 * unmounts. That is all React does with Phaser: the UI rendered inside it
 * never receives the game or its scenes. Everything the UI needs is
 * published on the `EventBus` and read through the UI store
 * (src/ui/store/uiStore.ts); see docs/UI_SYSTEM.md.
 *
 * @code
 * <PhaserGame>
 *     <UiLayer>
 *         <MyHud />
 *     </UiLayer>
 * </PhaserGame>
 * @endcode
 */
import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import StartGame from './game/main';

/** @brief Props of `<PhaserGame>`. */
export interface PhaserGameProps
{
    /** UI rendered on top of the game, usually a `<UiLayer>`. */
    children?: ReactNode;
}

/**
 * @brief Creates the Phaser game and renders the UI on top of it.
 * @param props See `PhaserGameProps`.
 * @return The game container element followed by `children`.
 */
export function PhaserGame ({ children }: PhaserGameProps)
{
    const containerRef = useRef<HTMLDivElement>(null);

    // Create the game once the container exists. The cleanup also runs on
    // React StrictMode's extra mount and on hot reload, so the game is always
    // destroyed before a new one is made.
    useLayoutEffect(() =>
    {
        if (!containerRef.current) return;
        const created = StartGame(containerRef.current);
        return () => created.destroy(true);
    }, []);

    return (
        <>
            <div id="game-container" ref={containerRef} />
            {children}
        </>
    );
}
