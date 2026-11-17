/**
 * @file index.ts
 * @brief Public entry point of the event and scripting system.
 *
 * Import from here in scenes: `import { EventManager, TextStore } from '../../events';`
 * See docs/EVENT_SYSTEM.md.
 */
export * from './schema.ts';
export {
    compileCommands, compileFile, compileFiles, compileScript, emptyBundle, formatIssue, mergeBundles, YES_NO_KEYS,
} from './compile.ts';
export type {
    BattleTargets, CompileIssue, CompiledHook, CompiledListener, CompiledPage, CompiledScript, EventBundle, Instruction,
    PlainCommand,
} from './compile.ts';
export { compare, evaluate, resolveNumber, resolveValue, storyReached } from './conditions.ts';
export type { EvalContext, EventRef } from './conditions.ts';
export { DIRECTION_DELTA, OPPOSITE, directionTowards, findPath } from './pathfinding.ts';
export type { PathOptions } from './pathfinding.ts';
export { FALLBACK_LOCALE, TextStore, parseCsv, parseLocaleCsv } from './text.ts';
export type { TextContext } from './text.ts';
export { buildTrainerTeam, resolveLevel, trainerSet } from './trainers.ts';
export type { BuiltTeam, TrainerData } from './trainers.ts';
export {
    CLASS_SPECS, FIXED_ENUMS, MAP_CLASS, buildScript, factoryFor, instantiateMap, objectLayers, readProperties,
    registerFactory, toMapObject, withDefaults,
} from './tiled.ts';
export type {
    ClassSpec, EnumName, FactoryContext, MapEvents, MapObject, MemberSpec, ObjectFactory, SpawnPoint, TiledLayer, TiledMap,
    TiledObject, TiledProperty,
} from './tiled.ts';
export { EventManager } from './runtime/EventManager.ts';
export type { EventManagerOptions, NativeFunction } from './runtime/EventManager.ts';
export { GameEvent } from './runtime/GameEvent.ts';
export type { EventDefinition } from './runtime/GameEvent.ts';
export { Interpreter, SYSTEM_TEXT_KEYS, WORLD_ONLY_COMMANDS } from './runtime/Interpreter.ts';
export type { Frame } from './runtime/Interpreter.ts';
export { BattleHookRunner, hookMatches, momentsOf } from './runtime/battleHooks.ts';
export type { HookMoment } from './runtime/battleHooks.ts';
export { neighbour, runRoute } from './runtime/route.ts';
export type { RouteContext } from './runtime/route.ts';
export type { Actor, BattleRequest, RuntimeData, WarpRequest, WorldHost } from './runtime/host.ts';
export * from './registry/index.ts';
