/**
 * @file teams.ts
 * @brief Helpers for building teams the simulator understands, plus samples.
 *
 * Teams are written in Showdown's "export" text format - exactly what you get
 * from the Teambuilder's Import/Export button at https://play.pokemonshowdown.com
 * - and converted to the compact "packed" string the simulator expects.
 */
import { Teams } from '@pkmn/sim';

/**
 * @brief Convert a Showdown export-format team into a packed team string.
 *
 * @param exportText Team in Showdown export format (one set per paragraph).
 * @return Packed team string suitable for `BattleEngine.start()`.
 * @throws Error if the text could not be parsed into at least one Pokémon.
 */
export function importTeam (exportText: string): string
{
    const sets = Teams.import(exportText.trim());
    if (!sets || sets.length === 0)
    {
        throw new Error('importTeam: could not parse any Pokémon from team text');
    }
    return Teams.pack(sets);
}

/** @brief Sample team for player 1 (export format). */
export const SAMPLE_TEAM_P1 = `
Pikachu @ Light Ball
Ability: Static
Tera Type: Electric
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Thunderbolt
- Volt Switch
- Grass Knot
- Surf

Charizard @ Heavy-Duty Boots
Ability: Blaze
Tera Type: Fire
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Flamethrower
- Air Slash
- Focus Blast
- Roost

Venusaur @ Black Sludge
Ability: Overgrow
Tera Type: Water
EVs: 252 HP / 4 SpA / 252 SpD
Calm Nature
- Giga Drain
- Sludge Bomb
- Leech Seed
- Earth Power
`;

/** @brief Sample team for player 2 (export format). */
export const SAMPLE_TEAM_P2 = `
Blastoise @ Leftovers
Ability: Torrent
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Scald
- Ice Beam
- Rapid Spin
- Protect

Gengar @ Life Orb
Ability: Cursed Body
Tera Type: Ghost
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Shadow Ball
- Sludge Bomb
- Focus Blast
- Thunderbolt

Snorlax @ Leftovers
Ability: Thick Fat
Tera Type: Normal
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Body Slam
- Earthquake
- Heavy Slam
- Rest
`;
