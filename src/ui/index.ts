/**
 * @file index.ts
 * @brief Public entry point of the React UI layer.
 *
 * Import from here in components: `import { UiLayer, Window, PixelText } from './ui';`
 * See docs/UI_SYSTEM.md.
 */

// Layer and shell
export { UiLayer } from './UiLayer';
export type { UiLayerProps } from './UiLayer';
export { RotateDevicePrompt } from './RotateDevicePrompt';
export type { RotateDevicePromptProps } from './RotateDevicePrompt';
export { lockLandscape } from './orientation';
export { blockTextCopy } from './noCopy';

// Game state, read through stores fed by the event bus
export {
    connectUiStore, getUiState, openModal, setTextSpeed, subscribeUiState, useGameSize, useModal, useUiStore,
    DEFAULT_TEXT_SPEED,
} from './store/uiStore';
export type { UiState } from './store/uiStore';
export { useBattle } from './useBattle';
export type { BattleControls } from './useBattle';
export { useGameState } from './useGameState';

// Input
export { useInputPress, useLastDevice } from './useInput';
export type { InputPressHandler } from './useInput';
export { VirtualPad } from './VirtualPad';
export type { VirtualPadProps, VirtualPadVisibility } from './VirtualPad';

// Assets
export { assetUrl, fontUrl, uiImageUrl, uiSoundUrl, windowskinUrl, UI_PATHS } from './assets/paths';
export { getLoadedImage, isFontLoaded, loadFont, loadImage, preloadUi, useImage } from './assets/loader';
export type { UiPreloadList } from './assets/loader';
export { UiAssetGate, defaultUiPreload } from './assets/UiAssetGate';
export type { UiAssetGateProps } from './assets/UiAssetGate';

// Skins, text and sounds
export {
    DEFAULT_SKINS, ESSENTIALS_DARK_TEXT, FRLG_TEXT, RMXP_LAYOUT, getSkin, listSkins, planWindow, registerSkin, skinSlice,
} from './skins/skins';
export type { SkinFormat, WindowPlan, WindowSkin } from './skins/skins';
export { centredSlice, fitWindowSize, insets, planNineSlice, tile } from './skins/nineSlice';
export type { DrawOp, Insets, Rect } from './skins/nineSlice';
export { DEFAULT_FONT, getFont, listFonts, registerFont } from './text/fonts';
export type { PixelFont } from './text/fonts';
export { chars, pageLength, paginate, textWidth, wrapText } from './text/layout';
export type { Advance } from './text/layout';
export { clearFontMetrics, cssFont, drawPixelText, fontAdvance, measureLines } from './text/render';
export type { PixelTextStyle } from './text/render';
export { useFontReady, usePixelFont, useTextPages } from './text/usePixelText';
export { getUiSound, playUiSound, registerUiSound } from './sounds';
export type { UiSoundEntry } from './sounds';

// Components
export { Window } from './components/Window';
export type { WindowProps } from './components/Window';
export { PixelText } from './components/PixelText';
export type { PixelTextProps } from './components/PixelText';
export { UiSprite } from './components/UiSprite';
export type { UiSpriteProps } from './components/UiSprite';

// Dialogue
export { EventDialogue } from './EventDialogue';
export { MessageBox, PAUSE_ARROW } from './dialogue/MessageBox';
export type { MessageBoxProps } from './dialogue/MessageBox';
export { NameBox } from './dialogue/NameBox';
export type { NameBoxProps } from './dialogue/NameBox';
export { ChoiceWindow, SELECT_ARROW } from './dialogue/ChoiceWindow';
export type { ChoiceWindowProps } from './dialogue/ChoiceWindow';
export { NameEntry } from './dialogue/NameEntry';
export type { NameEntryProps } from './dialogue/NameEntry';
export { TEXT_SPEED_CPS, useTicker, useTypewriter } from './dialogue/textSpeed';
export type { Typewriter } from './dialogue/textSpeed';
export { choiceBox, messageBox, nameBox, CHOICE_GAP, CHOICE_MARGIN_RIGHT, MESSAGE_HEIGHT, MESSAGE_LINES, NAME_BOX_INDENT } from './dialogue/layout';
export type { Box } from './dialogue/layout';
