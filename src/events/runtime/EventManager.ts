/**
 * @file EventManager.ts
 * @brief Runs the events of the current map: picks pages, starts scripts, runs listeners.
 *
 * The overworld scene owns one `EventManager` and tells it what the player
 * does (`playerAction()`, `playerMoved()`, `playerBumped()`...) and calls
 * `update()` every frame. The manager decides which scripts run:
 *
 * - **Blocking** scripts (action, touch, sight, autorun, listeners, common
 *   events) run one at a time. While one runs, `busy` is `true`, the player
 *   cannot walk and saving is blocked (`blockSaving()` in src/state).
 * - **Parallel** pages run alongside play and start again when they end.
 *
 * Pages are picked again whenever the game state changes, so setting a flag
 * or self switch switches events to their new page at once.
 *
 * @code
 * const events = new EventManager({ state, bundle, text, host, data });
 * events.loadMap('route1', definitions);   // from instantiateMap() (tiled.ts)
 * // every frame:
 * events.update();
 * // input:
 * if (!events.busy && actionPressed) events.playerAction();
 * @endcode
 */
import { Teams } from '@pkmn/sim';
import type { GameState } from '../../state/GameState.ts';
import { blockSaving } from '../../state/session.ts';
import type { SaveData } from '../../state/schema.ts';
import type { CompiledPage, EventBundle, Instruction } from '../compile.ts';
import type { EvalContext } from '../conditions.ts';
import { evaluate, resolveNumber } from '../conditions.ts';
import { DIRECTION_DELTA, directionTowards } from '../pathfinding.ts';
import { LISTENER_FLAG_PREFIX, TRAINER_FLAG_PREFIX } from '../registry/flags.ts';
import { DEFAULT_STORY_TRACK, findMilestone } from '../registry/story.ts';
import type { BattleResult, Condition, ListenerOn } from '../schema.ts';
import type { TextStore } from '../text.ts';
import { buildTrainerTeam, trainerSet } from '../trainers.ts';
import { BattleHookRunner } from './battleHooks.ts';
import { GameEvent } from './GameEvent.ts';
import type { EventDefinition } from './GameEvent.ts';
import type { RuntimeData, WorldHost } from './host.ts';
import { Interpreter } from './Interpreter.ts';
import type { Frame } from './Interpreter.ts';

/**
 * @brief A TypeScript function scripts may call by name with the `native` command.
 * @param args The command's arguments, already read.
 * @return Anything; a number or text is stored in the command's `resultVar`.
 */
export type NativeFunction = (args: Record<string, number | string>, manager: EventManager) => unknown;

/** @brief Settings for an `EventManager`. */
export interface EventManagerOptions
{
    state: GameState;
    /** All compiled event files (`import bundle from 'virtual:stab-events'`). */
    bundle: EventBundle;
    text: TextStore;
    host: WorldHost;
    data?: RuntimeData;
    /** Random numbers, 0 (inclusive) to 1 (exclusive). Default: `Math.random`. */
    random?: () => number;
    /**
     * Called when a script fails. The script stops; the game goes on.
     * Default: `console.error`.
     */
    onError?: (error: unknown, where: string) => void;
    /** Called for problems that do not stop a script. Default: `console.warn`. */
    onWarning?: (message: string) => void;
}

/** @brief A blocking script waiting to run. */
interface Job
{
    code: readonly Instruction[];
    frame: Frame;
    where: string;
    /** For autorun pages: the page that started, to clear its condition afterwards. */
    autorun?: { event: GameEvent; page: number };
    /** Run just before the script starts (e.g. `once` bookkeeping). Return `false` to skip it. */
    before?: () => boolean;
}

/** @brief Keeps the events of the current map running. */
export class EventManager
{
    readonly state: GameState;
    readonly bundle: EventBundle;
    readonly text: TextStore;
    readonly host: WorldHost;
    readonly data: RuntimeData;
    readonly random: () => number;

    /** @brief The current map's ID (empty before `loadMap()`). */
    map = '';
    /** @brief The current map's events, by ascending ID. */
    events: GameEvent[] = [];

    private readonly byId = new Map<number, GameEvent>();
    private readonly queue: Job[] = [];
    private readonly parallels = new Map<GameEvent, Interpreter>();
    private readonly natives = new Map<string, NativeFunction>();
    private readonly onError: (error: unknown, where: string) => void;
    private readonly onWarning: (message: string) => void;
    private main: Interpreter | null = null;
    private releaseSave: (() => void) | null = null;
    private dirty = true;
    private previous: SaveData;
    private readonly unsubscribe: () => void;

    /**
     * @param options State, scripts, text, host and data.
     */
    constructor (options: EventManagerOptions)
    {
        this.state = options.state;
        this.bundle = options.bundle;
        this.text = options.text;
        this.host = options.host;
        this.data = options.data ?? {};
        this.random = options.random ?? Math.random;
        this.onError = options.onError ?? ((error, where) => console.error(`[events] ${where}:`, error));
        this.onWarning = options.onWarning ?? ((message) => console.warn(`[events] ${message}`));
        this.previous = this.state.getSnapshot();
        this.unsubscribe = this.state.subscribe(() => this.stateChanged());
    }

    /** @brief Whether a blocking script is running or waiting. The player cannot walk or save meanwhile. */
    get busy (): boolean
    {
        return this.main !== null || this.queue.length > 0;
    }

    /** @brief Stop everything and stop listening to the game state. */
    dispose (): void
    {
        this.unsubscribe();
        this.main?.stop();
        for (const parallel of this.parallels.values()) parallel.stop();
        this.parallels.clear();
        this.queue.length = 0;
        this.releaseSave?.();
        this.releaseSave = null;
    }

    // ----------------------------------------------------------- Maps

    /**
     * @brief Put a map's events in place of the current ones.
     *
     * A script that is running (for example the one that warped here) keeps
     * running. Parallel scripts of the old map stop.
     * @param map Map ID.
     * @param definitions The map's events (from `instantiateMap()`).
     */
    loadMap (map: string, definitions: readonly EventDefinition[]): void
    {
        if (this.map) this.emit('mapExit', this.map);
        for (const parallel of this.parallels.values()) parallel.stop();
        this.parallels.clear();
        this.map = map;
        this.events = definitions.map((definition) => new GameEvent(definition)).sort((a, b) => a.id - b.id);
        this.byId.clear();
        for (const event of this.events) this.byId.set(event.id, event);
        this.refresh();
        this.emit('mapEnter', map);
    }

    /** @brief The event with this ID on the current map, or `undefined`. */
    event (id: number): GameEvent | undefined
    {
        return this.byId.get(id);
    }

    /**
     * @brief What conditions see right now.
     * @param frame The script's frame, or none for page selection.
     */
    context (frame?: Frame): EvalContext
    {
        return {
            state: this.state,
            map: frame?.map ?? this.map,
            self: frame?.self ?? null,
            trigger: frame?.trigger ?? null,
            playerFacing: this.host.player().facing,
            random: this.random,
        };
    }

    /** @brief Pick every event's page again and redraw those that changed. */
    refresh (): void
    {
        this.dirty = false;
        const ctx = this.context();
        for (const event of this.events)
        {
            if (!event.refresh(ctx, this.state.isEventHidden(this.map, event.id))) continue;
            this.parallels.get(event)?.stop();
            this.parallels.delete(event);
            this.host.syncEvent(event.id);
        }
    }

    // ---------------------------------------------------------- Frame

    /** @brief Call every frame: refreshes pages and starts scripts that are due. */
    update (): void
    {
        if (this.dirty) this.refresh();
        if (!this.main) this.startNext();
        for (const event of this.events)
        {
            const page = event.page;
            if (page?.trigger !== 'parallel' || this.parallels.has(event) || !page.code.length) continue;
            const interpreter = new Interpreter(this, page.code, this.frame(event, null));
            this.parallels.set(event, interpreter);
            void interpreter.run()
                .catch((error) => this.onError(error, `parallel page of event ${event.id} (${event.name})`))
                .finally(() =>
                {
                    if (this.parallels.get(event) === interpreter) this.parallels.delete(event);
                });
        }
    }

    /** @brief Start the next blocking script: queued ones first, then autorun pages, then trainers who see the player. */
    private startNext (): void
    {
        let job = this.queue.shift();
        while (job?.before && !job.before()) job = this.queue.shift();
        if (!job)
        {
            const autorun = this.events.find((event) => event.page?.trigger === 'autorun');
            if (autorun) job = this.pageJob(autorun, null);
        }
        if (!job)
        {
            const watcher = this.events.find((event) => this.sees(event));
            if (watcher) job = this.pageJob(watcher, null);
        }
        if (job) this.runJob(job);
    }

    /** @brief Run a blocking script, holding saving back until it ends. */
    private runJob (job: Job): void
    {
        const interpreter = new Interpreter(this, job.code, job.frame);
        this.main = interpreter;
        this.releaseSave ??= blockSaving('event');
        void interpreter.run()
            .catch((error) => this.onError(error, job.where))
            .finally(() =>
            {
                if (job.frame.self) job.frame.self.locked = false;
                if (job.autorun) this.clearAutorun(job.autorun.event, job.autorun.page);
                this.main = null;
                this.refresh();
                if (!this.queue.length)
                {
                    this.releaseSave?.();
                    this.releaseSave = null;
                }
            });
    }

    // ---------------------------------------------------------- Input

    /**
     * @brief The player pressed the action button.
     *
     * Looks at the player's own tile, then the tile in front of them, for an
     * event whose page has an `action` (or `sight`) trigger.
     * @return `true` if a script started.
     */
    playerAction (): boolean
    {
        if (this.busy) return false;
        const player = this.host.player();
        const [dx, dy] = DIRECTION_DELTA[player.facing];
        for (const [x, y] of [[player.x, player.y], [player.x + dx, player.y + dy]])
        {
            const event = this.eventsAt(x, y).find((e) => e.page?.trigger === 'action' || e.page?.trigger === 'sight');
            if (event) return this.start(event, null);
        }
        return false;
    }

    /**
     * @brief The player finished a step onto a tile.
     *
     * Starts `playerTouch`/`eventTouch` events the player is now standing on
     * (trigger areas, walk-through events) and `step` listeners.
     * @param x Tile column.
     * @param y Tile row.
     */
    playerMoved (x: number, y: number): void
    {
        this.emit('step', this.map);
        if (this.busy) return;
        const event = this.eventsAt(x, y).find((e) => e.page?.trigger === 'playerTouch' || e.page?.trigger === 'eventTouch');
        if (event) this.start(event, null);
    }

    /**
     * @brief The player tried to walk into a tile and something was in the way.
     * @param x Tile column.
     * @param y Tile row.
     * @return `true` if a script started.
     */
    playerBumped (x: number, y: number): boolean
    {
        if (this.busy) return false;
        const event = this.eventsAt(x, y).find((e) => e.page?.trigger === 'playerTouch' || e.page?.trigger === 'eventTouch');
        return event ? this.start(event, null) : false;
    }

    /**
     * @brief An event tried to walk into the player.
     * @param id The event's ID.
     * @return `true` if its `eventTouch` page started.
     */
    eventTouchedPlayer (id: number): boolean
    {
        const event = this.byId.get(id);
        if (this.busy || event?.page?.trigger !== 'eventTouch') return false;
        return this.start(event, null);
    }

    /**
     * @brief Run an event's active page now (queued behind a running script).
     * @param event The event.
     * @param trigger The event that set it off, or `null` for the player.
     * @return `false` if it has no active page with commands.
     */
    start (event: GameEvent, trigger: GameEvent | null): boolean
    {
        const job = this.pageJob(event, trigger);
        if (!job) return false;
        this.queue.push(job);
        if (!this.main) this.startNext();
        return true;
    }

    /**
     * @brief Run a common event (queued behind a running script).
     * @param id Common event ID.
     * @throws Error if there is no such common event.
     */
    runCommon (id: string): void
    {
        const code = this.bundle.common[id];
        if (!code) throw new Error(`[events] common event "${id}" does not exist`);
        this.queue.push({ code, frame: this.frame(null, null), where: `common event "${id}"` });
        if (!this.main) this.startNext();
    }

    /** @brief A job for an event's active page, locking it in place for action and touch triggers. */
    private pageJob (event: GameEvent, trigger: GameEvent | null): Job | undefined
    {
        const page = event.page;
        if (!page || !page.code.length) return undefined;
        const job: Job = { code: page.code, frame: this.frame(event, trigger), where: `event ${event.id} (${event.name})` };
        if (page.trigger === 'autorun') job.autorun = { event, page: event.pageIndex };
        if (page.trigger !== 'autorun' && page.trigger !== 'parallel')
        {
            job.before = () =>
            {
                this.lock(event, page);
                return true;
            };
        }
        return job;
    }

    /**
     * @brief Turn an event towards the player and hold it still while its script runs.
     * @param event The event (nothing happens for `null`).
     * @param page Its page. Default: the active one.
     */
    lock (event: GameEvent | null, page: CompiledPage | null = event?.page ?? null): void
    {
        if (!event) return;
        event.locked = true;
        if (page?.directionFix) return;
        const actor = this.host.actorOf(event.id);
        const player = this.host.player();
        const dir = actor && directionTowards(actor.x, actor.y, player.x, player.y);
        if (actor && dir) actor.turn(dir);
    }

    /** @brief A frame for a script of `self`. */
    private frame (self: GameEvent | null, trigger: GameEvent | null): Frame
    {
        return { map: this.map, self, trigger, mode: 'world' };
    }

    /**
     * @brief The events with an active page on a tile: where their character
     *        stands, or, for events without one, anywhere in their trigger area.
     */
    eventsAt (x: number, y: number): GameEvent[]
    {
        return this.events.filter((event) =>
        {
            if (!event.page) return false;
            const actor = this.host.actorOf(event.id);
            return actor ? actor.x === x && actor.y === y : event.covers(x, y);
        });
    }

    /**
     * @brief Whether an event with a `sight` page sees the player: in a straight
     *        line in front of it, within range, with nothing in between.
     */
    private sees (event: GameEvent): boolean
    {
        const page = event.page;
        if (page?.trigger !== 'sight' || event.locked) return false;
        const actor = this.host.actorOf(event.id);
        if (!actor) return false;
        const player = this.host.player();
        const [dx, dy] = DIRECTION_DELTA[actor.facing];
        let x = actor.x;
        let y = actor.y;
        for (let i = 0; i < (page.sightRange ?? 4); i++)
        {
            if (x + dx === player.x && y + dy === player.y) return true;
            if (!this.host.canStep(null, x, y, actor.facing)) return false;
            x += dx;
            y += dy;
        }
        return false;
    }

    // -------------------------------------------------------- Autorun

    /**
     * @brief After an autorun page ends: if the same page would start again,
     *        turn off its own condition so it cannot run forever.
     *
     * The first flag or self switch the page's conditions test (at the top or
     * inside `all`) is flipped. A page with nothing to flip is erased until
     * the map is loaded again.
     */
    private clearAutorun (event: GameEvent, pageIndex: number): void
    {
        this.refresh();
        const page = event.script.pages[pageIndex];
        if (event.pageIndex !== pageIndex || page.trigger !== 'autorun' || (page.autorunClear ?? 'auto') === 'none') return;
        const leaf = clearableLeaf(page.conditions);
        if (leaf && 'flag' in leaf) this.state.setFlag(leaf.flag, !(leaf.is ?? true));
        else if (leaf && 'selfSwitch' in leaf)
        {
            this.state.setSelfSwitch(this.map, leaf.event ?? event.id, leaf.selfSwitch, !(leaf.is ?? true));
        }
        else
        {
            event.erased = true;
            this.warn(`autorun page ${pageIndex + 1} of event ${event.id} (${event.name}) has no flag or self switch to clear; erased it until the map reloads`);
        }
        this.refresh();
    }

    // ------------------------------------------------------ Listeners

    /** @brief The game state changed: refresh pages soon and tell listeners. */
    private stateChanged (): void
    {
        this.dirty = true;
        const before = this.previous;
        const after = this.state.getSnapshot();
        this.previous = after;
        for (const name of changedKeys(before.flags, after.flags)) this.emit('flagChanged', name);
        for (const name of changedKeys(before.variables, after.variables)) this.emit('varChanged', name);
        for (const name of changedKeys(before.story, after.story)) this.emit('storyChanged', name);
        if (before.bag !== after.bag)
        {
            const had = itemCounts(before);
            for (const [item, count] of itemCounts(after)) if (count > (had.get(item) ?? 0)) this.emit('itemObtained', item);
        }
        if (before.party !== after.party || before.pc !== after.pc)
        {
            const had = new Set(allPokemon(before).map((pokemon) => pokemon.uid));
            for (const pokemon of allPokemon(after)) if (!had.has(pokemon.uid)) this.emit('pokemonObtained', pokemon.species);
        }
    }

    /**
     * @brief Queue the listeners for something that happened.
     * @param on What happened.
     * @param name What it is about (flag, variable, item, species, story track or map).
     */
    emit (on: ListenerOn, name: string): void
    {
        for (const [id, listener] of Object.entries(this.bundle.listeners))
        {
            if (listener.on !== on || (listener.name !== undefined && listener.name !== name)) continue;
            if (listener.once && this.state.getFlag(LISTENER_FLAG_PREFIX + id)) continue;
            const frame = this.frame(null, null);
            //  Conditions are checked when the change happens, not when the listener's turn comes.
            if (!evaluate(listener.conditions, this.context(frame))) continue;
            this.queue.push({
                code: listener.code, frame, where: `listener "${id}"`,
                before: () =>
                {
                    if (!listener.once) return true;
                    if (this.state.getFlag(LISTENER_FLAG_PREFIX + id)) return false;
                    this.state.setFlag(LISTENER_FLAG_PREFIX + id);
                    return true;
                },
            });
        }
    }

    // -------------------------------------------------------- Natives

    /**
     * @brief Make a TypeScript function callable from scripts with `{ "cmd": "native", "name": ... }`.
     * @param name Name (list it in src/events/registry/natives.ts too).
     * @param fn The function. May return a promise; the script waits for it.
     */
    registerNative (name: string, fn: NativeFunction): void
    {
        this.natives.set(name, fn);
    }

    /**
     * @brief Call a registered native function.
     * @param name Its name.
     * @param args Arguments.
     * @return What it returned.
     * @throws Error if nothing is registered under that name.
     */
    async callNative (name: string, args: Record<string, number | string>): Promise<unknown>
    {
        const fn = this.natives.get(name);
        if (!fn) throw new Error(`native function "${name}" is not registered (EventManager.registerNative)`);
        return fn(args, this);
    }

    // -------------------------------------------------------- Battles

    /**
     * @brief Build the opponent and ask the host to run a battle.
     * @param battle The battle command (without its result branches).
     * @param frame The script's frame, for conditions.
     * @return How it ended.
     */
    async runBattle (
        battle: Extract<Instruction, { op: 'battle' }>['battle'], frame: Frame,
    ): Promise<BattleResult>
    {
        const ctx = this.context(frame);
        const hooks = new BattleHookRunner(this, battle.cmd === 'trainerBattle' ? battle.trainer : undefined);
        const onStep = hooks.onStep.bind(hooks);
        if (battle.cmd === 'wildBattle')
        {
            const level = Math.max(1, Math.trunc(resolveNumber(battle.level, ctx, 'wildBattle level')));
            const set = trainerSet({ species: battle.species, level, moves: battle.moves, shiny: battle.shiny }, level, this.data);
            const result = await this.host.battle({
                kind: 'wild', foeName: this.text.dataName('pokemon', battle.species), sets: [set],
                team: Teams.pack([set]), format: 'singles', onStep,
            });
            this.emit('battleEnd', battle.species);
            return result;
        }
        const trainer = this.bundle.trainers[battle.trainer];
        if (!trainer) throw new Error(`trainer "${battle.trainer}" does not exist`);
        const team = buildTrainerTeam(trainer, ctx, this.data);
        const foeName = this.text.format(trainer.name, ctx);
        const result = await this.host.battle({
            kind: 'trainer', trainerId: battle.trainer, trainer, foeName, sets: team.sets, team: team.packed,
            format: trainer.format ?? 'singles', onStep,
        });
        if (result === 'win')
        {
            this.state.setFlag(TRAINER_FLAG_PREFIX + battle.trainer);
            const prize = (trainer.money ?? 0) * (team.sets.at(-1)?.level ?? 0);
            if (prize > 0)
            {
                this.state.addMoney(prize);
                await this.host.message(this.text.format('system.prize_money', ctx, { amount: prize }));
            }
            if (trainer.defeat) await this.host.message(this.text.format(trainer.defeat, ctx));
        }
        this.emit('battleEnd', battle.trainer);
        return result;
    }

    // ---------------------------------------------------------- Misc

    /**
     * @brief The track a milestone belongs to.
     * @param milestone Milestone ID.
     * @return Its track, or the default track if it is not registered.
     */
    trackOf (milestone: string): string
    {
        return findMilestone(milestone)?.track ?? DEFAULT_STORY_TRACK;
    }

    /** @brief Report a problem that does not stop the script. */
    warn (message: string): void
    {
        this.onWarning(message);
    }
}

/** @brief The first flag or self switch a condition tests, at the top or inside `all`. */
function clearableLeaf (condition: Condition | undefined): Extract<Condition, { flag: string } | { selfSwitch: string }> | null
{
    if (!condition) return null;
    if ('flag' in condition || 'selfSwitch' in condition) return condition;
    if ('all' in condition)
    {
        for (const part of condition.all)
        {
            const leaf = clearableLeaf(part);
            if (leaf) return leaf;
        }
    }
    return null;
}

/** @brief Keys whose values differ between two records. */
function changedKeys<T> (before: Record<string, T>, after: Record<string, T>): string[]
{
    if (before === after) return [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter((key) => before[key] !== after[key]);
}

/** @brief How many of each item the bag holds. */
function itemCounts (data: SaveData): Map<string, number>
{
    const counts = new Map<string, number>();
    for (const stacks of Object.values(data.bag)) for (const stack of stacks) counts.set(stack.item, stack.quantity);
    return counts;
}

/** @brief Every Pokémon the player owns. */
function allPokemon (data: SaveData): { uid: string; species: string }[]
{
    return [...data.party, ...data.pc.boxes.flatMap((box) => box.slots.filter((slot) => slot !== null))];
}
