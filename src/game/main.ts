import { Battle } from './scenes/Battle';
import { Game as MainGame } from './scenes/Game';
import { Overworld } from './scenes/Overworld';
import { AUTO, Core, Game, Scale, Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import { EventBus, GameEvents } from './EventBus';
import { input } from '../input';

// Find out more information about the Game Config at:
// https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Types.Core.GameConfig = {
    type: AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: 'game-container',
    backgroundColor: '#028af8',
    // The game is drawn at a low resolution and scaled up, so keep pixels sharp.
    pixelArt: true,
    //  Keyboard, gamepad, mouse and touch are read by src/input instead (see docs/INPUT_SYSTEM.md).
    input: {
        keyboard: false,
        gamepad: false,
    },
    scale: {
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH
    },
    //  The first scene starts by itself. `Battle` is started with a team (see scenes/Battle.ts),
    //  `Overworld` with a map (see scenes/Overworld.ts).
    scene: [
        MainGame,
        Overworld,
        Battle
    ]
};

/**
 * @brief Makes the game re-fit its container after the screen changes.
 *
 * Phaser 4.0.0 can keep the old canvas size after a phone is rotated: its
 * orientation handler refreshes before the page has its new size, and the
 * later check then sees nothing left to do. Asking for one more refresh on
 * the next frame fixes it. The listeners are removed when the game is destroyed.
 *
 * @param game The running game.
 */
function keepFitted (game: Game): void
{
    let frame = 0;
    const refit = () =>
    {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => game.scale?.refresh());
    };

    window.addEventListener('resize', refit);
    window.addEventListener('orientationchange', refit);
    screen.orientation?.addEventListener('change', refit);

    game.events.once(Core.Events.DESTROY, () =>
    {
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', refit);
        window.removeEventListener('orientationchange', refit);
        screen.orientation?.removeEventListener('change', refit);
    });
}

/**
 * @brief Connects the input system (src/input) to the game.
 *
 * The shared `input` listens to the page while the game exists, reads the
 * gamepads and starts a new input frame before every game step, so all
 * scenes see the same `justPressed()` within a frame. Device switches are
 * forwarded on the `EventBus` as `GameEvents.INPUT_DEVICE_CHANGED`.
 *
 * @param game The running game.
 * @param container Element holding the canvas; clicks and taps on it press A.
 */
function connectInput (game: Game, container: HTMLElement): void
{
    const disconnect = input.start(container);
    const step = () => input.update();
    const offDevice = input.onDeviceChange((device) => EventBus.emit(GameEvents.INPUT_DEVICE_CHANGED, device));
    game.events.on(Core.Events.PRE_STEP, step);

    game.events.once(Core.Events.DESTROY, () =>
    {
        game.events.off(Core.Events.PRE_STEP, step);
        offDevice();
        disconnect();
    });
}

/**
 * @brief Creates and starts the Phaser game.
 * @param parent The DOM element (or its id) the game canvas is added to.
 * @return The running game.
 */
const StartGame = (parent: string | HTMLElement) => {
    const game = new Game({ ...config, parent });
    keepFitted(game);
    const container = typeof parent === 'string' ? document.getElementById(parent) : parent;
    connectInput(game, container ?? document.body);
    return game;
}

export default StartGame;
