/**
 * @file registries.ts
 * @brief Collects every list scripts and maps refer to: the code registries, game data and content.
 *
 * | List             | Read from                                                   |
 * |------------------|-------------------------------------------------------------|
 * | Flag, Variable   | src/events/registry/flags.ts, variables.ts                  |
 * | StoryMilestone   | src/events/registry/story.ts                                |
 * | Emote, Native    | src/events/registry/emotes.ts, natives.ts                   |
 * | Item, Species, Move | content/pbs/generated + content/pbs/custom (merged)      |
 * | TrainerId, Script, CommonEvent | the event files (content/events, content/trainers) |
 * | InkStory, InkKnot | content/dialogue/*.ink                                     |
 * | TextKey          | content/locales/<category>/en.csv                           |
 * | Map              | src/tiled/maps/**\/*.tmj                                     |
 * | Picture          | public/assets/img/pictures/*.png                            |
 *
 * `npm run events:sync-tiled` writes these into the Tiled project and
 * `npm run events:validate` checks scripts and maps against them.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { EventBundle } from '../../src/events/compile.ts';
import { EMOTES } from '../../src/events/registry/emotes.ts';
import { FLAGS } from '../../src/events/registry/flags.ts';
import { NATIVES } from '../../src/events/registry/natives.ts';
import { STORY } from '../../src/events/registry/story.ts';
import { VARIABLES } from '../../src/events/registry/variables.ts';
import { FIXED_ENUMS } from '../../src/events/tiled.ts';
import type { EnumName } from '../../src/events/tiled.ts';
import { FALLBACK_LOCALE, parseLocaleCsv } from '../../src/events/text.ts';
import { readCustomLayers, readTables } from '../pbs/io.ts';
import { CUSTOM_DIR, GENERATED_DIR } from '../pokeapi/config.ts';
import {DIALOGUE_DIR, listFiles, loadEvents, LOCALES_DIR, mapId, MAPS_DIR, PICTURES_DIR} from './content.ts';

/** @brief Every list, by enum name, each sorted (except fixed enums, which keep their order). */
export type Registries = Record<EnumName, string[]>;

/**
 * @brief The IDs of a PBS table after the custom layers are applied.
 * @param table Table name, e.g. `items`.
 * @return Sorted IDs.
 */
export function pbsIds (table: 'items' | 'pokedex' | 'moves'): string[]
{
    const ids = new Set(Object.keys(readTables(GENERATED_DIR)[table] ?? {}));
    for (const layer of readCustomLayers(CUSTOM_DIR))
    {
        for (const [id, value] of Object.entries(layer.tables[table] ?? {}))
        {
            if (id.startsWith('$')) continue;
            if (value === null) ids.delete(id);
            else ids.add(id);
        }
    }
    return [...ids].sort();
}

/**
 * @brief The knots of an ink story, following its `INCLUDE`s.
 * @param file Absolute path of the `.ink` file.
 * @param seen Files already read (to stop include loops).
 * @return Knot names (functions excluded), in file order.
 */
export function inkKnots (file: string, seen = new Set<string>()): string[]
{
    if (seen.has(file) || !fs.existsSync(file)) return [];
    seen.add(file);
    const knots: string[] = [];
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/))
    {
        const include = /^\s*INCLUDE\s+(.+?)\s*$/.exec(line);
        if (include) knots.push(...inkKnots(path.resolve(path.dirname(file), include[1]), seen));
        const knot = /^\s*={2,}\s*(function\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
        if (knot && !knot[1]) knots.push(knot[2]);
    }
    return knots;
}

/**
 * @brief The text keys in the English locale files.
 * @return Sorted keys.
 */
export function textKeys (): string[]
{
    const keys = new Set<string>();
    for (const file of listFiles(LOCALES_DIR, ['.csv']))
    {
        if (path.basename(file, '.csv') !== FALLBACK_LOCALE) continue;
        for (const key of Object.keys(parseLocaleCsv(fs.readFileSync(file, 'utf-8')))) keys.add(key);
    }
    return [...keys].sort();
}

/**
 * @brief Collect every list.
 * @param bundle Compiled event files. Default: compiled now from disk.
 * @return The lists.
 */
export function collectRegistries (bundle: EventBundle = loadEvents().bundle): Registries
{
    const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
    const stories = listFiles(DIALOGUE_DIR, ['.ink']);
    return {
        Flag: sorted(Object.keys(FLAGS)),
        Variable: sorted(Object.keys(VARIABLES)),
        Item: pbsIds('items'),
        Species: pbsIds('pokedex'),
        Move: pbsIds('moves'),
        TrainerId: sorted(Object.keys(bundle.trainers)),
        StoryMilestone: Object.values(STORY).flat(),
        StoryTrack: Object.keys(STORY),
        InkStory: sorted(stories.map((file) => path.basename(file, '.ink'))),
        InkKnot:
            sorted(stories.flatMap((file) => inkKnots(file).map((knot) => `${path.basename(file, '.ink')}.${knot}`))),
        TextKey: textKeys(),
        Script: sorted(Object.keys(bundle.scripts)),
        CommonEvent: sorted(Object.keys(bundle.common)),
        Map: sorted(listFiles(MAPS_DIR, ['.tmj']).map(mapId)),
        TriggerType: [...FIXED_ENUMS.TriggerType!],
        Direction: [...FIXED_ENUMS.Direction!],
        MoveType: [...FIXED_ENUMS.MoveType!],
        Emote: Object.keys(EMOTES),
        Native: sorted(Object.keys(NATIVES)),
        Picture: sorted(
            listFiles(PICTURES_DIR, ['.png'])
                .map((file) => path.relative(PICTURES_DIR, file).split(path.sep).join('/').replace(/\.png$/, ''))),
    };
}
