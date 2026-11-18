/**
 * @file events.test.ts
 * @brief Tests for the event and scripting system. Run with `npm test`.
 *
 * The world is a fake `WorldHost`: a grid with walls, characters that move
 * instantly, and logs of what was shown.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameState } from '../state/GameState.ts';
import { createPokemon } from '../state/pokemon.ts';
import { MemoryStorage, SaveError, SaveManager, SAVE_VERSION } from '../state/SaveManager.ts';
import { compileFile, compileFiles, emptyBundle } from './compile.ts';
import type { EventBundle } from './compile.ts';
import { evaluate } from './conditions.ts';
import type { EvalContext } from './conditions.ts';
import { DIRECTION_DELTA, findPath } from './pathfinding.ts';
import { EventManager } from './runtime/EventManager.ts';
import type { EventDefinition } from './runtime/GameEvent.ts';
import { hookMatches } from './runtime/battleHooks.ts';
import type { Actor, BattleRequest, WarpRequest, WorldHost } from './runtime/host.ts';
import type { BattleResult, Command, Condition, Direction, EventFile, Page } from './schema.ts';
import { parseCsv, parseLocaleCsv, TextStore } from './text.ts';
import { instantiateMap } from './tiled.ts';
import type { TiledMap } from './tiled.ts';
import { buildTrainerTeam } from './trainers.ts';

// ---------------------------------------------------------------- Fakes

/** @brief A character that moves instantly. */
class FakeActor implements Actor
{
    facing: Direction = 'down';
    through = false;
    visible = true;
    graphic = '';
    readonly log: string[] = [];
    private readonly host: FakeHost;
    x: number;
    y: number;

    constructor (host: FakeHost, x: number, y: number)
    {
        this.host = host;
        this.x = x;
        this.y = y;
    }

    async step (dir: Direction): Promise<boolean>
    {
        this.facing = dir;
        if (!this.host.canStep(this, this.x, this.y, dir))
        {
            this.log.push(`blocked ${dir}`);
            return false;
        }
        const [dx, dy] = DIRECTION_DELTA[dir];
        this.x += dx;
        this.y += dy;
        this.log.push(dir);
        return true;
    }

    async jump (dx: number, dy: number): Promise<void>
    {
        this.x += dx;
        this.y += dy;
    }

    turn (dir: Direction): void { this.facing = dir; }
    placeAt (x: number, y: number): void { this.x = x; this.y = y; }
    setSpeed (): void {}
    setThrough (through: boolean): void { this.through = through; }
    setVisible (visible: boolean): void { this.visible = visible; }
    setGraphic (graphic: string): void { this.graphic = graphic; }
}

/** @brief A 10 × 10 world with walls, logging everything shown. */
class FakeHost implements WorldHost
{
    readonly walls = new Set<string>();
    readonly actors = new Map<number, FakeActor>();
    readonly playerActor = new FakeActor(this, 0, 0);
    readonly messages: string[] = [];
    readonly warps: WarpRequest[] = [];
    readonly battles: BattleRequest[] = [];
    /** Answers for `choose()`, in order. */
    answers: number[] = [];
    /** Result of the next battles, in order. */
    results: BattleResult[] = [];
    whiteouts = 0;
    /** While set, `message()` waits for this promise. */
    hold: Promise<void> | null = null;

    player (): Actor { return this.playerActor; }
    actorOf (id: number): Actor | null { return this.actors.get(id) ?? null; }

    canStep (actor: Actor | null, x: number, y: number, dir: Direction): boolean
    {
        const [dx, dy] = DIRECTION_DELTA[dir];
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= 10 || ny >= 10 || this.walls.has(`${nx},${ny}`)) return false;
        if (actor?.through) return true;
        const others = [this.playerActor, ...this.actors.values()].filter((other) => other !== actor && other.visible);
        return !others.some((other) => other.x === nx && other.y === ny);
    }

    syncEvent (): void {}
    async message (text: string): Promise<void>
    {
        this.messages.push(text);
        if (this.hold) await this.hold;
    }
    async choose (prompt: string | null, _options: string[], _cancel: number): Promise<number>
    {
        if (prompt !== null) this.messages.push(prompt);
        return this.answers.shift() ?? 0;
    }
    async nameInput (): Promise<string> { return 'Blue'; }
    pokedexEntry?: (species: string, languages: string[]) => Promise<void>;
    async ink (): Promise<void> {}
    async wait (): Promise<void> { await new Promise((resolve) => setTimeout(resolve, 0)); }
    async camera (): Promise<void> {}
    async shake (): Promise<void> {}
    async emote (): Promise<void> {}
    async fade (): Promise<void> {}
    async tint (): Promise<void> {}
    async flash (): Promise<void> {}
    playSe (): void {}
    playBgm (): void {}
    async playMe (): Promise<void> {}
    async playCry (): Promise<void> {}
    async warp (request: WarpRequest): Promise<void> { this.warps.push(request); }
    async battle (request: BattleRequest): Promise<BattleResult>
    {
        this.battles.push(request);
        return this.results.shift() ?? 'win';
    }
    async whiteout (): Promise<void> { this.whiteouts++; }
    setPlayerControl (): void {}
}

/** @brief Text where every key shows as itself, plus a few real lines. */
function makeText (): TextStore
{
    return new TextStore({
        en: {
            'system.yes': 'Yes', 'system.no': 'No', 'system.obtained_item': 'Got {quantity} {item}!',
            'system.bag_full': 'Bag full', 'system.prize_money': 'Got ${amount}', 'trainers.joey.name': 'Joey',
        },
    });
}

/** @brief Let every pending script run as far as it can. */
async function settle (manager?: EventManager, rounds = 30): Promise<void>
{
    for (let i = 0; i < rounds; i++)
    {
        manager?.update();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

/** @brief Compile an event file or fail the test. */
function bundleOf (file: EventFile): EventBundle
{
    const { bundle, issues } = compileFile(file, 'test.json');
    assert.deepEqual(issues, []);
    return bundle;
}

/** @brief An event definition at a tile. */
function defOf (bundle: EventBundle, script: string, id: number, x: number, y: number, tags: string[] = []): EventDefinition
{
    return { id, name: script, kind: 'Event', x, y, width: 1, height: 1, tags, script: bundle.scripts[script] };
}

/** @brief A world with one map holding the given events (each gets a character). */
function world (bundle: EventBundle, defs: EventDefinition[], state = GameState.create({ name: 'Red' }))
{
    const host = new FakeHost();
    for (const def of defs) host.actors.set(def.id, new FakeActor(host, def.x, def.y));
    const manager = new EventManager({
        state, bundle, text: makeText(), host, random: () => 0.5,
        data: { ability: () => 'static', learnset: () => ({ thundershock: ['9L1'], growl: ['9L1'], quickattack: ['9L5'] }) },
        onError: (error) => { throw error; },
        onWarning: () => {},
    });
    manager.loadMap('testmap', defs);
    return { host, manager, state };
}

/** @brief A one-page script that runs `commands` when talked to. */
function talk (commands: Command[], extra: Partial<Page> = {}): EventFile
{
    return { scripts: { npc: { pages: [{ commands, ...extra }] } } };
}

/** @brief Run `commands` as an event the player talks to; returns the world afterwards. */
async function runCommands (commands: Command[], state?: GameState)
{
    const bundle = bundleOf(talk(commands));
    const w = world(bundle, [defOf(bundle, 'npc', 1, 0, 1)], state);
    w.manager.playerAction();
    await settle(w.manager);
    return w;
}

// ---------------------------------------------------------------- Tests

test('if / elsif / else runs the first branch whose condition passes', async () =>
{
    const script = (badges: number): Command[] => [
        { cmd: 'setVar', var: 'badges', value: badges },
        {
            cmd: 'if', cond: { var: 'badges', op: 'ge', value: 8 }, then: [{ cmd: 'message', key: 'eight' }],
            elsif: [
                { cond: { var: 'badges', op: 'ge', value: 4 }, then: [{ cmd: 'message', key: 'four' }] },
                { cond: { var: 'badges', op: 'ge', value: 1 }, then: [{ cmd: 'message', key: 'one' }] },
                { cond: { var: 'badges', op: 'ge', value: 0 }, then: [{ cmd: 'message', key: 'never' }] },
            ],
            else: [{ cmd: 'message', key: 'none' }],
        },
        { cmd: 'message', key: 'after' },
    ];
    assert.deepEqual((await runCommands(script(9))).host.messages, ['eight', 'after']);
    assert.deepEqual((await runCommands(script(5))).host.messages, ['four', 'after']);
    assert.deepEqual((await runCommands(script(1))).host.messages, ['one', 'after']);
    assert.deepEqual((await runCommands(script(0))).host.messages, ['never', 'after']);
    const noElse: Command[] = [{ cmd: 'if', cond: { flag: 'x' }, then: [{ cmd: 'message', key: 'x' }], elsif: [] }];
    assert.deepEqual((await runCommands(noElse)).host.messages, []);
});

test('loops, break, labels, goto and switch', async () =>
{
    const { host, state } = await runCommands([
        { cmd: 'setVar', var: 'n', value: 0 },
        {
            cmd: 'loop', body: [
                { cmd: 'setVar', var: 'n', op: 'add', value: 1 },
                { cmd: 'if', cond: { var: 'n', op: 'ge', value: 3 }, then: [{ cmd: 'break' }] },
            ],
        },
        { cmd: 'goto', label: 'skip' },
        { cmd: 'message', key: 'skipped' },
        { cmd: 'label', name: 'skip' },
        {
            cmd: 'switch', var: 'n', cases: [
                { value: 2, then: [{ cmd: 'message', key: 'two' }] },
                { value: 3, then: [{ cmd: 'message', key: 'three' }] },
            ], default: [{ cmd: 'message', key: 'other' }],
        },
    ]);
    assert.equal(state.getVar('n'), 3);
    assert.deepEqual(host.messages, ['three']);
});

test('the compiler reports unknown labels, stray breaks and bad commands', () =>
{
    const bad = compileFile(talk([{ cmd: 'goto', label: 'nowhere' }, { cmd: 'break' }]), 'bad.json');
    assert.deepEqual(bad.issues.map((issue) => issue.message), [
        '"break" is only allowed inside a "loop"', 'label "nowhere" does not exist in this command list',
    ]);
    const invalid = compileFile({ scripts: { x: { pages: [{ commands: [{ cmd: 'fly' }] }] } } }, 'invalid.json');
    assert.ok(invalid.issues.length > 0);
    assert.match(invalid.issues[0].path, /^scripts\.x\.pages\.0\.commands\.0/);
    const duplicate = compileFiles([['a.json', talk([])], ['b.json', talk([])]]);
    assert.deepEqual(duplicate.issues.map((issue) => issue.message), ['"npc" is already defined in a.json']);
});

test('conditions: flags, variables, story, items, tags and combinators', () =>
{
    const state = GameState.create();
    const ctx: EvalContext = {
        state, map: 'route1', self: { id: 3, tags: ['rival'] }, trigger: null, playerFacing: 'up', random: () => 0.1,
    };
    const check = (condition: Condition) => evaluate(condition, ctx);
    assert.equal(check({ flag: 'met_rival' }), false);
    state.setFlag('met_rival');
    assert.equal(check({ flag: 'met_rival' }), true);
    assert.equal(check({ flag: 'met_rival', is: false }), false);
    state.setVar('badges', 3);
    assert.equal(check({ var: 'badges', op: 'ge', value: 3 }), true);
    assert.equal(check({ var: 'badges', value: { var: 'other' } }), false);
    assert.equal(check({ story: 'got_starter' }), false);
    assert.equal(check({ story: 'got_starter', op: 'before' }), true);
    state.setStory('first_rival_battle');
    assert.equal(check({ story: 'got_starter' }), true);
    assert.equal(check({ story: 'beat_gym_1' }), false);
    assert.equal(check({ story: 'first_rival_battle', op: 'at' }), true);
    state.addItem('potion', 2, 'medicine');
    assert.equal(check({ item: 'potion', value: 2 }), true);
    assert.equal(check({ item: 'potion', value: 3 }), false);
    assert.equal(check({ bagHasRoom: 'potion', quantity: 997 }), true);
    assert.equal(check({ bagHasRoom: 'potion', quantity: 998 }), false);
    assert.equal(check({ hasTag: 'rival' }), true);
    assert.equal(check({ eventId: 3 }), true);
    assert.equal(check({ eventId: 3, of: 'trigger' }), false);
    assert.equal(check({ map: 'route1' }), true);
    assert.equal(check({ playerFacing: 'up' }), true);
    assert.equal(check({ random: 0.2 }), true);
    assert.equal(check({ all: [{ flag: 'met_rival' }, { not: { map: 'route2' } }] }), true);
    assert.equal(check({ any: [{ flag: 'nope' }, { var: 'badges', value: 4 }] }), false);
    assert.equal(check({ all: [] }), true);
});

test('the last page whose conditions pass is active, and self switches change pages', async () =>
{
    const bundle = bundleOf({
        scripts: {
            aide: {
                pages: [
                    { commands: [{ cmd: 'message', key: 'hello' }, { cmd: 'setSelfSwitch', switch: 'A' }] },
                    { conditions: { selfSwitch: 'A' }, commands: [{ cmd: 'message', key: 'again' }] },
                    { conditions: { flag: 'never' }, commands: [{ cmd: 'message', key: 'never' }] },
                ],
            },
        },
    });
    const { host, manager, state } = world(bundle, [defOf(bundle, 'aide', 4, 0, 1)]);
    assert.equal(manager.event(4)!.pageIndex, 0);
    manager.playerAction();
    await settle(manager);
    assert.equal(state.getSelfSwitch('testmap', 4, 'A'), true);
    assert.equal(manager.event(4)!.pageIndex, 1);
    manager.playerAction();
    await settle(manager);
    assert.deepEqual(host.messages, ['hello', 'again']);
});

test('moveMany moves several characters at once and pathTo walks around walls', async () =>
{
    const bundle = bundleOf({
        scripts: {
            a: { pages: [{ trigger: 'none', commands: [] }] },
            b: { pages: [{ trigger: 'none', commands: [] }] },
            cutscene: {
                pages: [{
                    commands: [
                        {
                            cmd: 'moveMany', moves: [
                                { target: { id: 2 }, route: ['right', 'right', { repeat: 2, steps: ['down'] }] },
                                { target: { tag: 'twin' }, route: ['down', 'turnLeft'] },
                            ],
                        },
                        { cmd: 'pathTo', target: { id: 2 }, to: { x: 6, y: 2 } },
                    ],
                }],
            },
        },
    });
    const { host, manager } = world(bundle, [
        defOf(bundle, 'cutscene', 1, 0, 1), defOf(bundle, 'a', 2, 5, 5), defOf(bundle, 'b', 3, 8, 0, ['twin']),
    ]);
    host.walls.add('7,4').add('6,4').add('8,4');
    manager.playerAction();
    await settle(manager, 60);
    const a = host.actors.get(2)!;
    const b = host.actors.get(3)!;
    assert.deepEqual([b.x, b.y, b.facing], [8, 1, 'left']);
    assert.deepEqual([a.x, a.y], [6, 2]);
    assert.ok(!a.log.some((entry) => entry.startsWith('blocked')));
});

test('findPath finds a shortest path, stops next to a goal, or reports none', () =>
{
    const walls = new Set(['1,0', '1,1']);
    const canStep = (x: number, y: number, dir: Direction) =>
    {
        const [dx, dy] = DIRECTION_DELTA[dir];
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < 4 && ny < 4 && !walls.has(`${nx},${ny}`);
    };
    assert.deepEqual(findPath(0, 0, 2, 0, { canStep }), ['down', 'down', 'right', 'right', 'up', 'up']);
    assert.equal(findPath(0, 0, 2, 0, { canStep, adjacent: true })?.length, 5);
    walls.add('1,2').add('1,3');
    assert.equal(findPath(0, 0, 2, 0, { canStep }), null);
});

test('choices, yes/no and variables', async () =>
{
    const commands: Command[] = [
        {
            cmd: 'choice', key: 'pick', options: [
                { key: 'a', then: [{ cmd: 'setVar', var: 'picked', value: 'a' }] },
                { key: 'b', then: [{ cmd: 'setVar', var: 'picked', value: 'b' }] },
            ],
        },
        { cmd: 'yesNo', key: 'sure', yes: [{ cmd: 'message', key: 'yes_' }], no: [{ cmd: 'message', key: 'no_' }] },
        { cmd: 'setVar', var: 'x', value: 7 },
        { cmd: 'setVar', var: 'x', op: 'mul', value: 3 },
        { cmd: 'setVar', var: 'x', op: 'mod', value: 5 },
    ];
    const bundle = bundleOf(talk(commands));
    const { host, manager, state } = world(bundle, [defOf(bundle, 'npc', 1, 0, 1)]);
    host.answers = [1, 1];
    manager.playerAction();
    await settle(manager);
    assert.equal(state.getVar('picked'), 'b');
    assert.equal(state.getVar('choice_result'), 1);
    assert.deepEqual(host.messages, ['pick', 'sure', 'no_']);
    assert.equal(state.getVar('x'), 1);
});

test('trainer battles: teams are built at battle time and results pick the branch', async () =>
{
    const file: EventFile = {
        trainers: {
            joey: {
                class: 'youngster', name: 'trainers.joey.name', money: 10,
                variants: [
                    { conditions: { flag: 'rematch' }, team: [{ species: 'raticate', level: 30, moves: ['tackle'], ability: 'guts' }] },
                    {
                        team: [
                            { species: 'rattata', level: { party: 'max', offset: -1 }, moves: ['tackle'], ability: 'guts' },
                            { species: 'pidgey', level: 3, moves: ['gust'], ability: 'keeneye', conditions: { flag: 'never' } },
                        ],
                    },
                ],
            },
        },
        scripts: {
            npc: {
                pages: [{
                    commands: [{
                        cmd: 'trainerBattle', trainer: 'joey', canLose: true,
                        onWin: [{ cmd: 'message', key: 'won' }], onLose: [{ cmd: 'message', key: 'lost' }],
                    }, { cmd: 'message', key: 'after' }],
                }],
            },
        },
    };
    const bundle = bundleOf(file);
    const state = GameState.create({ name: 'Red' });
    state.addToParty(createPokemon({ species: 'pikachu', level: 12, ability: 'static', moves: ['thundershock'] }));
    const { host, manager } = world(bundle, [defOf(bundle, 'npc', 1, 0, 1)], state);
    host.results = ['win', 'lose'];
    manager.playerAction();
    await settle(manager);
    assert.equal(host.battles[0].foeName, 'Joey');
    assert.deepEqual(host.battles[0].sets.map((set) => [set.species, set.level]), [['rattata', 11]]);
    assert.equal(state.getFlag('trainer:joey'), true);
    assert.equal(state.getSnapshot().player.money, 110);
    assert.deepEqual(host.messages, ['Got $110', 'won', 'after']);
    state.setFlag('rematch');
    manager.playerAction();
    await settle(manager);
    assert.equal(host.battles[1].sets[0].species, 'raticate');
    assert.deepEqual(host.messages.slice(3), ['lost', 'after']);
    assert.equal(state.getVar('battle_result'), 'lose');
});

test('losing a battle that must be won whites out and ends the script', async () =>
{
    const { host, state } = await (async () =>
    {
        const bundle = bundleOf({
            scripts: {
                npc: {
                    pages: [{
                        commands: [
                            { cmd: 'wildBattle', species: 'pikachu', level: 5, onWin: [{ cmd: 'message', key: 'won' }] },
                            { cmd: 'message', key: 'after' },
                        ],
                    }],
                },
            },
        });
        const w = world(bundle, [defOf(bundle, 'npc', 1, 0, 1)]);
        w.host.results = ['lose'];
        w.manager.playerAction();
        await settle(w.manager);
        return w;
    })();
    assert.equal(host.whiteouts, 1);
    assert.deepEqual(host.messages, []);
    assert.equal(host.battles[0].kind, 'wild');
    assert.equal(state.getVar('battle_result'), 'lose');
});

test('an autorun page that ends turns off its own condition', async () =>
{
    const bundle = bundleOf({
        scripts: {
            intro: { pages: [{ trigger: 'autorun', conditions: { flag: 'intro_done', is: false }, commands: [{ cmd: 'message', key: 'intro' }] }] },
            loop: { pages: [{ trigger: 'autorun', commands: [{ cmd: 'message', key: 'loop' }] }] },
            switcher: {
                pages: [
                    { trigger: 'autorun', conditions: { all: [{ selfSwitch: 'B', is: false }] }, commands: [{ cmd: 'message', key: 'once' }] },
                ],
            },
        },
    });
    const { host, manager, state } = world(bundle, [
        defOf(bundle, 'intro', 1, 3, 3), defOf(bundle, 'loop', 2, 4, 4), defOf(bundle, 'switcher', 3, 5, 5),
    ]);
    await settle(manager, 60);
    assert.deepEqual(host.messages, ['intro', 'loop', 'once']);
    assert.equal(state.getFlag('intro_done'), true);
    assert.equal(manager.event(2)!.erased, true);
    assert.equal(state.getSelfSwitch('testmap', 3, 'B'), true);
    assert.equal(manager.busy, false);
});

test('saving is blocked while a cutscene runs', async () =>
{
    const bundle = bundleOf(talk([{ cmd: 'message', key: 'wait' }]));
    const { host, manager, state } = world(bundle, [defOf(bundle, 'npc', 1, 0, 1)]);
    let release!: () => void;
    host.hold = new Promise((resolve) => { release = resolve; });
    const saves = new SaveManager({ storage: new MemoryStorage() });
    manager.playerAction();
    await settle(manager, 3);
    assert.equal(manager.busy, true);
    assert.throws(() => saves.save(0, state), (error) => error instanceof SaveError && error.code === 'busy');
    release();
    await settle(manager);
    assert.equal(manager.busy, false);
    saves.save(0, state);
    assert.equal(saves.load(0).getSnapshot().player.name, 'Red');
});

test('items, Pokémon and the player', async () =>
{
    const { host, state } = await runCommands([
        { cmd: 'giveItem', item: 'potion', quantity: 2 },
        { cmd: 'takeItem', item: 'potion' },
        { cmd: 'givePokemon', species: 'pikachu', level: 5, silent: true },
        { cmd: 'teachMove', species: 'pikachu', move: 'thunderbolt' },
        { cmd: 'addMoney', amount: 500 },
        { cmd: 'addMoney', amount: -800 },
        { cmd: 'setPlayerName', name: 'Gold' },
        { cmd: 'setStory', milestone: 'got_starter' },
        { cmd: 'hide', target: 'self' },
    ]);
    assert.equal(state.countItem('potion'), 1);
    const [pikachu] = state.getSnapshot().party;
    assert.deepEqual(pikachu.moves.map((move) => move.id), ['thundershock', 'growl', 'quickattack', 'thunderbolt']);
    assert.equal(pikachu.met.map, 'testmap');
    assert.equal(state.getSnapshot().player.money, 0);
    assert.equal(state.getSnapshot().player.name, 'Gold');
    assert.equal(state.getStory('main'), 'got_starter');
    assert.equal(state.isEventHidden('testmap', 1), true);
    assert.deepEqual(host.messages, ['Got 2 potion!', 'system.learned_move']);
});

test('global listeners run when what they listen for changes', async () =>
{
    const bundle = bundleOf({
        listeners: {
            badge: { on: 'varChanged', name: 'badges', conditions: { var: 'badges', op: 'ge', value: 1 }, commands: [{ cmd: 'message', key: 'badge' }] },
            potion: { on: 'itemObtained', name: 'potion', once: true, commands: [{ cmd: 'message', key: 'first_potion' }] },
            enter: { on: 'mapEnter', name: 'testmap', commands: [{ cmd: 'message', key: 'welcome' }] },
        },
        scripts: { npc: { pages: [{ commands: [{ cmd: 'giveItem', item: 'potion', silent: true }] }] } },
    });
    const { host, manager, state } = world(bundle, [defOf(bundle, 'npc', 1, 0, 1)]);
    state.setVar('badges', 0);
    state.setVar('badges', 1);
    await settle(manager);
    manager.playerAction();
    await settle(manager);
    manager.playerAction();
    await settle(manager);
    assert.deepEqual(host.messages, ['welcome', 'badge', 'first_potion']);
    assert.equal(state.getFlag('listener:potion'), true);
});

test('battle hooks match by moment, trainer, side and turn', () =>
{
    const hook = { on: 'faint' as const, trainer: 'joey', side: 'foe' as const, code: [] };
    assert.equal(hookMatches(hook, { on: 'faint', side: 'foe', species: 'rattata' }, 'joey'), true);
    assert.equal(hookMatches(hook, { on: 'faint', side: 'player' }, 'joey'), false);
    assert.equal(hookMatches(hook, { on: 'faint', side: 'foe' }, 'other'), false);
    assert.equal(hookMatches({ on: 'turnStart', turn: 2, code: [] }, { on: 'turnStart', turn: 2 }, undefined), true);
    assert.equal(hookMatches({ on: 'turnStart', turn: 2, code: [] }, { on: 'turnStart', turn: 3 }, undefined), false);
});

test('battle hooks reject commands that need the overworld', async () =>
{
    const { bundle } = compileFile({
        hooks: { h: { on: 'battleStart', commands: [{ cmd: 'move', target: 'player', route: ['up'] }, { cmd: 'message', key: 'go' }] } },
    }, 'hooks.json');
    const warnings: string[] = [];
    const host = new FakeHost();
    const manager = new EventManager({
        state: GameState.create(), bundle, text: makeText(), host, onWarning: (message) => warnings.push(message),
    });
    const { BattleHookRunner } = await import('./runtime/battleHooks.ts');
    const runner = new BattleHookRunner(manager, undefined);
    await runner.onStep({ kind: 'turn', turn: 1 } as never, {} as never);
    assert.deepEqual(host.messages, ['go']);
    assert.equal(host.playerActor.y, 0);
    assert.match(warnings[0], /"move" cannot run during a battle/);
});

test('trainer levels can follow a variable', () =>
{
    const state = GameState.create();
    state.setVar('gym_level', 20);
    const ctx: EvalContext = { state, map: '', self: null, trigger: null, playerFacing: 'down' };
    const team = buildTrainerTeam({
        class: 'leader', name: 'x', variants: [{ team: [{ species: 'onix', level: { var: 'gym_level', offset: 2 }, ability: 'sturdy' }] }],
    }, ctx, { learnset: () => ({ tackle: ['9L1'], rockthrow: ['9L10'], bind: ['9L15'], harden: ['9L4'], screech: ['9L20'], rocktomb: ['9L22'] }) });
    assert.equal(team.sets[0].level, 22);
    assert.deepEqual(team.sets[0].moves, ['rockthrow', 'bind', 'screech', 'rocktomb']);
    assert.match(team.packed, /onix/i);
});

test('locale CSVs: quoting, placeholders and fallback to English', () =>
{
    assert.deepEqual(parseCsv('key,text\r\na,"Hello, ""you""\nthere"\n\nb,x'), [['key', 'text'], ['a', 'Hello, "you"\nthere'], ['b', 'x']]);
    const en = parseLocaleCsv('key,text\ngreet,"Hi {player}, {count} {item:potion}! {text:bye} {var:rival_name} {who}"\nbye,Bye\nitems.potion.name,Potion\nonly_en,English\n');
    const de = parseLocaleCsv('﻿key,text\ngreet,Hallo {player}!\nitems.potion.name,Trank\n');
    const text = new TextStore({ en, de });
    const state = GameState.create({ name: 'Red' });
    state.setVar('rival_name', 'Blue');
    assert.equal(text.format('greet', { state }, { count: 2, who: 'items.potion.name' }), 'Hi Red, 2 Potion! Bye Blue Potion');
    text.locale = 'de';
    assert.equal(text.format('greet', { state }), 'Hallo Red!');
    assert.equal(text.format('only_en', { state }), 'English');
    assert.equal(text.format('missing.key', { state }), 'missing.key');
    assert.equal(text.dataName('items', 'potion'), 'Trank');
});

test('saves from before events existed still load, at the same version', () =>
{
    assert.equal(SAVE_VERSION, 1);
    const old = GameState.create({ name: 'Red' }).toJSON() as Record<string, unknown>;
    delete old.selfSwitches;
    delete old.hiddenEvents;
    delete old.story;
    const state = GameState.fromJSON(old);
    assert.deepEqual(state.getSnapshot().selfSwitches, {});
    state.setSelfSwitch('map', 1, 'A');
    assert.equal(state.getSelfSwitch('map', 1, 'A'), true);
    state.setSelfSwitch('map', 1, 'A', false);
    assert.deepEqual(state.getSnapshot().selfSwitches, {});
});

test('Tiled objects become events through the factory of their class', () =>
{
    const bundle = bundleOf({
        trainers: { joey: { class: 'youngster', name: 'trainers.joey.name', variants: [{ team: [{ species: 'rattata', level: 3 }] }] } },
        scripts: { lab: { tags: ['lab'], pages: [{ commands: [] }] } },
    });
    const prop = (name: string, value: unknown) => ({ name, type: typeof value === 'number' ? 'int' : 'string', value });
    const map: TiledMap = {
        width: 10, height: 10, tilewidth: 16, tileheight: 16, tilesets: [],
        properties: [prop('bgm', 'route1')],
        layers: [
            { name: 'ground', type: 'tilelayer' },
            {
                name: 'events', type: 'objectgroup', objects: [
                    { id: 1, type: 'Sign', x: 32, y: 16, width: 16, height: 16, properties: [prop('text', 'signs.route1')] },
                    { id: 2, type: 'ItemBall', x: 48, y: 48, width: 16, height: 16, properties: [prop('item', 'potion')] },
                    { id: 3, type: 'Warp', x: 0, y: 0, width: 32, height: 16, properties: [prop('map', 'town'), prop('spawn', 'door')] },
                    { id: 4, type: 'Trainer', x: 64, y: 64, properties: [prop('trainer', 'joey'), prop('direction', 'left')] },
                    { id: 5, class: 'Event', name: 'aide', x: 80, y: 96, gid: 3, width: 16, height: 16, properties: [prop('script', 'lab'), prop('tags', 'a, b')] },
                    { id: 6, type: 'Spawn', name: 'door', x: 16, y: 16, properties: [prop('direction', 'up')] },
                    { id: 7, type: 'Mystery', x: 0, y: 0 },
                    { id: 8, type: 'Event', x: 0, y: 0, properties: [prop('script', 'missing')] },
                    { id: 9, x: 0, y: 0 },
                ],
            },
        ],
    };
    const result = instantiateMap(map, 'route1', bundle);
    assert.deepEqual(result.events.map((event) => [event.id, event.kind, event.x, event.y]), [
        [1, 'Sign', 2, 1], [2, 'ItemBall', 3, 3], [3, 'Warp', 0, 0], [4, 'Trainer', 4, 4], [5, 'Event', 5, 5],
    ]);
    assert.equal(result.events[2].width, 2);
    assert.deepEqual(result.events[4].tags, ['a', 'b']);
    assert.equal(result.events[1].script.pages[0].graphic, 'itemball');
    assert.equal(result.events[3].script.pages[0].trigger, 'sight');
    assert.equal(result.events[3].script.pages[0].direction, 'left');
    assert.deepEqual(result.spawns, { door: { x: 1, y: 1, dir: 'up' } });
    assert.equal(result.props.bgm, 'route1');
    assert.deepEqual(result.issues, [
        'route1: object 7 (Mystery): no factory for class "Mystery"',
        'route1: object 8 (Event): script "missing" does not exist',
    ]);
});

test('item balls disappear once taken, and stay when the bag is full', async () =>
{
    const map: TiledMap = {
        width: 10, height: 10, tilewidth: 16, tileheight: 16, tilesets: [],
        layers: [{
            name: 'events', type: 'objectgroup', objects: [
                { id: 2, type: 'ItemBall', x: 0, y: 16, properties: [{ name: 'item', type: 'string', value: 'potion' }] },
            ],
        }],
    };
    const bundle = emptyBundle();
    const { events } = instantiateMap(map, 'testmap', bundle);
    const state = GameState.create();
    state.addItem('potion', 999, 'medicine');
    const { host, manager } = world(bundle, events, state);
    manager.playerAction();
    await settle(manager);
    assert.equal(manager.event(2)!.pageIndex, 0);
    state.removeItem('potion', 999);
    manager.playerAction();
    await settle(manager);
    assert.equal(state.countItem('potion'), 1);
    assert.equal(manager.event(2)!.pageIndex, 1);
    assert.deepEqual(host.messages, ['Bag full', 'Got 1 potion!']);
});

test('trainers see the player, walk up and battle once', async () =>
{
    const bundle = bundleOf({
        trainers: { joey: { class: 'youngster', name: 'trainers.joey.name', variants: [{ team: [{ species: 'rattata', level: 3, moves: ['tackle'], ability: 'guts' }] }] } },
    });
    const map: TiledMap = {
        width: 10, height: 10, tilewidth: 16, tileheight: 16, tilesets: [],
        layers: [{
            name: 'events', type: 'objectgroup', objects: [{
                id: 4, type: 'Trainer', x: 0, y: 64, properties: [
                    { name: 'trainer', type: 'string', value: 'joey' }, { name: 'direction', type: 'string', value: 'up' },
                    { name: 'intro', type: 'string', value: 'intro' }, { name: 'after', type: 'string', value: 'after' },
                ],
            }],
        }],
    };
    const { events } = instantiateMap(map, 'testmap', bundle);
    const { host, manager } = world(bundle, events);
    host.actors.get(4)!.facing = 'up';
    await settle(manager, 60);
    assert.equal(host.battles.length, 1);
    assert.deepEqual([host.actors.get(4)!.x, host.actors.get(4)!.y], [0, 1]);
    assert.equal(host.playerActor.facing, 'down');
    manager.playerAction();
    await settle(manager);
    assert.equal(host.battles.length, 1);
    assert.deepEqual(host.messages, ['intro', 'after']);
});

test('parallel branches and common events', async () =>
{
    const bundle = bundleOf({
        common: { greet: [{ cmd: 'message', key: 'common' }, { cmd: 'setVar', var: 'n', op: 'add', value: 1 }] },
        scripts: {
            npc: {
                pages: [{
                    commands: [
                        {
                            cmd: 'parallel', branches: [
                                [{ cmd: 'wait', ms: 1 }, { cmd: 'setVar', var: 'a', value: 1 }],
                                [{ cmd: 'callCommon', id: 'greet' }],
                            ],
                        },
                        { cmd: 'callCommon', id: 'greet' },
                        { cmd: 'message', key: 'done' },
                    ],
                }],
            },
        },
    });
    const { host, manager, state } = world(bundle, [defOf(bundle, 'npc', 1, 0, 1)]);
    manager.playerAction();
    await settle(manager);
    assert.equal(state.getVar('a'), 1);
    assert.equal(state.getVar('n'), 2);
    assert.deepEqual(host.messages, ['common', 'common', 'done']);
    manager.runCommon('greet');
    await settle(manager);
    assert.equal(state.getVar('n'), 3);
});

test('nickname: the Pokémon\'s language sets the rules; only its original trainer may rename it', async () =>
{
    const state = GameState.create({ name: 'Red', trainerId: 1, language: 'de' });
    state.addToParty(createPokemon({ species: 'pikachu', level: 5, ability: 'static', moves: ['thundershock'] }));
    state.addToParty(createPokemon({
        species: 'eevee', level: 5, ability: 'runaway', moves: ['tackle'], language: 'ja', ot: { name: 'サトシ', id: 99 },
    }));
    const { host } = await runCommands([{ cmd: 'nickname', slot: 0 }, { cmd: 'nickname', slot: 1 }], state);
    const [pikachu, eevee] = state.getSnapshot().party;
    assert.equal(pikachu.language, 'de', 'the player\'s own Pokémon takes the game\'s language');
    assert.equal(pikachu.nickname, 'Blue');
    assert.equal(eevee.language, 'ja', 'a traded Pokémon keeps its language');
    assert.equal(eevee.nickname, undefined);
    assert.deepEqual(host.messages, ['system.cannot_nickname'], 'the prompt goes to the name entry, the refusal to the message box');
});

test('nickname: names longer than the language allows are cut', async () =>
{
    const state = GameState.create({ name: 'Red', trainerId: 1 });
    state.addToParty(createPokemon({ species: 'pikachu', level: 5, ability: 'static', moves: ['thundershock'], language: 'ja' }));
    //  No original trainer: it becomes the player's own, in the game's language.
    assert.equal(state.getSnapshot().party[0].language, 'en');
    state.updatePokemon(state.getSnapshot().party[0].uid, { language: 'ja' });
    const bundle = bundleOf(talk([{ cmd: 'nickname' }]));
    const w = world(bundle, [defOf(bundle, 'npc', 1, 0, 1)], state);
    w.host.nameInput = async () => 'ABCDEFGHIJ';
    w.manager.playerAction();
    await settle(w.manager);
    assert.equal(state.getSnapshot().party[0].nickname, 'ABCDEF', 'Japanese nicknames have 6 characters');
});

test('pokedexEntry passes the unlocked languages, the game\'s first', async () =>
{
    const state = GameState.create({ name: 'Red', trainerId: 1, language: 'fr' });
    state.addToParty(createPokemon({ species: 'eevee', level: 5, ability: 'runaway', moves: ['tackle'] }));
    state.addToParty(createPokemon({ species: 'eevee', level: 5, ability: 'runaway', moves: ['tackle'], language: 'ko', ot: { name: 'X', id: 5 } }));
    const bundle = bundleOf(talk([{ cmd: 'pokedexEntry', species: 'eevee' }]));
    const w = world(bundle, [defOf(bundle, 'npc', 1, 0, 1)], state);
    const shown: [string, string[]][] = [];
    w.host.pokedexEntry = async (species: string, languages: string[]) => { shown.push([species, languages]); };
    w.manager.playerAction();
    await settle(w.manager);
    assert.deepEqual(shown, [['eevee', ['fr', 'ko']]]);
});
