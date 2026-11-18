/**
 * @file config.ts
 * @brief Settings for the PokeAPI importer. Edit these to change what gets imported.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @brief Repository root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @brief Where generated tables are written. Owned by the importer: overwritten on every run. */
export const GENERATED_DIR = path.join(ROOT, 'content/pbs/generated');

/** @brief Developer overrides. Never written by the importer. */
export const CUSTOM_DIR = path.join(ROOT, 'content/pbs/custom');

/** @brief Generated JSON schemas for editor autocompletion. */
export const SCHEMAS_DIR = path.join(ROOT, 'content/pbs/schemas');

/** @brief Download cache for PokeAPI CSV files (gitignored). */
export const CACHE_DIR = path.join(ROOT, 'tools/pokeapi/.cache');

/** @brief GitHub repository that holds the PokeAPI CSV dump. */
export const POKEAPI_REPO = 'PokeAPI/pokeapi';

/** @brief Path of the CSV folder inside that repository. */
export const POKEAPI_CSV_PATH = 'data/v2/csv';

/** @brief Default git ref (branch, tag or commit) to import from. Override with `--ref`. */
export const DEFAULT_REF = 'master';

/**
 * @brief PokeAPI language identifier → engine language (src/i18n/languages.ts).
 *
 * Every UI locale PokeAPI has, plus the Pokémon-only languages (Japanese,
 * Korean, Chinese), whose names and Pokédex entries are shown as foreign
 * Pokédex entries. Japanese uses the kanji text (`ja`), not the kana-only one
 * (`ja-hrkt`). PokeAPI has no European Portuguese, so `pt-pt` falls back to
 * `pt-br` and is left for translators.
 */
export const LANGUAGES: Record<string, string> = {
    'en': 'en',
    'de': 'de',
    'fr': 'fr',
    'it': 'it',
    'es': 'es-es',
    'es-419': 'es-mx',
    'pt-br': 'pt-br',
    'ja': 'ja',
    'ko': 'ko',
    'zh-hans': 'zh-hans',
    'zh-hant': 'zh-hant',
};

/** @brief Language used for Showdown `name` fields and as the fallback text. */
export const PRIMARY_LANGUAGE = 'en';

/**
 * @brief Version groups whose move data is NOT imported into learnsets.
 *
 * Showdown keeps side games out of the main learnsets, so these are skipped
 * to stay compatible: Colosseum/XD (shadow moves), Let's Go (separate
 * mechanics), BDSP and Legends games (separate move pools), Japanese
 * Red/Green/Blue (duplicates of Red/Blue) and Champions.
 */
export const EXCLUDED_VERSION_GROUPS = new Set([
    'colosseum', 'xd', 'lets-go-pikachu-lets-go-eevee', 'brilliant-diamond-shining-pearl',
    'legends-arceus', 'legends-za', 'mega-dimension', 'red-green-japan', 'blue-japan', 'champions',
]);

/**
 * @brief PokeAPI move-learn method → Showdown learnset code.
 * Methods not listed (form change, Zygarde Cube, Colosseum…) are skipped.
 */
export const LEARN_METHODS: Record<string, string> = {
    'level-up': 'L',
    'machine': 'M',
    'tutor': 'T',
    'egg': 'E',
    'light-ball-egg': 'E',
};

/** @brief PokeAPI IDs at or above this are non-main-series (shadow moves, Conquest abilities…). */
export const NON_MAIN_SERIES_ID = 10000;
