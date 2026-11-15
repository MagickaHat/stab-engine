/**
 * @file PhaserGame.tsx
 * @brief React component that owns the Phaser game, plus hooks to reach it.
 *
 * `<PhaserGame>` creates the game when it mounts and destroys it when it
 * unmounts. Anything rendered inside it can call `useGame()` and
 * `useCurrentScene()`:
 *
 * @code
 * <PhaserGame>
 *     <UiLayer>
 *         <MyHud />
 *     </UiLayer>
 * </PhaserGame>
 * @endcode
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Game, Scene } from 'phaser';
import StartGame from './game/main';
import { EventBus, GameEvents } from './game/EventBus';

/** @brief What `<PhaserGame>` shares with its children. */
interface PhaserContextValue
{
    /** The running game, or `null` until it has been created. */
    game: Game | null;
    /** The scene that last finished `create()`, or `null` before the first one. */
    scene: Scene | null;
}

const PhaserContext = createContext<PhaserContextValue>({ game: null, scene: null });

/**
 * @brief Returns the running Phaser game.
 * @return The game, or `null` on the first render before it exists.
 */
export function useGame (): Game | null
{
    return useContext(PhaserContext).game;
}

/**
 * @brief Returns the active Phaser scene.
 *
 * Updates each time a scene emits `GameEvents.SCENE_READY` on the `EventBus`
 * (do this at the end of every scene's `create()`).
 *
 * @return The scene, or `null` before the first scene is ready.
 */
export function useCurrentScene (): Scene | null
{
    return useContext(PhaserContext).scene;
}

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
    const [game, setGame] = useState<Game | null>(null);
    const [scene, setScene] = useState<Scene | null>(null);

    // Create the game once the container exists. The cleanup also runs on
    // React StrictMode's extra mount and on hot reload, so the game is always
    // destroyed before a new one is made.
    useLayoutEffect(() =>
    {
        if (!containerRef.current) return;
        const created = StartGame(containerRef.current);
        setGame(created);
        return () =>
        {
            created.destroy(true);
            setGame(null);
            setScene(null);
        };
    }, []);

    useEffect(() =>
    {
        if (!game) return;
        const onSceneReady = (ready: Scene) =>
        {
            // Ignore scenes from a game that is being destroyed.
            if (ready.game === game) setScene(ready);
        };
        EventBus.on(GameEvents.SCENE_READY, onSceneReady);
        return () =>
        {
            EventBus.off(GameEvents.SCENE_READY, onSceneReady);
        };
    }, [game]);

    return (
        <PhaserContext.Provider value={{ game, scene }}>
            <div id="game-container" ref={containerRef} />
            {children}
        </PhaserContext.Provider>
    );
}
