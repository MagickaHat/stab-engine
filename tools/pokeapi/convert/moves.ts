/**
 * @file moves.ts
 * @brief Converts PokeAPI moves (`moves`, `move_meta`, `move_flag_map`…) to
 *        Showdown's `Moves` format.
 */
import { NON_MAIN_SERIES_ID } from '../config.ts';
import { int } from '../csv.ts';
import type { Row } from '../csv.ts';
import type { ImportContext } from '../context.ts';
import { showdownName, titleCase, toID } from '../ids.ts';
import { STAT_BY_ID } from './basic.ts';

/** @brief PokeAPI `move_targets` identifier → Showdown target. */
export const TARGETS: Record<string, string> = {
    'specific-move': 'scripted',
    'selected-pokemon-me-first': 'adjacentFoe',
    'ally': 'adjacentAlly',
    'users-field': 'allySide',
    'user-or-ally': 'adjacentAllyOrSelf',
    'opponents-field': 'foeSide',
    'user': 'self',
    'random-opponent': 'randomNormal',
    'all-other-pokemon': 'allAdjacent',
    'selected-pokemon': 'normal',
    'all-opponents': 'allAdjacentFoes',
    'entire-field': 'all',
    'user-and-allies': 'allies',
    'all-pokemon': 'all',
    'all-allies': 'allyTeam',
    'fainting-pokemon': 'normal',
};

/** @brief PokeAPI `move_flags` identifier → Showdown flag (`null` = no equivalent). */
export const FLAGS: Record<string, string | null> = {
    'contact': 'contact', 'charge': 'charge', 'recharge': 'recharge', 'protect': 'protect',
    'reflectable': 'reflectable', 'snatch': 'snatch', 'mirror': 'mirror', 'punch': 'punch',
    'sound': 'sound', 'gravity': 'gravity', 'defrost': 'defrost', 'distance': 'distance',
    'heal': 'heal', 'authentic': 'bypasssub', 'powder': 'powder', 'bite': 'bite', 'pulse': 'pulse',
    'ballistics': 'bullet', 'mental': null, 'non-sky-battle': 'nonsky', 'dance': 'dance',
};

/** @brief PokeAPI damage class → Showdown category. */
const CATEGORIES: Record<string, string> = { '1': 'Status', '2': 'Physical', '3': 'Special' };

/** @brief PokeAPI ailment → Showdown non-volatile status. */
const STATUSES: Record<string, string> = {
    'paralysis': 'par', 'sleep': 'slp', 'freeze': 'frz', 'burn': 'brn', 'poison': 'psn',
};

/** @brief PokeAPI ailment → Showdown volatile status (only ones Showdown applies this way). */
const VOLATILES: Record<string, string> = {
    'confusion': 'confusion', 'infatuation': 'attract', 'nightmare': 'nightmare', 'torment': 'torment',
    'disable': 'disable', 'yawn': 'yawn', 'heal-block': 'healblock', 'leech-seed': 'leechseed',
    'embargo': 'embargo', 'ingrain': 'ingrain', 'silence': 'throatchop', 'tar-shot': 'tarshot',
};

/** @brief Moves whose "poison" is bad poison. PokeAPI does not distinguish the two. */
const TOXIC_MOVES = new Set(['toxic', 'poison-fang', 'malignant-chain']);

/**
 * @brief Reduce a percentage to a fraction, Showdown style (`50` → `[1, 2]`, `33` → `[33, 100]`).
 * @param percent Percentage (positive).
 * @return `[numerator, denominator]`.
 */
export function fraction (percent: number): [number, number]
{
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const d = gcd(percent, 100);
    return [percent / d, 100 / d];
}

/**
 * @brief Build the effect fields of a move from its `move_meta` row.
 * @param identifier Move identifier.
 * @param move The move being built (modified).
 * @param meta Its `move_meta` row.
 * @param boosts Its stat changes.
 * @param ctx Import context (for warnings).
 * @param lookups Meta category / ailment names.
 */
function applyMeta (identifier: string, move: Record<string, unknown>, meta: Row, boosts: Record<string, number> | null, ctx: ImportContext, lookups: MoveLookups): void
{
    const category = lookups.metaCategories.get(meta.meta_category_id) ?? 'damage';
    const ailment = lookups.ailments.get(meta.meta_ailment_id) ?? 'none';
    const ailmentChance = int(meta.ailment_chance) ?? 0;
    const statChance = int(meta.stat_chance) ?? 0;
    const flinchChance = int(meta.flinch_chance) ?? 0;
    const secondaries: Record<string, unknown>[] = [];

    let status: string | undefined = STATUSES[ailment];
    if (status === 'psn' && TOXIC_MOVES.has(identifier)) status = 'tox';
    let volatileStatus: string | undefined = VOLATILES[ailment];
    // Binding moves (Wrap, Fire Spin…): Showdown applies the trap as a guaranteed volatile.
    if (ailment === 'trap' && int(meta.min_turns)) move.volatileStatus = 'partiallytrapped';

    switch (category)
    {
        case 'ailment':
        case 'swagger':
            if (status) move.status = status;
            if (volatileStatus) move.volatileStatus = volatileStatus;
            if (boosts) move.boosts = boosts;
            break;
        case 'damage-ailment':
            if (status || volatileStatus)
            {
                secondaries.push({ chance: ailmentChance || 100, ...(status ? { status } : { volatileStatus }) });
            }
            break;
        case 'net-good-stats':
            if (boosts) move.boosts = boosts;
            break;
        case 'damage-lower':
            if (boosts) secondaries.push({ chance: statChance || 100, boosts });
            break;
        case 'damage-raise':
            if (boosts)
            {
                const allDrops = Object.values(boosts).every((v) => v < 0);
                if (allDrops && (statChance === 0 || statChance === 100)) move.self = { boosts };
                else secondaries.push({ chance: statChance || 100, self: { boosts } });
            }
            break;
        case 'ohko':
            move.ohko = true;
            break;
        case 'force-switch':
            move.forceSwitch = true;
            break;
        default:
            if (volatileStatus && move.category === 'Status') move.volatileStatus = volatileStatus;
    }

    if (flinchChance > 0) secondaries.push({ chance: flinchChance, volatileStatus: 'flinch' });

    const drain = int(meta.drain) ?? 0;
    if (drain > 0) move.drain = fraction(drain);
    if (drain < 0) move.recoil = fraction(-drain);
    const healing = int(meta.healing) ?? 0;
    if (healing > 0) move.heal = fraction(healing);

    const crit = int(meta.crit_rate) ?? 0;
    if (crit >= 3) move.willCrit = true;
    else if (crit > 0) move.critRatio = crit + 1;

    const minHits = int(meta.min_hits);
    const maxHits = int(meta.max_hits);
    if (minHits && maxHits && maxHits > 1) move.multihit = minHits === maxHits ? minHits : [minHits, maxHits];

    if (secondaries.length === 1) move.secondary = secondaries[0];
    else if (secondaries.length > 1) move.secondaries = secondaries;
    else if (move.category !== 'Status') move.secondary = null;

    if (ailment !== 'none' && ailment !== 'unknown' && !status && !volatileStatus && ailment !== 'trap')
    {
        ctx.warn(`moves: "${identifier}" ailment "${ailment}" has no Showdown field; behaviour comes from the sim`);
    }
}

/** @brief Lookup tables used by `applyMeta()`. */
interface MoveLookups
{
    metaCategories: Map<string, string>;
    ailments: Map<string, string>;
}

/**
 * @brief Build `moves.json`. Fills `ctx.moves`.
 *
 * Shadow moves (Colosseum/XD) are skipped. Text goes to the `moves` locale
 * category (`name`, `desc` = short effect, `flavor` = newest in-game text).
 *
 * @param ctx Import context.
 * @return The table.
 */
export function convertMoves (ctx: ImportContext): Record<string, unknown>
{
    const out: Record<string, Record<string, unknown>> = {};
    const english = ctx.primaryNames('move_names', 'move_id');
    const targets = new Map(ctx.csv.get('move_targets').map((r) => [r.id, r.identifier]));
    const flagNames = new Map(ctx.csv.get('move_flags').map((r) => [r.id, r.identifier]));
    const lookups: MoveLookups = {
        metaCategories: new Map(ctx.csv.get('move_meta_categories').map((r) => [r.id, r.identifier])),
        ailments: new Map(ctx.csv.get('move_meta_ailments').map((r) => [r.id, r.identifier])),
    };
    const meta = ctx.csv.byId('move_meta', 'move_id');
    const flags = ctx.group('move_flag_map', 'move_id');
    const statChanges = ctx.group('move_meta_stat_changes', 'move_id');

    for (const row of ctx.csv.get('moves'))
    {
        if (Number(row.id) >= NON_MAIN_SERIES_ID) continue;
        // PokeAPI splits Z-Moves into `--physical`/`--special` copies; Showdown has one move.
        const identifier = row.identifier.replace(/--(physical|special)$/, '');
        const sd = showdownName('moves', identifier) ?? showdownName('moves', english.get(row.id) ?? '');
        const name = sd?.name ?? english.get(row.id) ?? titleCase(identifier).replace(/-/g, ' ');
        const id = sd?.id ?? toID(name);
        ctx.moves.set(row.id, { id, name });
        if (id in out) continue;
        if (!sd) ctx.warn(`moves: "${row.identifier}" is not in Showdown; named "${name}"`);

        const target = TARGETS[targets.get(row.target_id) ?? ''];
        if (!target) ctx.warn(`moves: "${row.identifier}" has unknown target id ${row.target_id}`);

        const move: Record<string, unknown> = {
            num: Number(row.id),
            name,
            type: ctx.typeName.get(row.type_id) ?? 'Normal',
            category: CATEGORIES[row.damage_class_id] ?? 'Status',
            basePower: int(row.power) ?? 0,
            accuracy: int(row.accuracy) || true,
            pp: int(row.pp) ?? 1,
            priority: int(row.priority) ?? 0,
            target: target ?? 'normal',
            flags: {},
        };
        for (const f of flags.get(row.id) ?? [])
        {
            const flag = FLAGS[flagNames.get(f.move_flag_id) ?? ''];
            if (flag) (move.flags as Record<string, 1>)[flag] = 1;
        }
        // "Can hit any Pokémon in a Triple Battle" is a target in Showdown, plus the flag.
        if ((move.flags as Record<string, 1>).distance && move.target === 'normal') move.target = 'any';

        let boosts: Record<string, number> | null = null;
        for (const change of statChanges.get(row.id) ?? [])
        {
            (boosts ??= {})[STAT_BY_ID[change.stat_id]] = Number(change.change);
        }
        const metaRow = meta.get(row.id);
        if (metaRow) applyMeta(row.identifier, move, metaRow, boosts, ctx, lookups);
        else if (move.category !== 'Status') move.secondary = null;

        move.gen = int(row.generation_id) ?? undefined;
        out[id] = move;
    }

    const key = (field: string) => (id: string) => ctx.moves.has(id) ? `moves.${ctx.moves.get(id)!.id}.${field}` : null;
    ctx.importNames('moves', 'move_names', 'move_id', 'name', key('name'));
    ctx.importFlavor('moves', 'move_flavor_text', 'move_id', key('flavor'));

    // Effect prose is shared between moves with the same effect id.
    const prose = ctx.group('move_effect_prose', 'move_effect_id');
    for (const row of ctx.csv.get('moves'))
    {
        const k = key('desc')(row.id);
        if (!k) continue;
        for (const p of prose.get(row.effect_id) ?? [])
        {
            ctx.addText('moves', p.local_language_id, k, ctx.cleanProse(p.short_effect, int(row.effect_chance)));
        }
    }
    return out;
}
