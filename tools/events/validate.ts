/**
 * @file validate.ts
 * @brief CLI: checks every event file and Tiled map.
 *
 * @code
 * npm run events:validate
 * npm run events:validate -- --strict   # warnings fail too
 * @endcode
 *
 * Exits with 1 if anything is wrong, so it can run in CI or from Tiled's
 * Command menu ("STAB: Validate events and maps"). See checks.ts for what
 * is checked.
 */
import fs from 'node:fs';
import { formatIssue } from '../../src/events/compile.ts';
import type { TiledMap } from '../../src/events/tiled.ts';
import { checkContent } from './checks.ts';
import type { Finding } from './checks.ts';
import { isMain, listFiles, loadEvents, loadLocales, mapId, MAPS_DIR, relative } from './content.ts';
import { collectRegistries } from './registries.ts';

/**
 * @brief Validate everything on disk.
 * @return Every finding (compile problems are errors).
 */
export function validateAll (): Finding[]
{
    const { bundle, issues, files } = loadEvents();
    const findings: Finding[] = issues.map((issue) => ({ level: 'error', where: issue.file, message: formatIssue(issue).slice(issue.file.length + 2) }));
    const maps: Record<string, TiledMap> = {};
    for (const file of listFiles(MAPS_DIR, ['.tmj']))
    {
        try
        {
            maps[mapId(file)] = JSON.parse(fs.readFileSync(file, 'utf-8')) as TiledMap;
        }
        catch (error)
        {
            findings.push({ level: 'error', where: relative(file), message: `not valid JSON: ${(error as Error).message}` });
        }
    }
    findings.push(...checkContent({ bundle, registries: collectRegistries(bundle), locales: loadLocales(), maps }));
    if (process.env.STAB_VERBOSE) console.log(`Checked ${files.length} event file(s) and ${Object.keys(maps).length} map(s).`);
    return findings;
}

if (isMain(import.meta.url))
{
    const findings = validateAll();
    const errors = findings.filter((f) => f.level === 'error');
    const warnings = findings.filter((f) => f.level === 'warning');
    for (const f of findings) console[f.level === 'error' ? 'error' : 'warn'](`${f.level === 'error' ? '✗' : '!'} ${f.where}: ${f.message}`);
    const strict = process.argv.includes('--strict');
    if (errors.length || (strict && warnings.length))
    {
        console.error(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
        process.exit(1);
    }
    console.log(`✓ Events and maps are valid${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
}
