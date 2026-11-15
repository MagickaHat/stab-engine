/**
 * @file plan.ts
 * @brief Works out, for one pack, which file goes where. Nothing is read or
 *        written here apart from listing folders, so `--dry-run` is instant.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ITEMS_DIR, POKEMON_DIR } from './config.ts';
import { findDir, formKey, parseAssetName } from './essentials.ts';
import type { AssetName } from './essentials.ts';
import type { ImageOp } from './image.ts';
import type { PackDefinition, Rule } from './pack.ts';
import { SpeciesResolver, toID } from './resolve.ts';
import type { DexIndex } from './resolve.ts';

/** @brief One source file and its destination. */
export interface PlannedFile
{
    /** Absolute source path. */
    src: string;
    /** Source path relative to the pack, with `/`. */
    srcRel: string;
    /** Destination relative to the output folder, with `/`, e.g. `pokemon/charizard/megax/front.png`. */
    dest: string;
    /** Rule label, e.g. `'front'`. */
    kind: string;
    /** Resize instructions, or `null` to copy. */
    image: ImageOp | null;
}

/** @brief Things the user may want to look at after planning. Each list holds readable lines. */
export interface PlanReport
{
    /** Forms that could not be named; imported as `form<N>` folders. */
    unresolved: string[];
    /** Species IDs missing from the engine's pokedex. */
    unknownSpecies: string[];
    /** Item IDs missing from the engine's items. */
    unknownItems: string[];
    /** Files whose name the importer does not understand. */
    skipped: string[];
    /** Files that would overwrite another file from the same pack; not imported. */
    duplicates: string[];
    /** Rule folders that do not exist in this pack. */
    missingDirs: string[];
}

/** @brief Result of `planPack()`. */
export interface Plan
{
    files: PlannedFile[];
    report: PlanReport;
}

/**
 * @brief List the files of one rule's folder that have the rule's extension.
 * @param packDir Pack root.
 * @param rule Rule.
 * @return `null` if the folder is missing, else `[absolute dir, file names]`.
 */
function ruleFiles (packDir: string, rule: Rule): [string, string[]] | null
{
    const dir = findDir(packDir, rule.dir);
    if (!dir) return null;
    const names = fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === rule.ext)
        .map((entry) => entry.name)
        .sort();
    return [dir, names];
}

/**
 * @brief Plan the import of one pack.
 * @param packDir Pack root folder (extracted).
 * @param pack Pack layout.
 * @param dex Engine species/items, for Showdown IDs.
 * @param formNames PBS form names (`formKey` → name), usually from `readFormNames()`.
 * @param only If given, only rules with these `kind`s are planned.
 * @return Files to produce and a report.
 */
export function planPack (packDir: string, pack: PackDefinition, dex: DexIndex, formNames: Map<string, string>, only?: Set<string>): Plan
{
    const report: PlanReport = { unresolved: [], unknownSpecies: [], unknownItems: [], skipped: [], duplicates: [], missingDirs: [] };
    const files: PlannedFile[] = [];
    const taken = new Map<string, string>();
    const rel = (file: string) => path.relative(packDir, file).split(path.sep).join('/');
    const add = (src: string, dest: string, rule: Rule) =>
    {
        const previous = taken.get(dest);
        if (previous)
        {
            report.duplicates.push(`${rel(src)} → ${dest} (already filled by ${previous})`);
            return;
        }
        taken.set(dest, rel(src));
        files.push({ src, srcRel: rel(src), dest, kind: rule.kind, image: rule.image ?? null });
    };

    // Pokémon: gather every file first, because forms are resolved per species as a group.
    const found: { rule: Rule; src: string; name: AssetName }[] = [];
    for (const rule of pack.rules.filter((r) => r.target === 'pokemon'))
    {
        const listing = ruleFiles(packDir, rule);
        if (!listing)
        {
            if (!only || only.has(rule.kind)) report.missingDirs.push(rule.dir);
            continue;
        }
        for (const file of listing[1])
        {
            const stem = file.slice(0, -rule.ext.length);
            const name = pack.ignore?.some((pattern) => pattern.test(stem)) ? null : parseAssetName(stem);
            if (name) found.push({ rule, src: path.join(listing[0], file), name });
            else if (!only || only.has(rule.kind)) report.skipped.push(`${rule.dir}/${file}`);
        }
    }

    const resolver = new SpeciesResolver(dex, formNames, pack.forms);
    const resolved = resolver.assign(found.map((f) => f.name));
    for (const [key, where] of resolved)
    {
        const folder = where.forme ? `${where.species}/${where.forme}` : where.species;
        if (where.how === 'unresolved') report.unresolved.push(`${key} → ${folder}`);
        if (!where.known && !report.unknownSpecies.includes(where.species)) report.unknownSpecies.push(where.species);
    }

    // Numbered forms before `_female` variants, so a real forme folder is never taken by a gender sprite.
    found.sort((a, b) => Number(a.name.female) - Number(b.name.female) || a.src.localeCompare(b.src));
    for (const { rule, src, name } of found)
    {
        if (only && !only.has(rule.kind)) continue;
        const where = resolved.get(formKey(name.id, name.form))!;
        let forme = where.forme;
        let female = name.female;
        // Showdown treats some females as a forme of their own (Meowstic-F, Indeedee-F…).
        if (female && !forme && dex.species[`${where.species}f`]?.baseSpecies)
        {
            forme = 'f';
            female = false;
        }
        const output = (rule.output ?? `${rule.kind}{f}${rule.ext}`).replace('{f}', female ? 'f' : '');
        add(src, [POKEMON_DIR, where.species, ...(forme ? [forme] : []), output].join('/'), rule);
    }

    // Items.
    for (const rule of pack.rules.filter((r) => r.target === 'item'))
    {
        if (only && !only.has(rule.kind)) continue;
        const listing = ruleFiles(packDir, rule);
        if (!listing)
        {
            report.missingDirs.push(rule.dir);
            continue;
        }
        for (const file of listing[1])
        {
            const stem = file.slice(0, -rule.ext.length);
            const custom = pack.item?.(stem);
            if (custom === null)
            {
                report.skipped.push(`${rule.dir}/${file}`);
                continue;
            }
            const id = custom ?? toID(stem);
            if (custom === undefined && !dex.items.has(id)) report.unknownItems.push(id);
            add(path.join(listing[0], file), `${ITEMS_DIR}/${id}${rule.ext}`, rule);
        }
    }

    for (const list of Object.values(report)) (list as string[]).sort();
    return { files, report };
}
