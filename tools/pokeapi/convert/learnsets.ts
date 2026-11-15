/**
 * @file learnsets.ts
 * @brief Converts PokeAPI `pokemon_moves` to Showdown's `Learnsets` format.
 *
 * Each PokeAPI (version group, method, level) becomes a Showdown learn source
 * `<gen><code><level?>`, e.g. Bulbasaur learning Vine Whip at level 3 in
 * Scarlet/Violet becomes `"9L3"`. See `LEARN_METHODS` in `config.ts`.
 */
import { EXCLUDED_VERSION_GROUPS, LEARN_METHODS } from '../config.ts';
import type { ImportContext } from '../context.ts';

/** @brief Sort order of method codes inside one generation (Showdown-like). */
const METHOD_ORDER = 'LMTESDV';

/**
 * @brief Compare two learn sources: newest generation first, then by method, then level.
 * @param a Source like `9L15`.
 * @param b Source like `8M`.
 * @return Sort order.
 */
function compareSources (a: string, b: string): number
{
    const pa = /^(\d+)([A-Z])(\d*)$/.exec(a)!;
    const pb = /^(\d+)([A-Z])(\d*)$/.exec(b)!;
    return Number(pb[1]) - Number(pa[1])
        || METHOD_ORDER.indexOf(pa[2]) - METHOD_ORDER.indexOf(pb[2])
        || Number(pa[3] || 0) - Number(pb[3] || 0);
}

/**
 * @brief Build `learnsets.json`. Must run after species and moves.
 * @param ctx Import context.
 * @return The table: `{ speciesId: { learnset: { moveId: ["9L1", …] } } }`.
 */
export function convertLearnsets (ctx: ImportContext): Record<string, unknown>
{
    const methods = new Map(ctx.csv.get('pokemon_move_methods').map((r) => [r.id, LEARN_METHODS[r.identifier]]));
    const sets = new Map<string, Map<string, Set<string>>>();
    let skipped = 0;

    for (const row of ctx.csv.get('pokemon_moves'))
    {
        const code = methods.get(row.pokemon_move_method_id);
        const group = ctx.versionGroupName.get(row.version_group_id) ?? '';
        const species = ctx.species.get(row.pokemon_id);
        const move = ctx.moves.get(row.move_id);
        if (!code || EXCLUDED_VERSION_GROUPS.has(group) || !species || !move)
        {
            skipped++;
            continue;
        }
        const gen = ctx.genOf(row.version_group_id);
        const source = `${gen}${code}${code === 'L' ? Number(row.level || 0) : ''}`;

        let learnset = sets.get(species.id);
        if (!learnset) sets.set(species.id, learnset = new Map());
        let sources = learnset.get(move.id);
        if (!sources) learnset.set(move.id, sources = new Set());
        sources.add(source);
    }

    const out: Record<string, { learnset: Record<string, string[]> }> = {};
    for (const [speciesId, learnset] of [...sets].sort(([a], [b]) => a.localeCompare(b)))
    {
        const moves: Record<string, string[]> = {};
        for (const [moveId, sources] of [...learnset].sort(([a], [b]) => a.localeCompare(b)))
        {
            moves[moveId] = [...sources].sort(compareSources);
        }
        out[speciesId] = { learnset: moves };
    }
    if (skipped) ctx.warn(`learnsets: ${skipped} rows skipped (excluded games or learn methods)`);
    return out;
}
