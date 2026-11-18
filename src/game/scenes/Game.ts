import { Scene } from 'phaser';
import { announceScene } from '../announceScene';
import { EventBus, GameEvents } from '../EventBus';
import { OVERWORLD_SCENE_KEY } from './Overworld';
import type { OverworldData } from './Overworld';

export class Game extends Scene
{
    constructor ()
    {
        super('Game');
    }

    preload ()
    {
        this.load.setPath('assets');
        
        this.load.image('background', 'bg.png');
        this.load.image('logo', 'logo.png');
    }

    create ()
    {
        //  Development shortcut: http://localhost:8080/?map=route1 opens that map (src/tiled/maps/route1.tmj).
        const map = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('map') : null;
        if (map)
        {
            const spawn = new URLSearchParams(window.location.search).get('spawn') ?? undefined;
            this.scene.start(OVERWORLD_SCENE_KEY, { map, spawn } satisfies OverworldData);
            return;
        }

        // Positions and sizes come from the current game size, not fixed numbers,
        // so the scene still fits if the resolution changes (see src/game/config.ts).
        const { width, height } = this.scale;

        this.add.image(width / 2, height / 2, 'background').setDisplaySize(width, height);

        const logo = this.add.image(width / 2, height * 0.42, 'logo').setDepth(100);
        logo.setScale((width * 0.7) / logo.width);

        this.add.text(width / 2, height * 0.62, 'Make something fun!', {
            fontFamily: 'Arial Black', fontSize: 12, color: '#ffffff',
            stroke: '#000000', strokeThickness: 3,
            align: 'center'
        }).setOrigin(0.5).setDepth(100);

        // React → Phaser: the sample HUD button asks for a camera shake.
        EventBus.on(GameEvents.UI_SHAKE, this.shake, this);
        this.events.once('shutdown', () => EventBus.off(GameEvents.UI_SHAKE, this.shake, this));

        // Phaser → React: tell the UI which scene is now active (as plain data).
        announceScene(this);
    }

    /**
     * @brief Shakes the camera briefly. Triggered by the sample HUD button.
     */
    shake ()
    {
        this.cameras.main.shake(250, 0.02);
    }
}
