/**
 * @file Character.ts
 * @brief A character on the overworld (the player or an event), moving tile by tile.
 *
 * Implements the event system's `Actor`, so scripts move it with routes,
 * `pathTo` and friends. Graphics are RPG Maker XP / Essentials character
 * sheets: `assets/img/characters/<name>.png`, 4 columns (walking frames) by
 * 4 rows (facing down, left, right, up). None are shipped; add your own.
 *
 * A character whose graphic is missing is invisible in production builds.
 * In development (`npm run dev`) it is drawn as an outlined box so maps can
 * be tested before any art exists; that box is drawn by code, not loaded.
 */
import type { GameObjects, Scene } from 'phaser';
import type { Actor } from '../events/runtime/host';
import { DIRECTION_DELTA } from '../events/pathfinding';
import type { Direction } from '../events/schema';

/** @brief Folder of character sheets, relative to the page. */
export const CHARACTER_DIR = 'assets/img/characters';

/** @brief Time one step takes at each speed (1 to 6), in milliseconds. 3 is walking, 4 running. */
export const STEP_MS = [0, 1066, 533, 266, 133, 66, 33] as const;

/** @brief Row of each direction in a character sheet. */
const ROW: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };

/** @brief What a character needs from the scene it lives in. */
export interface CharacterWorld
{
    scene: Scene;
    tileWidth: number;
    tileHeight: number;
    /** Whether `actor` may step from (x, y) towards `dir`. */
    canStep (actor: Actor, x: number, y: number, dir: Direction): boolean;
    /**
     * Texture key of a graphic, ready to use, or `null` if it is not loaded
     * (yet). Starts loading it if needed and calls `ready` when done.
     */
    texture (graphic: string, ready: () => void): string | null;
    /** A step was refused: something is on (x, y). */
    blocked? (character: Character, x: number, y: number): void;
}

/** @brief A character on the map. */
export class Character implements Actor
{
    /** Event ID, or `'player'`. */
    readonly id: number | 'player';
    x: number;
    y: number;
    facing: Direction = 'down';
    through = false;
    /** Drawn above everything else (an event page's `alwaysOnTop`). */
    alwaysOnTop = false;
    /** Present on the map: an event without an active page is not, and blocks nothing. */
    present = true;
    visible = true;
    moving = false;
    speed = 3;
    graphic = '';

    private readonly world: CharacterWorld;
    private view: GameObjects.Sprite | GameObjects.Rectangle | null = null;
    private steps = 0;

    /**
     * @param world The scene and map.
     * @param id Event ID or `'player'`.
     * @param x Tile column.
     * @param y Tile row.
     */
    constructor (world: CharacterWorld, id: number | 'player', x: number, y: number)
    {
        this.world = world;
        this.id = id;
        this.x = x;
        this.y = y;
    }

    /** @brief Where the character's feet are drawn, in pixels. */
    private pixel (x = this.x, y = this.y): { px: number; py: number }
    {
        return { px: (x + 0.5) * this.world.tileWidth, py: (y + 1) * this.world.tileHeight };
    }

    /** @brief Remove the drawing. */
    destroy (): void
    {
        this.view?.destroy();
        this.view = null;
    }

    /** @brief Draw the character as it is now (graphic, frame, position, depth). */
    refresh (): void
    {
        const { px, py } = this.pixel();
        this.view?.setPosition(px, py);
        this.view?.setVisible(this.visible && this.present);
        this.view?.setDepth(this.alwaysOnTop ? 2000 : 100 + this.y);
        this.showFrame(0);
    }

    /** @brief Show a walking frame (0 = standing) of the current direction. */
    private showFrame (column: number): void
    {
        if (this.view && 'setFrame' in this.view && this.view.texture.has(String(ROW[this.facing] * 4 + column)))
        {
            this.view.setFrame(String(ROW[this.facing] * 4 + column));
        }
    }

    setGraphic (graphic: string): void
    {
        this.graphic = graphic;
        this.view?.destroy();
        this.view = null;
        if (graphic)
        {
            const key = this.world.texture(graphic, () =>
            {
                if (this.graphic === graphic) this.setGraphic(graphic);
            });
            if (key) this.view = this.world.scene.add.sprite(0, 0, key, '0').setOrigin(0.5, 1);
            else if (import.meta.env?.DEV)
            {
                //  Development only: an outline so the character can be seen before art exists.
                const color = this.id === 'player' ? 0x40c0ff : 0xffc040;
                this.view = this.world.scene.add
                    .rectangle(0, 0, this.world.tileWidth - 2, this.world.tileHeight - 2)
                    .setStrokeStyle(1, color).setOrigin(0.5, 1);
            }
        }
        this.refresh();
    }

    turn (dir: Direction): void
    {
        this.facing = dir;
        if (!this.moving) this.showFrame(0);
    }

    placeAt (x: number, y: number): void
    {
        this.x = x;
        this.y = y;
        this.refresh();
    }

    setSpeed (speed: number): void
    {
        this.speed = Math.min(6, Math.max(1, Math.round(speed)));
    }

    setThrough (through: boolean): void
    {
        this.through = through;
    }

    setVisible (visible: boolean): void
    {
        this.visible = visible;
        this.refresh();
    }

    /**
     * @brief Walk one tile.
     * @param dir Direction.
     * @return `false` if the way was blocked (the character only turned).
     */
    async step (dir: Direction): Promise<boolean>
    {
        this.turn(dir);
        if (!this.world.canStep(this, this.x, this.y, dir))
        {
            const [dx, dy] = DIRECTION_DELTA[dir];
            this.world.blocked?.(this, this.x + dx, this.y + dy);
            return false;
        }
        const [dx, dy] = DIRECTION_DELTA[dir];
        //  Take the new tile at once, so no one else walks into it meanwhile.
        this.x += dx;
        this.y += dy;
        this.moving = true;
        this.steps++;
        this.showFrame(this.steps % 2 ? 1 : 3);
        const { px, py } = this.pixel();
        const duration = STEP_MS[this.speed];
        this.view?.setDepth(this.alwaysOnTop ? 2000 : 100 + Math.max(this.y, this.y - dy));
        await this.tween({ x: px, y: py }, duration, () =>
        {
            this.showFrame(0);
        });
        this.moving = false;
        this.refresh();
        return true;
    }

    /**
     * @brief Jump to a tile `dx`, `dy` away, ignoring what is in between.
     */
    async jump (dx: number, dy: number): Promise<void>
    {
        const from = this.pixel();
        this.x += dx;
        this.y += dy;
        const to = this.pixel();
        const height = this.world.tileHeight * (0.5 + 0.25 * Math.max(Math.abs(dx), Math.abs(dy)));
        this.moving = true;
        const duration = STEP_MS[this.speed] * (1 + Math.max(Math.abs(dx), Math.abs(dy)));
        await new Promise<void>((resolve) =>
        {
            this.world.scene.tweens.addCounter({
                from: 0, to: 1, duration,
                onUpdate: (tween) =>
                {
                    const t = tween.getValue() ?? 0;
                    this.view?.setPosition(from.px + (to.px - from.px) * t, from.py + (to.py - from.py) * t - Math.sin(Math.PI * t) * height);
                },
                onComplete: () => resolve(),
            });
        });
        this.moving = false;
        this.refresh();
    }

    /** @brief Tween the drawing (or just wait, if there is none). */
    private tween (props: { x: number; y: number }, duration: number, halfway?: () => void): Promise<void>
    {
        return new Promise((resolve) =>
        {
            const scene = this.world.scene;
            if (halfway) scene.time.delayedCall(duration / 2, halfway);
            if (!this.view)
            {
                scene.time.delayedCall(duration, () => resolve());
                return;
            }
            scene.tweens.add({ targets: this.view, ...props, duration, onComplete: () => resolve() });
        });
    }

    /** @brief Where the character is drawn right now (mid-step too), at the centre of its tile, in pixels. */
    position (): { px: number; py: number }
    {
        if (this.view) return { px: this.view.x, py: this.view.y - this.world.tileHeight / 2 };
        const { px, py } = this.pixel();
        return { px, py: py - this.world.tileHeight / 2 };
    }

    /** @brief The top of the drawing, in pixels, for emote bubbles. */
    top (): { px: number; py: number }
    {
        const { px, py } = this.pixel();
        const height = this.view ? this.view.displayHeight : this.world.tileHeight;
        return { px, py: py - height };
    }
}
