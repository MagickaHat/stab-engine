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
export { partyBattle, toPokemonSet, maxPP } from './battle.ts';
export type { PartyBattle, PartySide } from './battle.ts';
export {
    SaveData, SavedPokemon, SavedMove, PlayerData, Position, Facing, Gender, PcStorage, PcBox, Bag, BagStack,
    IVSpread, EVSpread, VariableValue,
    PARTY_SIZE, DEFAULT_BOX_COUNT, DEFAULT_BOX_SIZE, MAX_ITEM_QUANTITY, MAX_MONEY,
} from './schema.ts';
export type { PcLocation } from './schema.ts';
