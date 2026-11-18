/**
 * @file schema.ts
 * @brief The JSON format of event scripts: conditions, commands, pages and files.
 *
 * Events follow RPG Maker XP / Pokémon Essentials: an **event** has one or
 * more **pages**; the last page whose **conditions** pass is the active one,
 * and its **trigger** decides when its **commands** run. Every event has four
 * **self switches** (A to D) of its own.
 *
 * Scripts are plain JSON, so nothing is ever evaluated as code at run time
 * (no `eval`, no `new Function`, no loading JavaScript), which keeps the
 * game working in Android WebViews and app stores that forbid it. Files are
 * checked against these Zod schemas and compiled (see compile.ts) at build
 * time; `npm run events:schema` writes a JSON Schema for editor autocompletion.
 *
 * @code
 * {
 *   "$schema": "./schema.json",
 *   "scripts": {
 *     "lab_aide": {
 *       "tags": ["aide"],
 *       "pages": [
 *         { "graphic": "aide", "commands": [
 *             { "cmd": "message", "key": "events.lab_aide.hello" },
 *             { "cmd": "setSelfSwitch", "switch": "A" } ] },
 *         { "conditions": { "selfSwitch": "A" }, "graphic": "aide", "commands": [
 *             { "cmd": "message", "key": "events.lab_aide.again" } ] }
 *       ]
 *     }
 *   }
 * }
 * @endcode
 *
 * As elsewhere in the project, each schema and its type share one name.
 * Recursive types (conditions and commands contain lists of themselves) are
 * written out as TypeScript types first and the schemas are typed with them.
 */
import { z } from 'zod';
import { POKEMON_LANGUAGE_IDS } from '../i18n/languages.ts';
import type { PokemonLanguage } from '../i18n/languages.ts';

// ---------------------------------------------------------------- Basics

/** @brief A direction a character faces or moves in. */
export const Direction = z.enum(['up', 'down', 'left', 'right']);
export type Direction = z.infer<typeof Direction>;

/** @brief A self switch letter. */
export const SelfSwitchLetter = z.enum(['A', 'B', 'C', 'D']);
export type SelfSwitchLetter = z.infer<typeof SelfSwitchLetter>;

/** @brief Comparison operators: equal, not equal, less than, at most, greater than, at least. */
export const CompareOp = z.enum(['eq', 'ne', 'lt', 'le', 'gt', 'ge']);
export type CompareOp = z.infer<typeof CompareOp>;

/** @brief A Showdown-style ID: lowercase letters and digits (`pikachu`, `potion`). */
const Id = z.string().regex(/^[a-z0-9]+$/, 'must be a lowercase ID such as "potion" (letters and digits only)');

/** @brief A name made of letters, digits, `_`, `.`, `:` and `-` (flags, variables, keys). */
const Name = z.string().regex(/^[A-Za-z0-9_.:-]+$/, 'only letters, digits, "_", ".", ":" and "-" are allowed');

/**
 * @brief A value read when the command runs.
 *
 * - a number or text: itself;
 * - `{ "var": "name" }`: a variable;
 * - `{ "random": [min, max] }`: a random whole number from `min` to `max`, both included.
 */
export type ValueRef = number | string | { var: string } | { random: [number, number] };
export const ValueRef: z.ZodType<ValueRef> = z.union([
    z.number(),
    z.string(),
    z.strictObject({ var: Name }),
    z.strictObject({ random: z.tuple([z.number().int(), z.number().int()]) }),
]);

/**
 * @brief Which character a command acts on.
 *
 * - `"self"`: the event running the script;
 * - `"player"`: the player;
 * - `"trigger"`: the event that started the script (for `eventTouch`), else the player;
 * - `{ "id": 12 }`: the event with that ID on the current map (the Tiled object ID);
 * - `{ "tag": "rival" }`: every event with that tag. Commands that need one
 *   character use the first one found.
 */
export type Target = 'self' | 'player' | 'trigger' | { id: number } | { tag: string };
export const Target: z.ZodType<Target> = z.union([
    z.enum(['self', 'player', 'trigger']),
    z.strictObject({ id: z.number().int().min(0) }),
    z.strictObject({ tag: Name }),
]);

/** @brief Text parameters: values for `{name}` placeholders in a translated line. */
export const TextParams = z.record(z.string(), ValueRef);
export type TextParams = z.infer<typeof TextParams>;

/** @brief A colour as `#rrggbb`. */
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a colour like "#000000"');

/** @brief Highest picture number. Pictures are drawn in number order, the highest on top. */
export const MAX_PICTURES = 50;

/** @brief Picture number, 1 to `MAX_PICTURES`. */
const PictureId = z.number().int().min(1).max(MAX_PICTURES);

/** @brief Point of a picture placed at `x`/`y`: its top-left corner or its centre. */
export const PICTURE_ORIGINS = ['topLeft', 'center'] as const;
export type PictureOrigin = (typeof PICTURE_ORIGINS)[number];

/** @brief How a `movePicture` speeds up and slows down. */
export const PICTURE_EASES = ['linear', 'in', 'out', 'inOut'] as const;
export type PictureEase = (typeof PICTURE_EASES)[number];

// ------------------------------------------------------------ Conditions

/**
 * @brief A test that passes or fails, written as JSON.
 *
 * Leaves:
 * - `{ "flag": "got_starter", "is": true }` (`is` defaults to `true`);
 * - `{ "selfSwitch": "A", "is": true, "event": 5 }` (`event` defaults to the event itself);
 * - `{ "var": "badges", "op": "ge", "value": 3 }` (`op` defaults to `eq`);
 * - `{ "story": "got_starter", "op": "reached", "track": "main" }` (`op`: `reached`,
 *   `before` or `at`; `track` defaults to `main`);
 * - `{ "item": "potion", "op": "ge", "value": 1 }` (how many are in the bag);
 * - `{ "bagHasRoom": "potion", "quantity": 1 }`;
 * - `{ "money": 500, "op": "ge" }`;
 * - `{ "partySize": 1, "op": "ge" }`;
 * - `{ "hasSpecies": "pikachu" }` (in the party);
 * - `{ "trainerDefeated": "youngster_joey" }`;
 * - `{ "playerFacing": "up" }`;
 * - `{ "eventId": 5, "of": "trigger" }` and `{ "hasTag": "rival", "of": "self" }`
 *   (`of`: `self` or `trigger`, default `self`);
 * - `{ "map": "route1" }` (the current map);
 * - `{ "battleResult": "win" }` (the last battle's result);
 * - `{ "random": 0.25 }` (passes with that chance).
 *
 * Combinators: `{ "all": [...] }`, `{ "any": [...] }`, `{ "not": {...} }`.
 * `{ "all": [] }` always passes.
 */
export type Condition =
    | { flag: string; is?: boolean }
    | { selfSwitch: SelfSwitchLetter; is?: boolean; event?: number }
    | { var: string; op?: CompareOp; value: ValueRef }
    | { story: string; op?: 'reached' | 'before' | 'at'; track?: string }
    | { item: string; op?: CompareOp; value?: number }
    | { bagHasRoom: string; quantity?: number }
    | { money: number; op?: CompareOp }
    | { partySize: number; op?: CompareOp }
    | { hasSpecies: string }
    | { trainerDefeated: string }
    | { playerFacing: Direction }
    | { eventId: number; of?: 'self' | 'trigger' }
    | { hasTag: string; of?: 'self' | 'trigger' }
    | { map: string }
    | { battleResult: BattleResult }
    | { random: number }
    | { all: Condition[] }
    | { any: Condition[] }
    | { not: Condition };

/** @brief How a battle ended for the player. */
export const BattleResult = z.enum(['win', 'lose', 'draw', 'flee', 'caught']);
export type BattleResult = z.infer<typeof BattleResult>;

export const Condition: z.ZodType<Condition> = z.lazy(() => z.union([
    z.strictObject({ flag: Name, is: z.boolean().optional() }),
    z.strictObject({ selfSwitch: SelfSwitchLetter, is: z.boolean().optional(), event: z.number().int().min(0).optional() }),
    z.strictObject({ var: Name, op: CompareOp.optional(), value: ValueRef }),
    z.strictObject({ story: Name, op: z.enum(['reached', 'before', 'at']).optional(), track: Name.optional() }),
    z.strictObject({ item: Id, op: CompareOp.optional(), value: z.number().int().min(0).optional() }),
    z.strictObject({ bagHasRoom: Id, quantity: z.number().int().min(1).optional() }),
    z.strictObject({ money: z.number().int().min(0), op: CompareOp.optional() }),
    z.strictObject({ partySize: z.number().int().min(0), op: CompareOp.optional() }),
    z.strictObject({ hasSpecies: Id }),
    z.strictObject({ trainerDefeated: Name }),
    z.strictObject({ playerFacing: Direction }),
    z.strictObject({ eventId: z.number().int().min(0), of: z.enum(['self', 'trigger']).optional() }),
    z.strictObject({ hasTag: Name, of: z.enum(['self', 'trigger']).optional() }),
    z.strictObject({ map: z.string().min(1) }),
    z.strictObject({ battleResult: BattleResult }),
    z.strictObject({ random: z.number().min(0).max(1) }),
    z.strictObject({ all: z.array(Condition) }),
    z.strictObject({ any: z.array(Condition) }),
    z.strictObject({ not: Condition }),
]));

// --------------------------------------------------------- Move routes

/**
 * @brief One step of a movement route.
 *
 * Strings: `up`, `down`, `left`, `right` (one tile), `forward`, `backward`,
 * `towardPlayer`, `awayFromPlayer`, `random`, `turnUp`, `turnDown`,
 * `turnLeft`, `turnRight`, `turnAround`, `turnTowardPlayer`,
 * `turnAwayFromPlayer`, `turnRandom`.
 *
 * Objects: `{ "wait": ms }`, `{ "jump": [dx, dy] }`, `{ "speed": 1-6 }`,
 * `{ "through": bool }`, `{ "visible": bool }`, `{ "graphic": "name" }`,
 * `{ "face": "up" }`, `{ "se": "name" }`, `{ "repeat": n, "steps": [...] }`.
 */
export type RouteStep =
    | 'up' | 'down' | 'left' | 'right' | 'forward' | 'backward' | 'towardPlayer' | 'awayFromPlayer' | 'random'
    | 'turnUp' | 'turnDown' | 'turnLeft' | 'turnRight' | 'turnAround' | 'turnTowardPlayer' | 'turnAwayFromPlayer'
    | 'turnRandom'
    | { wait: number }
    | { jump: [number, number] }
    | { speed: number }
    | { through: boolean }
    | { visible: boolean }
    | { graphic: string }
    | { face: Direction }
    | { se: string }
    | { repeat: number; steps: RouteStep[] };

/** @brief Every route step that is written as a plain string. */
export const ROUTE_WORDS = [
    'up', 'down', 'left', 'right', 'forward', 'backward', 'towardPlayer', 'awayFromPlayer', 'random',
    'turnUp', 'turnDown', 'turnLeft', 'turnRight', 'turnAround', 'turnTowardPlayer', 'turnAwayFromPlayer', 'turnRandom',
] as const;

export const RouteStep: z.ZodType<RouteStep> = z.lazy(() => z.union([
    z.enum(ROUTE_WORDS),
    z.strictObject({ wait: z.number().min(0) }),
    z.strictObject({ jump: z.tuple([z.number().int(), z.number().int()]) }),
    z.strictObject({ speed: z.number().int().min(1).max(6) }),
    z.strictObject({ through: z.boolean() }),
    z.strictObject({ visible: z.boolean() }),
    z.strictObject({ graphic: z.string() }),
    z.strictObject({ face: Direction }),
    z.strictObject({ se: z.string().min(1) }),
    z.strictObject({ repeat: z.number().int().min(1), steps: z.array(RouteStep) }),
]));

// ------------------------------------------------------------ Commands

/** @brief One branch of an `if` after the first: `{ "cond": ..., "then": [...] }`. */
export interface ElsifBranch
{
    cond: Condition;
    then: Command[];
}

/** @brief A trainer battle or wild battle's follow-up command lists, by result. */
export interface BattleBranches
{
    /** Run when the player wins. */
    onWin?: Command[];
    /** Run when the player loses (only reached with `canLose`). */
    onLose?: Command[];
    /** Run on a draw. Default: the `onLose` commands. */
    onDraw?: Command[];
    /** Run when the player ran away (wild battles). */
    onFlee?: Command[];
    /** Run when the player caught the Pokémon (wild battles). */
    onCatch?: Command[];
    /**
     * `true`: the script goes on after a loss (a rival battle). `false`: a loss
     * ends the script and the host's whiteout handling runs. Default: `false`.
     */
    canLose?: boolean;
}

/**
 * @brief One command. The `cmd` field says which.
 *
 * See docs/EVENT_SYSTEM.md for a description of every command.
 */
export type Command =
    // Flow
    | { cmd: 'if'; cond: Condition; then: Command[]; elsif?: ElsifBranch[]; else?: Command[] }
    | { cmd: 'switch'; var: string; cases: { value: number | string; then: Command[] }[]; default?: Command[] }
    | { cmd: 'loop'; body: Command[] }
    | { cmd: 'break' }
    | { cmd: 'label'; name: string }
    | { cmd: 'goto'; label: string }
    | { cmd: 'wait'; ms: number }
    | { cmd: 'exit' }
    | { cmd: 'callCommon'; id: string }
    | { cmd: 'parallel'; branches: Command[][] }
    | { cmd: 'lock' }
    | { cmd: 'unlock' }
    | { cmd: 'comment'; text: string }
    | { cmd: 'native'; name: string; args?: Record<string, ValueRef>; resultVar?: string }
    // State
    | { cmd: 'setFlag'; flag: string; value?: boolean }
    | { cmd: 'setVar'; var: string; op?: 'set' | 'add' | 'sub' | 'mul' | 'div' | 'mod'; value: ValueRef }
    | { cmd: 'setSelfSwitch'; switch: SelfSwitchLetter; value?: boolean; event?: number }
    | { cmd: 'setStory'; milestone: string; track?: string }
    | { cmd: 'addMoney'; amount: ValueRef }
    // Dialogue
    | { cmd: 'message'; key: string; params?: TextParams; speaker?: string }
    | { cmd: 'choice'; key?: string; params?: TextParams; options: { key: string; then: Command[] }[]; cancel?: number }
    | { cmd: 'yesNo'; key: string; params?: TextParams; yes?: Command[]; no?: Command[] }
    | { cmd: 'ink'; story: string; knot?: string }
    | { cmd: 'nameInput'; var: string; key?: string; max?: number }
    | { cmd: 'nickname'; slot?: number; key?: string }
    | { cmd: 'pokedexEntry'; species: string }
    // Cutscene
    | { cmd: 'move'; target: Target; route: RouteStep[]; wait?: boolean; skipBlocked?: boolean }
    | { cmd: 'moveMany'; moves: { target: Target; route: RouteStep[] }[]; wait?: boolean; skipBlocked?: boolean }
    | { cmd: 'waitMoves' }
    | { cmd: 'pathTo'; target: Target; to: { x: number; y: number } | { target: Target }; wait?: boolean; adjacent?: boolean }
    | { cmd: 'face'; target: Target; dir?: Direction; towards?: Target }
    | { cmd: 'camera'; to: 'player' | { x: number; y: number } | { target: Target }; ms?: number; wait?: boolean }
    | { cmd: 'shake'; intensity?: number; ms?: number; wait?: boolean }
    | { cmd: 'emote'; target: Target; emote: string; wait?: boolean }
    | { cmd: 'fade'; dir: 'out' | 'in'; color?: string; ms?: number }
    | { cmd: 'tint'; color: string; alpha: number; ms?: number }
    | { cmd: 'flash'; color?: string; ms?: number }
    |
    {
        cmd: 'showPicture';
        id: number;
        name: string;
        x?: number;
        y?: number;
        origin?: PictureOrigin;
        opacity?: number;
        mirror?: boolean;
        ms?: number;
        wait?: boolean;
    }
    |
    {
        cmd: 'movePicture';
        id: number;
        x?: number;
        y?: number;
        opacity?: number;
        ms?: number;
        ease?: PictureEase;
        wait?: boolean
    }
    |
    {
        cmd: 'erasePicture';
        id: number|'all';
        ms?: number;
        wait?: boolean
    }
    | { cmd: 'se'; name: string; volume?: number }
    | { cmd: 'bgm'; name: string | null; volume?: number; fadeMs?: number }
    | { cmd: 'me'; name: string; wait?: boolean }
    | { cmd: 'cry'; species: string; wait?: boolean }
    | { cmd: 'show'; target: Target }
    | { cmd: 'hide'; target: Target }
    | { cmd: 'erase'; target?: Target }
    | { cmd: 'setPosition'; target: Target; x: number; y: number; dir?: Direction }
    | { cmd: 'setGraphic'; target: Target; graphic: string }
    | { cmd: 'warp'; map: string; x?: number; y?: number; spawn?: string; dir?: Direction; transition?: 'fade' | 'none' }
    | { cmd: 'playerControl'; enabled: boolean }
    // Pokémon, items and the player
    | {
        cmd: 'givePokemon'; species: string; level: ValueRef; ability?: string; moves?: string[]; nickname?: string;
        shiny?: boolean; item?: string; nature?: string; gender?: 'M' | 'F' | 'N'; silent?: boolean;
        language?: PokemonLanguage; ot?: { name: string; id: number };
    }
    | { cmd: 'removePokemon'; species: string }
    | { cmd: 'heal' }
    | { cmd: 'giveItem'; item: string; quantity?: ValueRef; silent?: boolean }
    | { cmd: 'takeItem'; item: string; quantity?: ValueRef }
    | { cmd: 'teachMove'; species?: string; slot?: number; move: string }
    | { cmd: 'setPlayerName'; name: ValueRef }
    // Battles
    | ({ cmd: 'trainerBattle'; trainer: string } & BattleBranches)
    | ({ cmd: 'wildBattle'; species: string; level: ValueRef; shiny?: boolean; moves?: string[] } & BattleBranches);

/** @brief The value of `cmd` of each command. */
export type CommandName = Command['cmd'];

/** @brief `Command` with a given `cmd`. */
export type CommandOf<K extends CommandName> = Extract<Command, { cmd: K }>;

const Commands: z.ZodType<Command[]> = z.lazy(() => z.array(Command));

/** @brief The result branches shared by both battle commands. */
const battleBranches = {
    onWin: Commands.optional(),
    onLose: Commands.optional(),
    onDraw: Commands.optional(),
    onFlee: Commands.optional(),
    onCatch: Commands.optional(),
    canLose: z.boolean().optional(),
};

export const Command: z.ZodType<Command> = z.lazy(() => z.discriminatedUnion('cmd', [
    // Flow
    z.strictObject({
        cmd: z.literal('if'),
        cond: Condition,
        then: Commands,
        elsif: z.array(z.strictObject({cond: Condition, then: Commands})).optional(),
        else: Commands.optional(),
    }),
    z.strictObject({
        cmd: z.literal('switch'),
        var : Name,
        cases: z.array(z.strictObject({value: z.union([z.number(), z.string()]), then: Commands})),
        default: Commands.optional(),
    }),
    z.strictObject({cmd: z.literal('loop'), body: Commands}),
    z.strictObject({cmd: z.literal('break')}),
    z.strictObject({cmd: z.literal('label'), name: Name}),
    z.strictObject({cmd: z.literal('goto'), label: Name}),
    z.strictObject({cmd: z.literal('wait'), ms: z.number().min(0)}),
    z.strictObject({cmd: z.literal('exit')}),
    z.strictObject({cmd: z.literal('callCommon'), id: Name}),
    z.strictObject({cmd: z.literal('parallel'), branches: z.array(Commands).min(1)}),
    z.strictObject({cmd: z.literal('lock')}),
    z.strictObject({cmd: z.literal('unlock')}),
    z.strictObject({cmd: z.literal('comment'), text: z.string()}),
    z.strictObject({
        cmd: z.literal('native'),
        name: Name,
        args: z.record(z.string(), ValueRef).optional(),
        resultVar: Name.optional(),
    }),
    // State
    z.strictObject({cmd: z.literal('setFlag'), flag: Name, value: z.boolean().optional()}),
    z.strictObject({
        cmd: z.literal('setVar'),
        var : Name,
        op: z.enum(['set', 'add', 'sub', 'mul', 'div', 'mod']).optional(),
        value: ValueRef,
    }),
    z.strictObject({
        cmd: z.literal('setSelfSwitch'), switch: SelfSwitchLetter, value: z.boolean().optional(),
        event: z.number().int().min(0).optional(),
    }),
    z.strictObject({cmd: z.literal('setStory'), milestone: Name, track: Name.optional()}),
    z.strictObject({cmd: z.literal('addMoney'), amount: ValueRef}),
    // Dialogue
    z.strictObject({cmd: z.literal('message'), key: Name, params: TextParams.optional(), speaker: Name.optional()}),
    z.strictObject({
        cmd: z.literal('choice'),
        key: Name.optional(),
        params: TextParams.optional(),
        options: z.array(z.strictObject({key: Name, then: Commands})).min(1),
        cancel: z.number().int().min(-1).optional(),
    }),
    z.strictObject({
        cmd: z.literal('yesNo'),
        key: Name,
        params: TextParams.optional(),
        yes: Commands.optional(),
        no: Commands.optional(),
    }),
    z.strictObject({cmd: z.literal('ink'), story: Name, knot: z.string().min(1).optional()}),
    z.strictObject(
        {cmd: z.literal('nameInput'), var : Name, key: Name.optional(), max: z.number().int().min(1).optional()}),
    z.strictObject({cmd: z.literal('nickname'), slot: z.number().int().min(0).max(5).optional(), key: Name.optional()}),
    z.strictObject({cmd: z.literal('pokedexEntry'), species: Id}),
    // Cutscene
    z.strictObject({
        cmd: z.literal('move'),
        target: Target,
        route: z.array(RouteStep),
        wait: z.boolean().optional(),
        skipBlocked: z.boolean().optional(),
    }),
    z.strictObject({
        cmd: z.literal('moveMany'),
        moves: z.array(z.strictObject({target: Target, route: z.array(RouteStep)})).min(1),
        wait: z.boolean().optional(),
        skipBlocked: z.boolean().optional(),
    }),
    z.strictObject({cmd: z.literal('waitMoves')}),
    z.strictObject({
        cmd: z.literal('pathTo'),
        target: Target,
        to: z.union([z.strictObject({x: z.number().int(), y: z.number().int()}), z.strictObject({target: Target})]),
        wait: z.boolean().optional(),
        adjacent: z.boolean().optional(),
    }),
    z.strictObject({cmd: z.literal('face'), target: Target, dir: Direction.optional(), towards: Target.optional()}),
    z.strictObject({
        cmd: z.literal('camera'),
        to: z.union(
            [z.literal('player'), z.strictObject({x: z.number(), y: z.number()}), z.strictObject({target: Target})]),
        ms: z.number().min(0).optional(),
        wait: z.boolean().optional(),
    }),
    z.strictObject({
        cmd: z.literal('shake'),
        intensity: z.number().min(0).optional(),
        ms: z.number().min(0).optional(),
        wait: z.boolean().optional(),
    }),
    z.strictObject({cmd: z.literal('emote'), target: Target, emote: Name, wait: z.boolean().optional()}),
    z.strictObject({
        cmd: z.literal('fade'),
        dir: z.enum(['out', 'in']),
        color: Color.optional(),
        ms: z.number().min(0).optional()
    }),
    z.strictObject(
        {cmd: z.literal('tint'), color: Color, alpha: z.number().min(0).max(1), ms: z.number().min(0).optional()}),
    z.strictObject({cmd: z.literal('flash'), color: Color.optional(), ms: z.number().min(0).optional()}),
    z.strictObject({
        cmd: z.literal('showPicture'),
        id: PictureId,
        name: Name,
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        origin: z.enum(PICTURE_ORIGINS).optional(),
        opacity: z.number().min(0).max(1).optional(),
        mirror: z.boolean().optional(),
        ms: z.number().min(0).optional(),
        wait: z.boolean().optional(),
    }),
    z.strictObject({
        cmd: z.literal('movePicture'),
        id: PictureId,
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        opacity: z.number().min(0).max(1).optional(),
        ms: z.number().min(0).optional(),
        ease: z.enum(PICTURE_EASES).optional(),
        wait: z.boolean().optional(),
    }),
    z.strictObject({
        cmd: z.literal('erasePicture'),
        id: z.union([PictureId, z.literal('all')]),
        ms: z.number().min(0).optional(),
        wait: z.boolean().optional(),
    }),
    z.strictObject({cmd: z.literal('se'), name: z.string().min(1), volume: z.number().min(0).max(1).optional()}),
    z.strictObject({
        cmd: z.literal('bgm'),
        name: z.string().min(1).nullable(),
        volume: z.number().min(0).max(1).optional(),
        fadeMs: z.number().min(0).optional(),
    }),
    z.strictObject({cmd: z.literal('me'), name: z.string().min(1), wait: z.boolean().optional()}),
    z.strictObject({cmd: z.literal('cry'), species: Id, wait: z.boolean().optional()}),
    z.strictObject({cmd: z.literal('show'), target: Target}),
    z.strictObject({cmd: z.literal('hide'), target: Target}),
    z.strictObject({cmd: z.literal('erase'), target: Target.optional()}),
    z.strictObject({
        cmd: z.literal('setPosition'),
        target: Target,
        x: z.number().int(),
        y: z.number().int(),
        dir: Direction.optional(),
    }),
    z.strictObject({cmd: z.literal('setGraphic'), target: Target, graphic: z.string()}),
    z.strictObject({
        cmd: z.literal('warp'),
        map: z.string().min(1),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        spawn: z.string().min(1).optional(),
        dir: Direction.optional(),
        transition: z.enum(['fade', 'none']).optional(),
    }),
    z.strictObject({cmd: z.literal('playerControl'), enabled: z.boolean()}),
    // Pokémon, items and the player
    z.strictObject({
        cmd: z.literal('givePokemon'),
        species: Id,
        level: ValueRef,
        ability: Id.optional(),
        moves: z.array(Id).max(4).optional(),
        nickname: z.string().min(1).optional(),
        shiny: z.boolean().optional(),
        item: Id.optional(),
        nature: Id.optional(),
        gender: z.enum(['M', 'F', 'N']).optional(),
        silent: z.boolean().optional(),
        language: z.enum(POKEMON_LANGUAGE_IDS).optional(),
        ot: z.strictObject({name: z.string().min(1), id: z.number().int().min(0).max(999999)}).optional(),
    }),
    z.strictObject({cmd: z.literal('removePokemon'), species: Id}),
    z.strictObject({cmd: z.literal('heal')}),
    z.strictObject(
        {cmd: z.literal('giveItem'), item: Id, quantity: ValueRef.optional(), silent: z.boolean().optional()}),
    z.strictObject({cmd: z.literal('takeItem'), item: Id, quantity: ValueRef.optional()}),
    z.strictObject({
        cmd: z.literal('teachMove'),
        species: Id.optional(),
        slot: z.number().int().min(0).max(5).optional(),
        move: Id,
    }),
    z.strictObject({cmd: z.literal('setPlayerName'), name: ValueRef}),
    // Battles
    z.strictObject({cmd: z.literal('trainerBattle'), trainer: Name, ...battleBranches}),
    z.strictObject({
        cmd: z.literal('wildBattle'),
        species: Id,
        level: ValueRef,
        shiny: z.boolean().optional(),
        moves: z.array(Id).max(4).optional(),
        ...battleBranches,
    }),
]));

// ----------------------------------------------------------------- Pages

/** @brief When a page's commands run. */
export const Trigger = z.enum(['action', 'playerTouch', 'eventTouch', 'autorun', 'parallel', 'sight', 'none']);
export type Trigger = z.infer<typeof Trigger>;

/** @brief How an event walks around by itself while nothing else moves it. */
export const MoveType = z.enum(['fixed', 'random', 'towardPlayer', 'route']);
export type MoveType = z.infer<typeof MoveType>;

/**
 * @brief One page of an event.
 *
 * - `trigger`: `action` (the player faces it and presses the action button),
 *   `playerTouch` (the player walks into it or onto it), `eventTouch` (it
 *   walks into the player, or the player into it), `autorun` (runs by
 *   itself and blocks the player until it ends), `parallel` (runs by itself
 *   alongside play), `sight` (a trainer sees the player), `none`.
 * - `autorunClear`: what happens when an `autorun` page ends while still
 *   active. `auto` (default) turns off the page's own condition (see
 *   docs/EVENT_SYSTEM.md); `none` lets it run again.
 */
export const Page = z.strictObject({
    /** The page is a candidate only while this passes. Default: always. */
    conditions: Condition.optional(),
    trigger: Trigger.optional(),
    /** Character graphic (file name in `assets/img/characters` without extension). Empty: invisible. */
    graphic: z.string().optional(),
    direction: Direction.optional(),
    moveType: MoveType.optional(),
    /** With `moveType: "route"`: the route, repeated. */
    moveRoute: z.array(RouteStep).optional(),
    /** 1 (slowest) to 6 (fastest). Default: 3. */
    moveSpeed: z.number().int().min(1).max(6).optional(),
    /** 1 (rarely) to 6 (constantly): how often `random`/`towardPlayer` moves happen. Default: 3. */
    moveFrequency: z.number().int().min(1).max(6).optional(),
    /** Walk through walls and characters. */
    through: z.boolean().optional(),
    /** Drawn above the player. */
    alwaysOnTop: z.boolean().optional(),
    /** Never turn to face the player when talked to. */
    directionFix: z.boolean().optional(),
    /** With `trigger: "sight"`: how many tiles it sees. Default: 4. */
    sightRange: z.number().int().min(1).optional(),
    autorunClear: z.enum(['auto', 'none']).optional(),
    commands: z.array(Command),
});
export type Page = z.infer<typeof Page>;

/** @brief An event's script: its pages and tags. */
export const EventScript = z.strictObject({
    /** Tags for `{ "tag": ... }` targets and `hasTag` conditions, added to those set in Tiled. */
    tags: z.array(Name).optional(),
    pages: z.array(Page).min(1),
});
export type EventScript = z.infer<typeof EventScript>;

// ------------------------------------------------- Listeners and hooks

/** @brief What a global listener reacts to. */
export const ListenerOn = z.enum([
    'flagChanged', 'varChanged', 'itemObtained', 'pokemonObtained', 'storyChanged', 'mapEnter', 'mapExit', 'step', 'battleEnd',
]);
export type ListenerOn = z.infer<typeof ListenerOn>;

/**
 * @brief A global listener: commands that run whenever something happens, on any map.
 *
 * `name` narrows it: the flag, variable, item, species, story track or map
 * ID it is about. Listeners run one at a time and block the player like
 * `autorun` pages.
 */
export const Listener = z.strictObject({
    on: ListenerOn,
    name: z.string().min(1).optional(),
    conditions: Condition.optional(),
    /** Run only the first time (remembered in the flag `listener:<id>`). */
    once: z.boolean().optional(),
    commands: z.array(Command),
});
export type Listener = z.infer<typeof Listener>;

/** @brief Moments of a battle a hook can run at. */
export const HookOn = z.enum(['battleStart', 'turnStart', 'faint', 'switchIn', 'battleEnd']);
export type HookOn = z.infer<typeof HookOn>;

/**
 * @brief A battle hook: commands that run during a battle.
 *
 * Only commands that make sense inside a battle are allowed (messages,
 * flags, variables, sounds, items...); the validator rejects the others.
 */
export const BattleHook = z.strictObject({
    on: HookOn,
    /** Only in battles against this trainer. Default: every battle. */
    trainer: Name.optional(),
    /** With `turnStart`: only on this turn. */
    turn: z.number().int().min(1).optional(),
    /** With `faint` and `switchIn`: whose Pokémon. Default: either. */
    side: z.enum(['player', 'foe']).optional(),
    /** With `faint` and `switchIn`: only this species. */
    species: Id.optional(),
    conditions: Condition.optional(),
    /** Run at most once per battle. Default: `true`. */
    once: z.boolean().optional(),
    commands: z.array(Command),
});
export type BattleHook = z.infer<typeof BattleHook>;

// -------------------------------------------------------------- Trainers

/**
 * @brief The level of a trainer's Pokémon: fixed, or worked out when the battle starts.
 *
 * - a number;
 * - `{ "var": "name", "offset": 0 }`;
 * - `{ "party": "max" | "avg" | "min", "offset": -2 }`: from the player's party.
 */
export const TrainerLevel = z.union([
    z.number().int().min(1),
    z.strictObject({ var: Name, offset: z.number().int().optional() }),
    z.strictObject({ party: z.enum(['max', 'avg', 'min']), offset: z.number().int().optional() }),
]);
export type TrainerLevel = z.infer<typeof TrainerLevel>;

/** @brief One Pokémon of a trainer's team. Fields left out are filled from game data. */
export const TrainerPokemon = z.strictObject({
    species: Id,
    level: TrainerLevel,
    moves: z.array(Id).min(1).max(4).optional(),
    ability: Id.optional(),
    item: Id.optional(),
    nature: Id.optional(),
    gender: z.enum(['M', 'F', 'N']).optional(),
    shiny: z.boolean().optional(),
    nickname: z.string().min(1).optional(),
    teraType: z.string().min(1).optional(),
    ivs: z.number().int().min(0).max(31).optional(),
    /** Only include this Pokémon when this passes. */
    conditions: Condition.optional(),
});
export type TrainerPokemon = z.infer<typeof TrainerPokemon>;

/** @brief A team a trainer may use. The first one whose conditions pass is used. */
export const TrainerVariant = z.strictObject({
    conditions: Condition.optional(),
    team: z.array(TrainerPokemon).min(1).max(6),
});
export type TrainerVariant = z.infer<typeof TrainerVariant>;

/** @brief A trainer an event can battle. Its team is built when the battle starts. */
export const Trainer = z.strictObject({
    /** Trainer class ID (for the class name and graphics), e.g. `youngster`. */
    class: Name,
    /** Text key of the trainer's name. */
    name: Name,
    /** Battle AI. Default: `random`. */
    ai: z.enum(['random']).optional(),
    /** Prize money per level of the last Pokémon. Default: 0. */
    money: z.number().int().min(0).optional(),
    /** Battle format. Default: `singles`. */
    format: z.enum(['singles', 'doubles']).optional(),
    /** Text key shown when the player wins. */
    defeat: Name.optional(),
    variants: z.array(TrainerVariant).min(1),
});
export type Trainer = z.infer<typeof Trainer>;

// ------------------------------------------------------------------ Files

/**
 * @brief One event file (`content/events/**\/*.json`).
 *
 * Every section is optional, so a file can hold the scripts of one map, a
 * set of common events, listeners, battle hooks or trainers. IDs must be
 * unique across all files.
 */
export const EventFile = z.strictObject({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    /** Event scripts, by script ID (referenced by the `script` property in Tiled). */
    scripts: z.record(Name, EventScript).optional(),
    /** Common events, by ID: command lists run with `callCommon`. */
    common: z.record(Name, z.array(Command)).optional(),
    /** Global listeners, by ID. */
    listeners: z.record(Name, Listener).optional(),
    /** Battle hooks, by ID. */
    hooks: z.record(Name, BattleHook).optional(),
    /** Trainers, by trainer ID. */
    trainers: z.record(Name, Trainer).optional(),
});
export type EventFile = z.infer<typeof EventFile>;
