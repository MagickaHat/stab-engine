/**
 * @file data.ts
 * @brief The game data the event runtime looks things up in (item pockets, abilities, learnsets).
 */
import { loadPbs, toID } from '../data';
import type { RuntimeData } from '../events/runtime/host';

/**
 * @brief Load the tables the event runtime needs.
 * @return Lookups for `EventManager`'s `data` option.
 */
export async function loadRuntimeData (): Promise<RuntimeData>
{
    const { itemInfo, pokedex, learnsets } = await loadPbs(['itemInfo', 'pokedex', 'learnsets']);
    return {
        itemPocket: (item) => itemInfo[item]?.pocket,
        ability: (species) =>
        {
            const name = pokedex[species]?.abilities?.['0'];
            return name ? toID(name) : undefined;
        },
        learnset: (species) => learnsets[species]?.learnset,
    };
}
