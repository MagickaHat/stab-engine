/**
 * @file host.ts
 * @brief What the event runtime needs from the game world, as interfaces.
 *
 * The interpreter never touches Phaser or React. Everything it shows or
 * moves goes through a `WorldHost` (the overworld scene implements it, see
 * src/game/scenes/Overworld.ts) and the characters it gets from there
 * (`Actor`). Tests use small fakes instead, so the whole event system runs
 * in Node.
 */
import type { PokemonSet } from '@pkmn/sim';
import type { BattleSnapshot, BattleStep } from '../../battle/bridge/index.ts';
import type { BattleResult, Direction, Trainer } from '../schema.ts';
import type { ItemPocket } from '../../data/schemas/engine.ts';

/**
 * @brief A character on the map: the player or an event.
 *
 * Positions are in tiles. Movement methods resolve when the movement has
 * been shown.
 */
export interface Actor
{
    /** Tile column. */
    readonly x: number;
    /** Tile row. */
    readonly y: number;
    readonly facing: Direction;
    /** Walks through walls and characters. */
    readonly through: boolean;
    /**
     * Take one step.
     * @param dir Direction.
     * @return `false` if the way is blocked (the character then only turns).
     */
    step (dir: Direction): Promise<boolean>;
    /** Jump by `dx`, `dy` tiles (0, 0 hops on the spot). Jumps ignore what is in between. */
    jump (dx: number, dy: number): Promise<void>;
    turn (dir: Direction): void;
    /** Move to a tile at once. */
    placeAt (x: number, y: number): void;
    /** 1 (slowest) to 6 (fastest). */
    setSpeed (speed: number): void;
    setThrough (through: boolean): void;
    setVisible (visible: boolean): void;
    /** Graphic name; empty for none. */
    setGraphic (graphic: string): void;
}

/** @brief Where a warp goes. */
export interface WarpRequest
{
    map: string;
    x?: number;
    y?: number;
    /** Name of a `Spawn` object on the destination map, used when `x`/`y` are left out. */
    spawn?: string;
    dir?: Direction;
    transition: 'fade' | 'none';
}

/** @brief A battle the runtime asks the host to run. */
export interface BattleRequest
{
    kind: 'trainer' | 'wild';
    /** For trainer battles: the trainer's ID and data. */
    trainerId?: string;
    trainer?: Trainer;
    /** The opponent's name, already translated. */
    foeName: string;
    /** The opponent's team. */
    sets: PokemonSet[];
    /** The team packed for `PlayerOptions.team`. */
    team: string;
    format: 'singles' | 'doubles';
    /**
     * Pass every battle step here and wait for it before showing the next
     * one: it runs the battle hooks.
     */
    onStep: (step: BattleStep, snapshot: BattleSnapshot) => Promise<void>;
}

/** @brief Game data the runtime looks up. Each part is optional; what is missing is left at its default. */
export interface RuntimeData
{
    /** The bag pocket of an item not yet in the bag. Default: `misc`. */
    itemPocket?: (item: string) => ItemPocket | undefined;
    /** A species' first ability's ID. */
    ability?: (species: string) => string | undefined;
    /** A species' learnset (move ID → sources). */
    learnset?: (species: string) => Readonly<Record<string, readonly string[]>> | undefined;
}

/** @brief The game world, as the event runtime sees it. */
export interface WorldHost
{
    /** The player. */
    player (): Actor;
    /** The character of an event on the current map, or `null` if it has none. */
    actorOf (eventId: number): Actor | null;
    /**
     * Whether `actor` (or, with `null`, any walker) could step from a tile to
     * the next one in `dir`: map collisions and other characters.
     */
    canStep (actor: Actor | null, x: number, y: number, dir: Direction): boolean;
    /** Called when an event's page or visibility changed, to redraw it. */
    syncEvent (eventId: number): void;

    /** Show one line of text and wait until the player has read it. */
    message (text: string, speaker?: string): Promise<void>;
    /**
     * Show options and wait for one.
     * @param prompt Text above the options, or `null`.
     * @param options The options' text.
     * @param cancel Option the cancel button picks, or -1 if it cannot be cancelled.
     * @return Index of the option picked.
     */
    choose (prompt: string | null, options: string[], cancel: number): Promise<number>;
    /** Ask the player to type a name. */
    nameInput (prompt: string | null, current: string, max: number): Promise<string>;
    /** Run an ink story (or one knot of it) as a conversation. */
    ink (story: string, knot?: string): Promise<void>;
    /** Wait. Must keep working while the overworld is asleep (battle hooks). */
    wait (ms: number): Promise<void>;

    /** Move the camera to a tile (or back to the player) over `ms`. */
    camera (to: { x: number; y: number } | 'player', ms: number): Promise<void>;
    shake (intensity: number, ms: number): Promise<void>;
    emote (actor: Actor, emote: string): Promise<void>;
    /** Fade the screen to `color` (`out`) or back from it (`in`). */
    fade (dir: 'out' | 'in', color: string, ms: number): Promise<void>;
    /** Tint the screen; `alpha` 0 removes the tint. */
    tint (color: string, alpha: number, ms: number): Promise<void>;
    flash (color: string, ms: number): Promise<void>;

    playSe (name: string, volume?: number): void;
    /** Play background music (`null` stops it). */
    playBgm (name: string | null, volume: number, fadeMs: number): void;
    /** Play a jingle over the music, pausing it, and resolve when it ends. */
    playMe (name: string): Promise<void>;
    playCry (species: string): Promise<void>;

    warp (request: WarpRequest): Promise<void>;
    battle (request: BattleRequest): Promise<BattleResult>;
    /** The player lost a battle they had to win: heal, move to safety... */
    whiteout (): Promise<void>;
    /** Let the player walk (or not), for scripts that run alongside play. */
    setPlayerControl (enabled: boolean): void;
}
