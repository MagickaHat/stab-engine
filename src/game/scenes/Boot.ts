/**
 * @file Boot.ts
 * @brief The first scene: loads what the intro and title screen show, then starts the intro.
 *
 * Images come from src/game/title/titleConfig.ts (`SPLASHES`, `TITLE_SCREEN`)
 * and are cached under their own path as texture key, so the later scenes
 * find them with `textures.exists(path)`. Missing files are logged by Phaser
 * and skipped by the scenes that would draw them.
 *
 * Development shortcut (`npm run dev` only): `?map=<id>` skips the intro and
 * title and opens that map (src/tiled/maps/<id>.tmj), `&spawn=<name>` picks
 * its `Spawn` object. Without a loaded save, the New Game language menu comes first.
 */
import {Scene} from 'phaser';
import {announceScene} from '../announceScene';
import {SPLASHES, titleImages} from '../title/titleConfig';
import {OVERWORLD_SCENE_KEY} from './Overworld';
import type {OverworldData} from './Overworld';
import {BOOT_SCENE_KEY, SPLASH_SCENE_KEY} from '../title/sceneKeys';

export class Boot extends Scene
{
    constructor()
    {
        super(BOOT_SCENE_KEY);
    }

    preload()
    {
        this.cameras.main.setBackgroundColor('#000000');
        for (const image of new Set([...SPLASHES.map((splash) => splash.image), ...titleImages()]))
        {
            if (!this.textures.exists(image)) this.load.image(image, image);
        }
    }

    create()
    {
        announceScene(this);

        const params = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
        const map = params?.get('map');
        if (map)
        {
            this.scene.start(
                OVERWORLD_SCENE_KEY, { map, spawn: params?.get('spawn') ?? undefined } satisfies OverworldData);
            return;
        }
        this.scene.start(SPLASH_SCENE_KEY);
    }
}
