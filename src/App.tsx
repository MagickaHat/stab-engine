/**
 * @file App.tsx
 * @brief Root React component: the game with the UI layer on top.
 */
import { useEffect } from 'react';
import { PhaserGame } from './PhaserGame';
import { EventBus, GameEvents } from './bus/EventBus';
import { EventDialogue, lockLandscape, PixelText, RotateDevicePrompt, UiAssetGate, UiLayer, useUiStore, VirtualPad, Window } from './ui';

/**
 * @brief Sample HUD showing both directions of React ↔ Phaser communication.
 *
 * Only shown by `npm run dev`. The label shows the active scene, published by
 * the scene as plain data (Phaser → bus → UI store → React), and the button
 * asks the scene to shake the camera (React → bus → Phaser). Replace it with real UI.
 *
 * @return The HUD elements.
 */
function SampleHud ()
{
    const sceneKey = useUiStore((ui) => ui.sceneKey);
    const busy = useUiStore((ui) => ui.modalCount > 0);
    if (busy) return null;

    return (
        <>
            <Window skin="choice_1" x={2} y={2} width={80} height={30}>
                <PixelText text={sceneKey ?? '...'} skin="choice_1" x={-6} />
            </Window>
            <Window
                skin="choice_1" x={196} y={160} width={58} height={30} interactive
                onPointerDown={(event) => { if (event.button === 0) EventBus.emit(GameEvents.UI_SHAKE); }}
            >
                <PixelText text="SHAKE" skin="choice_1" x={-6} />
            </Window>
        </>
    );
}

/**
 * @brief The whole application.
 * @return The Phaser game with the React UI drawn over it.
 */
export default function App ()
{
    // The game is landscape only on phones and tablets.
    useEffect(lockLandscape, []);

    return (
        <PhaserGame>
            <UiLayer>
                <UiAssetGate>
                    {import.meta.env.DEV && <SampleHud />}
                    <EventDialogue />
                </UiAssetGate>
                <VirtualPad />
            </UiLayer>
            <RotateDevicePrompt />
        </PhaserGame>
    );
}
