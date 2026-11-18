import { Battle } from './scenes/Battle';
import {Boot} from './scenes/Boot';
import { Overworld } from './scenes/Overworld';
import {Splash} from './scenes/Splash';
import {Title} from './scenes/Title';
import { AUTO, Core, Game, Scale, Types } from 'phaser';
import { attachUiSounds } from './uiSounds';
import { attachPixelScale } from './viewport';
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
    backgroundColor: '#000000',
    // The game is drawn at a low resolution and scaled up, so keep pixels sharp.
    pixelArt: true,
    //  Keyboard, gamepad, mouse and touch are read by src/input instead (see docs/INPUT_SYSTEM.md).
    input: {
        keyboard: false,
        gamepad: false,
    },
    //  Scaled by whole device pixels only, so pixels stay square and sharp (see src/game/viewport.ts).
    scale: { mode: Scale.NONE, autoCenter: Scale.NO_CENTER },
    //  The first scene starts by itself: Boot → Splash (splashes, opening movie) → Title
    //  (New Game / Continue) → Overworld. See src/game/title/titleConfig.ts and docs/TITLE_SCREEN.md.
    //  `Battle` is started with a team (see scenes/Battle.ts), `Overworld` with a map (see scenes/Overworld.ts).
    scene: [Boot, Splash, Title, Overworld, Battle]
};

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
    const container = (typeof parent === 'string' ? document.getElementById(parent) : parent) ?? document.body;
    attachPixelScale(game, container);
    attachUiSounds(game);
    connectInput(game, container);
    return game;
}

export default StartGame;
