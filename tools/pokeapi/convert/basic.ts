/**
 * @file basic.ts
 * @brief Converters for the type chart, natures and abilities.
 */
import { NON_MAIN_SERIES_ID } from '../config.ts';
import { int } from '../csv.ts';
import type { ImportContext } from '../context.ts';
import { showdownName, titleCase, toID } from '../ids.ts';

/** @brief PokeAPI damage factor → Showdown `damageTaken` code. */
const DAMAGE_CODES: Record<string, 0 | 1 | 2 | 3> = { '100': 0, '200': 1, '50': 2, '0': 3 };

/** @brief PokeAPI stat id → Showdown stat ID. */
export const STAT_BY_ID: Record<string, string> = {
    '1': 'hp', '2': 'atk', '3': 'def', '4': 'spa', '5': 'spd', '6': 'spe', '7': 'accuracy', '8': 'evasion',
};

/**
 * @brief Build `typechart.json` (Showdown `TypeChart`).
 *
 * Uses PokeAPI's current-generation `type_efficacy`. Only types that appear
 * in the chart are exported (no `???`/Shadow/Stellar).
 *
 * @param ctx Import context.
 * @return The table.
 */
export function convertTypeChart (ctx: ImportContext): Record<string, unknown>
{
    const chart: Record<string, { name: string; damageTaken: Record<string, number> }> = {};
    const typeIds = new Set<string>();
    for (const row of ctx.csv.get('type_efficacy')) typeIds.add(row.target_type_id);

    for (const typeId of [...typeIds].sort((a, b) => Number(a) - Number(b)))
    {
        const name = ctx.typeName.get(typeId)!;
        chart[toID(name)] = { name, damageTaken: {} };
    }
    for (const row of ctx.csv.get('type_efficacy'))
    {
        const defender = chart[toID(ctx.typeName.get(row.target_type_id))];
        const code = DAMAGE_CODES[row.damage_factor];
        if (code === undefined) ctx.warn(`type_efficacy: unexpected damage factor ${row.damage_factor}`);
        defender.damageTaken[ctx.typeName.get(row.damage_type_id)!] = code ?? 0;
    }

    ctx.importNames('types', 'type_names', 'type_id', 'name', (id) =>
    {
        const name = ctx.typeName.get(id);
        return name && toID(name) in chart ? `types.${toID(name)}.name` : null;
    });
    return chart;
}

/**
 * @brief Build `natures.json` (Showdown `Natures`).
 * @param ctx Import context.
 * @return The table.
 */
export function convertNatures (ctx: ImportContext): Record<string, unknown>
{
    const out: Record<string, unknown> = {};
    const ids = new Map<string, string>();
    for (const row of ctx.csv.get('natures'))
    {
        const name = titleCase(row.identifier);
        const plus = STAT_BY_ID[row.increased_stat_id];
        const minus = STAT_BY_ID[row.decreased_stat_id];
        out[toID(name)] = plus === minus ? { name } : { name, plus, minus };
        ids.set(row.id, toID(name));
    }
    ctx.importNames('natures', 'nature_names', 'nature_id', 'name', (id) => ids.has(id) ? `natures.${ids.get(id)}.name` : null);
    return out;
}

/**
 * @brief Build `abilities.json` (Showdown `Abilities`). Fills `ctx.abilities`.
 * @param ctx Import context.
 * @return The table.
 */
export function convertAbilities (ctx: ImportContext): Record<string, unknown>
{
    // Showdown's placeholder for Pokémon without an ability (some new Megas in PokeAPI).
    const out: Record<string, unknown> = { noability: { num: 0, name: 'No Ability' } };
    const english = ctx.primaryNames('ability_names', 'ability_id');
    for (const row of ctx.csv.get('abilities'))
    {
        if (row.is_main_series !== '1' || Number(row.id) >= NON_MAIN_SERIES_ID) continue;
        const sd = showdownName('abilities', row.identifier) ?? showdownName('abilities', english.get(row.id) ?? '');
        const name = sd?.name ?? english.get(row.id) ?? titleCase(row.identifier).replace(/-/g, ' ');
        const id = sd?.id ?? toID(name);
        if (!sd) ctx.warn(`abilities: "${row.identifier}" is not in Showdown; named "${name}"`);
        ctx.abilities.set(row.id, { id, name });
        out[id] = { num: Number(row.id), name, gen: int(row.generation_id) ?? undefined };
    }

    const key = (field: string) => (id: string) => ctx.abilities.has(id) ? `abilities.${ctx.abilities.get(id)!.id}.${field}` : null;
    ctx.importNames('abilities', 'ability_names', 'ability_id', 'name', key('name'));
    ctx.importFlavor('abilities', 'ability_flavor_text', 'ability_id', key('flavor'));
    for (const row of ctx.csv.get('ability_prose'))
    {
        const k = key('desc')(row.ability_id);
        if (k) ctx.addText('abilities', row.local_language_id, k, ctx.cleanProse(row.short_effect));
    }
    return out;
}
