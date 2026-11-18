/**
 * @file export.ts
 * @brief `npm run locales:export -- --locale de [--todo] [--data] [--category battle] [--out file.csv]`
 *
 * Writes a translator sheet (see exchange.ts) for one locale: every English
 * key with its context and the current translation. `--todo` keeps only
 * missing, stale and unverified rows; `--data` adds the game-data names
 * imported from PokeAPI. Without `--out` the sheet goes to
 * `locales-<locale>.csv` in the current folder.
 */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { isUiLocale } from '../../src/i18n/languages.ts';
import { isMain } from '../events/content.ts';
import { loadGeneratedText, loadLocaleFiles } from './content.ts';
import { exportSheet } from './exchange.ts';

if (isMain(import.meta.url))
{
    const { values } = parseArgs({
        options: {
            locale: { type: 'string' }, todo: { type: 'boolean' }, data: { type: 'boolean' },
            category: { type: 'string', multiple: true }, out: { type: 'string' },
        },
    });
    if (!values.locale || !isUiLocale(values.locale) || values.locale === 'en')
    {
        console.error('Usage: npm run locales:export -- --locale <de|fr|it|es-es|es-mx|pt-br|pt-pt> [--todo] [--data] [--category <name>] [--out <file>]');
        process.exit(1);
    }
    const sheet = exportSheet(loadLocaleFiles(), loadGeneratedText(), {
        locale: values.locale, todo: values.todo, data: values.data, categories: values.category,
    });
    const out = values.out ?? `locales-${values.locale}.csv`;
    fs.writeFileSync(out, '﻿' + sheet);
    console.log(`✓ Wrote ${sheet.split('\n').length - 2} row(s) to ${out}.`);
}
