/**
 * @file events-tools.test.ts
 * @brief Tests for the event tools: Tiled project sync, validation checks and script stubs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { compileFile } from '../../src/events/compile.ts';
import type { EventFile } from '../../src/events/schema.ts';
import { CLASS_SPECS } from '../../src/events/tiled.ts';
import type { TiledMap } from '../../src/events/tiled.ts';
import { checkContent } from './checks.ts';
import { DIALOGUE_DIR, loadEvents } from './content.ts';
import { addScript } from './new-script.ts';
import { inkKnots } from './registries.ts';
import type { Registries } from './registries.ts';
import { PROJECT_COMMANDS, syncProject } from './tiledProject.ts';
import type { TiledProject } from './tiledProject.ts';

/** @brief Small registries for the checks. */
function registries (extra: Partial<Registries> = {}): Registries
{
    return {
        Flag: ['got_starter'], Variable: ['badges'], Item: ['potion'], Species: ['pikachu'], Move: ['tackle'],
        TrainerId: ['joey'], StoryMilestone: ['intro', 'got_starter'], StoryTrack: ['main'], InkStory: ['sample'],
        InkKnot: ['sample.professor'], TextKey: ['hello', 'system.yes'], Script: ['npc'], CommonEvent: [], Map: ['route1'],
        TriggerType: ['action'], Direction: ['down', 'up', 'left', 'right'], MoveType: ['fixed'], Emote: ['exclamation'], Native: [],
        ...extra,
    };
}

test('syncProject writes enums and classes, keeps custom types and IDs, and is stable', () =>
{
    const project: TiledProject = {
        propertyTypes: [
            { id: 7, name: 'MyOwnEnum', type: 'enum', values: ['a'] },
            { id: 3, name: 'Flag', type: 'enum', values: ['old'] },
        ],
        commands: [{ name: 'My command' }, { name: PROJECT_COMMANDS[0].name, command: 'old' }],
        folders: ['maps'],
    };
    const once = syncProject(project, registries());
    const twice = syncProject(once, registries());
    assert.deepEqual(twice, once);
    const types = once.propertyTypes!;
    assert.deepEqual(types.find((type) => type.name === 'MyOwnEnum'), project.propertyTypes![0]);
    assert.equal(types.find((type) => type.name === 'Flag')!.id, 3);
    assert.deepEqual(types.find((type) => type.name === 'Flag')!.values, ['got_starter']);
    assert.equal(new Set(types.map((type) => type.id)).size, types.length);
    for (const spec of CLASS_SPECS) assert.ok(types.some((type) => type.name === spec.name && type.type === 'class'));
    const event = types.find((type) => type.name === 'Event') as unknown as { members: { name: string; propertyType?: string }[] };
    assert.equal(event.members.find((member) => member.name === 'script')!.propertyType, 'Script');
    assert.deepEqual(once.commands!.map((command) => command.name), ['My command', ...PROJECT_COMMANDS.map((c) => c.name)]);
    assert.deepEqual(once.folders, ['maps']);
});

test('checks catch unknown names, missing text and commands that cannot run in battles', () =>
{
    const file: EventFile = {
        scripts: {
            npc: {
                pages: [{
                    conditions: { flag: 'got_startr' },
                    commands: [
                        { cmd: 'message', key: 'hello' },
                        { cmd: 'message', key: 'nope' },
                        { cmd: 'giveItem', item: 'potoin' },
                        { cmd: 'setVar', var: 'badges', value: { var: 'badgs' } },
                        { cmd: 'trainerBattle', trainer: 'joey2' },
                        { cmd: 'warp', map: 'route9', x: 1, y: 1 },
                        { cmd: 'ink', story: 'sample', knot: 'missing' },
                        { cmd: 'setStory', milestone: 'beat_elite_four' },
                        { cmd: 'emote', target: 'self', emote: 'exclamation' },
                    ],
                }],
            },
            loop: { pages: [{ trigger: 'autorun', commands: [{ cmd: 'message', key: 'hello' }] }] },
        },
        hooks: { h: { on: 'battleStart', commands: [{ cmd: 'fade', dir: 'out' }, { cmd: 'message', key: 'hello' }] } },
    };
    const { bundle, issues } = compileFile(file, 'x.json');
    assert.deepEqual(issues, []);
    const findings = checkContent({ bundle, registries: registries(), locales: { en: { hello: 'Hi' }, de: { hello: 'Hallo' } }, maps: {} });
    const messages = findings.map((f) => `${f.level}: ${f.message}`);
    for (const expected of [
        'error: unknown flag "got_startr" (add it to src/events/registry/flags.ts)',
        'error: text key "nope" is not in any content/locales/*/en.csv',
        'error: unknown item "potoin"',
        'error: unknown variable "badgs" (add it to src/events/registry/variables.ts)',
        'error: unknown trainer "joey2"',
        'error: warp to unknown map "route9"',
        'error: unknown ink knot "sample.missing"',
        'error: unknown story milestone "beat_elite_four"',
        'error: "fade" cannot run during a battle',
        'error: text key "system.no" is not in any content/locales/*/en.csv',
    ])
    {
        assert.ok(messages.includes(expected), `missing: ${expected}\n${messages.join('\n')}`);
    }
    assert.ok(messages.some((m) => m.startsWith('warning: autorun page never changes its own conditions')));
    assert.ok(!messages.some((m) => m.includes('"emote"')));
    assert.equal(findings[0].level, 'error');
});

test('checks look at map objects: classes, required and listed properties, warps and spawns', () =>
{
    const { bundle } = compileFile({ scripts: { npc: { pages: [{ commands: [] }] } } }, 'x.json');
    const prop = (name: string, value: unknown) => ({ name, type: 'string', value });
    const map: TiledMap = {
        width: 5, height: 5, tilewidth: 16, tileheight: 16, tilesets: [],
        layers: [{
            name: 'events', type: 'objectgroup', objects: [
                { id: 1, type: 'Sign', x: 0, y: 0 },
                { id: 2, type: 'ItemBall', x: 16, y: 0, properties: [prop('item', 'masterball')] },
                { id: 3, type: 'Warp', x: 33, y: 0, properties: [prop('map', 'route1'), prop('spawn', 'gate')] },
                { id: 4, type: 'Spawn', name: 'door', x: 48, y: 0 },
                { id: 5, type: 'Spawn', name: 'door', x: 64, y: 0 },
                { id: 6, type: 'Npc', x: 0, y: 16, properties: [prop('text', 'hello'), prop('direction', 'up')] },
            ],
        }],
    };
    const findings = checkContent({ bundle, registries: registries(), locales: { en: { hello: 'Hi' } }, maps: { route1: map } });
    const messages = findings.map((f) => `${f.where}: ${f.message}`);
    for (const expected of [
        'map route1: object 1 (Sign): no text set',
        'map route1: object 1 (Sign): "text" must be set',
        'map route1: object 2 (ItemBall): "item": unknown Item "masterball"',
        'map route1: object 3 (Warp): map "route1" has no Spawn named "gate"',
        'map route1: object 5 "door" (Spawn): two Spawns are named "door"',
        'map route1: object 3 (Warp): not aligned to the tile grid',
    ])
    {
        assert.ok(messages.some((m) => m.endsWith(expected)), `missing: ${expected}\n${messages.join('\n')}`);
    }
    assert.ok(!messages.some((m) => m.includes('object 6')));
});

test('the shipped event files compile and pass the checks', () =>
{
    const { issues } = loadEvents();
    assert.deepEqual(issues, []);
});

test('ink knots follow INCLUDE and skip functions', () =>
{
    assert.deepEqual(inkKnots(path.join(DIALOGUE_DIR, 'sample.ink')), ['professor']);
});

test('addScript adds an empty script and refuses bad or taken IDs', () =>
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stab-events-'));
    try
    {
        const file = addScript('route1_old_man', 'maps/route1', root);
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        assert.equal(data.$schema, '../schema.json');
        assert.deepEqual(data.scripts.route1_old_man, { pages: [{ trigger: 'action', commands: [] }] });
        addScript('route1_sign', 'maps/route1', root);
        assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf-8')).scripts), ['route1_old_man', 'route1_sign']);
        assert.throws(() => addScript('Bad-Name', 'x', root), /not a valid script ID/);
        assert.throws(() => addScript('ok', '../escape', root), /not a valid file name/);
        assert.throws(() => addScript('sample_rival', 'x', root), /already exists/);
    }
    finally
    {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
