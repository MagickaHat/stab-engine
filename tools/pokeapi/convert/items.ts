/**
 * @file items.ts
 * @brief Converts PokeAPI items to Showdown's `Items` format (`items.json`) plus
 *        engine-only data (`item_info.json`: price, pocket, flags, TM move).
 */
import { int } from '../csv.ts';
import type { ImportContext } from '../context.ts';
import { showdownName, titleCase, toID } from '../ids.ts';

/** @brief PokeAPI fling effect → Showdown `fling` extra field. */
const FLING_EFFECTS: Record<string, Record<string, string>> = {
    'badly-poison': { status: 'tox' },
    'burn': { status: 'brn' },
    'paralyze': { status: 'par' },
    'poison': { status: 'psn' },
    'flinch': { volatileStatus: 'flinch' },
};

/** @brief Result of `convertItems()`. */
export interface ItemTables
{
    items: Record<string, unknown>;
    itemInfo: Record<string, unknown>;
}

/**
 * @brief Build `items.json` and `item_info.json`. Fills `ctx.items`.
 *
 * Must run after `convertMoves()` (TMs reference moves).
 *
 * @param ctx Import context.
 * @return Both tables.
 */
export function convertItems (ctx: ImportContext): ItemTables
{
    const items: Record<string, unknown> = {};
    const itemInfo: Record<string, unknown> = {};
    const english = ctx.primaryNames('item_names', 'item_id');
    const categories = ctx.csv.byId('item_categories');
    const pockets = new Map(ctx.csv.get('item_pockets').map((r) => [r.id, r.identifier]));
    const flagNames = new Map(ctx.csv.get('item_flags').map((r) => [r.id, r.identifier]));
    const flingEffects = new Map(ctx.csv.get('item_fling_effects').map((r) => [r.id, r.identifier]));
    const flags = ctx.group('item_flag_map', 'item_id');
    const berries = ctx.csv.byId('berries', 'item_id');

    // Newest game index per item (Showdown's `num` is the in-game index).
    const gameIndex = new Map<string, { gen: number; index: number }>();
    const introduced = new Map<string, number>();
    for (const row of ctx.csv.get('item_game_indices'))
    {
        const gen = Number(row.generation_id);
        const current = gameIndex.get(row.item_id);
        if (!current || gen > current.gen) gameIndex.set(row.item_id, { gen, index: Number(row.game_index) });
        introduced.set(row.item_id, Math.min(introduced.get(row.item_id) ?? 99, gen));
    }

    // Newest move each machine teaches.
    const teaches = new Map<string, { order: number; move: string }>();
    for (const row of ctx.csv.get('machines'))
    {
        const order = ctx.versionGroupOrder.get(row.version_group_id) ?? 0;
        const current = teaches.get(row.item_id);
        const move = ctx.moves.get(row.move_id);
        if (move && (!current || order > current.order)) teaches.set(row.item_id, { order, move: move.id });
    }

    for (const row of ctx.csv.get('items'))
    {
        const sd = showdownName('items', row.identifier) ?? showdownName('items', english.get(row.id) ?? '');
        const englishName = english.get(row.id);
        let name = sd?.name ?? englishName ?? titleCase(row.identifier).replace(/-/g, ' ');
        let id = sd?.id ?? toID(name);
        if (!id || id in items)
        {
            // Several PokeAPI items share an English name (e.g. per-game key items).
            id = toID(row.identifier);
            name = englishName ? `${englishName} (${titleCase(row.identifier)})` : name;
        }
        if (id in items)
        {
            ctx.warn(`items: duplicate ID "${id}" for "${row.identifier}"; skipped`);
            continue;
        }
        ctx.items.set(row.id, { id, name });

        const category = categories.get(row.category_id);
        const item: Record<string, unknown> = { num: gameIndex.get(row.id)?.index ?? Number(row.id), name };
        const fling = int(row.fling_power);
        if (fling)
        {
            item.fling = { basePower: fling, ...FLING_EFFECTS[flingEffects.get(row.fling_effect_id) ?? ''] };
        }
        const berry = berries.get(row.id);
        if (berry)
        {
            item.isBerry = true;
            const giftType = ctx.typeName.get(berry.natural_gift_type_id);
            if (giftType) item.naturalGift = { basePower: Number(berry.natural_gift_power), type: giftType };
        }
        const pocket = pockets.get(category?.pocket_id ?? '') ?? 'misc';
        if (pocket === 'pokeballs') item.isPokeball = true;
        if (category?.identifier === 'jewels') item.isGem = true;
        if (introduced.has(row.id)) item.gen = introduced.get(row.id);
        items[id] = item;

        const info: Record<string, unknown> = {
            price: int(row.cost) ?? 0,
            pocket,
            category: category?.identifier ?? 'unknown',
            flags: (flags.get(row.id) ?? []).map((f) => flagNames.get(f.item_flag_id)).filter(Boolean),
        };
        const taught = teaches.get(row.id);
        if (taught) info.teaches = taught.move;
        itemInfo[id] = info;
    }

    const key = (field: string) => (id: string) => ctx.items.has(id) ? `items.${ctx.items.get(id)!.id}.${field}` : null;
    ctx.importNames('items', 'item_names', 'item_id', 'name', key('name'));
    ctx.importFlavor('items', 'item_flavor_text', 'item_id', key('flavor'));
    for (const row of ctx.csv.get('item_prose'))
    {
        const k = key('desc')(row.item_id);
        if (k) ctx.addText('items', row.local_language_id, k, ctx.cleanProse(row.short_effect));
    }
    return { items, itemInfo };
}
