/**
 * @file index.ts
 * @brief Public entry point of the input system. See docs/INPUT_SYSTEM.md.
 *
 * @code
 * import { input } from '../input';
 * if (input.justPressed('a')) ...
 * @endcode
 */
export { BUTTONS, DPAD, isButton } from './buttons.ts';
export type { Button, DpadButton, InputDevice } from './buttons.ts';
export {
    BINDINGS_STORAGE_KEY, cloneBindings, DEFAULT_GAMEPAD, DEFAULT_KEYBOARD, defaultBindings, loadBindings,
    MemoryBindingStorage, rebind, resetBindings, saveBindings, STICK_DEADZONE,
} from './bindings.ts';
export type { BindingDevice, Bindings, BindingStorage } from './bindings.ts';
export { InputState } from './InputState.ts';
export type { ButtonEvent, ButtonListener, DeviceListener } from './InputState.ts';
export { input, InputManager, stickDirection } from './InputManager.ts';
