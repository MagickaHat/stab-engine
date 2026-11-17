/**
 * @file compile.ts
 * @brief Turns event files (schema.ts) into flat instruction lists the interpreter runs.
 *
 * Nested blocks (`if`/`elsif`/`else`, `switch`, `loop`, `choice`, battle
 * result branches) become jumps, labels become instruction indices, and
 * mistakes that can be found without running the game (unknown labels,
 * `break` outside a loop, duplicate IDs) are reported with their path.
 *
 * The same code runs in the Vite plugin (vite/plugins/events.mjs), in the
 * Node tools and in tests, so a script that compiles for `npm run
 * events:validate` compiles the same way in the game.
 *
 * @code
 *  { "cmd": "if", "cond": A, "then": [x], "elsif": [{ "cond": B, "then": [y] }], "else": [z] }
 *
 *  0  jumpUnless A → 3
 *  1  x
 *  2  jump → 7
 *  3  jumpUnless B → 6
 *  4  y
 *  5  jump → 7
 *  6  z
 *  7  ...
 * @endcode
 */
import type { z } from 'zod';
import { EventFile } from './schema.ts';
import type {
    BattleHook, BattleResult, Command, CommandOf, Condition, EventScript, Listener, Page, TextParams, Trainer,
} from './schema.ts';

// ---------------------------------------------------------------- Output

/** @brief Commands that compile to themselves: everything that does not change the flow. */
export type PlainCommand = Exclude<Command, {
    cmd: 'if' | 'switch' | 'loop' | 'break' | 'label' | 'goto' | 'exit' | 'parallel' | 'choice' | 'yesNo'
        | 'trainerBattle' | 'wildBattle' | 'comment';
}>;

/** @brief Where each battle result continues, as instruction indices. */
export type BattleTargets = Record<BattleResult, number>;

/** @brief One compiled instruction. */
export type Instruction =
    | { op: 'jump'; to: number }
    | { op: 'jumpUnless'; cond: Condition; to: number }
    | { op: 'exit' }
    | { op: 'choice'; key?: string; params?: TextParams; options: string[]; cancel: number; targets: number[] }
    | { op: 'parallel'; branches: Instruction[][] }
    | {
        op: 'battle'; battle: Omit<CommandOf<'trainerBattle'>, `on${string}`> | Omit<CommandOf<'wildBattle'>, `on${string}`>;
        targets: BattleTargets;
    }
    | { op: 'cmd'; command: PlainCommand };

/** @brief A page with its commands compiled. `trigger` is always set (default `action`). */
export type CompiledPage = Omit<Page, 'commands' | 'trigger'> & { trigger: NonNullable<Page['trigger']>; code: Instruction[] };

/** @brief An event script with its pages compiled. */
export interface CompiledScript
{
    tags: string[];
    pages: CompiledPage[];
}

/** @brief A listener with its commands compiled. */
export type CompiledListener = Omit<Listener, 'commands'> & { code: Instruction[] };

/** @brief A battle hook with its commands compiled. */
export type CompiledHook = Omit<BattleHook, 'commands'> & { code: Instruction[] };

/** @brief Everything the game needs from all event files, keyed by ID. */
export interface EventBundle
{
    scripts: Record<string, CompiledScript>;
    common: Record<string, Instruction[]>;
    listeners: Record<string, CompiledListener>;
    hooks: Record<string, CompiledHook>;
    trainers: Record<string, Trainer>;
}

/** @brief A problem found while compiling, with where it is. */
export interface CompileIssue
{
    /** File it is in, as given to `compileFile()`. */
    file: string;
    /** Path inside the file, e.g. `scripts.lab_aide.pages.0.commands.2`. */
    path: string;
    message: string;
}

/** @brief Text keys used for the two options of `yesNo`. */
export const YES_NO_KEYS = ['system.yes', 'system.no'] as const;

/** @brief An empty bundle. */
export function emptyBundle (): EventBundle
{
    return { scripts: {}, common: {}, listeners: {}, hooks: {}, trainers: {} };
}

// ------------------------------------------------------------- Compiler

/** @brief What the compiler of one command list keeps track of. */
interface Scope
{
    out: Instruction[];
    labels: Map<string, number>;
    /** Jumps to labels, patched once every label is known: [instruction, label, path]. */
    gotos: [{ op: 'jump'; to: number }, string, string][];
    /** For each open loop, the `break` jumps to patch with its end. */
    loops: { op: 'jump'; to: number }[][];
    issues: string[][];
}

/**
 * @brief Compile one command list.
 * @param commands The commands.
 * @param path Where they are, for messages.
 * @param issues Receives `[path, message]` for every problem.
 * @return The instructions.
 */
export function compileCommands (commands: readonly Command[], path: string, issues: string[][]): Instruction[]
{
    const scope: Scope = { out: [], labels: new Map(), gotos: [], loops: [], issues };
    emitList(scope, commands, path);
    for (const [jump, label, where] of scope.gotos)
    {
        const to = scope.labels.get(label);
        if (to === undefined) issues.push([where, `label "${label}" does not exist in this command list`]);
        else jump.to = to;
    }
    return scope.out;
}

/** @brief Compile a list of commands into the scope. */
function emitList (scope: Scope, commands: readonly Command[] | undefined, path: string): void
{
    (commands ?? []).forEach((command, i) => emit(scope, command, `${path}.${i}`));
}

/**
 * @brief Compile one command into the scope.
 * @param scope Output and bookkeeping.
 * @param command The command.
 * @param path Where it is, for messages.
 */
function emit (scope: Scope, command: Command, path: string): void
{
    const { out } = scope;
    switch (command.cmd)
    {
        case 'comment':
            return;
        case 'exit':
            out.push({ op: 'exit' });
            return;
        case 'label':
            if (scope.labels.has(command.name)) scope.issues.push([path, `label "${command.name}" is defined twice`]);
            scope.labels.set(command.name, out.length);
            return;
        case 'goto':
        {
            const jump = { op: 'jump' as const, to: -1 };
            out.push(jump);
            scope.gotos.push([jump, command.label, path]);
            return;
        }
        case 'if':
        {
            const branches = [{ cond: command.cond, then: command.then }, ...(command.elsif ?? [])];
            const ends: { op: 'jump'; to: number }[] = [];
            branches.forEach((branch, i) =>
            {
                const test = { op: 'jumpUnless' as const, cond: branch.cond, to: -1 };
                out.push(test);
                emitList(scope, branch.then, i === 0 ? `${path}.then` : `${path}.elsif.${i - 1}.then`);
                const end = { op: 'jump' as const, to: -1 };
                out.push(end);
                ends.push(end);
                test.to = out.length;
            });
            emitList(scope, command.else, `${path}.else`);
            for (const end of ends) end.to = out.length;
            return;
        }
        case 'switch':
        {
            const ends: { op: 'jump'; to: number }[] = [];
            command.cases.forEach((branch, i) =>
            {
                const test = { op: 'jumpUnless' as const, cond: { var: command.var, value: branch.value }, to: -1 };
                out.push(test);
                emitList(scope, branch.then, `${path}.cases.${i}.then`);
                const end = { op: 'jump' as const, to: -1 };
                out.push(end);
                ends.push(end);
                test.to = out.length;
            });
            emitList(scope, command.default, `${path}.default`);
            for (const end of ends) end.to = out.length;
            return;
        }
        case 'loop':
        {
            const start = out.length;
            scope.loops.push([]);
            emitList(scope, command.body, `${path}.body`);
            out.push({ op: 'jump', to: start });
            for (const jump of scope.loops.pop()!) jump.to = out.length;
            return;
        }
        case 'break':
        {
            const loop = scope.loops.at(-1);
            if (!loop)
            {
                scope.issues.push([path, '"break" is only allowed inside a "loop"']);
                return;
            }
            const jump = { op: 'jump' as const, to: -1 };
            out.push(jump);
            loop.push(jump);
            return;
        }
        case 'choice':
            emitChoice(scope, path, command.key, command.params, command.options, command.cancel ?? -1, 'options');
            return;
        case 'yesNo':
            emitChoice(scope, path, command.key, command.params, [
                { key: YES_NO_KEYS[0], then: command.yes ?? [] },
                { key: YES_NO_KEYS[1], then: command.no ?? [] },
            ], 1, null);
            return;
        case 'parallel':
            out.push({
                op: 'parallel',
                branches: command.branches.map((branch, i) => compileCommands(branch, `${path}.branches.${i}`, scope.issues)),
            });
            return;
        case 'trainerBattle':
        case 'wildBattle':
            emitBattle(scope, command, path);
            return;
        default:
            out.push({ op: 'cmd', command });
    }
}

/**
 * @brief Compile a choice: the question, then each option's commands, each ending with a jump past the rest.
 * @param scope Output and bookkeeping.
 * @param path Where it is, for messages.
 * @param key Text key of the question, if any.
 * @param params Placeholders of the question.
 * @param options The options.
 * @param cancel Option chosen by cancelling, or -1 if the choice cannot be cancelled.
 * @param field Name of the options field, for paths (`null` for `yesNo`).
 */
function emitChoice (
    scope: Scope, path: string, key: string | undefined, params: TextParams | undefined,
    options: { key: string; then: Command[] }[], cancel: number, field: string | null,
): void
{
    if (cancel >= options.length) scope.issues.push([`${path}.cancel`, `there is no option ${cancel}`]);
    const choice: Extract<Instruction, { op: 'choice' }> = {
        op: 'choice', options: options.map((option) => option.key), cancel, targets: [],
    };
    if (key !== undefined) choice.key = key;
    if (params !== undefined) choice.params = params;
    scope.out.push(choice);
    const ends: { op: 'jump'; to: number }[] = [];
    options.forEach((option, i) =>
    {
        choice.targets.push(scope.out.length);
        emitList(scope, option.then, field ? `${path}.${field}.${i}.then` : `${path}.${i === 0 ? 'yes' : 'no'}`);
        const end = { op: 'jump' as const, to: -1 };
        scope.out.push(end);
        ends.push(end);
    });
    for (const end of ends) end.to = scope.out.length;
}

/**
 * @brief Compile a battle: the battle, then one block per result.
 *
 * A result without commands continues after the battle. A draw without
 * `onDraw` uses the `onLose` block.
 */
function emitBattle (scope: Scope, command: CommandOf<'trainerBattle'> | CommandOf<'wildBattle'>, path: string): void
{
    const { onWin, onLose, onDraw, onFlee, onCatch, ...battle } = command;
    const blocks: [BattleResult, Command[] | undefined][] = [
        ['win', onWin], ['lose', onLose], ['draw', onDraw], ['flee', onFlee], ['caught', onCatch],
    ];
    const instruction: Extract<Instruction, { op: 'battle' }> = {
        op: 'battle', battle, targets: { win: -1, lose: -1, draw: -1, flee: -1, caught: -1 },
    };
    scope.out.push(instruction);
    const ends: { op: 'jump'; to: number }[] = [];
    for (const [result, commands] of blocks)
    {
        if (!commands?.length) continue;
        instruction.targets[result] = scope.out.length;
        emitList(scope, commands, `${path}.on${result === 'caught' ? 'Catch' : result[0].toUpperCase() + result.slice(1)}`);
        const end = { op: 'jump' as const, to: -1 };
        scope.out.push(end);
        ends.push(end);
    }
    const after = scope.out.length;
    for (const end of ends) end.to = after;
    if (instruction.targets.draw < 0) instruction.targets.draw = instruction.targets.lose;
    for (const result of Object.keys(instruction.targets) as BattleResult[])
    {
        if (instruction.targets[result] < 0) instruction.targets[result] = after;
    }
}

// ----------------------------------------------------------------- Files

/**
 * @brief Turn Zod issues into compile issues.
 * @param file File name.
 * @param issues Zod issues.
 * @param prefix Path prefix.
 */
function zodIssues (file: string, issues: readonly z.core.$ZodIssue[], prefix = ''): CompileIssue[]
{
    return issues.slice(0, 20).map((issue) => ({
        file,
        path: prefix + issue.path.map(String).join('.'),
        message: issue.code === 'invalid_union' ? `${issue.message} (no form of this value matches)` : issue.message,
    }));
}

/**
 * @brief Compile one script.
 * @param script The script.
 * @param path Where it is.
 * @param issues Receives `[path, message]` pairs.
 */
export function compileScript (script: EventScript, path: string, issues: string[][]): CompiledScript
{
    return {
        tags: script.tags ?? [],
        pages: script.pages.map(({ commands, ...page }, i) => ({
            ...page,
            trigger: page.trigger ?? 'action',
            code: compileCommands(commands, `${path}.pages.${i}.commands`, issues),
        })),
    };
}

/**
 * @brief Check and compile one event file.
 * @param json The file's parsed JSON.
 * @param file Its name, for messages.
 * @return The compiled bundle (empty if the file does not match the schema) and every problem found.
 */
export function compileFile (json: unknown, file: string): { bundle: EventBundle; issues: CompileIssue[] }
{
    const bundle = emptyBundle();
    const parsed = EventFile.safeParse(json);
    if (!parsed.success) return { bundle, issues: zodIssues(file, parsed.error.issues) };

    const raw: string[][] = [];
    const data = parsed.data;
    for (const [id, script] of Object.entries(data.scripts ?? {}))
    {
        bundle.scripts[id] = compileScript(script, `scripts.${id}`, raw);
    }
    for (const [id, commands] of Object.entries(data.common ?? {}))
    {
        bundle.common[id] = compileCommands(commands, `common.${id}`, raw);
    }
    for (const [id, { commands, ...listener }] of Object.entries(data.listeners ?? {}))
    {
        bundle.listeners[id] = { ...listener, code: compileCommands(commands, `listeners.${id}.commands`, raw) };
    }
    for (const [id, { commands, ...hook }] of Object.entries(data.hooks ?? {}))
    {
        bundle.hooks[id] = { ...hook, code: compileCommands(commands, `hooks.${id}.commands`, raw) };
    }
    Object.assign(bundle.trainers, data.trainers ?? {});
    return { bundle, issues: raw.map(([path, message]) => ({ file, path, message })) };
}

/**
 * @brief Combine compiled files into one bundle.
 * @param files `[file name, bundle]` pairs.
 * @return The combined bundle, and an issue for every ID defined in more than one file.
 */
export function mergeBundles (files: readonly [string, EventBundle][]): { bundle: EventBundle; issues: CompileIssue[] }
{
    const bundle = emptyBundle();
    const issues: CompileIssue[] = [];
    const owners = new Map<string, string>();
    for (const [file, part] of files)
    {
        for (const section of Object.keys(bundle) as (keyof EventBundle)[])
        {
            for (const [id, value] of Object.entries(part[section]))
            {
                const key = `${section}.${id}`;
                const owner = owners.get(key);
                if (owner !== undefined)
                {
                    issues.push({ file, path: key, message: `"${id}" is already defined in ${owner}` });
                    continue;
                }
                owners.set(key, file);
                (bundle[section] as Record<string, unknown>)[id] = value;
            }
        }
    }
    return { bundle, issues };
}

/**
 * @brief Compile several files at once.
 * @param files `[file name, parsed JSON]` pairs.
 * @return The combined bundle and every problem found.
 */
export function compileFiles (files: readonly [string, unknown][]): { bundle: EventBundle; issues: CompileIssue[] }
{
    const compiled: [string, EventBundle][] = [];
    const issues: CompileIssue[] = [];
    for (const [file, json] of files)
    {
        const result = compileFile(json, file);
        compiled.push([file, result.bundle]);
        issues.push(...result.issues);
    }
    const merged = mergeBundles(compiled);
    return { bundle: merged.bundle, issues: [...issues, ...merged.issues] };
}

/**
 * @brief Format an issue as one line.
 * @param issue The issue.
 * @return `file: path: message`.
 */
export function formatIssue (issue: CompileIssue): string
{
    return `${issue.file}: ${issue.path ? `${issue.path}: ` : ''}${issue.message}`;
}
