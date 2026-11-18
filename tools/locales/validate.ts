/**
 * @file validate.ts
 * @brief `npm run locales:validate`: checks every locale file, keyboard,
 *        overlay and translated graphic (see checks.ts for the list).
 *
 * Options:
 * - `--strict`: warnings fail too;
 * - `--quiet`: print only errors and the summary.
 *
 * Exit code 1 when there are errors.
 */
import fs from 'node:fs';
import { TextOverlay } from '../../src/i18n/overlays.ts';
import type { TiledMap } from '../../src/events/tiled.ts';
import { usedTextKeys } from '../events/checks.ts';
import { isMain, listFiles, loadEvents, loadLocales, mapId, MAPS_DIR } from '../events/content.ts';
import { collectRegistries } from '../events/registries.ts';
import { checkLocales } from './checks.ts';
import type { LocaleCheckInput, LocaleReport } from './checks.ts';
import {
    inkKeys, listLocaleGraphics, loadGeneratedText, loadKeyboards, loadLocaleFiles, loadOverlayFiles, loadUiFont, pngSize,
    readLocaleJson, scanCodeKeys,
} from './content.ts';
import type { GrammarSpec, LimitsSpec } from './content.ts';

/**
 * @brief Read everything the checks need from disk.
 * @return The input of `checkLocales()`.
 */
export function gatherInput (): LocaleCheckInput
{
    const { bundle } = loadEvents();
    const maps: Record<string, TiledMap> = {};
    for (const file of listFiles(MAPS_DIR, ['.tmj']))
    {
        try
        {
            maps[mapId(file)] = JSON.parse(fs.readFileSync(file, 'utf-8')) as TiledMap;
        }
        catch
        {
            //  events:validate reports broken maps.
        }
    }
    const used = usedTextKeys({ bundle, registries: collectRegistries(bundle), locales: loadLocales(), maps });
    for (const key of inkKeys()) used.add(key);
    const keyboards = loadKeyboards();
    for (const layout of keyboards) for (const page of layout.pages) used.add(page.label);
    const overlays = loadOverlayFiles();
    for (const { raw } of overlays)
    {
        const parsed = TextOverlay.safeParse(raw);
        if (!parsed.success) continue;
        for (const slot of parsed.data.text) for (const key of slot.keys ?? [slot.key!]) used.add(key);
    }
    return {
        files: loadLocaleFiles(),
        generated: loadGeneratedText(),
        usedKeys: used,
        code: scanCodeKeys(),
        grammar: readLocaleJson<GrammarSpec>('grammar.json', {}),
        limits: readLocaleJson<LimitsSpec>('limits.json', { samples: {}, rules: [] }),
        font: loadUiFont(),
        keyboards,
        overlays,
        localeGraphics: listLocaleGraphics(),
        imageSize: pngSize,
    };
}

/**
 * @brief Run every check on the files on disk.
 * @return Findings and report.
 */
export function validateLocales (): LocaleReport
{
    return checkLocales(gatherInput());
}

if (isMain(import.meta.url))
{
    const { findings } = validateLocales();
    const errors = findings.filter((f) => f.level === 'error');
    const warnings = findings.filter((f) => f.level === 'warning');
    const quiet = process.argv.includes('--quiet');
    for (const f of findings)
    {
        if (quiet && f.level === 'warning') continue;
        console[f.level === 'error' ? 'error' : 'warn'](`${f.level === 'error' ? '✗' : '!'} ${f.where}: ${f.message}`);
    }
    if (errors.length || (process.argv.includes('--strict') && warnings.length))
    {
        console.error(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
        process.exit(1);
    }
    console.log(`✓ Locale files are valid${warnings.length ? ` (${warnings.length} warning(s); npm run locales:report for details)` : ''}.`);
}
