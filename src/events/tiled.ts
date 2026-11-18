/**
 * @file tiled.ts
 * @brief Tiled maps → events: the object classes, their properties, and the factories.
 *
 * Events are placed in Tiled as objects on object layers. Each object's
 * **class** says what it is, and a **factory** registered for that class
 * turns it into an `EventDefinition` when the map loads:
 *
 * | Class        | What it is                                                    |
 * |--------------|---------------------------------------------------------------|
 * | `Event`      | Any event; its pages come from the script named by `script`.  |
 * | `Npc`        | A character who says `text` (or runs `script`).               |
 * | `Sign`       | Shows `text` when the player reads it.                        |
 * | `ItemBall`   | An item on the ground; disappears once taken.                 |
 * | `HiddenItem` | An invisible item found by pressing the action button.        |
 * | `Warp`       | Moves the player to another map when stepped on.              |
 * | `Trainer`    | Battles the player on sight; afterwards says `after`.         |
 * | `Trigger`    | An area that runs `script` when entered (or by itself).       |
 * | `Spawn`      | A named place warps can arrive at. Not an event.              |
 *
 * `CLASS_SPECS` lists every class's properties. `npm run events:sync-tiled`
 * writes them into the Tiled project, so Tiled shows them with drop-down
 * lists of flags, items, species, trainers, scripts and text keys. Games can
 * add classes with `registerFactory()`.
 *
 * Nothing here imports Phaser: the overworld passes in the parsed map JSON.
 */
import type { CompiledScript, EventBundle } from './compile.ts';
import { compileScript } from './compile.ts';
import type { EventDefinition } from './runtime/GameEvent.ts';
import type { Command, Direction, EventScript, MoveType, Page, Trigger } from './schema.ts';

// ------------------------------------------------------------ Tiled JSON

/** @brief A custom property as Tiled writes it in JSON maps. */
export interface TiledProperty
{
    name: string;
    type: string;
    propertytype?: string;
    value: unknown;
}

/** @brief An object in a Tiled object layer (the fields used here). */
export interface TiledObject
{
    id: number;
    name?: string;
    /** The object's class (Tiled 1.9+ writes it as `type` in JSON). */
    type?: string;
    class?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    /** Set for tile objects, whose `y` is their bottom edge. */
    gid?: number;
    visible?: boolean;
    properties?: TiledProperty[];
}

/** @brief A Tiled layer (the fields used here). */
export interface TiledLayer
{
    id?: number;
    name: string;
    type: 'tilelayer' | 'objectgroup' | 'imagelayer' | 'group';
    class?: string;
    visible?: boolean;
    objects?: TiledObject[];
    layers?: TiledLayer[];
    properties?: TiledProperty[];
    data?: number[] | string;
    width?: number;
    height?: number;
}

/** @brief A Tiled map in JSON form (`.tmj`), the fields used here. */
export interface TiledMap
{
    width: number;
    height: number;
    tilewidth: number;
    tileheight: number;
    class?: string;
    layers: TiledLayer[];
    properties?: TiledProperty[];
    tilesets: ({ firstgid: number; source: string } | ({ firstgid: number } & Record<string, unknown>))[];
}

/**
 * @brief Read Tiled properties into a plain object.
 * @param properties Tiled's property list.
 * @return Name → value.
 */
export function readProperties (properties: readonly TiledProperty[] | undefined): Record<string, unknown>
{
    return Object.fromEntries((properties ?? []).map((property) => [property.name, property.value]));
}

/**
 * @brief Every object layer of a map, including those inside group layers.
 * @param layers The map's layers.
 * @return Object layers, top-level first, in drawing order.
 */
export function objectLayers (layers: readonly TiledLayer[]): TiledLayer[]
{
    return layers.flatMap((layer) =>
    {
        if (layer.type === 'objectgroup') return [layer];
        if (layer.type === 'group') return objectLayers(layer.layers ?? []);
        return [];
    });
}

// -------------------------------------------------------- Class specs

/** @brief Names of the enums `npm run events:sync-tiled` writes into the Tiled project. */
export type EnumName =
    |'Flag'|'Variable'|'Item'|'Species'|'Move'|'TrainerId'|'StoryMilestone'|'StoryTrack'|'InkStory'|'InkKnot'|'TextKey'|'Script'|'CommonEvent'|'Map'|'TriggerType'|'Direction'|'MoveType'|'Emote'|'Native'|'Picture';

/** @brief One property of an object class. */
export interface MemberSpec
{
    name: string;
    type: 'string' | 'int' | 'float' | 'bool' | 'file';
    /** Drop-down list to pick the value from. */
    enum?: EnumName;
    default: string | number | boolean;
    /** The validator reports an object that leaves it empty. */
    required?: boolean;
    /** What it does, shown in docs. */
    doc: string;
}

/** @brief One object class. */
export interface ClassSpec
{
    name: string;
    /** Colour Tiled draws its objects in. */
    color: string;
    doc: string;
    members: MemberSpec[];
}

const tags: MemberSpec = { name: 'tags', type: 'string', default: '', doc: 'Comma-separated tags, for `{ "tag": ... }` targets.' };
const direction: MemberSpec = { name: 'direction', type: 'string', enum: 'Direction', default: 'down', doc: 'Direction it faces.' };
const graphic: MemberSpec = { name: 'graphic', type: 'string', default: '', doc: 'Character graphic (assets/img/characters/<name>.png).' };

/** @brief Every object class the engine knows, with its properties. */
export const CLASS_SPECS: readonly ClassSpec[] = [
    {
        name: 'Event', color: '#ffe0a000', doc: 'An event whose pages come from a script.',
        members: [
            { name: 'script', type: 'string', enum: 'Script', default: '', required: true, doc: 'Script ID in content/events.' },
            tags,
        ],
    },
    {
        name: 'Npc', color: '#ff40a0ff', doc: 'A character who talks.',
        members: [
            graphic, direction,
            { name: 'moveType', type: 'string', enum: 'MoveType', default: 'fixed', doc: 'How it wanders.' },
            { name: 'text', type: 'string', enum: 'TextKey', default: '', doc: 'What it says. Ignored when `script` is set.' },
            { name: 'script', type: 'string', enum: 'Script', default: '', doc: 'Script to use instead of `text`.' },
            tags,
        ],
    },
    {
        name: 'Sign', color: '#ffa07040', doc: 'Shows a text when read.',
        members: [{ name: 'text', type: 'string', enum: 'TextKey', default: '', required: true, doc: 'What it says.' }, tags],
    },
    {
        name: 'ItemBall', color: '#ffff4040', doc: 'An item on the ground. Disappears once taken (self switch A).',
        members: [
            { name: 'item', type: 'string', enum: 'Item', default: '', required: true, doc: 'Item ID.' },
            { name: 'quantity', type: 'int', default: 1, doc: 'How many.' },
            { ...graphic, default: 'itemball' },
            tags,
        ],
    },
    {
        name: 'HiddenItem', color: '#ffc04040', doc: 'An invisible item found with the action button.',
        members: [
            { name: 'item', type: 'string', enum: 'Item', default: '', required: true, doc: 'Item ID.' },
            { name: 'quantity', type: 'int', default: 1, doc: 'How many.' },
            tags,
        ],
    },
    {
        name: 'Warp', color: '#ff4080ff', doc: 'Moves the player to another map when stepped on.',
        members: [
            { name: 'map', type: 'string', enum: 'Map', default: '', required: true, doc: 'Destination map ID.' },
            { name: 'spawn', type: 'string', default: '', doc: 'Name of a Spawn object there (used when x/y are -1).' },
            { name: 'x', type: 'int', default: -1, doc: 'Destination column (-1: use spawn).' },
            { name: 'y', type: 'int', default: -1, doc: 'Destination row (-1: use spawn).' },
            { ...direction, default: '', doc: 'Direction to face on arrival (empty: keep).' },
            { name: 'fade', type: 'bool', default: true, doc: 'Fade the screen out and in.' },
            { name: 'se', type: 'string', default: '', doc: 'Sound effect to play (assets/sound/se).' },
            tags,
        ],
    },
    {
        name: 'Trainer', color: '#ffff0000', doc: 'Battles the player on sight.',
        members: [
            { name: 'trainer', type: 'string', enum: 'TrainerId', default: '', required: true, doc: 'Trainer ID.' },
            graphic, direction,
            { name: 'sightRange', type: 'int', default: 4, doc: 'Tiles it sees.' },
            { name: 'intro', type: 'string', enum: 'TextKey', default: '', doc: 'Said before the battle.' },
            { name: 'after', type: 'string', enum: 'TextKey', default: '', doc: 'Said when talked to after losing.' },
            { name: 'script', type: 'string', enum: 'Script', default: '', doc: 'Extra pages, added after the built-in ones.' },
            tags,
        ],
    },
    {
        name: 'Trigger', color: '#ff00c0c0', doc: 'An area that runs a script.',
        members: [
            { name: 'script', type: 'string', enum: 'Script', default: '', required: true, doc: 'Script ID.' },
            { name: 'trigger', type: 'string', enum: 'TriggerType', default: 'playerTouch', doc: 'Trigger of pages that name none.' },
            tags,
        ],
    },
    {
        name: 'Spawn', color: '#ff00ff00', doc: 'A named place warps can arrive at (the object name).',
        members: [direction],
    },
];

/** @brief Map-level properties (the map's class in Tiled). */
export const MAP_CLASS: ClassSpec = {
    name: 'StabMap', color: '#ff808080', doc: 'Settings of a whole map.',
    members: [
        { name: 'name', type: 'string', enum: 'TextKey', default: '', doc: 'Text key of the map name.' },
        { name: 'bgm', type: 'string', default: '', doc: 'Background music (assets/sound/bgm).' },
    ],
};

/** @brief The values every fixed enum has (the others are read from the registries and content). */
export const FIXED_ENUMS: Partial<Record<EnumName, readonly string[]>> = {
    TriggerType: ['action', 'playerTouch', 'eventTouch', 'autorun', 'parallel', 'sight', 'none'] satisfies Trigger[],
    Direction: ['down', 'up', 'left', 'right'] satisfies Direction[],
    MoveType: ['fixed', 'random', 'towardPlayer', 'route'] satisfies MoveType[],
};

/**
 * @brief An object's properties with the class defaults filled in.
 *
 * Tiled leaves properties that still have their default value out of the
 * map file, so the defaults are applied here.
 * @param spec The object's class.
 * @param properties What the map file says.
 * @return Every member's value.
 */
export function withDefaults (spec: ClassSpec | undefined, properties: Record<string, unknown>): Record<string, unknown>
{
    const out: Record<string, unknown> = {};
    for (const member of spec?.members ?? []) out[member.name] = member.default;
    return { ...out, ...properties };
}

// ------------------------------------------------------------ Factories

/** @brief An object as factories see it: tile coordinates and properties with defaults. */
export interface MapObject
{
    id: number;
    name: string;
    class: string;
    /** Top-left tile. */
    x: number;
    y: number;
    /** Size in tiles, at least 1 × 1. */
    width: number;
    height: number;
    props: Record<string, unknown>;
    tags: string[];
}

/** @brief What a factory may look things up in. */
export interface FactoryContext
{
    bundle: EventBundle;
    map: string;
}

/**
 * @brief Turns a map object of one class into an event.
 * @return The event, or `null` for objects that are not events.
 * @throws Error with a readable message if the object cannot be used (it is then skipped).
 */
export type ObjectFactory = (object: MapObject, ctx: FactoryContext) => EventDefinition | null;

/** @brief Read a string property. */
function str (object: MapObject, name: string): string
{
    const value = object.props[name];
    return typeof value === 'string' ? value : '';
}

/** @brief Read a whole-number property. */
function int (object: MapObject, name: string, fallback: number): number
{
    const value = object.props[name];
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/** @brief Read a direction property. */
function dir (object: MapObject, name = 'direction'): Direction | undefined
{
    const value = str(object, name);
    return value === 'up' || value === 'down' || value === 'left' || value === 'right' ? value : undefined;
}

/** @brief The script named by an object's `script` property. */
function namedScript (object: MapObject, ctx: FactoryContext, required: boolean): CompiledScript | null
{
    const id = str(object, 'script');
    if (!id)
    {
        if (required) throw new Error('no script set');
        return null;
    }
    const script = ctx.bundle.scripts[id];
    if (!script) throw new Error(`script "${id}" does not exist`);
    return script;
}

/**
 * @brief Compile pages written in TypeScript (for factories).
 * @param object The object, for messages.
 * @param script The pages.
 * @return The compiled script.
 */
export function buildScript (object: MapObject, script: EventScript): CompiledScript
{
    const issues: string[][] = [];
    const compiled = compileScript(script, `${object.class} ${object.id}`, issues);
    if (issues.length) throw new Error(issues.map(([path, message]) => `${path}: ${message}`).join('; '));
    return compiled;
}

/** @brief Make the event definition for an object. */
function definition (object: MapObject, script: CompiledScript): EventDefinition
{
    return {
        id: object.id, name: object.name, kind: object.class, x: object.x, y: object.y,
        width: object.width, height: object.height, tags: object.tags, script,
    };
}

/** @brief Pages of a script with the object's graphic, direction and trigger as defaults. */
function withPageDefaults (script: CompiledScript, defaults: Partial<Page>): CompiledScript
{
    return { ...script, pages: script.pages.map((page) => ({ ...defaults, ...page })) };
}

/** @brief The commands that give an item once (shared by item balls and hidden items). */
function pickUp (object: MapObject): Command[]
{
    const item = str(object, 'item');
    if (!item) throw new Error('no item set');
    const quantity = Math.max(1, int(object, 'quantity', 1));
    return [{
        cmd: 'if', cond: { bagHasRoom: item, quantity },
        then: [{ cmd: 'giveItem', item, quantity }, { cmd: 'setSelfSwitch', switch: 'A' }],
        else: [{ cmd: 'giveItem', item, quantity }],
    }];
}

/** @brief The built-in factories, by class. */
const FACTORIES = new Map<string, ObjectFactory>([
    ['Event', (object, ctx) => definition(object, namedScript(object, ctx, true)!)],
    ['Trigger', (object, ctx) =>
    {
        const trigger = (str(object, 'trigger') || 'playerTouch') as Trigger;
        return definition(object, withPageDefaults(namedScript(object, ctx, true)!, { trigger, through: true }));
    }],
    ['Npc', (object, ctx) =>
    {
        const defaults: Partial<Page> = {
            graphic: str(object, 'graphic'), direction: dir(object), moveType: (str(object, 'moveType') || 'fixed') as MoveType,
            trigger: 'action',
        };
        const script = namedScript(object, ctx, false);
        if (script) return definition(object, withPageDefaults(script, defaults));
        const text = str(object, 'text');
        return definition(object, buildScript(object, {
            pages: [{ ...defaults, commands: text ? [{ cmd: 'message', key: text }] : [] }],
        }));
    }],
    ['Sign', (object) =>
    {
        const text = str(object, 'text');
        if (!text) throw new Error('no text set');
        return definition(object, buildScript(object, {
            pages: [{ trigger: 'action', commands: [{ cmd: 'message', key: text }] }],
        }));
    }],
    ['ItemBall', (object) => definition(object, buildScript(object, {
        pages: [
            { trigger: 'action', graphic: str(object, 'graphic'), commands: pickUp(object) },
            { conditions: { selfSwitch: 'A' }, trigger: 'none', graphic: '', through: true, commands: [] },
        ],
    }))],
    ['HiddenItem', (object) => definition(object, buildScript(object, {
        pages: [
            { trigger: 'action', graphic: '', through: true, commands: pickUp(object) },
            { conditions: { selfSwitch: 'A' }, trigger: 'none', graphic: '', through: true, commands: [] },
        ],
    }))],
    ['Warp', (object) =>
    {
        const map = str(object, 'map');
        if (!map) throw new Error('no destination map set');
        const x = int(object, 'x', -1);
        const y = int(object, 'y', -1);
        const spawn = str(object, 'spawn');
        if ((x < 0 || y < 0) && !spawn) throw new Error('set x and y, or a spawn name');
        const commands: Command[] = [];
        const se = str(object, 'se');
        if (se) commands.push({ cmd: 'se', name: se });
        const warp: Command = { cmd: 'warp', map, transition: object.props.fade === false ? 'none' : 'fade' };
        if (x >= 0 && y >= 0) Object.assign(warp, { x, y });
        else Object.assign(warp, { spawn });
        const facing = dir(object);
        if (facing) Object.assign(warp, { dir: facing });
        commands.push(warp);
        return definition(object, buildScript(object, { pages: [{ trigger: 'playerTouch', through: true, commands }] }));
    }],
    ['Trainer', (object, ctx) =>
    {
        const trainer = str(object, 'trainer');
        if (!trainer) throw new Error('no trainer set');
        if (!ctx.bundle.trainers[trainer]) throw new Error(`trainer "${trainer}" does not exist`);
        const look: Partial<Page> = { graphic: str(object, 'graphic'), direction: dir(object) };
        const intro = str(object, 'intro');
        const after = str(object, 'after');
        const battle: Command[] = [
            { cmd: 'emote', target: 'self', emote: 'exclamation' },
            { cmd: 'pathTo', target: 'self', to: { target: 'player' } },
            { cmd: 'face', target: 'player', towards: 'self' },
        ];
        if (intro) battle.push({ cmd: 'message', key: intro });
        battle.push({ cmd: 'trainerBattle', trainer });
        const pages: Page[] = [
            { ...look, trigger: 'sight', sightRange: Math.max(1, int(object, 'sightRange', 4)), commands: battle },
            {
                ...look, conditions: { trainerDefeated: trainer }, trigger: 'action',
                commands: after ? [{ cmd: 'message', key: after }] : [],
            },
        ];
        const base = buildScript(object, { pages });
        const extra = namedScript(object, ctx, false);
        if (!extra) return definition(object, base);
        return definition(object, {
            tags: [...base.tags, ...extra.tags],
            pages: [...base.pages, ...withPageDefaults(extra, look).pages],
        });
    }],
    ['Spawn', () => null],
]);

/**
 * @brief Make a class of map object become events (or replace a built-in one).
 * @param className Tiled class name.
 * @param factory Turns an object of that class into an event.
 */
export function registerFactory (className: string, factory: ObjectFactory): void
{
    FACTORIES.set(className, factory);
}

/**
 * @brief The factory for a class.
 * @param className Tiled class name.
 * @return The factory, or `undefined` if the class is unknown.
 */
export function factoryFor (className: string): ObjectFactory | undefined
{
    return FACTORIES.get(className);
}

// ------------------------------------------------------------- Loading

/** @brief Where a warp can arrive on a map. */
export interface SpawnPoint
{
    x: number;
    y: number;
    dir?: Direction;
}

/** @brief What `instantiateMap()` makes of a map. */
export interface MapEvents
{
    events: EventDefinition[];
    /** Spawn points by name. */
    spawns: Record<string, SpawnPoint>;
    /** Map-level properties (`StabMap` class), with defaults. */
    props: Record<string, unknown>;
    /** Objects that were skipped, and why. */
    issues: string[];
}

/**
 * @brief Read a map object into tile coordinates with its class defaults.
 * @param object The Tiled object.
 * @param map The map, for the tile size.
 * @return The object, or `null` if it has no class.
 */
export function toMapObject (object: TiledObject, map: Pick<TiledMap, 'tilewidth' | 'tileheight'>): MapObject | null
{
    const className = object.type || object.class || '';
    if (!className) return null;
    const spec = CLASS_SPECS.find((c) => c.name === className);
    const props = withDefaults(spec, readProperties(object.properties));
    const pixelY = object.gid ? object.y - (object.height ?? map.tileheight) : object.y;
    const tagText = typeof props.tags === 'string' ? props.tags : '';
    return {
        id: object.id,
        name: object.name ?? '',
        class: className,
        x: Math.floor(object.x / map.tilewidth),
        y: Math.floor(pixelY / map.tileheight),
        width: Math.max(1, Math.round((object.width ?? map.tilewidth) / map.tilewidth)),
        height: Math.max(1, Math.round((object.height ?? map.tileheight) / map.tileheight)),
        props,
        tags: tagText.split(',').map((tag) => tag.trim()).filter(Boolean),
    };
}

/**
 * @brief Turn a map's objects into events by sending each object to the factory of its class.
 *
 * Objects without a class (decoration, notes) are ignored. Objects whose
 * class is unknown, or whose factory fails, are skipped and listed in `issues`.
 * @param map The parsed map JSON.
 * @param mapId The map's ID.
 * @param bundle Compiled event files.
 * @return Events, spawn points and issues.
 */
export function instantiateMap (map: TiledMap, mapId: string, bundle: EventBundle): MapEvents
{
    const result: MapEvents = {
        events: [], spawns: {}, props: withDefaults(MAP_CLASS, readProperties(map.properties)), issues: [],
    };
    const ctx: FactoryContext = { bundle, map: mapId };
    for (const layer of objectLayers(map.layers))
    {
        for (const raw of layer.objects ?? [])
        {
            const object = toMapObject(raw, map);
            if (!object) continue;
            const where = `${mapId}: object ${object.id}${object.name ? ` "${object.name}"` : ''} (${object.class})`;
            if (object.class === 'Spawn')
            {
                if (!object.name) result.issues.push(`${where}: a Spawn needs a name`);
                else result.spawns[object.name] = { x: object.x, y: object.y, dir: dir(object) };
            }
            const factory = FACTORIES.get(object.class);
            if (!factory)
            {
                result.issues.push(`${where}: no factory for class "${object.class}"`);
                continue;
            }
            try
            {
                const event = factory(object, ctx);
                if (event) result.events.push(event);
            }
            catch (error)
            {
                result.issues.push(`${where}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    return result;
}
