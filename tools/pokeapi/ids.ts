/**
 * @file ids.ts
 * @brief Turns PokeAPI identifiers (`charizard-mega-x`, `u-turn`) into
 *        Showdown IDs and display names (`charizardmegax`, `Charizard-Mega-X`).
 *
 * Showdown's own Dex (from `@pkmn/sim`) is used as the reference for spelling:
 * when a PokeAPI entry matches one Showdown knows, its exact Showdown name is
 * used. Everything else gets a name built in the same style and is reported.
 */
import { Dex } from '@pkmn/sim';
import { toID } from '../../src/data/integrity.ts';

export { toID };

/**
 * @brief PokeAPI Pokémon identifiers whose Showdown ID cannot be guessed.
 *
 * Most forms match after removing dashes (`rotom-wash` → `rotomwash`) or are
 * the default forme (`giratina-altered` → `giratina`); only the rest are here.
 */
export const SPECIES_ALIASES: Record<string, string> = {
    'minior-red-meteor': 'miniormeteor',
    'minior-red': 'minior',
    'zygarde-50': 'zygarde',
    'zygarde-10': 'zygarde10',
    'maushold-family-of-four': 'mausholdfour',
    'maushold-family-of-three': 'maushold',
    'tauros-paldea-combat-breed': 'taurospaldeacombat',
    'tauros-paldea-blaze-breed': 'taurospaldeablaze',
    'tauros-paldea-aqua-breed': 'taurospaldeaaqua',
    'necrozma-dusk': 'necrozmaduskmane',
    'necrozma-dawn': 'necrozmadawnwings',
    'calyrex-ice': 'calyrexice',
    'calyrex-shadow': 'calyrexshadow',
    'dudunsparce-three-segment': 'dudunsparcethreesegment',
    'greninja-battle-bond': 'greninjabond',
    'meowstic-male-mega': 'meowsticmmega',
    'rockruff-own-tempo': 'rockruffdusk',
    'meowstic-female-mega': 'meowsticfmega',
    'squawkabilly-green-plumage': 'squawkabilly',
    'ogerpon-teal-mask': 'ogerpon',
    'ogerpon-wellspring-mask': 'ogerponwellspring',
    'ogerpon-hearthflame-mask': 'ogerponhearthflame',
    'ogerpon-cornerstone-mask': 'ogerponcornerstone',
};

/**
 * @brief Title-case a dashed identifier the way Showdown writes names.
 * @param identifier e.g. `'limited-build'`.
 * @return e.g. `'Limited-Build'`.
 */
export function titleCase (identifier: string): string
{
    return identifier.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
}

/** @brief A resolved Showdown species name. */
export interface SpeciesName
{
    id: string;
    name: string;
    /** `true` if Showdown knows this species/forme. */
    matched: boolean;
}

/** @brief Minimal stats used to confirm a fuzzy match is the same Pokémon. */
export interface StatsCheck
{
    hp: number; atk: number; def: number; spa: number; spd: number; spe: number;
}

/**
 * @brief Look up a species in Showdown's Dex.
 * @param id Candidate ID.
 * @return The Showdown species, or `null` if unknown.
 */
function showdownSpecies (id: string)
{
    const species = Dex.species.get(id);
    return species.exists ? species : null;
}

/**
 * @brief Assigns unique Showdown IDs/names to PokeAPI Pokémon.
 *
 * Call `exact()` for every Pokémon first, then `fuzzy()` for those still
 * unresolved, then `fallback()`; this order keeps an exact match from being
 * stolen by a fuzzy one.
 */
export class SpeciesNamer
{
    private readonly taken = new Set<string>();

    /**
     * @brief Mark an ID as used.
     * @param id ID.
     * @return `false` if it was already used.
     */
    private claim (id: string): boolean
    {
        if (this.taken.has(id)) return false;
        this.taken.add(id);
        return true;
    }

    /**
     * @brief Check that a Showdown species has the given base stats.
     * @param species Showdown species.
     * @param stats PokeAPI stats (`null` skips the check).
     * @return `true` if they match or no stats were given.
     */
    private static sameStats (species: { baseStats: StatsCheck }, stats: StatsCheck | null): boolean
    {
        if (!stats) return true;
        const b = species.baseStats;
        return b.hp === stats.hp && b.atk === stats.atk && b.def === stats.def &&
            b.spa === stats.spa && b.spd === stats.spd && b.spe === stats.spe;
    }

    /**
     * @brief Try exact matches: an alias, the identifier itself, `-female`→`-f`,
     *        or the species name for default formes.
     *
     * Showdown's Dex also resolves nicknames (`pyroarm` → Pyroar-Mega), so
     * with `stats` given a match only counts if the base stats agree. Run
     * once with stats for every Pokémon, then once without for the rest.
     *
     * @param identifier PokeAPI Pokémon identifier.
     * @param speciesIdentifier PokeAPI species identifier.
     * @param isDefault Whether this is the species' default Pokémon.
     * @param stats PokeAPI base stats, or `null` to skip the check.
     * @return The name, or `null` if nothing matched.
     */
    exact (identifier: string, speciesIdentifier: string, isDefault: boolean, stats: StatsCheck | null): SpeciesName | null
    {
        const candidates = [
            SPECIES_ALIASES[identifier],
            identifier,
            stats ? identifier.replace(/-female$/, '-f').replace(/-female-/, '-f-').replace(/-male$/, '') : undefined,
            isDefault ? speciesIdentifier : undefined,
        ];
        for (const candidate of candidates)
        {
            if (!candidate) continue;
            const species = showdownSpecies(toID(candidate));
            if (species && SpeciesNamer.sameStats(species, stats) && this.claim(species.id))
            {
                return { id: species.id, name: species.name, matched: true };
            }
        }
        return null;
    }

    /**
     * @brief Try looser matches (shorter identifiers, swapped words), accepted
     *        only if Showdown's base stats are identical.
     * @param identifier PokeAPI Pokémon identifier.
     * @param stats PokeAPI base stats of this Pokémon.
     * @return The name, or `null` if nothing matched.
     */
    fuzzy (identifier: string, stats: StatsCheck): SpeciesName | null
    {
        const parts = identifier.split('-');
        const candidates: string[] = [];
        if (parts.length >= 3) candidates.push([...parts.slice(0, -2), parts.at(-1), parts.at(-2)].join('-'));
        for (let k = parts.length - 1; k >= 1; k--) candidates.push(parts.slice(0, k).join('-'));
        for (const candidate of candidates)
        {
            const species = showdownSpecies(toID(candidate));
            if (!species) continue;
            if (SpeciesNamer.sameStats(species, stats) && this.claim(species.id)) return { id: species.id, name: species.name, matched: true };
        }
        return null;
    }

    /**
     * @brief Build a Showdown-style name for a forme Showdown does not have.
     *
     * Words already in the base name are dropped, so base `Minior-Meteor` +
     * form `orange-meteor` gives `Minior-Meteor-Orange`.
     *
     * @param baseName Showdown name of the base species, e.g. `'Koraidon'`.
     * @param formIdentifier PokeAPI form identifier, e.g. `'limited-build'`.
     * @return A unique name such as `Koraidon-Limited-Build`.
     */
    fallback (baseName: string, formIdentifier: string): SpeciesName
    {
        const baseWords = new Set(baseName.toLowerCase().split('-'));
        const form = titleCase(formIdentifier.split('-').filter((w) => !baseWords.has(w)).join('-'));
        let name = form ? `${baseName}-${form}` : baseName;
        let n = 2;
        while (!this.claim(toID(name))) name = `${baseName}-${form}-${n++}`;
        return { id: toID(name), name, matched: false };
    }
}

/**
 * @brief Showdown's spelling of a move, ability or item, if it knows it.
 * @param kind Which Dex table.
 * @param identifier PokeAPI identifier.
 * @return Showdown `{ id, name }`, or `null` if unknown.
 */
export function showdownName (kind: 'moves' | 'abilities' | 'items', identifier: string): { id: string; name: string } | null
{
    const entry = Dex[kind].get(toID(identifier));
    if (!entry.exists) return null;
    // Showdown aliases (e.g. old item names) resolve to another ID; only accept real matches.
    if (entry.id !== toID(identifier)) return null;
    return { id: entry.id, name: entry.name };
}
