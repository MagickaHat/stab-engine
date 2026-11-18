/**
 * @file report.ts
 * @brief `npm run locales:report`: how complete each language is.
 *
 * For each locale: translated, shown from a sister locale, missing, stale and
 * unverified keys; then the English keys nothing uses.
 *
 * Options:
 * - `--json`: print the report as JSON;
 * - `--locale <id>`: only that locale, with every key listed;
 * - `--out <file>`: write to a file instead of the terminal.
 */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { languageInfo } from '../../src/i18n/languages.ts';
import { isMain } from '../events/content.ts';
import type { LocaleReport, LocaleStats } from './checks.ts';
import { validateLocales } from './validate.ts';

/**
 * @brief Write a report as Markdown.
 * @param report The report.
 * @param full List every key instead of the first few.
 * @return Markdown text.
 */
export function formatReport (report: LocaleReport, full = false): string
{
    const percent = (stat: LocaleStats) => (stat.total ? Math.round(((stat.translated + stat.fromSister.length) / stat.total) * 100) : 100);
    const lines = [
        '# Localization report', '',
        '| Locale | Language | Done | Translated | From sister | Missing | Stale | No hash | Not in English |',
        '|--------|----------|-----:|-----------:|------------:|--------:|------:|--------:|---------------:|',
        ...report.stats.map((stat) => `| ${stat.locale} | ${languageInfo(stat.locale).nativeName} | ${percent(stat)}% | ${stat.translated}/${stat.total} | ${stat.fromSister.length} | ${stat.missing.length} | ${stat.stale.length} | ${stat.unverified.length} | ${stat.orphans.length} |`),
        '',
    ];
    const list = (title: string, keys: string[]) =>
    {
        if (!keys.length) return;
        const shown = full ? keys : keys.slice(0, 20);
        lines.push(`- **${title}** (${keys.length}): ${shown.map((key) => `\`${key}\``).join(', ')}${shown.length < keys.length ? ', …' : ''}`);
    };
    for (const stat of report.stats)
    {
        const before = lines.length;
        lines.push(`## ${stat.locale}`, '');
        list('Stale', stat.stale);
        list('Missing', stat.missing);
        list('Shown from a sister locale', stat.fromSister);
        list('No hash', stat.unverified);
        list('Not in English', stat.orphans);
        if (lines.length === before + 2) lines.length = before;
        else lines.push('');
    }
    lines.push('## Unused English keys', '');
    lines.push(report.unused.length ? report.unused.map((key) => `- \`${key}\``).join('\n') : 'None.');
    return lines.join('\n') + '\n';
}

if (isMain(import.meta.url))
{
    const { values } = parseArgs({ options: { json: { type: 'boolean' }, locale: { type: 'string' }, out: { type: 'string' } } });
    const report = validateLocales();
    if (values.locale) report.stats = report.stats.filter((stat) => stat.locale === values.locale);
    const text = values.json ? JSON.stringify({ stats: report.stats, unused: report.unused }, null, 2) + '\n' : formatReport(report, !!values.locale);
    if (values.out) fs.writeFileSync(values.out, text);
    else process.stdout.write(text);
}
