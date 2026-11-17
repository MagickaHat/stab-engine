/**
 * @file index.ts
 * @brief Public entry point of the battle bridge (also re-exported by `src/battle`).
 */
export { BattleBridge } from './BattleBridge.ts';
export type { BattleBridgeOptions, BattlePresenter } from './BattleBridge.ts';
export { buildSnapshot, viewChoice } from './snapshot.ts';
export type {
    BattlePhase, BattleSnapshot, ChoiceView, MoveChoice, PokemonView, SideView, SwitchChoice,
} from './snapshot.ts';
export { toStep } from './steps.ts';
export type {
    BattleStep, BattleStepKind, BoostStep, EndStep, FaintStep, FormeChangeStep, HPStep, MoveStep,
    OtherStep, StatusStep, StepPokemon, SwitchStep, TurnStep, WeatherStep,
} from './steps.ts';
export { getActiveBattle, setActiveBattle, subscribeActiveBattle } from './session.ts';
export { cryPath, spritePath, CRY_DIR, POKEMON_SPRITE_DIR } from './assets.ts';
export type { AssetManifest, SpriteFacing, SpriteFiles, SpriteSubject } from './assets.ts';
