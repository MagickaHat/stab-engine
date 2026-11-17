/**
 * @file index.ts
 * @brief Public entry point of the game state and save system.
 *
 * Import from here in scenes: `import { getGameState, SaveManager } from '../../state';`
 * See docs/SAVE_SYSTEM.md.
 */
export { GameState } from './GameState.ts';
export type { NewGameOptions, PokemonLocation } from './GameState.ts';
export {
    SaveManager, MemoryStorage, SaveError, parseSaveFile, MIGRATIONS,
    SAVE_VERSION, DEFAULT_SAVE_SLOTS, DEFAULT_SAVE_PREFIX,
} from './SaveManager.ts';
export type {
    Migration, SaveErrorCode, SaveFile, SaveManagerOptions, SaveStorage, SaveSummary, SlotInfo,
} from './SaveManager.ts';
export { getGameState, requireGameState, setGameState, subscribeGameState } from './session.ts';
export { createPokemon, healed, isFainted, makeUid, NATURE_IDS } from './pokemon.ts';
export type { NewPokemon } from './pokemon.ts';
export { partyBattle, setBattleLevel, toPokemonSet, maxPP, usedUpBerry } from './battle.ts';
export type {
    BattleOutcome, ExpOptions, ExpResult, ExpSpecies, PartyBattle, PartyBattleOptions, PartySide,
} from './battle.ts';
export { evolvedAbility, evolvePokemon, findEvolution } from './evolution.ts';
export type { EvolutionContext, EvolveOptions, PendingEvolution } from './evolution.ts';
export {
    addEvs, expForLevel, expGain, levelForExp, levelUpMoves, MAX_LEVEL, LUCKY_EGG_BONUS, TRADED_BONUS,
} from './experience.ts';
export type { ExpGainInput, GrowthRate } from './experience.ts';
export {
    SaveData, SavedPokemon, SavedMove, PlayerData, Position, Facing, Gender, PcStorage, PcBox, Bag, BagStack,
    IVSpread, EVSpread, VariableValue,
    PARTY_SIZE, MAX_MOVES, MAX_EV, MAX_TOTAL_EVS, DEFAULT_BOX_COUNT, DEFAULT_BOX_SIZE, MAX_ITEM_QUANTITY, MAX_MONEY,
} from './schema.ts';
export type { PcLocation } from './schema.ts';
