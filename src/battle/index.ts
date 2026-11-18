/**
 * @file index.ts
 * @brief Public entry point of the battle system.
 *
 * Import from here in scenes: `import { BattleEngine, importTeam } from '../../battle';`
 */
export { BattleEngine } from './BattleEngine.ts';
export type { AIKind, BattleEngineOptions, Perspective, PlayerOptions } from './BattleEngine.ts';
export { BattleState, createGenerations } from './BattleState.ts';
export { loadMod, isModLoaded, MOD_IDS } from './mods.ts';
export type { ModID } from './mods.ts';
export { importTeam, SAMPLE_TEAM_P1, SAMPLE_TEAM_P2 } from './teams.ts';
export {
    describeLine, isMoveRequest, isSwitchRequest, isTeamPreviewRequest, isWaitRequest,
    parseHP, parseIdent, parseLine, parseTyped,
} from './protocol.ts';
export {
    createBattleNarrator, decodeTextMessage, encodeTextMessage, englishMessage, narrateLine, ENGLISH_BATTLE_MESSAGES,
} from './text.ts';
export type { BattleNarrator, NarratorOptions } from './text.ts';
export { Protocol } from '@pkmn/protocol';
export type { Handler } from '@pkmn/protocol';
export type { HPStatus, PokemonIdent, ProtocolLine } from './protocol.ts';
export type * from './types.ts';
export * from './bridge/index.ts';
