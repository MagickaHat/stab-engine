/**
 * @file species.ts
 * @brief Converts PokeAPI Pokémon/species/forms to Showdown's `Pokedex`
 *        format (`pokedex.json`) plus engine-only data (`species_info.json`).
 *
 * PokeAPI model → Showdown model:
 * - a PokeAPI *pokemon* (battle-distinct: Charizard, Charizard-Mega-X) is a
 *   Showdown species/forme entry;
 * - extra PokeAPI *forms* of one pokemon (Unown B, Vivillon patterns) are
 *   Showdown `cosmeticFormes`.
 *
 * Must run after abilities, items and moves (evolutions reference them).
 */
import { Dex } from '@pkmn/sim';
import { bool, int } from '../csv.ts';
import type { Row } from '../csv.ts';
import type { ImportContext, Named } from '../context.ts';
import { SpeciesNamer, titleCase, toID } from '../ids.ts';
import type { StatsCheck } from '../ids.ts';
import { STAT_BY_ID } from './basic.ts';

/** @brief PokeAPI egg group → Showdown egg group name. */
export const EGG_GROUPS: Record<string, string> = {
    'monster': 'Monster', 'water1': 'Water 1', 'bug': 'Bug', 'flying': 'Flying', 'ground': 'Field',
    'fairy': 'Fairy', 'plant': 'Grass', 'humanshape': 'Human-Like', 'water3': 'Water 3',
    'mineral': 'Mineral', 'indeterminate': 'Amorphous', 'water2': 'Water 2', 'ditto': 'Ditto',
    'dragon': 'Dragon', 'no-eggs': 'Undiscovered',
};

/** @brief Regional form identifiers: these inherit the base species' evolution line. */
const REGIONAL_FORMS = new Set(['alola', 'galar', 'hisui', 'paldea']);

/** @brief Result of `convertSpecies()`. */
export interface SpeciesTables
{
    pokedex: Record<string, Record<string, unknown>>;
    speciesInfo: Record<string, Record<string, unknown>>;
}

/** @brief Everything known about one PokeAPI pokemon while converting. */
interface Mon
{
    row: Row;
    species: Row;
    form: Row | undefined;
    stats: Record<string, number>;
    evs: Record<string, number>;
    named?: Named;
}

/**
 * @brief Build an English evolution condition and Showdown evo fields from a `pokemon_evolution` row.
 * @param row Evolution row.
 * @param ctx Import context.
 * @param lookups Name lookups.
 * @return Showdown fields (`evoType`, `evoLevel`, …) and the structured method.
 */
function describeEvolution (row: Row, ctx: ImportContext, lookups: Lookups): { showdown: Record<string, unknown>; method: Record<string, unknown> }
{
    const trigger = lookups.triggers.get(row.evolution_trigger_id) ?? 'unclassified';
    const sd: Record<string, unknown> = {};
    const method: Record<string, unknown> = { trigger };
    const conditions: string[] = [];

    const level = int(row.minimum_level);
    const item = ctx.items.get(row.trigger_item_id);
    const held = ctx.items.get(row.held_item_id);
    const move = ctx.moves.get(row.known_move_id);
    const moveType = ctx.typeName.get(row.known_move_type_id);
    const happiness = int(row.minimum_happiness);
    const location = lookups.locations.get(row.location_id);
    const gender = row.gender_id === '1' ? 'F' : row.gender_id === '2' ? 'M' : undefined;
    const time = row.time_of_day || undefined;

    if (level) method.minLevel = level;
    if (item) method.item = item.id;
    if (held) method.heldItem = held.id;
    if (gender) method.gender = gender;
    if (location) method.location = location;
    if (time) method.timeOfDay = time;
    if (move) method.knownMove = move.id;
    if (moveType) method.knownMoveType = moveType;
    if (happiness) method.minHappiness = happiness;
    if (int(row.minimum_beauty)) method.minBeauty = int(row.minimum_beauty);
    if (int(row.minimum_affection)) method.minAffection = int(row.minimum_affection);
    if (row.relative_physical_stats) method.relativePhysicalStats = int(row.relative_physical_stats);
    const party = lookups.speciesDefault.get(row.party_species_id);
    if (party) method.partySpecies = party.id;
    const partyType = ctx.typeName.get(row.party_type_id);
    if (partyType) method.partyType = partyType;
    const tradeFor = lookups.speciesDefault.get(row.trade_species_id);
    if (tradeFor) method.tradeSpecies = tradeFor.id;
    if (bool(row.needs_overworld_rain)) method.needsOverworldRain = true;
    if (bool(row.turn_upside_down)) method.turnUpsideDown = true;
    const usedMove = ctx.moves.get(row.used_move_id);
    if (usedMove) method.usedMove = usedMove.id;
    if (int(row.minimum_move_count)) method.minMoveCount = int(row.minimum_move_count);
    if (int(row.minimum_steps)) method.minSteps = int(row.minimum_steps);
    if (int(row.minimum_damage_taken)) method.minDamageTaken = int(row.minimum_damage_taken);

    // English text for Showdown's evoCondition (UI text should use the structured data + locales).
    if (time) conditions.push(time === 'day' ? 'during the day' : time === 'night' ? 'at night' : `at ${time}`);
    if (location) conditions.push(`at ${titleCase(location).replace(/-/g, ' ')}`);
    if (gender) conditions.push(gender === 'F' ? 'if female' : 'if male');
    if (moveType) conditions.push(`knowing a ${moveType} move`);
    if (party) conditions.push(`with ${party.name} in party`);
    if (partyType) conditions.push(`with a ${partyType}-type in party`);
    if (tradeFor) conditions.push(`when traded for ${tradeFor.name}`);
    if (bool(row.needs_overworld_rain)) conditions.push('while raining');
    if (bool(row.turn_upside_down)) conditions.push('with the console upside-down');
    if (method.minBeauty) conditions.push('with high Beauty');
    if (method.minAffection) conditions.push('with high Affection');
    if (method.relativePhysicalStats !== undefined)
    {
        conditions.push(['with Atk < Def', 'with Atk = Def', 'with Atk > Def'][Number(method.relativePhysicalStats) + 1]);
    }
    if (usedMove) conditions.push(`after using ${usedMove.name}${method.minMoveCount ? ` ${method.minMoveCount} times` : ''}`);
    if (method.minSteps) conditions.push(`after walking ${method.minSteps} steps`);
    if (method.minDamageTaken) conditions.push(`after losing ${method.minDamageTaken}+ HP`);

    switch (trigger)
    {
        case 'level-up':
            if (happiness) sd.evoType = 'levelFriendship';
            else if (held) { sd.evoType = 'levelHold'; sd.evoItem = held.name; }
            else if (move) { sd.evoType = 'levelMove'; sd.evoMove = move.name; }
            else if (!level && conditions.length) sd.evoType = 'levelExtra';
            if (level) sd.evoLevel = level;
            break;
        case 'trade':
            sd.evoType = 'trade';
            if (held) sd.evoItem = held.name;
            break;
        case 'use-item':
            sd.evoType = 'useItem';
            if (item) sd.evoItem = item.name;
            break;
        default:
            sd.evoType = 'other';
            conditions.unshift(titleCase(trigger).replace(/-/g, ' '));
    }
    if (conditions.length) sd.evoCondition = conditions.join(', ');
    return { showdown: sd, method };
}

/** @brief Name lookups shared by the evolution helpers. */
interface Lookups
{
    triggers: Map<string, string>;
    locations: Map<string, string>;
    /** species id → its default pokemon's Showdown name. */
    speciesDefault: Map<string, Named>;
}

/**
 * @brief Build `pokedex.json` and `species_info.json`. Fills `ctx.species`.
 * @param ctx Import context.
 * @return Both tables.
 */
export function convertSpecies (ctx: ImportContext): SpeciesTables
{
    const csv = ctx.csv;
    const speciesRows = csv.byId('pokemon_species');
    const colors = new Map(csv.get('pokemon_colors').map((r) => [r.id, titleCase(r.identifier)]));
    const shapes = new Map(csv.get('pokemon_shapes').map((r) => [r.id, r.identifier]));
    const habitats = new Map(csv.get('pokemon_habitats').map((r) => [r.id, r.identifier]));
    const growthRates = new Map(csv.get('growth_rates').map((r) => [r.id, r.identifier]));
    const eggGroupNames = new Map(csv.get('egg_groups').map((r) => [r.id, r.identifier]));
    const eggGroups = ctx.group('pokemon_egg_groups', 'species_id');
    const types = ctx.group('pokemon_types', 'pokemon_id');
    const abilities = ctx.group('pokemon_abilities', 'pokemon_id');
    const forms = ctx.group('pokemon_forms', 'pokemon_id');
    const englishSpecies = ctx.primaryNames('pokemon_species_names', 'pokemon_species_id');
    const itemByIdentifier = new Map(csv.get('items').map((r) => [r.identifier, ctx.items.get(r.id)]));

    // ---- gather -------------------------------------------------------------
    const mons: Mon[] = [];
    const statRows = ctx.group('pokemon_stats', 'pokemon_id');
    for (const row of csv.get('pokemon'))
    {
        const stats: Record<string, number> = {};
        const evs: Record<string, number> = {};
        for (const s of statRows.get(row.id) ?? [])
        {
            stats[STAT_BY_ID[s.stat_id]] = Number(s.base_stat);
            if (Number(s.effort) > 0) evs[STAT_BY_ID[s.stat_id]] = Number(s.effort);
        }
        const form = (forms.get(row.id) ?? []).find((f) => f.is_default === '1');
        mons.push({ row, species: speciesRows.get(row.species_id)!, form, stats, evs });
    }

    // ---- names: exact matches first, then fuzzy, then built names ----------
    const namer = new SpeciesNamer();
    const ordered = [...mons].sort((a, b) => Number(b.row.is_default) - Number(a.row.is_default) || Number(a.row.id) - Number(b.row.id));
    const stats = (mon: Mon) => mon.stats as unknown as StatsCheck;
    for (const mon of ordered) mon.named = namer.exact(mon.row.identifier, mon.species.identifier, mon.row.is_default === '1', stats(mon)) ?? undefined;
    for (const mon of ordered) mon.named ??= namer.fuzzy(mon.row.identifier, stats(mon)) ?? undefined;
    for (const mon of ordered) mon.named ??= namer.exact(mon.row.identifier, mon.species.identifier, mon.row.is_default === '1', null) ?? undefined;
    const defaultOf = new Map<string, Mon>();
    for (const mon of ordered)
    {
        if (mon.row.is_default === '1')
        {
            mon.named ??= namer.fallback(englishSpecies.get(mon.species.id) ?? titleCase(mon.species.identifier), '');
            defaultOf.set(mon.species.id, mon);
        }
    }
    for (const mon of ordered)
    {
        if (mon.named) continue;
        const base = defaultOf.get(mon.species.id)!.named!.name;
        const formId = mon.form?.form_identifier || mon.row.identifier.replace(`${mon.species.identifier}-`, '');
        mon.named = namer.fallback(base, formId);
        ctx.warn(`pokedex: "${mon.row.identifier}" is not in Showdown; named "${mon.named.name}"`);
    }
    for (const mon of mons) ctx.species.set(mon.row.id, mon.named!);

    const lookups: Lookups = {
        triggers: new Map(csv.get('evolution_triggers').map((r) => [r.id, r.identifier])),
        locations: new Map(csv.get('locations').map((r) => [r.id, r.identifier])),
        speciesDefault: new Map([...defaultOf].map(([id, mon]) => [id, mon.named!])),
    };

    // ---- build entries ------------------------------------------------------
    const pokedex: Record<string, Record<string, unknown>> = {};
    const speciesInfo: Record<string, Record<string, unknown>> = {};
    for (const mon of [...mons].sort((a, b) => Number(a.row.order || 1e9) - Number(b.row.order || 1e9)))
    {
        const { row, species, form, named } = mon;
        const { id, name } = named!;
        const isDefault = row.is_default === '1';
        const base = defaultOf.get(species.id)!;
        const entry: Record<string, unknown> = { num: Number(species.id), name };

        if (!isDefault)
        {
            const baseName = base.named!.name;
            entry.baseSpecies = baseName;
            entry.forme = name.startsWith(`${baseName}-`) ? name.slice(baseName.length + 1) : titleCase(form?.form_identifier ?? '');
        }
        else if (form?.form_identifier)
        {
            entry.baseForme = titleCase(form.form_identifier);
        }

        entry.types = (types.get(row.id) ?? [])
            .sort((a, b) => Number(a.slot) - Number(b.slot))
            .map((t) => ctx.typeName.get(t.type_id));

        const genderRate = Number(species.gender_rate);
        if (genderRate === -1) entry.gender = 'N';
        else if (genderRate === 0) entry.gender = 'M';
        else if (genderRate === 8) entry.gender = 'F';
        else if (genderRate !== 4) entry.genderRatio = { M: (8 - genderRate) / 8, F: genderRate / 8 };

        entry.baseStats = { hp: mon.stats.hp, atk: mon.stats.atk, def: mon.stats.def, spa: mon.stats.spa, spd: mon.stats.spd, spe: mon.stats.spe };

        const slots: Record<string, string> = {};
        for (const a of abilities.get(row.id) ?? [])
        {
            const ability = ctx.abilities.get(a.ability_id);
            if (!ability) continue;
            const slot = a.is_hidden === '1' ? 'H' : a.slot === '1' ? '0' : a.slot === '2' ? '1' : 'H';
            slots[slot] = ability.name;
        }
        if (!slots['0'])
        {
            ctx.warn(`pokedex: "${row.identifier}" has no abilities in PokeAPI; using "No Ability"`);
            slots['0'] = 'No Ability';
        }
        entry.abilities = slots;
        entry.heightm = Number(row.height) / 10;
        entry.weightkg = Number(row.weight) / 10;
        entry.color = colors.get(species.color_id) ?? 'Black';
        entry.eggGroups = (eggGroups.get(species.id) ?? []).map((g) => EGG_GROUPS[eggGroupNames.get(g.egg_group_id) ?? ''] ?? 'Undiscovered');
        if (!(entry.eggGroups as string[]).length) entry.eggGroups = ['Undiscovered'];

        // Battle-only formes and their required items.
        const formIdentifier = form?.form_identifier ?? '';
        if (!isDefault && /(^|-)gmax$/.test(formIdentifier)) entry.changesFrom = base.named!.name;
        else if (!isDefault && form?.is_battle_only === '1') entry.battleOnly = base.named!.name;
        if (form?.is_mega === '1')
        {
            const suffix = formIdentifier.replace(/^mega-?/, '');
            const stone = itemByIdentifier.get(`${species.identifier}ite${suffix ? `-${suffix}` : ''}`);
            if (stone) entry.requiredItem = stone.name;
        }

        if (species.is_mythical === '1') entry.tags = ['Mythical'];
        entry.gen = isDefault ? Number(species.generation_id) : ctx.genOf(form?.introduced_in_version_group_id) ?? Number(species.generation_id);
        pokedex[id] = entry;

        speciesInfo[id] = {
            catchRate: Number(species.capture_rate),
            baseExp: int(row.base_experience),
            evYield: mon.evs,
            growthRate: growthRates.get(species.growth_rate_id) ?? 'medium',
            hatchCycles: int(species.hatch_counter),
            baseFriendship: int(species.base_happiness),
            hasGenderDifferences: bool(species.has_gender_differences),
            isBaby: bool(species.is_baby),
            isLegendary: bool(species.is_legendary),
            isMythical: bool(species.is_mythical),
            shape: shapes.get(species.shape_id) ?? null,
            habitat: habitats.get(species.habitat_id) ?? null,
            formsSwitchable: bool(species.forms_switchable),
            order: int(row.order) ?? undefined,
        };

        // Cosmetic formes: extra PokeAPI forms of this same pokemon.
        const cosmetic = (forms.get(row.id) ?? [])
            .filter((f) => f.is_default !== '1' && f.form_identifier)
            .sort((a, b) => Number(a.form_order) - Number(b.form_order))
            .map((f) =>
            {
                const sd = Dex.species.get(toID(f.identifier));
                return sd.exists && sd.baseSpecies === name ? sd.name : `${name}-${titleCase(f.form_identifier)}`;
            });
        if (cosmetic.length) entry.cosmeticFormes = cosmetic;
    }

    // Other formes and forme order on base species.
    for (const mon of mons)
    {
        if (mon.row.is_default !== '1') continue;
        const entry = pokedex[mon.named!.id];
        const others = mons
            .filter((m) => m.species.id === mon.species.id && m.row.is_default !== '1')
            .sort((a, b) => Number(a.row.order || 1e9) - Number(b.row.order || 1e9))
            .map((m) => m.named!.name);
        if (others.length) entry.otherFormes = others;
        const cosmetic = (entry.cosmeticFormes as string[] | undefined) ?? [];
        if (others.length || cosmetic.length) entry.formeOrder = [entry.name, ...others, ...cosmetic];
    }

    // ---- evolutions ---------------------------------------------------------
    const evoRows = ctx.group('pokemon_evolution', 'evolved_species_id');
    const formPokemon = new Map(csv.get('pokemon_forms').map((f) => [f.id, f.pokemon_id]));
    const link = (from: string, to: string) =>
    {
        const parent = pokedex[from];
        const child = pokedex[to];
        if (!parent || !child || child.prevo) return;
        child.prevo = parent.name;
        const evos = (parent.evos as string[] | undefined) ?? [];
        if (!evos.includes(child.name as string)) parent.evos = [...evos, child.name];
    };

    for (const [speciesId, rows] of evoRows)
    {
        const species = speciesRows.get(speciesId);
        if (!species?.evolves_from_species_id) continue;
        const preferred = rows.find((r) => r.is_default === '1') ?? rows[0];
        const methods: Record<string, unknown>[] = [];
        const seen = new Set<string>();

        for (const row of rows)
        {
            const fromMon = row.required_pokemon_form_id
                ? ctx.species.get(formPokemon.get(row.required_pokemon_form_id) ?? '')
                : defaultOf.get(species.evolves_from_species_id)?.named;
            const toMon = row.evolved_pokemon_form_id
                ? ctx.species.get(formPokemon.get(row.evolved_pokemon_form_id) ?? '')
                : defaultOf.get(speciesId)?.named;
            if (!fromMon || !toMon) continue;

            const { showdown, method } = describeEvolution(row, ctx, lookups);
            if (row === preferred || !pokedex[toMon.id].prevo)
            {
                link(fromMon.id, toMon.id);
                if (row === preferred) Object.assign(pokedex[toMon.id], showdown);
            }
            const full = { into: toMon.id, ...method };
            const key = `${fromMon.id}|${JSON.stringify(full)}`;
            if (!seen.has(key))
            {
                seen.add(key);
                methods.push(full);
                const info = speciesInfo[fromMon.id];
                info.evolutions = [...((info.evolutions as unknown[]) ?? []), full];
            }
        }
        if (!methods.length) ctx.warn(`pokedex: could not resolve evolution into species ${species.identifier}`);
    }

    // Regional formes inherit the evolution line (Raichu-Alola ← Pikachu, Sandslash-Alola ← Sandshrew-Alola).
    for (const mon of mons)
    {
        const region = mon.form?.form_identifier;
        if (mon.row.is_default === '1' || !region || !REGIONAL_FORMS.has(region)) continue;
        const parentSpecies = mon.species.evolves_from_species_id;
        if (!parentSpecies || pokedex[mon.named!.id].prevo) continue;
        const regionalParent = mons.find((m) => m.species.id === parentSpecies && m.form?.form_identifier === region);
        const parent = regionalParent ?? defaultOf.get(parentSpecies);
        if (parent) link(parent.named!.id, mon.named!.id);
    }

    // Evolution info lives on the evolved Pokémon in Showdown; copy it to regional formes too.
    for (const entry of Object.values(pokedex))
    {
        if (entry.prevo && !entry.evoType && !entry.evoLevel && entry.baseSpecies)
        {
            const base = pokedex[toID(entry.baseSpecies)];
            for (const field of ['evoType', 'evoLevel', 'evoItem', 'evoMove', 'evoCondition'])
            {
                if (base?.[field] !== undefined) entry[field] = base[field];
            }
        }
    }

    // ---- text ---------------------------------------------------------------
    const formNames = ctx.group('pokemon_form_names', 'pokemon_form_id');
    for (const mon of mons)
    {
        const id = mon.named!.id;
        if (mon.row.is_default === '1')
        {
            for (const row of csv.get('pokemon_species_names').filter((r) => r.pokemon_species_id === mon.species.id))
            {
                ctx.addText('pokemon', row.local_language_id, `pokemon.${id}.name`, row.name);
                ctx.addText('pokemon', row.local_language_id, `pokemon.${id}.genus`, row.genus);
            }
        }
        for (const row of formNames.get(mon.form?.id ?? '') ?? [])
        {
            ctx.addText('pokemon', row.local_language_id, `pokemon.${id}.form`, row.form_name);
            if (mon.row.is_default !== '1') ctx.addText('pokemon', row.local_language_id, `pokemon.${id}.name`, row.pokemon_name);
        }
    }
    ctx.importFlavor('pokemon', 'pokemon_species_flavor_text', 'species_id', (speciesId) =>
    {
        const mon = defaultOf.get(speciesId);
        return mon ? `pokemon.${mon.named!.id}.flavor` : null;
    });

    return { pokedex, speciesInfo };
}
