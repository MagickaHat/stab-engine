/**
 * @file tiledProject.ts
 * @brief Writes the event classes and registry enums into a Tiled project, keeping everything else.
 *
 * Tiled keeps custom property types in the project file (`propertyTypes`).
 * This module turns `CLASS_SPECS` (src/events/tiled.ts) into Tiled classes
 * and the registries (registries.ts) into Tiled enums, so in Tiled the
 * object classes appear in the Class drop-down and their properties offer
 * the right values.
 *
 * Types it does not manage (ones you added in Tiled) are left alone, and
 * every type keeps its ID, so maps that use them stay valid.
 */
import { CLASS_SPECS, MAP_CLASS } from '../../src/events/tiled.ts';
import type { ClassSpec, EnumName } from '../../src/events/tiled.ts';
import type { Registries } from './registries.ts';

/** @brief A Tiled custom property type (enum or class). */
export interface TiledPropertyType
{
    id: number;
    name: string;
    type: 'enum' | 'class';
    [key: string]: unknown;
}

/** @brief A command in Tiled's Command menu. */
export interface TiledCommand
{
    name: string;
    [key: string]: unknown;
}

/** @brief The parts of a `.tiled-project` file touched here. */
export interface TiledProject
{
    propertyTypes?: TiledPropertyType[];
    commands?: TiledCommand[];
    [key: string]: unknown;
}

/** @brief Commands added to Tiled's Command menu. They run from the repository root. */
export const PROJECT_COMMANDS: TiledCommand[] = [
    {
        name: 'STAB: Validate events and maps', command: 'node', arguments: 'tools/events/validate.ts',
        workingDirectory: '%projectpath/../..', enabled: true, saveBeforeExecute: true, showOutput: true, shortcut: '',
    },
    {
        name: 'STAB: Sync registries', command: 'node', arguments: 'tools/events/sync-tiled.ts',
        workingDirectory: '%projectpath/../..', enabled: true, saveBeforeExecute: true, showOutput: true, shortcut: '',
    },
];

/**
 * @brief The Tiled class for a class spec.
 * @param spec The spec.
 * @param id Its ID in the project.
 * @param useAs What Tiled may use it for.
 */
function tiledClass (spec: ClassSpec, id: number, useAs: string[]): TiledPropertyType
{
    return {
        color: spec.color,
        drawFill: true,
        id,
        members: spec.members.map((member) => ({
            name: member.name,
            ...(member.enum ? { propertyType: member.enum } : {}),
            type: member.type,
            value: member.default,
        })),
        name: spec.name,
        type: 'class',
        useAs,
    };
}

/**
 * @brief Put the managed enums, classes and commands into a project.
 * @param project The project as read from disk (not changed).
 * @param registries Every list.
 * @return The new project.
 */
export function syncProject (project: TiledProject, registries: Registries): TiledProject
{
    const existing = project.propertyTypes ?? [];
    const enumNames = Object.keys(registries) as EnumName[];
    const managed = new Set<string>([...enumNames, ...CLASS_SPECS.map((spec) => spec.name), MAP_CLASS.name]);
    let nextId = Math.max(0, ...existing.map((type) => type.id)) + 1;
    const idOf = (name: string) => existing.find((type) => type.name === name)?.id ?? nextId++;

    const types: TiledPropertyType[] = existing.filter((type) => !managed.has(type.name));
    for (const name of enumNames)
    {
        types.push({ id: idOf(name), name, storageType: 'string', type: 'enum', values: registries[name], valuesAsFlags: false });
    }
    for (const spec of CLASS_SPECS) types.push(tiledClass(spec, idOf(spec.name), ['object']));
    types.push(tiledClass(MAP_CLASS, idOf(MAP_CLASS.name), ['map']));
    types.sort((a, b) => a.id - b.id);

    const commandNames = new Set(PROJECT_COMMANDS.map((command) => command.name));
    const commands = [...(project.commands ?? []).filter((command) => !commandNames.has(command.name)), ...PROJECT_COMMANDS];
    return { ...project, commands, propertyTypes: types };
}

/**
 * @brief A Tiled object template (`.tj`) for a class, so it can be dragged onto maps.
 * @param spec The class.
 * @param tileSize Tile size in pixels.
 * @return The template file's contents.
 */
export function objectTemplate (spec: ClassSpec, tileSize: number): object
{
    return {
        object: { height: tileSize, name: '', rotation: 0, type: spec.name, visible: true, width: tileSize },
        type: 'template',
    };
}

/**
 * @brief Format JSON the way Tiled writes it (four spaces).
 * @param value The data.
 * @return The text, ending with a newline.
 */
export function formatTiledJson (value: unknown): string
{
    return `${JSON.stringify(value, null, 4)}\n`;
}
