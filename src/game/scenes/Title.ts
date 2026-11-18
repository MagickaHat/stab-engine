/**
 * @file Title.ts
 * @brief The title screen, and the way into the game: New Game or Continue.
 *
 * What it shows comes from `TITLE_SCREEN` (src/game/title/titleConfig.ts): its
 * layers are drawn by the factories in src/game/title/layers.ts, back to front.
 * A start button (or a tap) opens the New Game / Continue menu, drawn by the
 * React UI (`GameEvents.TITLE_LOAD_MENU`), with the slots of the shared
 * `SaveManager` (`getSaveManager()`):
 *
 * - **Continue** loads the slot and opens the overworld where the player saved.
 * - **New Game** asks for the game's language first (`startNewGame()`), then
 *   opens the intro map (`NEW_GAME`), whose autorun event plays the opening speech.
 * - **B** goes back to the title screen.
 *
 * If `TITLE_SCREEN.idleMs` passes without input, the intro (or only the
 * movie, with `idleReplay: 'movie'`) plays again.
 */
import {Scene} from 'phaser';
import {input} from '../../input';
import {BUTTONS} from '../../input/buttons';
import {getSaveManager, setGameState} from '../../state';
import {startNewGame} from '../../world/newGame';
import {announceScene} from '../announceScene';
import {createTitleLayer} from '../title/layers';
import type {TitleLayerInstance} from '../title/layers';
import {showLoadMenu} from '../title/requests';
import {NEW_GAME, TITLE_SCREEN} from '../title/titleConfig';
import {OVERWORLD_SCENE_KEY} from './Overworld';
import type {OverworldData} from './Overworld';
import {SPLASH_SCENE_KEY, TITLE_SCENE_KEY} from '../title/sceneKeys';
import type {SplashData} from './Splash';

export class Title extends Scene
{
    private layers: TitleLayerInstance[] = [];
    /** Milliseconds since the title screen appeared. */
    private elapsed = 0;
    /** Milliseconds since the last button press. */
    private idle = 0;
    /** The menu (or the new game's language menu) is open. */
    private busy = false;
    private left = false;

    constructor()
    {
        super(TITLE_SCENE_KEY);
    }

    create()
    {
        this.elapsed = 0;
        this.idle = 0;
        this.busy = false;
        this.left = false;
        const { width, height } = this.scale;
        this.cameras.main.setBackgroundColor(TITLE_SCREEN.background);
        this.layers = TITLE_SCREEN.layers
                          .map((layer, index) => createTitleLayer(this, layer, {
                                   width,
                                   height,
                                   depth: index,
                                   texture: (image) => (this.textures.exists(image) ? image : null),
                               }))
                          .filter((layer): layer is TitleLayerInstance => layer !== null);
        for (const layer of this.layers) layer.update?.(0);
        this.playBgm();

        this.events.once('shutdown', () => {
            this.left = true;
            for (const layer of this.layers) layer.destroy?.();
            this.layers = [];
            this.sound.stopByKey(this.bgmKey());
        });
        announceScene(this);
    }

    update(_time: number, delta: number)
    {
        this.elapsed += delta;
        for (const layer of this.layers) layer.update?.(this.elapsed);
        if (this.busy) return;

        if (BUTTONS.some((button) => input.justPressed(button)))
            this.idle = 0;
        else
            this.idle += delta;

        if (TITLE_SCREEN.startButtons.some((button) => input.justPressed(button)))
        {
            for (const button of TITLE_SCREEN.startButtons) input.consume(button);
            void this.openMenu();
            return;
        }
        if (TITLE_SCREEN.idleMs > 0 && this.idle >= TITLE_SCREEN.idleMs)
        {
            this.scene.start(SPLASH_SCENE_KEY, { movieOnly: TITLE_SCREEN.idleReplay === 'movie' } satisfies SplashData);
        }
    }

    /** @brief Show the New Game / Continue menu and act on the pick. */
    private async openMenu(): Promise<void>
    {
        this.busy = true;
        try
        {
            const saves = getSaveManager();
            const choice = await showLoadMenu(saves.list());
            if (this.left) return;
            if (choice.kind === 'continue')
            {
                setGameState(saves.load(choice.slot));
                this.scene.start(OVERWORLD_SCENE_KEY, {} satisfies OverworldData);
                return;
            }
            if (choice.kind === 'newGame')
            {
                //  The language comes first: the professor's speech is in it.
                setGameState(null);
                await startNewGame();
                if (this.left) return;
                this.scene.start(
                    OVERWORLD_SCENE_KEY, { map: NEW_GAME.map, spawn: NEW_GAME.spawn } satisfies OverworldData);
                return;
            }
        }
        catch (error)
        {
            console.error('[title] could not start the game:', error);
        }
        this.idle = 0;
        this.busy = false;
    }

    /** @brief Texture-free cache key of the title music. */
    private bgmKey(): string
    {
        return `title-bgm:${TITLE_SCREEN.bgm ?? ''}`;
    }

    /** @brief Start the title music, if there is one and its file exists. */
    private playBgm(): void
    {
        const name = TITLE_SCREEN.bgm;
        if (!name) return;
        const key = this.bgmKey();
        const play = () => {
            if (!this.left && this.cache.audio.exists(key)) this.sound.play(key, { loop: true });
        };
        if (this.cache.audio.exists(key))
        {
            play();
            return;
        }
        this.load.audio(key, `assets/sound/bgm/${name}.ogg`);
        this.load.once('complete', play);
        this.load.start();
    }
}
