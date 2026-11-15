/**
 * @file i18n.ts
 * @brief Naming conventions for localized game-data text.
 *
 * Data tables store only an English `name` (Showdown needs it, and it is the
 * fallback). All player-facing text lives in locale files, under keys built
 * from the table category, the entry ID and a field:
 *
 * | Key                         | Text                                     |
 * |-----------------------------|------------------------------------------|
 * | `pokemon.bulbasaur.name`    | Species name ("Bulbasaur")               |
 * | `pokemon.bulbasaur.genus`   | Pokédex category ("Seed Pokémon")        |
 * | `pokemon.bulbasaur.flavor`  | Pokédex entry                            |
 * | `pokemon.charizardmegax.form` | Forme name ("Mega Charizard X")        |
 * | `moves.thunderbolt.name` / `.desc` / `.flavor` | Name, short effect, in-game description |
 * | `abilities.static.name` / `.desc` / `.flavor`   |                         |
 * | `items.leftovers.name` / `.desc` / `.flavor`    |                         |
 * | `natures.adamant.name`, `types.fire.name`        |                         |
 *
 * The importer writes PokeAPI's translations to
 * `content/pbs/generated/locales/<locale>/<category>.json`. A future
 * localization system should load those first, then the hand-written files in
 * `content/locales/<category>/<locale>.csv` on top, so translators can
 * override anything.
 */
import type { LocaleCategory } from './tables.ts';

/** @brief Locales the project ships (folder names in `content/locales`). */
export const LOCALES = ['en', 'de', 'fr', 'es-es', 'es-mx', 'pt-br', 'pt-pt'] as const;
export type Locale = (typeof LOCALES)[number];

/** @brief Fields a text key can have. */
export type TextField = 'name' | 'desc' | 'flavor' | 'genus' | 'form';

/**
 * @brief Build a locale key.
 * @param category Locale category, e.g. `'moves'`.
 * @param id Entry ID, e.g. `'thunderbolt'`.
 * @param field Which text, e.g. `'name'`.
 * @return Key such as `"moves.thunderbolt.name"`.
 */
export function textKey (category: LocaleCategory, id: string, field: TextField): string
{
    return `${category}.${id}.${field}`;
}
