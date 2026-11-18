/**
 * @file import.ts
 * @brief `npm run locales:import -- <sheet.csv> --locale de [--dry-run]`
 *
 * Reads a translator sheet made by `locales:export` (see exchange.ts) and
 * writes its translations into `content/locales/<category>/<locale>.csv`,
 * stamping each with the hash of its English text.
 *
 * `npm run locales:import -- --locale de --stamp` instead stamps every
 * translation that has no hash yet (after reviewing them), so the stale
 * check covers them from now on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { isUiLocale } from '../../src/i18n/languages.ts';
import { isMain } from '../events/content.ts';
import { loadGeneratedText, loadLocaleFiles, LOCALES_DIR } from './content.ts';
import { importSheet, stampHashes } from './exchange.ts';

/**
 * @brief Write new locale files.
 * @param locale Locale.
 * @param files New CSV text by category.
 * @param dryRun Only print what would change.
 */
function writeFiles (locale: string, files: Map<string, string>, dryRun: boolean): void
{
    for (const [category, text] of files)
    {
        const file = path.join(LOCALES_DIR, category, `${locale}.csv`);
        console.log(`${dryRun ? 'would write' : 'wrote'} content/locales/${category}/${locale}.csv`);
        if (dryRun) continue;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
}

if (isMain(import.meta.url))
{
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: { locale: { type: 'string' }, 'dry-run': { type: 'boolean' }, stamp: { type: 'boolean' } },
    });
    const locale = values.locale;
    if (!locale || !isUiLocale(locale) || locale === 'en' || (!values.stamp && positionals.length !== 1))
    {
        console.error('Usage: npm run locales:import -- <sheet.csv> --locale <de|fr|...> [--dry-run]\n       npm run locales:import -- --locale <de|fr|...> --stamp');
        process.exit(1);
    }
    const dryRun = !!values['dry-run'];
    if (values.stamp)
    {
        const { files, stamped } = stampHashes(loadLocaleFiles(), locale);
        writeFiles(locale, files, dryRun);
        console.log(`✓ Stamped ${stamped} translation(s).`);
    }
    else
    {
        const result = importSheet(fs.readFileSync(positionals[0], 'utf-8'), loadLocaleFiles(), loadGeneratedText(), locale);
        for (const problem of result.problems) console.error(`✗ ${problem}`);
        if (result.problems.length && !result.files.size) process.exit(1);
        if (result.unknown.length) console.warn(`! ${result.unknown.length} key(s) are not in English and were skipped: ${result.unknown.slice(0, 10).join(', ')}`);
        writeFiles(locale, result.files, dryRun);
        console.log(`✓ ${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged.`);
    }
}
