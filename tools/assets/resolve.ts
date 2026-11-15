/**
 * @file resolve.ts
 * @brief Turns Essentials names (`CHARIZARD_1`, `BLACKAUGURITE`) into the
 *        engine's Showdown IDs (`charizard` + `megax`, `blackaugurite`).
 *
 * The engine's own game data (`content/pbs`, generated + custom) is the
 * reference, so custom species and formes resolve the same way official ones do.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mergeTable, orderCustomFiles } from '../../src/data/merge.ts';
import type { Json } from '../../src/data/merge.ts';
import { formKey } from './essentials.ts';

/**
 * @brief Convert a name to a Showdown ID, exactly like Showdown's `toID()`.
 * @param text Any name, e.g. `"Mr. Mime"`.
 * @return Lowercase alphanumeric ID, e.g. `"mrmime"`.
 */
export function toID (text: unknown): string
{
    return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** @brief The pokedex fields the resolver reads. */
export interface DexSpecies
{
    name: string;
    baseSpecies?: string;
    forme?: string;
    baseForme?: string;
    cosmeticFormes?: string[];
}

/** @brief Species and item IDs known to the engine. */
export interface DexIndex
{
    species: Record<string, DexSpecies>;
    items: Set<string>;
}

/**
 * @brief Read one merged table (generated + custom layers) without validating it.
 * @param pbsDir `content/pbs`.
 * @param file Table file name, e.g. `'pokedex.json'`.
 * @return The merged table.
 */
function readTable (pbsDir: string, file: string): Record<string, Json>
{
    const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, Json>;
    const generated = path.join(pbsDir, 'generated', file);
    const customDir = path.join(pbsDir, 'custom');
    const custom = fs.existsSync(customDir)
        ? (fs.readdirSync(customDir, { recursive: true }) as string[]).map((f) => f.split(path.sep).join('/'))
        : [];
    const layers = orderCustomFiles(custom.filter((f) => f === file || f.endsWith(`/${file}`)));
    return mergeTable(fs.existsSync(generated) ? read(generated) : {}, ...layers.map((f) => read(path.join(customDir, f))));
}

/**
 * @brief Load the species and item IDs from `content/pbs`.
 * @param pbsDir `content/pbs`.
 * @return The index.
 */
export function loadDexIndex (pbsDir: string): DexIndex
{
    return {
        species: readTable(pbsDir, 'pokedex.json') as unknown as Record<string, DexSpecies>,
        items: new Set(Object.keys(readTable(pbsDir, 'items.json'))),
    };
}

/**
 * @brief A hand-written answer for names the resolver cannot work out.
 *
 * Keys are Essentials names: `'MAUSHOLD_1'` for one form, or `'ALCREMIE'`
 * with a function to cover every form of a species. Values are
 * `'<species id>'` or `'<species id>/<forme id>'`.
 */
export type FormAliases = Record<string, string | ((form: number) => string | undefined)>;

/** @brief Where one Essentials species/form goes. */
export interface Resolution
{
    /** Showdown ID of the base species (folder name). */
    species: string;
    /** Showdown ID of the forme (sub-folder name), `''` for the base forme. */
    forme: string;
    /**
     * How it was decided: `base` (form 0), `alias` (pack config), `name`
     * (PBS form name matched a forme), `unresolved` (kept as `form<N>`).
     */
    how: 'base' | 'alias' | 'name' | 'unresolved';
    /** `false` if the base species is not in the engine's pokedex. */
    known: boolean;
}

/** @brief Words in Essentials form names that Showdown leaves out of forme names. */
const FILLER = new Set([
    'form', 'forme', 'mode', 'style', 'cloak', 'size', 'drive', 'mask', 'face', 'sea', 'plumage', 'breed',
    'color', 'colour', 'rider', 'sword', 'shield', 'pattern', 'trim', 'flower', 'type', 'core', 'of', 'the',
]);

/** @brief Essentials wording → Showdown wording. */
const REWORD: Record<string, string> = {
    alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea',
    female: 'f', male: 'm', gigantamax: 'gmax',
};

/**
 * @brief Split a form/forme name into comparable words.
 * @param text e.g. `'Paldean (Combat Breed)'` or `'Paldea-Combat'`.
 * @return e.g. `['paldea', 'combat', 'breed']` / `['paldea', 'combat']`.
 */
export function formWords (text: string): string[]
{
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’.:%]/g, '')
        .split(/[^a-z0-9]+/).filter(Boolean).map((word) => REWORD[word] ?? word);
}

/** @brief One forme a form name can match. */
interface Candidate
{
    forme: string;
    words: Set<string>;
}

/**
 * @brief Resolves Essentials species/form pairs to Showdown species + forme IDs.
 */
export class SpeciesResolver
{
    private readonly dex: DexIndex;
    private readonly formNames: Map<string, string>;
    private readonly aliases: FormAliases;
    /** Base species name → IDs of its formes. */
    private readonly formesOf = new Map<string, string[]>();

    /**
     * @param dex Engine species/items.
     * @param formNames PBS form names (`formKey` → name).
     * @param aliases Pack-specific overrides.
     */
    constructor (dex: DexIndex, formNames: Map<string, string>, aliases: FormAliases)
    {
        this.dex = dex;
        this.formNames = formNames;
        this.aliases = aliases;
        for (const [id, entry] of Object.entries(dex.species))
        {
            if (!entry.baseSpecies || entry.baseSpecies === entry.name) continue;
            const list = this.formesOf.get(entry.baseSpecies) ?? [];
            list.push(id);
            this.formesOf.set(entry.baseSpecies, list);
        }
    }

    /**
     * @brief Look up a pack alias.
     * @param id Essentials species ID.
     * @param form Form number.
     * @return `[species, forme]`, or `null` if there is no alias.
     */
    private alias (id: string, form: number): [string, string] | null
    {
        const exact = this.aliases[formKey(id, form)];
        const whole = this.aliases[id];
        const target = typeof exact === 'string' ? exact : typeof whole === 'function' ? whole(form) : undefined;
        if (!target) return null;
        const [species, forme = ''] = target.split('/');
        return [species, forme];
    }

    /**
     * @brief List the formes of a species that a form name may refer to.
     * @param base Pokedex entry of the base species.
     * @return Candidates; the base forme (if it has a name) is `forme: ''`.
     */
    private candidates (base: DexSpecies): Candidate[]
    {
        const list: Candidate[] = [];
        const add = (forme: string, label: string) =>
        {
            if (label && !list.some((c) => c.forme === forme)) list.push({ forme, words: new Set(formWords(label)) });
        };
        add('', base.baseForme ?? '');
        for (const id of this.formesOf.get(base.name) ?? [])
        {
            const entry = this.dex.species[id];
            const label = entry.forme ?? entry.name.slice(base.name.length + 1);
            add(toID(label), label);
        }
        for (const name of base.cosmeticFormes ?? [])
        {
            const label = name.slice(base.name.length + 1);
            add(toID(label), label);
        }
        return list;
    }

    /**
     * @brief Match an Essentials form name against a species' formes.
     *
     * A forme matches when all of its words appear in the form name
     * (`Galarian Standard Mode` → `Galar`); the forme with the most words
     * wins (`Galarian Zen Mode` → `Galar-Zen`). On a tie the base forme
     * gives way (`Galarian Standard Mode` is `Galar`, not Darmanitan's base
     * `Standard`); any other tie is not guessed.
     *
     * @param base Pokedex entry of the base species.
     * @param formName Essentials form name.
     * @return The forme ID (`''` for the base forme), or `null`.
     */
    private matchName (base: DexSpecies, formName: string): string | null
    {
        const own = new Set(formWords(base.name));
        const all = formWords(formName).filter((word) => !own.has(word));
        const words = new Set(all.filter((word) => !FILLER.has(word)));
        if (!words.size) return null;
        let best: Candidate[] = [];
        for (const candidate of this.candidates(base))
        {
            if (![...candidate.words].every((word) => words.has(word) || all.includes(word))) continue;
            if (!best.length || candidate.words.size > best[0].words.size) best = [candidate];
            else if (candidate.words.size === best[0].words.size) best.push(candidate);
        }
        if (best.length > 1) best = best.filter((candidate) => candidate.forme !== '');
        return best.length === 1 ? best[0].forme : null;
    }

    /**
     * @brief Resolve every form of the given species at once.
     *
     * Resolving together lets better evidence win: aliases claim their
     * folder first, then form names, and two forms of a species never share
     * one folder. Forms that are left over are not guessed: they go to a
     * `form<N>` folder and are reported, because a wrong name is worse than
     * no name.
     *
     * @param pairs Every Essentials species/form that has at least one asset.
     * @return `formKey` → where it goes.
     */
    assign (pairs: { id: string; form: number }[]): Map<string, Resolution>
    {
        const result = new Map<string, Resolution>();
        /** Folder → the Essentials ID that owns it. */
        const claimed = new Map<string, { id: string; alias: boolean }>();
        const claim = (id: string, form: number, species: string, forme: string, how: Resolution['how'], known: boolean): boolean =>
        {
            const folder = `${species}/${forme}`;
            const owner = claimed.get(folder);
            // Two different Essentials IDs may share a folder when an alias says so (e.g. a misspelt file name).
            if (owner && (owner.id === id || !(owner.alias || how === 'alias'))) return false;
            if (!owner) claimed.set(folder, { id, alias: how === 'alias' });
            result.set(formKey(id, form), { species, forme, how, known });
            return true;
        };
        const sorted = [...new Map(pairs.map((p) => [formKey(p.id, p.form), p])).values()]
            .sort((a, b) => a.id.localeCompare(b.id) || a.form - b.form);
        const baseOf = (id: string) =>
        {
            const species = this.alias(id, 0)?.[0] ?? toID(id);
            return { species, entry: this.dex.species[species] as DexSpecies | undefined };
        };

        // 1. Aliases.
        for (const { id, form } of sorted)
        {
            const alias = this.alias(id, form);
            if (alias) claim(id, form, alias[0], alias[1], 'alias', true);
        }
        // 2. PBS form names. Form 0 keeps the base folder unless its name says otherwise.
        for (const { id, form } of sorted)
        {
            const key = formKey(id, form);
            if (result.has(key)) continue;
            const { species, entry } = baseOf(id);
            const formName = this.formNames.get(key);
            const forme = entry && formName ? this.matchName(entry, formName) : null;
            if (forme !== null && claim(id, form, species, forme, forme === '' && form === 0 ? 'base' : 'name', true)) continue;
            if (form === 0) claim(id, form, species, '', 'base', Boolean(entry));
        }
        // 3. Everything else keeps its form number.
        for (const { id, form } of sorted)
        {
            if (result.has(formKey(id, form))) continue;
            const { species, entry } = baseOf(id);
            claim(id, form, species, `form${form}`, 'unresolved', Boolean(entry));
        }
        return result;
    }
}
