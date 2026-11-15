/**
 * @file App.tsx
 * @brief Root React component: the game with the UI layer on top.
 */
import { PhaserGame, useCurrentScene } from './PhaserGame';
import { EventBus, GameEvents } from './game/EventBus';
import { UiLayer } from './ui';

/**
 * @brief Sample HUD showing both directions of React ↔ Phaser communication.
 *
 * The label shows the active scene (Phaser → React) and the button asks the
 * scene to shake the camera (React → Phaser). Replace it with real UI.
 *
 * @return The HUD elements.
 */
function SampleHud ()
{
    const scene = useCurrentScene();

    return (
        <>
            <div className="sample-hud-label">
                Scene: {scene ? scene.scene.key : '...'}
            </div>
            <button
                type="button"
                className="sample-hud-button ui-interactive"
                onClick={() => EventBus.emit(GameEvents.UI_SHAKE)}
            >
                Shake
            </button>
        </>
    );
}

/**
 * @brief The whole application.
 * @return The Phaser game with the React UI drawn over it.
 */
export default function App ()
{
    return (
        <PhaserGame>
            <UiLayer>
                <SampleHud />
            </UiLayer>
        </PhaserGame>
    );
}
