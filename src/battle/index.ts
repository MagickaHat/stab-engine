/**
 * @file index.ts
 * @brief Public entry point of the battle system.
 *
 * Import from here in scenes: `import { BattleEngine, importTeam } from '../../battle';`
 */
export { BattleEngine } from './BattleEngine';
export type { AIKind, BattleEngineOptions, Perspective, PlayerOptions } from './BattleEngine';
export { BattleState, createGenerations } from './BattleState';
export { loadMod, isModLoaded, MOD_IDS } from './mods';
export type { ModID } from './mods';
export { importTeam, SAMPLE_TEAM_P1, SAMPLE_TEAM_P2 } from './teams';
export {
    describeLine, isMoveRequest, isSwitchRequest, isTeamPreviewRequest, isWaitRequest,
    parseHP, parseIdent, parseLine, parseTyped,
} from './protocol';
export { Protocol } from '@pkmn/protocol';
export type { Handler } from '@pkmn/protocol';
export type { HPStatus, PokemonIdent, ProtocolLine } from './protocol';
export type * from './types';
