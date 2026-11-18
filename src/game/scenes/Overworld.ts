/**
 * @file Overworld.ts
 * @brief The overworld scene: draws a Tiled map, moves the player and runs the map's events.
 *
 * It is the event system's `WorldHost` (src/events/runtime/host.ts): every
 * command that shows or moves something ends up in a method here.
 *
 * Start it with a map ID (a file in src/tiled/maps without `.tmj`):
 * @code
 * this.scene.start(OVERWORLD_SCENE_KEY, { map: 'route1', spawn: 'start' } satisfies OverworldData);
 * this.scene.start(OVERWORLD_SCENE_KEY, {});   // continue at the saved position
 * @endcode
 *
 * When the map loads, every object on its object layers is sent to the
 * factory of its class (src/events/tiled.ts: `Event`, `Npc`, `Sign`, `Warp`,
 * `Trainer`...), and the resulting events are handed to an `EventManager`.
 *
 * Map conventions:
 * - Tile layers draw in order below characters. A tile layer with the bool
 *   property `above` draws over them; one with the bool property `collision`
 *   is hidden and every tile on it blocks.
 * - A tile whose tileset gives it the bool property `collides` blocks.
 * - The map's `bgm` property (class `StabMap`) starts its music.
 * - Without a position or spawn, the player starts on the `Spawn` named `start` (else the first one).
 *
 * Controls come from the input system (src/input, docs/INPUT_SYSTEM.md), so
 * keyboard, gamepad, touch and the on-screen pad all work: the D-pad walks,
 * holding B runs, and A (or a tap / left click on the game) is the action button.
 *
 * No graphics or sounds ship with the engine. Missing files are skipped;
 * in development builds characters without art are drawn as outlines.
 */
import { Cameras, Loader, Scene, Tilemaps } from 'phaser';
import type {Tweens} from 'phaser';
import type { GameObjects, Sound } from 'phaser';
import bundle from 'virtual:stab-events';
import { CRY_DIR } from '../../battle';
import {
    directionTowards, DIRECTION_DELTA, EMOTE_FRAME_SIZE, EMOTES, EventManager, instantiateMap, runRoute,
} from '../../events';
import type {Actor, BattleRequest, BattleResult, Direction, PictureEase, PictureMove, PictureRequest, RuntimeData, SpawnPoint, WarpRequest, WorldHost,} from '../../events';
import { input } from '../../input';
import { getGameState } from '../../state';
import type { GameState } from '../../state';
import { CHARACTER_DIR, Character } from '../../world/Character';
import type { CharacterWorld } from '../../world/Character';
import { loadRuntimeData } from '../../world/data';
import { showChoice, showMessage, showNameInput, showPokedexEntry } from '../../world/dialogue';
import { runInk } from '../../world/ink';
import { loadMapAssets } from '../../world/maps';
import { startNewGame } from '../../world/newGame';
import { loadText, setLocalizer } from '../../world/text';
import { announceScene } from '../announceScene';
import { EventBus, GameEvents } from '../EventBus';
import type { UiModalInfo } from '../EventBus';
import { isUiModalOpen } from '../uiModal';
import { BATTLE_SCENE_KEY } from './Battle';
import type { BattleResultData, BattleSceneData } from './Battle';

/** @brief Key of the overworld scene, for `this.scene.start()`. */
export const OVERWORLD_SCENE_KEY = 'Overworld';

/** @brief Where to start. Everything left out comes from the saved position. */
export interface OverworldData
{
    /** Map ID. Default: the saved map. */
    map?: string;
    x?: number;
    y?: number;
    /** Name of a `Spawn` object, used when `x`/`y` are left out. */
    spawn?: string;
    dir?: Direction;
}

/** @brief Graphic of the player (assets/img/characters/<name>.png). */
export const PLAYER_GRAPHIC = 'player';

/** @brief Emote sheet, relative to the page. */
const EMOTE_SHEET = 'assets/img/system/emotes.png';

/** @brief How long an emote bubble stays, in milliseconds. */
const EMOTE_MS = 700;

/** @brief Folder of the pictures shown by the `showPicture` command, relative to the page. */
export const PICTURE_DIR = 'assets/img/pictures';

/** @brief Depth of picture 0: above characters and emotes, below the screen tint. Picture `n` is drawn at this + `n`. */
const PICTURE_DEPTH = 2600;

/** @brief Play time is added to the save in steps of this many milliseconds, not every frame. */
const PLAY_TIME_STEP_MS = 1000;

/** @brief Phaser ease of each `movePicture` ease. */
const PICTURE_EASE: Record<PictureEase, string> = {
    linear: 'Linear',
    in : 'Quad.easeIn',
    out: 'Quad.easeOut',
    inOut: 'Quad.easeInOut',
};

/** @brief A picture on screen. */
interface ShownPicture
{
    image: GameObjects.Image;
    /** Where `x`/`y` are measured from, relative to the top-left corner (whole pixels). */
    anchorX: number;
    anchorY: number;
    /** Position and opacity as the script sees them; `x`/`y` are the anchor's position. */
    x: number;
    y: number;
    opacity: number;
    /** The move or fade in progress, if any. */
    tween: Tweens.Tween|null;
    /** Ends the current move's promise early (picture erased or replaced). */
    finish: (() => void)|null;
}

/** @brief Milliseconds between autonomous moves for each move frequency (1 to 6). */
const MOVE_DELAY = [0, 4000, 2000, 1000, 500, 250, 60] as const;

/** @brief `#rrggbb` → red, green, blue (0-255). */
function rgb (color: string): [number, number, number]
{
    const value = parseInt(color.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export class Overworld extends Scene implements WorldHost
{
    private start: OverworldData;
    private ready = false;
    private state: GameState;
    private runtimeData: RuntimeData;
    private eventManager: EventManager;

    private mapId = '';
    private tilemap: Tilemaps.Tilemap | null = null;
    private mapWidth = 0;
    private mapHeight = 0;
    private tileW = 16;
    private tileH = 16;
    private blocked = new Set<string>();
    private spawns: Record<string, SpawnPoint> = {};

    private hero: Character;
    private readonly characters = new Map<number, Character>();
    private readonly nextMove = new Map<number, number>();
    private readonly onRoute = new Set<number>();
    private playerControl = true;
    /** @brief A menu or message of the React UI has the player's input (`GameEvents.UI_MODAL_CHANGED`). */
    private uiModalOpen = false;
    private changingMap = false;
    private cameraFollows = true;
    private actionLocked = false;

    private tintLayer: GameObjects.Rectangle | null = null;
    private bgm: { name: string; sound: Sound.BaseSound } | null = null;
    private readonly loading = new Map<string, Promise<boolean>>();
    private hasEmotes = false;
    private readonly pictures = new Map<number, ShownPicture>();
    /** Play time not yet added to the save (see `PLAY_TIME_STEP_MS`). */
    private unsavedPlayTime = 0;

    constructor ()
    {
        super(OVERWORLD_SCENE_KEY);
    }

    /**
     * @brief Receives where to start.
     * @param data See `OverworldData`.
     */
    init (data: OverworldData)
    {
        this.start = data ?? {};
        this.ready = false;
    }

    create ()
    {
        this.cameras.main.setRoundPixels(true);

        let left = false;
        const onModal = ({ open }: UiModalInfo) => { this.uiModalOpen = open; };
        this.uiModalOpen = isUiModalOpen();
        //  The development HUD's SHAKE button (src/App.tsx), a sample of React → Phaser.
        const onShake = () => this.cameras.main.shake(250, 0.02);
        EventBus.on(GameEvents.UI_MODAL_CHANGED, onModal);
        EventBus.on(GameEvents.UI_SHAKE, onShake);
        this.events.once('shutdown', () =>
        {
            left = true;
            EventBus.off(GameEvents.UI_MODAL_CHANGED, onModal);
            EventBus.off(GameEvents.UI_SHAKE, onShake);
            this.flushPlayTime();
            for (const id of [...this.pictures.keys()]) this.removePicture(id);
            this.eventManager?.dispose();
            this.bgm?.sound.stop();
        });
        void this.setup().then(() =>
        {
            if (left) return;
            this.ready = true;
            announceScene(this);
        }).catch((error) => console.error('[overworld] could not start:', error));
    }

    /** @brief Load text, data and the first map. */
    private async setup (): Promise<void>
    {
        //  No game loaded: start a new one, which asks for its language first.
        const state = getGameState() ?? await startNewGame();
        this.state = state;
        //  The save's language never changes: lock the localizer to it.
        const [text, data] = await Promise.all([loadText(state.language), loadRuntimeData(), this.loadEmotes()]);
        text.lock(state.language);
        setLocalizer(text);
        this.runtimeData = data;
        this.hero = new Character(this.world(), 'player', 0, 0);
        this.eventManager = new EventManager({ state, bundle, text, host: this, data });
        const saved = state.getSnapshot().player.position;
        const map = this.start.map ?? saved.map;
        if (!map) throw new Error('no map to start on: pass { map } to the Overworld scene');
        const useSaved = this.start.map === undefined;
        await this.enterMap({
            map,
            x: this.start.x ?? (useSaved ? saved.x : undefined),
            y: this.start.y ?? (useSaved ? saved.y : undefined),
            spawn: this.start.spawn,
            dir: this.start.dir ?? (useSaved ? saved.facing : undefined),
            transition: 'none',
        });
        this.hero.setGraphic(PLAYER_GRAPHIC);
    }

    // ------------------------------------------------------------ Maps

    /** @brief What characters need from this scene. */
    private world (): CharacterWorld
    {
        return {
            scene: this,
            tileWidth: this.tileW,
            tileHeight: this.tileH,
            canStep: (actor, x, y, dir) => this.canStep(actor, x, y, dir),
            texture: (graphic, ready) => this.characterTexture(graphic, ready),
            blocked: (character, x, y) =>
            {
                if (character === this.hero) this.eventManager.playerBumped(x, y);
                else if (this.hero.x === x && this.hero.y === y && typeof character.id === 'number')
                {
                    this.eventManager.eventTouchedPlayer(character.id);
                }
            },
        };
    }

    /**
     * @brief Replace the current map with another one.
     * @param request Map and position.
     */
    private async enterMap (request: WarpRequest): Promise<void>
    {
        const assets = await loadMapAssets(request.map);
        await Promise.all(Object.entries(assets.images).map(([, url]) => this.loadFile('image', url, url)));

        //  Clear the old map.
        for (const character of this.characters.values()) character.destroy();
        this.characters.clear();
        this.nextMove.clear();
        this.onRoute.clear();
        this.tilemap?.destroy();

        const { map } = assets;
        this.mapId = request.map;
        this.mapWidth = map.width;
        this.mapHeight = map.height;
        this.tileW = map.tilewidth;
        this.tileH = map.tileheight;
        const key = `map:${request.map}`;
        if (this.cache.tilemap.exists(key)) this.cache.tilemap.remove(key);
        this.cache.tilemap.add(key, { format: Tilemaps.Formats.TILED_JSON, data: map });
        const tilemap = this.make.tilemap({ key });
        this.tilemap = tilemap;
        const tilesets = Object.entries(assets.images)
            .map(([name, url]) => tilemap.addTilesetImage(name, url))
            .filter((tileset): tileset is Tilemaps.Tileset => tileset !== null);

        this.blocked = new Set();
        tilemap.layers.forEach((layerData, index) =>
        {
            const props = Object.fromEntries(((layerData.properties ?? []) as { name: string; value: unknown }[])
                .map((property) => [property.name, property.value]));
            const layer = tilemap.createLayer(index, tilesets, 0, 0);
            if (!layer) return;
            layer.setDepth(props.above === true ? 1500 + index : index);
            if (props.collision === true) layer.setVisible(false);
            layer.layer.data.forEach((row) => row.forEach((tile) =>
            {
                if (tile.index < 0) return;
                if (props.collision === true || (tile.properties as Record<string, unknown> | undefined)?.collides === true)
                {
                    this.blocked.add(`${tile.x},${tile.y}`);
                }
            }));
        });

        const placed = instantiateMap(map, request.map, bundle);
        for (const issue of placed.issues) console.warn(`[overworld] ${issue}`);
        this.spawns = placed.spawns;

        //  Characters for 1 × 1 events; larger events are trigger areas.
        const graphics = new Set<string>([PLAYER_GRAPHIC]);
        for (const event of placed.events)
        {
            for (const page of event.script.pages) if (page.graphic) graphics.add(page.graphic);
        }
        await Promise.all([...graphics].map((graphic) => this.loadCharacterSheet(graphic)));
        for (const event of placed.events)
        {
            if (event.width !== 1 || event.height !== 1) continue;
            this.characters.set(event.id, new Character(this.world(), event.id, event.x, event.y));
        }

        //  No position and no spawn named: use the Spawn called "start", else the first one.
        const fallback = request.x === undefined || request.y === undefined
            ? this.spawns.start ?? Object.values(this.spawns)[0]
            : undefined;
        const spawn = request.spawn ? this.spawns[request.spawn] : fallback;
        if (request.spawn && !spawn) console.warn(`[overworld] map "${request.map}" has no Spawn named "${request.spawn}"`);
        const x = request.x ?? spawn?.x ?? 0;
        const y = request.y ?? spawn?.y ?? 0;
        this.hero.placeAt(x, y);
        this.hero.turn(request.dir ?? spawn?.dir ?? this.hero.facing);
        this.hero.refresh();

        const camera = this.cameras.main;
        camera.setBounds(0, 0, Math.max(map.width * map.tilewidth, this.scale.width), Math.max(map.height * map.tileheight, this.scale.height));
        this.cameraFollows = true;
        this.followPlayer();

        this.eventManager.loadMap(request.map, placed.events);
        this.savePosition();
        const bgm = placed.props.bgm;
        if (typeof bgm === 'string' && bgm) this.playBgm(bgm, 1, 400);
    }

    /** @brief Remember where the player stands. */
    private savePosition (): void
    {
        this.state.setPosition({ map: this.mapId, x: this.hero.x, y: this.hero.y, facing: this.hero.facing });
    }

    /** @brief Keep the camera on the player. */
    private followPlayer (): void
    {
        if (!this.cameraFollows) return;
        const { px, py } = this.hero.position();
        this.cameras.main.centerOn(px, py);
    }

    // ---------------------------------------------------------- Loading

    /**
     * @brief Load one file into Phaser's cache, once.
     * @return Whether it loaded.
     */
    private loadFile (type: 'image' | 'audio' | 'spritesheet', key: string, url: string, frame?: number): Promise<boolean>
    {
        const exists = type === 'audio' ? this.cache.audio.exists(key) : this.textures.exists(key);
        if (exists) return Promise.resolve(true);
        const pending = this.loading.get(key);
        if (pending) return pending;
        const promise = new Promise<boolean>((resolve) =>
        {
            //  The batch's COMPLETE event always fires, also for files that failed to load or to
            //  be processed (a dev server answers a missing file with its HTML page).
            this.load.once(Loader.Events.COMPLETE, () =>
            {
                this.loading.delete(key);
                resolve(type === 'audio' ? this.cache.audio.exists(key) : this.textures.exists(key));
            });
            if (type === 'spritesheet') this.load.spritesheet(key, url, { frameWidth: frame!, frameHeight: frame! });
            else if (type === 'audio') this.load.audio(key, url);
            else this.load.image(key, url);
            if (!this.load.isLoading()) this.load.start();
        });
        this.loading.set(key, promise);
        return promise;
    }

    /** @brief Load a character sheet and cut it into 4 × 4 frames named `0` to `15`. */
    private async loadCharacterSheet (graphic: string): Promise<boolean>
    {
        const key = `char:${graphic}`;
        const ok = await this.loadFile('image', key, `${CHARACTER_DIR}/${graphic}.png`);
        if (!ok || this.textures.get(key).has('15')) return ok;
        const texture = this.textures.get(key);
        const source = texture.getSourceImage() as { width: number; height: number };
        const w = Math.floor(source.width / 4);
        const h = Math.floor(source.height / 4);
        for (let i = 0; i < 16; i++) texture.add(String(i), 0, (i % 4) * w, Math.floor(i / 4) * h, w, h);
        return true;
    }

    /** @brief For characters: the texture of a graphic, loading it first if needed. */
    private characterTexture (graphic: string, ready: () => void): string | null
    {
        const key = `char:${graphic}`;
        if (this.textures.exists(key) && this.textures.get(key).has('15')) return key;
        void this.loadCharacterSheet(graphic).then((ok) => { if (ok) ready(); });
        return null;
    }

    /** @brief Load the emote sheet, if the game has one. */
    private async loadEmotes (): Promise<void>
    {
        this.hasEmotes = await this.loadFile('spritesheet', 'stab-emotes', EMOTE_SHEET, EMOTE_FRAME_SIZE);
    }

    // ------------------------------------------------------------ Frame

    update (_time: number, delta: number)
    {
        if (!this.ready) return;
        this.countPlayTime(delta);
        if (this.changingMap) return;
        //  The press that closes a script's last message must not start the event again: after a
        //  script, the action button only counts once it has been let go. (The dialogue UI also
        //  consumes the presses it handles.)
        let action = input.justPressed('a');
        if (this.eventManager.busy || this.uiModalOpen) this.actionLocked = true;
        else if (!input.isDown('a')) this.actionLocked = false;
        if (this.actionLocked) action = false;
        this.eventManager.update();
        this.moveEvents(delta);
        this.followPlayer();
        if (this.eventManager.busy || this.uiModalOpen || !this.playerControl || this.hero.moving) return;

        if (action && this.eventManager.playerAction()) return;
        const dir: Direction | null = input.direction();
        if (dir) void this.walkPlayer(dir);
    }

    /**
     * @brief Count play time, adding it to the save once a second so the
     *        save's listeners are not woken every frame.
     * @param delta Milliseconds since the last frame.
     */
    private countPlayTime(delta: number): void
    {
        this.unsavedPlayTime += delta;
        if (this.unsavedPlayTime >= PLAY_TIME_STEP_MS) this.flushPlayTime();
    }

    /** @brief Add the play time counted so far to the save. */
    private flushPlayTime(): void
    {
        if (this.unsavedPlayTime > 0) this.state?.addPlayTime(this.unsavedPlayTime);
        this.unsavedPlayTime = 0;
    }

    /** @brief Take one step with the player and tell the events. */
    private async walkPlayer (dir: Direction): Promise<void>
    {
        this.hero.setSpeed(input.isDown('b') ? 4 : 3);
        if (!(await this.hero.step(dir))) return;
        this.savePosition();
        this.eventManager.playerMoved(this.hero.x, this.hero.y);
    }

    /** @brief Move events that wander by themselves (page `moveType`). */
    private moveEvents (delta: number): void
    {
        if (this.eventManager.busy) return;
        for (const event of this.eventManager.events)
        {
            const page = event.page;
            const character = this.characters.get(event.id);
            if (!page || !character || event.locked || character.moving || this.onRoute.has(event.id)) continue;
            const type = page.moveType ?? 'fixed';
            if (type === 'fixed') continue;
            if (type === 'route')
            {
                if (!page.moveRoute?.length) continue;
                this.onRoute.add(event.id);
                void runRoute(character, page.moveRoute, {
                    player: this.hero, wait: (ms) => this.wait(ms), playSe: (name) => this.playSe(name),
                    random: Math.random, skipBlocked: true, cancelled: () => event.page !== page || this.eventManager.busy,
                }).finally(() => this.onRoute.delete(event.id));
                continue;
            }
            const due = (this.nextMove.get(event.id) ?? 0) - delta;
            this.nextMove.set(event.id, due);
            if (due > 0) continue;
            this.nextMove.set(event.id, MOVE_DELAY[page.moveFrequency ?? 3] * (0.5 + Math.random()));
            const dirs: Direction[] = ['up', 'down', 'left', 'right'];
            const dir = type === 'towardPlayer'
                ? directionTowards(character.x, character.y, this.hero.x, this.hero.y)
                : dirs[Math.floor(Math.random() * 4)];
            if (dir) void character.step(dir);
        }
    }

    // ------------------------------------------------------ WorldHost

    player (): Actor
    {
        return this.hero;
    }

    actorOf (eventId: number): Actor | null
    {
        return this.characters.get(eventId) ?? null;
    }

    canStep (actor: Actor | null, x: number, y: number, dir: Direction): boolean
    {
        const [dx, dy] = DIRECTION_DELTA[dir];
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= this.mapWidth || ny >= this.mapHeight) return false;
        if (actor?.through) return true;
        if (this.blocked.has(`${nx},${ny}`)) return false;
        const others = [this.hero, ...this.characters.values()];
        return !others.some((other) => other !== actor && other.present && !other.through && other.x === nx && other.y === ny);
    }

    syncEvent (eventId: number): void
    {
        const character = this.characters.get(eventId);
        const event = this.eventManager.event(eventId);
        if (!character || !event) return;
        const page = event.page;
        character.present = page !== null;
        if (!page)
        {
            character.setGraphic('');
            return;
        }
        character.through = page.through ?? false;
        character.alwaysOnTop = page.alwaysOnTop ?? false;
        character.setSpeed(page.moveSpeed ?? 3);
        if (page.direction && !event.locked) character.turn(page.direction);
        character.setGraphic(page.graphic ?? '');
    }

    message (text: string, speaker?: string): Promise<void>
    {
        return showMessage(text, speaker);
    }

    choose (prompt: string | null, options: string[], cancel: number): Promise<number>
    {
        return showChoice(prompt, options, cancel);
    }

    nameInput (prompt: string | null, current: string, max: number, options?: { language?: string; species?: string }): Promise<string>
    {
        return showNameInput(prompt, current, max, { language: options?.language ?? this.state.language, species: options?.species });
    }

    pokedexEntry (species: string, languages: string[]): Promise<void>
    {
        return showPokedexEntry(species, languages);
    }

    ink (story: string, knot?: string): Promise<void>
    {
        return runInk(story, knot, {
            state: this.state,
            text: this.eventManager.text,
            message: (text, speaker) => this.message(text, speaker),
            choose: (prompt, options, cancel) => this.choose(prompt, options, cancel),
            giveItem: (item, quantity) =>
            {
                const pocket = this.state.countItem(item) > 0 ? undefined : (this.runtimeData.itemPocket?.(item) ?? 'misc');
                return this.state.addItem(item, quantity, pocket);
            },
        });
    }

    /** @brief Timers that keep running while the scene sleeps (battle hooks wait during battles). */
    wait (ms: number): Promise<void>
    {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    camera (to: { x: number; y: number } | 'player', ms: number): Promise<void>
    {
        const target = to === 'player'
            ? this.hero.position()
            : { px: (to.x + 0.5) * this.tileW, py: (to.y + 0.5) * this.tileH };
        this.cameraFollows = false;
        return new Promise((resolve) =>
        {
            this.cameras.main.pan(target.px, target.py, Math.max(1, ms), 'Sine.easeInOut', true, (_camera, progress) =>
            {
                if (progress < 1) return;
                if (to === 'player') this.cameraFollows = true;
                resolve();
            });
        });
    }

    shake (intensity: number, ms: number): Promise<void>
    {
        return new Promise((resolve) =>
        {
            this.cameras.main.shake(ms, intensity);
            this.time.delayedCall(ms, () => resolve());
        });
    }

    async emote (actor: Actor, emote: string): Promise<void>
    {
        const frame = EMOTES[emote as keyof typeof EMOTES];
        if (!this.hasEmotes || frame === undefined || !(actor instanceof Character))
        {
            if (import.meta.env.DEV && !this.hasEmotes) console.info(`[overworld] emote "${emote}" (no ${EMOTE_SHEET})`);
            return this.wait(EMOTE_MS);
        }
        const { px, py } = actor.top();
        const bubble = this.add.image(px, py, 'stab-emotes', frame).setOrigin(0.5, 1).setDepth(2500);
        await this.wait(EMOTE_MS);
        bubble.destroy();
    }

    fade (dir: 'out' | 'in', color: string, ms: number): Promise<void>
    {
        const [r, g, b] = rgb(color);
        const camera = this.cameras.main;
        return new Promise((resolve) =>
        {
            const event = dir === 'out' ? Cameras.Scene2D.Events.FADE_OUT_COMPLETE : Cameras.Scene2D.Events.FADE_IN_COMPLETE;
            camera.once(event, () => resolve());
            if (dir === 'out') camera.fadeOut(Math.max(1, ms), r, g, b);
            else camera.fadeIn(Math.max(1, ms), r, g, b);
        });
    }

    tint (color: string, alpha: number, ms: number): Promise<void>
    {
        const [r, g, b] = rgb(color);
        if (!this.tintLayer)
        {
            this.tintLayer = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0, 0)
                .setOrigin(0, 0).setScrollFactor(0).setDepth(3000);
        }
        const layer = this.tintLayer;
        layer.setFillStyle((r << 16) | (g << 8) | b, layer.fillAlpha);
        return new Promise((resolve) =>
        {
            if (ms <= 0)
            {
                layer.setFillStyle(layer.fillColor, alpha);
                resolve();
                return;
            }
            this.tweens.add({ targets: layer, fillAlpha: alpha, duration: ms, onComplete: () => resolve() });
        });
    }

    // ---------------------------------------------------------- Pictures

    async showPicture(request: PictureRequest): Promise<void>
    {
        const key = `pic:${request.name}`;
        if (!(await this.loadFile('image', key, `${PICTURE_DIR}/${request.name}.png`)))
        {
            console.warn(`[overworld] picture "${request.name}" not found (${PICTURE_DIR}/${request.name}.png)`);
            return;
        }
        if (!this.scene.isActive()) return;
        this.removePicture(request.id);
        const image = this.add.image(0, 0, key)
                          .setOrigin(0, 0)
                          .setScrollFactor(0)
                          .setDepth(PICTURE_DEPTH + request.id)
                          .setFlipX(request.mirror);
        //  Centred pictures are anchored on a whole pixel, so they never sit half a pixel off.
        const centred = request.origin === 'center';
        const picture: ShownPicture = {
            image,
            anchorX: centred ? Math.floor(image.width / 2) : 0,
            anchorY: centred ? Math.floor(image.height / 2) : 0,
            x: request.x,
            y: request.y,
            opacity: request.ms > 0 ? 0 : request.opacity,
            tween: null,
            finish: null,
        };
        this.pictures.set(request.id, picture);
        this.placePicture(picture);
        if (request.ms > 0) await this.animatePicture(picture, { opacity: request.opacity }, request.ms, 'linear');
    }

    movePicture(id: number, to: PictureMove, ms: number, ease: PictureEase): Promise<void>
    {
        const picture = this.pictures.get(id);
        if (!picture) return Promise.resolve();
        return this.animatePicture(picture, to, ms, ease);
    }

    async erasePicture(id: number|'all', ms: number): Promise<void>
    {
        const ids = id === 'all' ? [...this.pictures.keys()] : [id];
        await Promise.all(ids.map(async (pictureId) => {
            const picture = this.pictures.get(pictureId);
            if (!picture) return;
            if (ms > 0) await this.animatePicture(picture, { opacity: 0 }, ms, 'linear');
            //  Only remove it if it was not replaced while fading out.
            if (this.pictures.get(pictureId) === picture) this.removePicture(pictureId);
        }));
    }

    /** @brief Draw a picture at its position and opacity, on whole pixels. */
    private placePicture(picture: ShownPicture): void
    {
        picture.image.setPosition(Math.round(picture.x) - picture.anchorX, Math.round(picture.y) - picture.anchorY);
        picture.image.setAlpha(picture.opacity);
    }

    /**
     * @brief Move or fade a picture, replacing any move in progress.
     * @return Resolves when the move ends, or when the picture is removed or moved again.
     */
    private animatePicture(picture: ShownPicture, to: PictureMove, ms: number, ease: PictureEase): Promise<void>
    {
        this.stopPicture(picture);
        const target = { x: to.x ?? picture.x, y: to.y ?? picture.y, opacity: to.opacity ?? picture.opacity };
        if (ms <= 0)
        {
            Object.assign(picture, target);
            this.placePicture(picture);
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            const values = { x: picture.x, y: picture.y, opacity: picture.opacity };
            picture.finish = () => {
                picture.finish = null;
                resolve();
            };
            picture.tween = this.tweens.add({
                targets: values,
                ...target,
                duration: ms,
                ease: PICTURE_EASE[ease],
                onUpdate: () => {
                    Object.assign(picture, values);
                    this.placePicture(picture);
                },
                onComplete: () => {
                    picture.tween = null;
                    Object.assign(picture, target);
                    this.placePicture(picture);
                    picture.finish?.();
                },
            });
        });
    }

    /** @brief Stop a picture's move where it is, and let its script go on. */
    private stopPicture(picture: ShownPicture): void
    {
        picture.tween?.stop();
        picture.tween = null;
        picture.finish?.();
    }

    /** @brief Remove a picture at once. */
    private removePicture(id: number): void
    {
        const picture = this.pictures.get(id);
        if (!picture) return;
        this.stopPicture(picture);
        picture.image.destroy();
        this.pictures.delete(id);
    }

    flash (color: string, ms: number): Promise<void>
    {
        const [r, g, b] = rgb(color);
        return new Promise((resolve) =>
        {
            this.cameras.main.flash(ms, r, g, b);
            this.time.delayedCall(ms, () => resolve());
        });
    }

    playSe (name: string, volume = 1): void
    {
        const key = `se:${name}`;
        void this.loadFile('audio', key, `assets/sound/se/${name}.ogg`).then((ok) => { if (ok) this.sound.play(key, { volume }); });
    }

    playBgm (name: string | null, volume: number, fadeMs: number): void
    {
        if (name && this.bgm?.name === name) return;
        const old = this.bgm;
        this.bgm = null;
        if (old)
        {
            if (fadeMs > 0) this.tweens.add({ targets: old.sound, volume: 0, duration: fadeMs, onComplete: () => old.sound.destroy() });
            else old.sound.destroy();
        }
        if (!name) return;
        const key = `bgm:${name}`;
        void this.loadFile('audio', key, `assets/sound/bgm/${name}.ogg`).then((ok) =>
        {
            if (!ok) return;
            const sound = this.sound.add(key, { loop: true, volume: fadeMs > 0 ? 0 : volume });
            sound.play();
            this.bgm = { name, sound };
            if (fadeMs > 0) this.tweens.add({ targets: sound, volume, duration: fadeMs });
        });
    }

    async playMe (name: string): Promise<void>
    {
        const key = `me:${name}`;
        if (!(await this.loadFile('audio', key, `assets/sound/me/${name}.ogg`))) return;
        this.bgm?.sound.pause();
        await new Promise<void>((resolve) =>
        {
            const sound = this.sound.add(key);
            sound.once('complete', () =>
            {
                sound.destroy();
                resolve();
            });
            sound.play();
        });
        this.bgm?.sound.resume();
    }

    async playCry (species: string): Promise<void>
    {
        const key = `cry:${species}`;
        if (!(await this.loadFile('audio', key, `assets/${CRY_DIR}/${species}.ogg`))) return;
        await new Promise<void>((resolve) =>
        {
            const sound = this.sound.add(key);
            sound.once('complete', () =>
            {
                sound.destroy();
                resolve();
            });
            sound.play();
        });
    }

    async warp (request: WarpRequest): Promise<void>
    {
        this.changingMap = true;
        try
        {
            if (request.transition === 'fade') await this.fade('out', '#000000', 250);
            await this.enterMap(request);
            if (request.transition === 'fade') await this.fade('in', '#000000', 250);
        }
        finally
        {
            this.changingMap = false;
        }
    }

    battle (request: BattleRequest): Promise<BattleResult>
    {
        return new Promise((resolve) =>
        {
            const data: BattleSceneData = {
                usePlayerParty: true,
                wild: request.kind === 'wild',
                onStep: request.onStep,
                options: {
                    formatid: request.format === 'doubles' ? 'gen9doublescustomgame' : 'gen9customgame',
                    p1: { team: '' },
                    p2: { name: request.foeName, team: request.team, ai: 'random' },
                },
            };
            EventBus.once(GameEvents.BATTLE_RESULT, ({ result }: BattleResultData) =>
            {
                //  Leave the result on screen for a moment, then come back.
                setTimeout(() =>
                {
                    this.scene.stop(BATTLE_SCENE_KEY);
                    this.scene.wake(OVERWORLD_SCENE_KEY);
                    resolve(result);
                }, 1000);
            });
            this.scene.sleep(OVERWORLD_SCENE_KEY);
            this.scene.run(BATTLE_SCENE_KEY, data);
        });
    }

    /**
     * @brief The player lost a battle they had to win.
     *
     * Heals the party and returns the player to the map's `Spawn` named
     * `heal` (or the spot they stand on). Replace this for your game's rules
     * (last Pokémon Center, money loss...).
     */
    async whiteout (): Promise<void>
    {
        this.state.healParty();
        await this.fade('out', '#000000', 400);
        const heal = this.spawns.heal;
        if (heal) await this.enterMap({ map: this.mapId, spawn: 'heal', transition: 'none' });
        await this.fade('in', '#000000', 400);
    }

    setPlayerControl (enabled: boolean): void
    {
        this.playerControl = enabled;
    }
}
