/**
 * @file Battle.ts
 * @brief The battle scene: runs a battle and shows the Pokémon on the field.
 *
 * The scene owns a `BattleBridge` (src/battle/bridge) and is its presenter:
 * the bridge hands it one step at a time and waits until the step has been
 * shown. Today the scene shows what the imported assets allow:
 *
 * - a Pokémon is sent out: its sprite appears and its cry plays;
 * - a Pokémon is hit: its sprite blinks;
 * - a Pokémon faints: its cry plays and the sprite drops away;
 * - a Pokémon changes forme (Mega Evolution, Transform...): the sprite is swapped.
 *
 * Sprites and cries are loaded when they are first needed, not up front.
 *
 * Menus, HP bars and messages are not drawn here. They belong to the React UI,
 * which reads the same battle through `useBattle()` (src/ui/useBattle.ts).
 *
 * Start a battle from another scene:
 * @code
 * const data: BattleSceneData = {
 *     options: {
 *         p1: { name: 'Player', team: importTeam(SAMPLE_TEAM_P1) },
 *         p2: { name: 'Rival', team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
 *     },
 * };
 * this.scene.start(BATTLE_SCENE_KEY, data);
 * @endcode
 *
 * To fight with the player's saved party instead of a fixed team, add
 * `usePlayerParty: true`. The party then enters the battle with its saved HP,
 * status and PP, and the result is written back to the game state when the
 * battle ends (see src/state/battle.ts):
 * @code
 * const data: BattleSceneData = {
 *     usePlayerParty: true,
 *     options: {
 *         p1: { team: '' },   // name and team come from the game state
 *         p2: { name: 'Rival', team: importTeam(SAMPLE_TEAM_P2), ai: 'random' },
 *     },
 * };
 * @endcode
 */
import { Scene } from 'phaser';
import type { GameObjects } from 'phaser';
import { BattleBridge, cryPath, setActiveBattle, spritePath } from '../../battle';
import type {
    AssetManifest, BattleBridgeOptions, BattleSnapshot, BattleStep, PokemonView, StepPokemon,
} from '../../battle';
import { partyBattle, requireGameState } from '../../state';
import type { PartyBattle } from '../../state';
import { EventBus, GameEvents } from '../EventBus';

/** @brief Key of the battle scene, for `this.scene.start()`. */
export const BATTLE_SCENE_KEY = 'Battle';

/** @brief Data passed to the battle scene when it is started. */
export interface BattleSceneData
{
    /** Teams, format and AI: the same options as `BattleBridge` / `BattleEngine`. */
    options: BattleBridgeOptions;
    /**
     * `true` to fight with the party of the game in progress (`getGameState()`).
     * The local player's `team` in `options` is then ignored, and their `name`
     * defaults to the saved player name. Requires a game state with at least
     * one Pokémon that has not fainted.
     */
    usePlayerParty?: boolean;
}

/**
 * @brief Where things are on the battlefield and how long animations take.
 *
 * Positions are fractions of the game size (0 = left/top, 1 = right/bottom)
 * and mark the bottom centre of a sprite. Change them here when the battle
 * backgrounds and menus are designed.
 */
export const BATTLE_LAYOUT = {
    /** The player's Pokémon (back sprite). */
    player: { x: 0.27, y: 0.9 },
    /** The opponent's Pokémon (front sprite). */
    foe: { x: 0.73, y: 0.5 },
    /** Horizontal distance between two Pokémon of the same side in double battles. */
    slotSpacing: 0.22,
    /** Time for a Pokémon to appear or be withdrawn, in milliseconds. */
    enterMs: 150,
    /** Time one blink takes when a Pokémon is hit, in milliseconds. */
    blinkMs: 70,
    /** Number of blinks when a Pokémon is hit. */
    blinks: 4,
    /** Time for a fainted Pokémon to drop away, in milliseconds. */
    faintMs: 350,
    /** Longest time to wait for a cry before moving on, in milliseconds. */
    maxCryMs: 1500,
} as const;

/** @brief Cache key of the asset manifest. */
const MANIFEST_KEY = 'asset-manifest';

/** @brief Folder of the imported assets, relative to the page. */
const ASSETS = 'assets';

/** @brief A Pokémon shown on the field. */
interface Battler
{
    sprite: GameObjects.Image;
    /** Texture key in use (the sprite's path). */
    texture: string;
    /** Audio key of its cry, or `null` if it has none. */
    cry: string | null;
    /** Where the sprite rests, in game pixels. */
    y: number;
}

export class Battle extends Scene
{
    private options: BattleBridgeOptions;
    private usePlayerParty: boolean;
    private manifest: AssetManifest;
    /** Pokémon on the field, by side and position (`"p1:0"`). */
    private readonly battlers = new Map<string, Battler>();

    constructor ()
    {
        super(BATTLE_SCENE_KEY);
    }

    /**
     * @brief Receives the battle to run.
     * @param data See `BattleSceneData`.
     */
    init (data: BattleSceneData)
    {
        if (!data?.options)
        {
            throw new Error('Battle: start this scene with { options } (see BattleSceneData).');
        }
        this.options = data.options;
        this.usePlayerParty = data.usePlayerParty ?? false;
    }

    preload ()
    {
        //  The manifest stays in the cache, so it is only downloaded for the first battle.
        if (!this.cache.json.exists(MANIFEST_KEY)) this.load.json(MANIFEST_KEY, `${ASSETS}/manifest.json`);
    }

    create ()
    {
        this.battlers.clear();
        this.manifest = (this.cache.json.get(MANIFEST_KEY) as AssetManifest | undefined) ?? { pokemon: {}, cries: [] };

        const party = this.usePlayerParty ? this.linkParty() : null;
        const bridge = new BattleBridge(this.options);
        bridge.setPresenter((step, snapshot) => this.present(step, snapshot));

        const stopWatching = bridge.subscribe(() =>
        {
            const snapshot = bridge.getSnapshot();
            if (snapshot.phase !== 'ended') return;
            stopWatching();
            //  Save the party's condition first, so listeners already see it.
            party?.finish();
            EventBus.emit(GameEvents.BATTLE_END, snapshot.winner ?? null);
        });

        this.events.once('shutdown', () =>
        {
            stopWatching();
            //  Left before the end: keep the damage taken so far. Does nothing after a normal end.
            party?.finish();
            setActiveBattle(null);
            bridge.destroy();
            this.battlers.clear();
        });

        setActiveBattle(bridge);
        EventBus.emit(GameEvents.BATTLE_START, bridge);
        EventBus.emit(GameEvents.SCENE_READY, this);

        bridge.start();
    }

    /**
     * @brief Puts the saved party in the local player's place in `this.options`.
     * @return The link to call `finish()` on when the battle is over.
     * @throws Error if no game is in progress or no party Pokémon can fight.
     */
    private linkParty (): PartyBattle
    {
        const state = requireGameState();
        const side = this.options.perspective === 'p2' ? 'p2' : 'p1';
        const link = partyBattle(state, side);
        const prepare = this.options.prepare;
        this.options = {
            ...this.options,
            [side]: {
                ...this.options[side],
                name: this.options[side].name ?? state.getSnapshot().player.name,
                team: link.team,
            },
            prepare: (battle) =>
            {
                link.prepare(battle);
                prepare?.(battle);
            },
        };
        return link;
    }

    /**
     * @brief Shows one step of the battle. Called by the bridge.
     * @param step What happened.
     * @param snapshot The battle right after it.
     * @return Resolves when the step has been shown.
     */
    private async present (step: BattleStep, snapshot: BattleSnapshot): Promise<void>
    {
        switch (step.kind)
        {
            case 'switch':
                await this.showSwitch(step.pokemon, snapshot, step.replace);
                break;
            case 'damage':
                await this.showHit(step.pokemon);
                break;
            case 'faint':
                await this.showFaint(step.pokemon);
                break;
            default:
                //  Forme changes, Transform, Illusion ending... anything that changes a sprite.
                await this.refreshSprites(snapshot);
        }
    }

    /**
     * @brief A Pokémon enters the field.
     * @param pokemon Who, from the step.
     * @param snapshot The battle after the switch.
     * @param quiet `true` to swap the sprite without the entrance and cry (an Illusion ended).
     */
    private async showSwitch (pokemon: StepPokemon, snapshot: BattleSnapshot, quiet: boolean): Promise<void>
    {
        const view = this.viewOf(pokemon, snapshot);
        if (!view) return;
        const key = `${pokemon.side}:${pokemon.slot}`;
        const own = pokemon.side === snapshot.player;

        const texture = spritePath(this.manifest, view, own ? 'back' : 'front');
        const cry = cryPath(this.manifest, view);
        const [hasTexture, hasCry] = await this.loadFiles([['image', texture], ['audio', cry]]);

        const previous = this.battlers.get(key);
        if (previous)
        {
            this.battlers.delete(key);
            if (!quiet) await this.tween(previous.sprite, { alpha: 0 }, BATTLE_LAYOUT.enterMs);
            previous.sprite.destroy();
        }
        if (!texture || !hasTexture) return;

        const { x, y } = this.positionOf(own, pokemon.slot);
        const sprite = this.add.image(x, y, texture).setOrigin(0.5, 1).setDepth((own ? 10 : 0) + pokemon.slot);
        this.battlers.set(key, { sprite, texture, cry: hasCry ? cry : null, y });
        if (quiet) return;

        sprite.setAlpha(0);
        await Promise.all([
            this.tween(sprite, { alpha: 1 }, BATTLE_LAYOUT.enterMs),
            this.playCry(hasCry ? cry : null),
        ]);
    }

    /**
     * @brief A Pokémon takes damage: its sprite blinks.
     * @param pokemon Who, from the step.
     */
    private async showHit (pokemon: StepPokemon): Promise<void>
    {
        const battler = this.battlers.get(`${pokemon.side}:${pokemon.slot}`);
        if (!battler) return;
        for (let i = 0; i < BATTLE_LAYOUT.blinks; i++)
        {
            battler.sprite.setVisible(false);
            await this.wait(BATTLE_LAYOUT.blinkMs);
            battler.sprite.setVisible(true);
            await this.wait(BATTLE_LAYOUT.blinkMs);
        }
    }

    /**
     * @brief A Pokémon faints: it cries, then drops away.
     * @param pokemon Who, from the step.
     */
    private async showFaint (pokemon: StepPokemon): Promise<void>
    {
        const key = `${pokemon.side}:${pokemon.slot}`;
        const battler = this.battlers.get(key);
        if (!battler) return;
        this.battlers.delete(key);
        await this.playCry(battler.cry);
        await this.tween(battler.sprite, { y: battler.y + battler.sprite.displayHeight / 2, alpha: 0 }, BATTLE_LAYOUT.faintMs);
        battler.sprite.destroy();
    }

    /**
     * @brief Makes every sprite on the field match the snapshot (after a forme change, for example).
     * @param snapshot The battle to match.
     */
    private async refreshSprites (snapshot: BattleSnapshot): Promise<void>
    {
        for (const side of [snapshot.me, snapshot.foe])
        {
            const own = side.id === snapshot.player;
            for (const [slot, view] of side.active.entries())
            {
                const battler = this.battlers.get(`${side.id}:${slot}`);
                if (!battler || !view) continue;
                const texture = spritePath(this.manifest, view, own ? 'back' : 'front');
                if (!texture || texture === battler.texture) continue;

                const cry = cryPath(this.manifest, view);
                const [hasTexture, hasCry] = await this.loadFiles([['image', texture], ['audio', cry]]);
                if (!hasTexture || !battler.sprite.active) continue;
                battler.sprite.setTexture(texture);
                battler.texture = texture;
                battler.cry = hasCry ? cry : null;
            }
        }
    }

    /**
     * @brief Finds a step's Pokémon in a snapshot.
     * @param pokemon Who, from the step.
     * @param snapshot The snapshot to look in.
     * @return Its view, or `null` if that field position is empty.
     */
    private viewOf (pokemon: StepPokemon, snapshot: BattleSnapshot): PokemonView | null
    {
        const side = pokemon.side === snapshot.player ? snapshot.me : snapshot.foe;
        return side.active[pokemon.slot] ?? null;
    }

    /**
     * @brief Where a Pokémon stands.
     * @param own `true` for the player's side.
     * @param slot Field position (0 in single battles).
     * @return Bottom centre of its sprite, in game pixels.
     */
    private positionOf (own: boolean, slot: number): { x: number; y: number }
    {
        const { width, height } = this.scale;
        const spot = own ? BATTLE_LAYOUT.player : BATTLE_LAYOUT.foe;
        //  In doubles the player's second Pokémon stands to the right, the opponent's to the left.
        const shift = slot * BATTLE_LAYOUT.slotSpacing * (own ? 1 : -1);
        return { x: Math.round((spot.x + shift) * width), y: Math.round(spot.y * height) };
    }

    /**
     * @brief Loads files that are not in the cache yet.
     * @param files Pairs of file type and path inside the assets folder (also used as the
     *              cache key). A `null` path is skipped.
     * @return For each file, `true` if it is available.
     */
    private loadFiles (files: ['image' | 'audio', string | null][]): Promise<boolean[]>
    {
        const ready = (type: string, key: string) => (type === 'image' ? this.textures.exists(key) : this.cache.audio.exists(key));
        const results = files.map(([type, key]) => key !== null && ready(type, key));
        const waiting = new Map<string, number>();
        files.forEach(([type, key], index) =>
        {
            if (key !== null && !results[index]) waiting.set(`${type}:${key}`, index);
        });
        if (!waiting.size) return Promise.resolve(results);

        return new Promise((resolve) =>
        {
            const settle = (file: { type: string; key: string }, ok: boolean) =>
            {
                //  Phaser calls image files "image" and audio files "audio".
                const index = waiting.get(`${file.type}:${file.key}`);
                if (index === undefined) return;
                waiting.delete(`${file.type}:${file.key}`);
                results[index] = ok;
                if (waiting.size) return;
                this.load.off('filecomplete', onComplete);
                this.load.off('loaderror', onError);
                resolve(results);
            };
            const onComplete = (key: string, type: string) => settle({ key, type }, true);
            const onError = (file: { type: string; key: string }) => settle(file, false);
            this.load.on('filecomplete', onComplete);
            this.load.on('loaderror', onError);

            for (const name of waiting.keys())
            {
                const type = name.slice(0, name.indexOf(':')) as 'image' | 'audio';
                const key = name.slice(type.length + 1);
                this.load[type](key, `${ASSETS}/${key}`);
            }
            this.load.start();
        });
    }

    /**
     * @brief Plays a cry and waits for it (up to `BATTLE_LAYOUT.maxCryMs`).
     * @param key Audio key, or `null` for no cry.
     */
    private async playCry (key: string | null): Promise<void>
    {
        //  Browsers keep audio locked until the first touch or click; skip rather than play late.
        if (!key || this.sound.locked) return;
        const cry = this.sound.add(key);
        cry.once('complete', () => cry.destroy());
        this.events.once('shutdown', () => cry.destroy());
        cry.play();
        await this.wait(Math.min(cry.totalDuration * 1000, BATTLE_LAYOUT.maxCryMs));
    }

    /**
     * @brief Runs a tween and waits for it.
     * @param target The object to animate.
     * @param props Properties to animate to.
     * @param duration Length in milliseconds.
     */
    private tween (target: GameObjects.Image, props: Record<string, number>, duration: number): Promise<void>
    {
        return new Promise((resolve) =>
        {
            this.tweens.add({ targets: target, ...props, duration, onComplete: () => resolve() });
        });
    }

    /**
     * @brief Waits on the scene's clock (so it pauses with the scene).
     * @param ms Milliseconds.
     */
    private wait (ms: number): Promise<void>
    {
        return new Promise((resolve) => { this.time.delayedCall(ms, resolve); });
    }
}
