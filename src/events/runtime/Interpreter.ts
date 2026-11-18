/**
 * @file Interpreter.ts
 * @brief Runs compiled instructions (compile.ts), one command at a time.
 *
 * Every command is a case in a `switch`; there is no way for a script to
 * run code of its own. Commands that take time (messages, movement, fades,
 * battles) are awaited, so a script reads top to bottom like a cutscene.
 */
import { canNickname, languageInfo, nicknameRules, sanitizeName } from '../../i18n/index.ts';
import { createPokemon } from '../../state/pokemon.ts';
import { levelUpMoves } from '../../state/experience.ts';
import type { Instruction, PlainCommand } from '../compile.ts';
import { evaluate, resolveNumber, resolveValue } from '../conditions.ts';
import type { EvalContext } from '../conditions.ts';
import { DIRECTION_DELTA, directionTowards, findPath } from '../pathfinding.ts';
import { BATTLE_RESULT_VAR, CHOICE_RESULT_VAR } from '../registry/variables.ts';
import type { CommandName, Target, TextParams } from '../schema.ts';
import type { EventManager } from './EventManager.ts';
import type { GameEvent } from './GameEvent.ts';
import type { Actor } from './host.ts';
import { runRoute } from './route.ts';

/** @brief Who and where a script runs for. */
export interface Frame
{
    /** Map the script started on: self switches it sets belong to this map. */
    map: string;
    /** The event whose script this is, or `null` (common events, listeners, hooks). */
    self: GameEvent | null;
    /** The event that started it, or `null` if the player did. */
    trigger: GameEvent | null;
    /** `battle` for battle hooks: commands that need the overworld are skipped. */
    mode: 'world' | 'battle';
}

/**
 * @brief Commands that only work on the overworld map.
 *
 * The validator rejects them in battle hooks, and the interpreter skips them
 * there with a warning.
 */
export const WORLD_ONLY_COMMANDS: ReadonlySet<CommandName> = new Set<CommandName>([
    'move', 'moveMany', 'waitMoves', 'pathTo', 'face', 'camera', 'shake', 'emote', 'fade', 'tint', 'flash', 'show', 'hide',
    'erase', 'setPosition', 'setGraphic', 'warp', 'playerControl', 'lock', 'unlock', 'trainerBattle', 'wildBattle', 'ink',
    'nameInput', 'nickname', 'pokedexEntry',
]);

/**
 * @brief Text keys the runtime itself shows. They must exist in the English locale file.
 *
 * Placeholders: `obtained_item`: `{item}`, `{quantity}`; `obtained_pokemon`
 * and `no_room_pokemon`: `{species}`; `prize_money`: `{amount}`;
 * `learned_move`: `{pokemon}`, `{move}`; `nickname_prompt` and `cannot_nickname`: `{pokemon}`.
 */
export const SYSTEM_TEXT_KEYS = [
    'system.yes', 'system.no', 'system.obtained_item', 'system.bag_full', 'system.obtained_pokemon',
    'system.no_room_pokemon', 'system.prize_money', 'system.learned_move', 'system.nickname_prompt', 'system.cannot_nickname',
] as const;

/** @brief After this many instructions without waiting, a script yields one frame so the game never freezes. */
const YIELD_EVERY = 1000;

/** @brief Runs one command list. */
export class Interpreter
{
    private pc = 0;
    private stopped = false;
    /** Movement started with `wait: false`, for `waitMoves`. */
    private readonly moving = new Set<Promise<void>>();
    private readonly manager: EventManager;
    private readonly code: readonly Instruction[];
    /** @brief Who and where it runs for. */
    readonly frame: Frame;

    /**
     * @param manager The event manager (state, host, text, bundle).
     * @param code The instructions.
     * @param frame Who and where it runs for.
     */
    constructor (manager: EventManager, code: readonly Instruction[], frame: Frame)
    {
        this.manager = manager;
        this.code = code;
        this.frame = frame;
    }

    /** @brief Whether `stop()` was called. */
    get isStopped (): boolean
    {
        return this.stopped;
    }

    /** @brief Stop at the next command. A command already running finishes first. */
    stop (): void
    {
        this.stopped = true;
    }

    /**
     * @brief Run to the end (or until `stop()` or `exit`).
     * @return Resolves when the script has finished.
     */
    async run (): Promise<void>
    {
        let quick = 0;
        while (!this.stopped && this.pc < this.code.length)
        {
            const instruction = this.code[this.pc++];
            if (++quick >= YIELD_EVERY)
            {
                quick = 0;
                await this.manager.host.wait(16);
            }
            switch (instruction.op)
            {
                case 'jump':
                    this.pc = instruction.to;
                    break;
                case 'jumpUnless':
                    if (!evaluate(instruction.cond, this.context())) this.pc = instruction.to;
                    break;
                case 'exit':
                    this.pc = this.code.length;
                    break;
                case 'choice':
                    quick = 0;
                    await this.choice(instruction);
                    break;
                case 'parallel':
                    quick = 0;
                    await Promise.all(instruction.branches.map((branch) => this.child(branch).run()));
                    break;
                case 'battle':
                {
                    quick = 0;
                    if (this.skipInBattle(instruction.battle.cmd)) break;
                    const result = await this.manager.runBattle(instruction.battle, this.frame);
                    this.manager.state.setVar(BATTLE_RESULT_VAR, result);
                    //  Without canLose, losing is the end of the script (Essentials' whiteout).
                    if ((result === 'lose' || result === 'draw') && !instruction.battle.canLose)
                    {
                        await this.manager.host.whiteout();
                        this.stop();
                        break;
                    }
                    this.pc = instruction.targets[result];
                    break;
                }
                case 'cmd':
                {
                    const pending = this.exec(instruction.command);
                    if (pending)
                    {
                        quick = 0;
                        await pending;
                    }
                }
            }
        }
    }

    /** @brief An interpreter for a `parallel` branch, stopped together with this one. */
    private child (code: readonly Instruction[]): Interpreter
    {
        const child = new Interpreter(this.manager, code, this.frame);
        const parentStop = this.stop.bind(this);
        this.stop = () =>
        {
            parentStop();
            child.stop();
        };
        return child;
    }

    /** @brief What conditions and values are evaluated against right now. */
    private context (): EvalContext
    {
        return this.manager.context(this.frame);
    }

    /** @brief Show a choice and continue at the picked option's commands. */
    private async choice (instruction: Extract<Instruction, { op: 'choice' }>): Promise<void>
    {
        const prompt = instruction.key ? this.text(instruction.key, instruction.params) : null;
        const picked = await this.manager.host.choose(
            prompt, instruction.options.map((key) => this.text(key)), instruction.cancel,
        );
        const index = Math.min(Math.max(0, Math.floor(picked)), instruction.targets.length - 1);
        this.manager.state.setVar(CHOICE_RESULT_VAR, picked === instruction.cancel && picked < 0 ? -1 : index);
        this.pc = instruction.targets[index];
    }

    /** @brief Translate and fill a text key. */
    private text (key: string, params?: TextParams): string
    {
        return this.manager.text.format(key, this.context(), params);
    }

    /** @brief Skip a command that needs the overworld while in a battle hook. */
    private skipInBattle (cmd: CommandName): boolean
    {
        if (this.frame.mode !== 'battle' || !WORLD_ONLY_COMMANDS.has(cmd)) return false;
        this.manager.warn(`"${cmd}" cannot run during a battle; skipped`);
        return true;
    }

    /**
     * @brief The characters a target means.
     * @param target The target.
     * @return Their actors (events without a character are left out).
     */
    private actors (target: Target): Actor[]
    {
        const { host } = this.manager;
        if (target === 'player') return [host.player()];
        const events = this.events(target);
        if (target === 'trigger' && !this.frame.trigger) return [host.player()];
        return events.map((event) => host.actorOf(event.id)).filter((actor): actor is Actor => actor !== null);
    }

    /** @brief The first character a target means. */
    private actor (target: Target): Actor | null
    {
        return this.actors(target)[0] ?? null;
    }

    /** @brief The events a target means (none for the player). */
    private events (target: Target): GameEvent[]
    {
        if (target === 'player') return [];
        if (target === 'self') return this.frame.self ? [this.frame.self] : [];
        if (target === 'trigger') return this.frame.trigger ? [this.frame.trigger] : [];
        if ('id' in target)
        {
            const event = this.manager.event(target.id);
            return event ? [event] : [];
        }
        return this.manager.events.filter((event) => event.tags.includes(target.tag));
    }

    /** @brief Play a route on a character, as part of this script. */
    private route (actor: Actor, route: Parameters<typeof runRoute>[1], skipBlocked: boolean): Promise<void>
    {
        const { host } = this.manager;
        return runRoute(actor, route, {
            player: host.player(),
            wait: (ms) => host.wait(ms),
            playSe: (name) => host.playSe(name),
            random: this.manager.random,
            skipBlocked,
            cancelled: () => this.stopped,
        });
    }

    /** @brief Keep track of movement that runs while the script goes on. */
    private track (moves: Promise<void>): void
    {
        const tracked = moves.finally(() => this.moving.delete(tracked));
        this.moving.add(tracked);
    }

    /**
     * @brief Run one plain command.
     * @param command The command.
     * @return A promise if the command takes time, else nothing.
     */
    private exec (command: PlainCommand): Promise<unknown> | void
    {
        if (this.skipInBattle(command.cmd)) return;
        const { manager } = this;
        const { state, host } = manager;
        const ctx = this.context();

        switch (command.cmd)
        {
            // ------------------------------------------------------- Flow
            case 'wait':
                return host.wait(command.ms);
            case 'callCommon':
            {
                const code = manager.bundle.common[command.id];
                if (!code) throw new Error(`common event "${command.id}" does not exist`);
                return new Interpreter(manager, code, this.frame).run();
            }
            case 'lock':
                manager.lock(this.frame.self);
                return;
            case 'unlock':
                if (this.frame.self) this.frame.self.locked = false;
                return;
            case 'native':
            {
                const args = Object.fromEntries(Object.entries(command.args ?? {}).map(([k, v]) => [k, resolveValue(v, ctx)]));
                return manager.callNative(command.name, args).then((result) =>
                {
                    if (command.resultVar && (typeof result === 'number' || typeof result === 'string'))
                    {
                        state.setVar(command.resultVar, result);
                    }
                });
            }

            // ------------------------------------------------------ State
            case 'setFlag':
                state.setFlag(command.flag, command.value ?? true);
                return;
            case 'setVar':
            {
                const value = resolveValue(command.value, ctx);
                const op = command.op ?? 'set';
                if (op === 'set')
                {
                    state.setVar(command.var, value);
                    return;
                }
                const current = resolveNumber({ var: command.var }, ctx, `variable "${command.var}"`);
                const operand = resolveNumber(command.value, ctx, `setVar ${op} value`);
                const result = op === 'add' ? current + operand
                    : op === 'sub' ? current - operand
                        : op === 'mul' ? current * operand
                            : op === 'div' ? (operand === 0 ? 0 : Math.trunc(current / operand))
                                : (operand === 0 ? 0 : current % operand);
                state.setVar(command.var, result);
                return;
            }
            case 'setSelfSwitch':
            {
                const event = command.event ?? this.frame.self?.id;
                if (event === undefined) throw new Error('setSelfSwitch needs an event: give "event" outside event scripts');
                state.setSelfSwitch(this.frame.map, event, command.switch, command.value ?? true);
                return;
            }
            case 'setStory':
                state.setStory(command.milestone, command.track ?? manager.trackOf(command.milestone));
                return;
            case 'addMoney':
            {
                const amount = resolveNumber(command.amount, ctx, 'addMoney amount');
                if (!state.addMoney(Math.trunc(amount))) state.addMoney(-state.getSnapshot().player.money);
                return;
            }

            // --------------------------------------------------- Dialogue
            case 'message':
                return host.message(
                    this.text(command.key, command.params), command.speaker ? manager.text.raw(command.speaker) : undefined,
                );
            case 'ink':
                return host.ink(command.story, command.knot);
            case 'nameInput':
            {
                const current = String(state.getVar(command.var) ?? '');
                return host.nameInput(command.key ? this.text(command.key) : null, current, command.max ?? languageInfo(state.language).playerNameMax)
                    .then((name) => state.setVar(command.var, name));
            }
            case 'nickname':
                return this.nickname(command.slot, command.key);
            case 'pokedexEntry':
                return host.pokedexEntry?.(command.species, state.pokedexLanguages(command.species));

            // --------------------------------------------------- Cutscene
            case 'move':
            {
                const moves = Promise.all(this.actors(command.target)
                    .map((actor) => this.route(actor, command.route, command.skipBlocked ?? false))).then(() => {});
                if (command.wait ?? true) return moves;
                this.track(moves);
                return;
            }
            case 'moveMany':
            {
                const moves = Promise.all(command.moves.flatMap((move) => this.actors(move.target)
                    .map((actor) => this.route(actor, move.route, command.skipBlocked ?? false)))).then(() => {});
                if (command.wait ?? true) return moves;
                this.track(moves);
                return;
            }
            case 'waitMoves':
                return Promise.all([...this.moving]);
            case 'pathTo':
            {
                const actor = this.actor(command.target);
                if (!actor) return;
                let goal: { x: number; y: number } | null;
                let adjacent = command.adjacent ?? false;
                if ('target' in command.to)
                {
                    goal = this.actor(command.to.target);
                    adjacent = command.adjacent ?? true;
                }
                else goal = command.to;
                if (!goal) return;
                const target = { x: goal.x, y: goal.y };
                const path = findPath(actor.x, actor.y, target.x, target.y, {
                    adjacent,
                    canStep: (x, y, dir) =>
                    {
                        //  The goal itself may hold the character being walked up to.
                        const [dx, dy] = DIRECTION_DELTA[dir];
                        if (adjacent && x + dx === target.x && y + dy === target.y) return false;
                        return host.canStep(actor, x, y, dir);
                    },
                });
                if (!path)
                {
                    manager.warn(`pathTo: no way from (${actor.x}, ${actor.y}) to (${target.x}, ${target.y})`);
                    return;
                }
                const moves = this.route(actor, path, false).then(() =>
                {
                    const dir = adjacent ? directionTowards(actor.x, actor.y, target.x, target.y) : null;
                    if (dir) actor.turn(dir);
                });
                if (command.wait ?? true) return moves;
                this.track(moves);
                return;
            }
            case 'face':
            {
                const towards = command.towards ? this.actor(command.towards) : null;
                for (const actor of this.actors(command.target))
                {
                    const dir = towards ? directionTowards(actor.x, actor.y, towards.x, towards.y) : command.dir;
                    if (dir) actor.turn(dir);
                }
                return;
            }
            case 'camera':
            {
                let to: { x: number; y: number } | 'player';
                if (command.to === 'player') to = 'player';
                else if ('target' in command.to)
                {
                    const actor = this.actor(command.to.target);
                    if (!actor) return;
                    to = { x: actor.x, y: actor.y };
                }
                else to = command.to;
                const pan = host.camera(to, command.ms ?? 500);
                return (command.wait ?? true) ? pan : void this.track(pan);
            }
            case 'shake':
            {
                const shake = host.shake(command.intensity ?? 0.01, command.ms ?? 300);
                return (command.wait ?? true) ? shake : void this.track(shake);
            }
            case 'emote':
            {
                const actor = this.actor(command.target);
                if (!actor) return;
                const emote = host.emote(actor, command.emote);
                return (command.wait ?? true) ? emote : void this.track(emote);
            }
            case 'fade':
                return host.fade(command.dir, command.color ?? '#000000', command.ms ?? 400);
            case 'tint':
                return host.tint(command.color, command.alpha, command.ms ?? 0);
            case 'flash':
                return host.flash(command.color ?? '#ffffff', command.ms ?? 300);
            case 'se':
                host.playSe(command.name, command.volume);
                return;
            case 'bgm':
                host.playBgm(command.name, command.volume ?? 1, command.fadeMs ?? 0);
                return;
            case 'me':
            {
                const me = host.playMe(command.name);
                return (command.wait ?? true) ? me : void this.track(me);
            }
            case 'cry':
            {
                const cry = host.playCry(command.species);
                return (command.wait ?? false) ? cry : void this.track(cry);
            }
            case 'show':
            case 'hide':
            {
                const hidden = command.cmd === 'hide';
                if (command.target === 'player') host.player().setVisible(!hidden);
                for (const event of this.events(command.target)) state.setEventHidden(this.frame.map, event.id, hidden);
                manager.refresh();
                return;
            }
            case 'erase':
                for (const event of this.events(command.target ?? 'self')) event.erased = true;
                manager.refresh();
                return;
            case 'setPosition':
                for (const actor of this.actors(command.target))
                {
                    actor.placeAt(command.x, command.y);
                    if (command.dir) actor.turn(command.dir);
                }
                return;
            case 'setGraphic':
                for (const actor of this.actors(command.target)) actor.setGraphic(command.graphic);
                return;
            case 'warp':
                return host.warp({
                    map: command.map, x: command.x, y: command.y, spawn: command.spawn, dir: command.dir,
                    transition: command.transition ?? 'fade',
                });
            case 'playerControl':
                host.setPlayerControl(command.enabled);
                return;

            // ----------------------------------- Pokémon, items, player
            case 'givePokemon':
                return this.givePokemon(command, ctx);
            case 'removePokemon':
            {
                const index = state.getSnapshot().party.findIndex((pokemon) => pokemon.species === command.species);
                if (index >= 0) state.removeFromParty(index);
                return;
            }
            case 'heal':
                state.healParty();
                return;
            case 'giveItem':
            {
                const quantity = Math.max(1, Math.trunc(resolveNumber(command.quantity ?? 1, ctx, 'giveItem quantity')));
                const pocket = state.countItem(command.item) > 0 ? undefined : (manager.data.itemPocket?.(command.item) ?? 'misc');
                const added = state.addItem(command.item, quantity, pocket);
                if (command.silent) return;
                const params = { item: manager.text.dataName('items', command.item), quantity };
                return host.message(this.text(added ? 'system.obtained_item' : 'system.bag_full', params));
            }
            case 'takeItem':
            {
                const quantity = Math.max(1, Math.trunc(resolveNumber(command.quantity ?? 1, ctx, 'takeItem quantity')));
                const held = state.countItem(command.item);
                if (held > 0) state.removeItem(command.item, Math.min(quantity, held));
                return;
            }
            case 'teachMove':
            {
                const party = state.getSnapshot().party;
                const pokemon = command.species !== undefined
                    ? party.find((p) => p.species === command.species)
                    : party[command.slot ?? 0];
                if (!pokemon) return;
                if (state.learnMove(pokemon.uid, command.move) === null) return;
                return host.message(this.text('system.learned_move', {
                    pokemon: pokemon.nickname ?? manager.text.dataName('pokemon', pokemon.species),
                    move: manager.text.dataName('moves', command.move),
                }));
            }
            case 'setPlayerName':
                state.setPlayerName(String(resolveValue(command.name, ctx)));
                return;
        }
    }

    /** @brief Give the player a Pokémon, filling in left-out fields from game data. */
    /**
     * @brief Let the player nickname a party Pokémon, with the rules and keyboard of its language.
     * @param slot Party position; default: the last Pokémon (the one just received).
     * @param key Prompt text key; default: `system.nickname_prompt`.
     */
    private async nickname (slot: number | undefined, key: string | undefined): Promise<void>
    {
        const { state, host, text } = this.manager;
        const data = state.getSnapshot();
        const pokemon = data.party[slot ?? data.party.length - 1];
        if (!pokemon) return;
        const name = text.pokemonName(pokemon);
        if (!canNickname(pokemon, data.player))
        {
            await host.message(this.text('system.cannot_nickname', { pokemon: name.text }));
            return;
        }
        const rules = nicknameRules(pokemon.language);
        const typed = await host.nameInput(
            this.text(key ?? 'system.nickname_prompt', { pokemon: name.text }), pokemon.nickname ?? '', rules.max,
            { language: pokemon.language, species: pokemon.species },
        );
        const nickname = sanitizeName(typed, rules);
        const species = text.dataName('pokemon', pokemon.species);
        state.updatePokemon(pokemon.uid, ({ nickname: _old, ...rest }) => (nickname && nickname !== species ? { ...rest, nickname } : rest));
    }

    private async givePokemon (command: Extract<PlainCommand, { cmd: 'givePokemon' }>, ctx: EvalContext): Promise<void>
    {
        const { manager } = this;
        const { state, data } = manager;
        const level = Math.max(1, Math.trunc(resolveNumber(command.level, ctx, 'givePokemon level')));
        let moves = command.moves ?? levelUpMoves(data.learnset?.(command.species), 0, level).slice(-4);
        moves = [...new Set(moves)];
        if (!moves.length) throw new Error(`givePokemon: no moves for ${command.species}; list them or provide learnsets`);
        const ability = command.ability ?? data.ability?.(command.species);
        if (!ability) throw new Error(`givePokemon: no ability for ${command.species}; give one or provide species data`);
        const pokemon = createPokemon({
            species: command.species, level, ability, moves, nickname: command.nickname, shiny: command.shiny,
            item: command.item, nature: command.nature, gender: command.gender, metMap: this.frame.map,
            language: command.language, ot: command.ot,
        }, manager.random);
        const where = state.addToParty(pokemon);
        if (command.silent) return;
        const species = manager.text.dataName('pokemon', command.species);
        await manager.host.message(this.text(where ? 'system.obtained_pokemon' : 'system.no_room_pokemon', { species }));
    }
}
