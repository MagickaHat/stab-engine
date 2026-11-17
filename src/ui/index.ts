/**
 * @file index.ts
 * @brief Public entry point of the React UI layer.
 *
 * Import from here in components: `import { UiLayer } from './ui';`
 */
export { UiLayer } from './UiLayer';
export type { UiLayerProps } from './UiLayer';
export { useGameViewport } from './useGameViewport';
export type { GameViewport } from './useGameViewport';
export { RotateDevicePrompt } from './RotateDevicePrompt';
export type { RotateDevicePromptProps } from './RotateDevicePrompt';
export { lockLandscape } from './orientation';
export { useBattle } from './useBattle';
export type { BattleControls } from './useBattle';
