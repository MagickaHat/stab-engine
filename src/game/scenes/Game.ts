import { Scene } from 'phaser';
import { EventBus, GameEvents } from '../EventBus';

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

        // Phaser → React: tell the UI which scene is now active.
        EventBus.emit(GameEvents.SCENE_READY, this);
    }

    /**
     * @brief Shakes the camera briefly. Triggered by the sample HUD button.
     */
    shake ()
    {
        this.cameras.main.shake(250, 0.02);
    }
}
