/**
 * @file checks.ts
 * @brief The checks behind `npm run events:validate`: scripts, trainers, text and maps.
 *
 * Compiling (src/events/compile.ts) already checks the shape of every file.
 * These checks go further and compare every name a script or map uses with
 * the registries (registries.ts): unknown flags, variables, items, species,
 * moves, trainers, text keys, ink knots, maps, common events, natives and
 * emotes are errors; untranslated text, missing pictures and risky autorun
 * pages are warnings.
 */
import type { CompiledPage, EventBundle, Instruction } from '../../src/events/compile.ts';
import { YES_NO_KEYS } from '../../src/events/compile.ts';
import { fallbackChain } from '../../src/i18n/languages.ts';
import { isKnownFlag } from '../../src/events/registry/flags.ts';
import { findMilestone } from '../../src/events/registry/story.ts';
import { SYSTEM_TEXT_KEYS, WORLD_ONLY_COMMANDS } from '../../src/events/runtime/Interpreter.ts';
import type { Command, Condition, RouteStep, ValueRef } from '../../src/events/schema.ts';
import { CLASS_SPECS, instantiateMap, objectLayers, toMapObject } from '../../src/events/tiled.ts';
import type { TiledMap } from '../../src/events/tiled.ts';
import type { Registries } from './registries.ts';

/** @brief One finding. */
export interface Finding
{
    level: 'error' | 'warning';
    /** Where: `scripts.lab.pages.0`, `map route1: object 4`... */
    where: string;
    message: string;
}

/** @brief Everything the checks look things up in. */
export interface CheckInput
{
    bundle: EventBundle;
    registries: Registries;
    /** Text by locale, then key. */
    locales: Record<string, Record<string, string>>;
    /** Parsed maps by map ID. */
    maps: Record<string, TiledMap>;
}

/** @brief Checks one piece of content and collects findings. */
class Checker
{
    readonly findings: Finding[] = [];
    /** Every registry as a set, for quick lookups. */
    readonly sets: { [K in keyof Registries]: Set<string> };
    /** Text keys used anywhere, for the translation report. */
    readonly usedKeys = new Set<string>();
    readonly input: CheckInput;

    constructor (input: CheckInput)
    {
        this.input = input;
        this.sets = Object.fromEntries(Object.entries(input.registries).map(([name, list]) => [name, new Set(list)])) as never;
    }

    error (where: string, message: string): void
    {
        this.findings.push({ level: 'error', where, message });
    }

    warn (where: string, message: string): void
    {
        this.findings.push({ level: 'warning', where, message });
    }

    /** @brief Report a name missing from a registry. */
    known (where: string, list: keyof Registries, value: string, what: string): void
    {
        if (!this.sets[list].has(value)) this.error(where, `unknown ${what} "${value}"`);
    }

    flag (where: string, name: string): void
    {
        if (!isKnownFlag(name)) this.error(where, `unknown flag "${name}" (add it to src/events/registry/flags.ts)`);
    }

    variable (where: string, name: string): void
    {
        if (!this.sets.Variable.has(name)) this.error(where, `unknown variable "${name}" (add it to src/events/registry/variables.ts)`);
    }

    text (where: string, key: string): void
    {
        this.usedKeys.add(key);
        if (!this.sets.TextKey.has(key)) this.error(where, `text key "${key}" is not in any content/locales/*/en.csv`);
    }

    value (where: string, value: ValueRef | undefined): void
    {
        if (value && typeof value === 'object' && 'var' in value) this.variable(where, value.var);
    }

    condition (where: string, condition: Condition | undefined): void
    {
        if (!condition) return;
        if ('all' in condition) condition.all.forEach((c, i) => this.condition(`${where}.all.${i}`, c));
        else if ('any' in condition) condition.any.forEach((c, i) => this.condition(`${where}.any.${i}`, c));
        else if ('not' in condition) this.condition(`${where}.not`, condition.not);
        else if ('flag' in condition) this.flag(where, condition.flag);
        else if ('var' in condition)
        {
            this.variable(where, condition.var);
            this.value(where, condition.value);
        }
        else if ('story' in condition) this.story(where, condition.story, condition.track);
        else if ('item' in condition) this.known(where, 'Item', condition.item, 'item');
        else if ('bagHasRoom' in condition) this.known(where, 'Item', condition.bagHasRoom, 'item');
        else if ('hasSpecies' in condition) this.known(where, 'Species', condition.hasSpecies, 'species');
        else if ('trainerDefeated' in condition) this.known(where, 'TrainerId', condition.trainerDefeated, 'trainer');
    }

    story (where: string, milestone: string, track: string | undefined): void
    {
        if (track !== undefined && !this.sets.StoryTrack.has(track)) this.error(where, `unknown story track "${track}"`);
        else if (!findMilestone(milestone, track)) this.error(where, `unknown story milestone "${milestone}"${track ? ` on track "${track}"` : ''}`);
    }

    route (where: string, route: readonly RouteStep[]): void
    {
        for (const step of route)
        {
            if (typeof step === 'object' && 'repeat' in step) this.route(where, step.steps);
        }
    }

    /**
     * @brief Check compiled instructions.
     * @param where Path prefix.
     * @param code The instructions.
     * @param battle `true` inside battle hooks.
     */
    code (where: string, code: readonly Instruction[], battle = false): void
    {
        code.forEach((instruction, i) =>
        {
            const at = `${where}[${i}]`;
            switch (instruction.op)
            {
                case 'jumpUnless':
                    this.condition(at, instruction.cond);
                    break;
                case 'choice':
                    if (instruction.key) this.text(at, instruction.key);
                    for (const key of instruction.options) this.text(at, key);
                    this.params(at, instruction.params);
                    break;
                case 'parallel':
                    instruction.branches.forEach((branch, b) => this.code(`${at}.branch${b}`, branch, battle));
                    break;
                case 'battle':
                {
                    const command = instruction.battle;
                    if (battle) this.error(at, `"${command.cmd}" cannot run during a battle`);
                    if (command.cmd === 'trainerBattle') this.known(at, 'TrainerId', command.trainer, 'trainer');
                    else
                    {
                        this.known(at, 'Species', command.species, 'species');
                        this.value(at, command.level);
                        for (const move of command.moves ?? []) this.known(at, 'Move', move, 'move');
                    }
                    break;
                }
                case 'cmd':
                    this.command(at, instruction.command as Command, battle);
            }
        });
    }

    params (where: string, params: Record<string, ValueRef> | undefined): void
    {
        for (const value of Object.values(params ?? {})) this.value(where, value);
    }

    command (at: string, command: Command, battle: boolean): void
    {
        if (battle && WORLD_ONLY_COMMANDS.has(command.cmd)) this.error(at, `"${command.cmd}" cannot run during a battle`);
        switch (command.cmd)
        {
            case 'setFlag': this.flag(at, command.flag); break;
            case 'setVar': this.variable(at, command.var); this.value(at, command.value); break;
            case 'nameInput': this.variable(at, command.var); if (command.key) this.text(at, command.key); break;
            case 'nickname': if (command.key) this.text(at, command.key); break;
            case 'pokedexEntry': this.known(at, 'Species', command.species, 'species'); break;
            case 'native':
                this.known(at, 'Native', command.name, 'native function');
                if (command.resultVar) this.variable(at, command.resultVar);
                for (const value of Object.values(command.args ?? {})) this.value(at, value);
                break;
            case 'setStory': this.story(at, command.milestone, command.track); break;
            case 'addMoney': this.value(at, command.amount); break;
            case 'callCommon': this.known(at, 'CommonEvent', command.id, 'common event'); break;
            case 'message':
                this.text(at, command.key);
                if (command.speaker) this.text(at, command.speaker);
                this.params(at, command.params);
                break;
            case 'ink':
                this.known(at, 'InkStory', command.story, 'ink story');
                if (command.knot) this.known(at, 'InkKnot', `${command.story}.${command.knot.split('.')[0]}`, 'ink knot');
                break;
            case 'move': this.route(at, command.route); break;
            case 'moveMany': for (const move of command.moves) this.route(at, move.route); break;
            case 'emote': this.known(at, 'Emote', command.emote, 'emote'); break;
            case 'showPicture':
                if (!this.sets.Picture.has(command.name))
                    this.warn(
                        at,
                        `picture "${command.name}" not found (expected public/assets/img/pictures/${
                            command.name}.png)`);
                break;
            case 'cry': this.known(at, 'Species', command.species, 'species'); break;
            case 'warp': this.warp(at, command.map, command.spawn, command.x, command.y); break;
            case 'givePokemon':
                if (command.language && !command.ot) this.warn(at, `"language" without "ot": the Pokémon becomes the player's and takes the game's language`);
                this.known(at, 'Species', command.species, 'species');
                this.value(at, command.level);
                for (const move of command.moves ?? []) this.known(at, 'Move', move, 'move');
                if (command.item) this.known(at, 'Item', command.item, 'item');
                break;
            case 'removePokemon': this.known(at, 'Species', command.species, 'species'); break;
            case 'giveItem': case 'takeItem':
                this.known(at, 'Item', command.item, 'item');
                this.value(at, command.quantity);
                break;
            case 'teachMove':
                this.known(at, 'Move', command.move, 'move');
                if (command.species) this.known(at, 'Species', command.species, 'species');
                break;
            case 'setPlayerName': this.value(at, command.name); break;
            default:
        }
    }

    /** @brief Check a warp destination: the map exists and, if named, the spawn exists on it. */
    warp (where: string, map: string, spawn: string | undefined, x: number | undefined, y: number | undefined): void
    {
        if (!this.sets.Map.has(map))
        {
            this.error(where, `warp to unknown map "${map}"`);
            return;
        }
        const target = this.input.maps[map];
        if (spawn && target)
        {
            const names = objectLayers(target.layers).flatMap((layer) => layer.objects ?? [])
                .filter((object) => (object.type || object.class) === 'Spawn').map((object) => object.name);
            if (!names.includes(spawn)) this.error(where, `map "${map}" has no Spawn named "${spawn}"`);
        }
        if (!spawn && (x === undefined || y === undefined)) this.error(where, 'a warp needs x and y, or a spawn');
        if (target && x !== undefined && y !== undefined && (x < 0 || y < 0 || x >= target.width || y >= target.height))
        {
            this.error(where, `(${x}, ${y}) is outside map "${map}"`);
        }
    }

    /** @brief Warn about autorun pages that will be erased because they have nothing to clear. */
    autorun (where: string, page: CompiledPage): void
    {
        if (page.trigger !== 'autorun' || (page.autorunClear ?? 'auto') === 'none') return;
        //  Fine if its own commands change something its conditions test.
        const tested = new Set<string>();
        const collect = (c: Condition | undefined): void =>
        {
            if (!c) return;
            if ('all' in c) c.all.forEach(collect);
            else if ('any' in c) c.any.forEach(collect);
            else if ('not' in c) collect(c.not);
            else if ('flag' in c) tested.add(`flag:${c.flag}`);
            else if ('selfSwitch' in c) tested.add(`self:${c.selfSwitch}`);
            else if ('var' in c) tested.add(`var:${c.var}`);
            else if ('story' in c) tested.add('story');
            else if ('trainerDefeated' in c) tested.add(`flag:trainer:${c.trainerDefeated}`);
        };
        collect(page.conditions);
        if ([...changedBy(page.code)].some((name) => tested.has(name))) return;
        const clearable = (c: Condition | undefined): boolean => !!c
            && ('flag' in c || 'selfSwitch' in c || ('all' in c && c.all.some(clearable)));
        if (!clearable(page.conditions))
        {
            this.warn(where, 'autorun page never changes its own conditions and has no flag or self switch to clear: after it runs once it is erased until the map reloads');
        }
    }
}

/**
 * @brief What a command list changes, in the form `flag:<name>`, `self:<letter>`, `var:<name>` or `story`.
 * @param code Compiled instructions.
 */
function changedBy (code: readonly Instruction[]): Set<string>
{
    const out = new Set<string>();
    for (const instruction of code)
    {
        if (instruction.op === 'parallel') for (const branch of instruction.branches) for (const name of changedBy(branch)) out.add(name);
        if (instruction.op === 'battle' && instruction.battle.cmd === 'trainerBattle') out.add(`flag:trainer:${instruction.battle.trainer}`);
        if (instruction.op === 'choice') out.add('var:choice_result');
        if (instruction.op !== 'cmd') continue;
        const command = instruction.command;
        if (command.cmd === 'setFlag') out.add(`flag:${command.flag}`);
        else if (command.cmd === 'setSelfSwitch' && command.event === undefined) out.add(`self:${command.switch}`);
        else if (command.cmd === 'setVar' || command.cmd === 'nameInput') out.add(`var:${command.var}`);
        else if (command.cmd === 'setStory') out.add('story');
    }
    return out;
}

/**
 * @brief Run every check.
 * @param input Bundle, registries, locales and maps.
 * @return Findings, errors first.
 */
export function checkContent (input: CheckInput): Finding[]
{
    return runChecks(input).findings;
}

/**
 * @brief Every text key that event files, trainers, maps and the engine use
 *        (for the unused-key report of `npm run locales:validate`).
 * @param input Bundle, registries, locales and maps.
 * @return The keys.
 */
export function usedTextKeys (input: CheckInput): Set<string>
{
    return runChecks(input).usedKeys;
}

/** @brief Run every check; returns the findings (errors first) and the keys used. */
function runChecks (input: CheckInput): { findings: Finding[]; usedKeys: Set<string> }
{
    const check = new Checker(input);
    const { bundle } = input;

    for (const [id, script] of Object.entries(bundle.scripts))
    {
        script.pages.forEach((page, i) =>
        {
            const where = `scripts.${id}.pages.${i}`;
            check.condition(`${where}.conditions`, page.conditions);
            check.code(`${where}.commands`, page.code);
            check.autorun(where, page);
            if (page.moveRoute) check.route(where, page.moveRoute);
        });
    }
    for (const [id, code] of Object.entries(bundle.common)) check.code(`common.${id}`, code);
    for (const [id, listener] of Object.entries(bundle.listeners))
    {
        check.condition(`listeners.${id}.conditions`, listener.conditions);
        check.code(`listeners.${id}.commands`, listener.code);
        if (listener.on === 'flagChanged' && listener.name) check.flag(`listeners.${id}.name`, listener.name);
        if (listener.on === 'varChanged' && listener.name) check.variable(`listeners.${id}.name`, listener.name);
        if (listener.on === 'itemObtained' && listener.name) check.known(`listeners.${id}.name`, 'Item', listener.name, 'item');
        if (listener.on === 'pokemonObtained' && listener.name) check.known(`listeners.${id}.name`, 'Species', listener.name, 'species');
        if ((listener.on === 'mapEnter' || listener.on === 'mapExit') && listener.name) check.known(`listeners.${id}.name`, 'Map', listener.name, 'map');
    }
    for (const [id, hook] of Object.entries(bundle.hooks))
    {
        check.condition(`hooks.${id}.conditions`, hook.conditions);
        check.code(`hooks.${id}.commands`, hook.code, true);
        if (hook.trainer) check.known(`hooks.${id}.trainer`, 'TrainerId', hook.trainer, 'trainer');
        if (hook.species) check.known(`hooks.${id}.species`, 'Species', hook.species, 'species');
    }
    for (const [id, trainer] of Object.entries(bundle.trainers))
    {
        const where = `trainers.${id}`;
        check.text(`${where}.name`, trainer.name);
        if (trainer.defeat) check.text(`${where}.defeat`, trainer.defeat);
        trainer.variants.forEach((variant, v) =>
        {
            check.condition(`${where}.variants.${v}.conditions`, variant.conditions);
            variant.team.forEach((pokemon, p) =>
            {
                const at = `${where}.variants.${v}.team.${p}`;
                check.known(at, 'Species', pokemon.species, 'species');
                for (const move of pokemon.moves ?? []) check.known(at, 'Move', move, 'move');
                if (pokemon.item) check.known(at, 'Item', pokemon.item, 'item');
                if (typeof pokemon.level === 'object' && 'var' in pokemon.level) check.variable(at, pokemon.level.var);
                check.condition(`${at}.conditions`, pokemon.conditions);
            });
        });
    }
    for (const key of [...SYSTEM_TEXT_KEYS, ...YES_NO_KEYS]) check.text('engine', key);

    for (const [id, map] of Object.entries(input.maps)) checkMap(check, id, map);

    //  Translations: one warning per locale file that lacks keys the game uses.
    for (const [locale, table] of Object.entries(input.locales))
    {
        if (locale === 'en' || !Object.keys(table).length) continue;
        //  A key a sister locale has (es-mx → es-es) is shown in that language, not English.
        const chain = fallbackChain(locale).filter((name) => name !== 'en');
        const missing = [...check.usedKeys].filter((key) => chain.every((name) => input.locales[name]?.[key] === undefined) && input.locales.en?.[key] !== undefined);
        if (missing.length)
        {
            check.warn(`locale ${locale}`, `${missing.length} text key(s) not translated (English is shown): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
        }
    }
    return {
        findings: [...check.findings.filter((f) => f.level === 'error'), ...check.findings.filter((f) => f.level === 'warning')],
        usedKeys: check.usedKeys,
    };
}

/** @brief Check one map's objects. */
function checkMap (check: Checker, id: string, map: TiledMap): void
{
    const prefix = `map ${id}`;
    const result = instantiateMap(map, id, check.input.bundle);
    for (const issue of result.issues) check.error(prefix, issue.replace(`${id}: `, ''));
    const spawns = new Set<string>();
    const ids = new Set<number>();
    for (const layer of objectLayers(map.layers))
    {
        for (const raw of layer.objects ?? [])
        {
            const object = toMapObject(raw, map);
            if (!object) continue;
            const where = `${prefix}: object ${object.id}${object.name ? ` "${object.name}"` : ''} (${object.class})`;
            if (ids.has(object.id)) check.error(where, 'duplicate object ID');
            ids.add(object.id);
            const pixelY = raw.gid ? raw.y - (raw.height ?? map.tileheight) : raw.y;
            if (raw.x % map.tilewidth !== 0 || pixelY % map.tileheight !== 0) check.warn(where, 'not aligned to the tile grid');
            const spec = CLASS_SPECS.find((c) => c.name === object.class);
            if (!spec) continue;
            for (const member of spec.members)
            {
                const value = object.props[member.name];
                if (member.required && (value === '' || value === undefined)) check.error(where, `"${member.name}" must be set`);
                if (!member.enum || typeof value !== 'string' || value === '') continue;
                const list = check.sets[member.enum];
                if (!list.has(value)) check.error(where, `"${member.name}": unknown ${member.enum} "${value}"`);
                else if (member.enum === 'TextKey') check.text(where, value);
            }
            if (object.class === 'Spawn')
            {
                if (spawns.has(object.name)) check.error(where, `two Spawns are named "${object.name}"`);
                spawns.add(object.name);
            }
            if (object.class === 'Warp' && typeof object.props.map === 'string' && object.props.map)
            {
                const x = Number(object.props.x);
                const y = Number(object.props.y);
                const useXY = x >= 0 && y >= 0;
                check.warp(where, object.props.map, useXY ? undefined : String(object.props.spawn || ''), useXY ? x : undefined, useXY ? y : undefined);
            }
        }
    }
}
