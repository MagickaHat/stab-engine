/**
 * @file bindings.ts
 * @brief Which keys and gamepad buttons press which game button, and saving player changes.
 *
 * Keys are named by `KeyboardEvent.code` (`KeyZ`, `ArrowUp`, `Space`...), which
 * names the physical key, so the layout stays the same on AZERTY or QWERTZ
 * keyboards. Gamepad buttons are indices of the W3C "standard" gamepad
 * mapping, which browsers use for Xbox, PlayStation, Switch and most other
 * controllers: they name a *position*, so `0` is the bottom face button.
 *
 * Players' changes are stored as overrides on top of the defaults: a button
 * that was never rebound follows the defaults, even if a later version of the
 * game changes them.
 *
 * @code
 * const bindings = loadBindings();                          // defaults + saved changes
 * const changed = rebind(bindings, 'keyboard', 'a', ['KeyJ']);
 * saveBindings(changed);
 * @endcode
 */
import { BUTTONS, isButton } from './buttons.ts';
import type { Button } from './buttons.ts';

/** @brief Devices whose bindings can be changed. */
export type BindingDevice = 'keyboard' | 'gamepad';

/** @brief Keys (`KeyboardEvent.code`) and gamepad button indices for every game button. */
export interface Bindings
{
    keyboard: Record<Button, string[]>;
    gamepad: Record<Button, number[]>;
}

/** @brief Default keyboard keys. */
export const DEFAULT_KEYBOARD: Readonly<Record<Button, readonly string[]>> = {
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    a: ['KeyZ', 'Space'],
    b: ['KeyX', 'Escape', 'Backspace'],
    x: ['KeyC'],
    y: ['KeyV'],
    l: ['KeyQ'],
    r: ['KeyE'],
    start: ['Enter'],
    select: ['Tab', 'ShiftRight'],
};

/**
 * @brief Default gamepad buttons (standard mapping).
 *
 * 0-3 are the face buttons (bottom, right, left, top), 4/5 the bumpers, 6/7
 * the triggers, 8 back/select, 9 start, 12-15 the D-pad. Both the bumper and
 * the trigger on a side count as that side's trigger. The left stick also
 * works as the D-pad (see `STICK_DEADZONE`).
 */
export const DEFAULT_GAMEPAD: Readonly<Record<Button, readonly number[]>> = {
    up: [12],
    down: [13],
    left: [14],
    right: [15],
    a: [0],
    b: [1],
    x: [2],
    y: [3],
    l: [4, 6],
    r: [5, 7],
    start: [9],
    select: [8],
};

/** @brief How far the left stick must be pushed (0 to 1) to count as the D-pad. */
export const STICK_DEADZONE = 0.5;

/** @brief Key bindings are saved under in `localStorage`. */
export const BINDINGS_STORAGE_KEY = 'stab-input-bindings';

/** @brief Version of the saved format, raised if it ever changes. */
const BINDINGS_VERSION = 1;

/** @brief Where bindings are saved. `localStorage` fits; tests use `MemoryBindingStorage`. */
export interface BindingStorage
{
    getItem (key: string): string | null;
    setItem (key: string, value: string): void;
    removeItem (key: string): void;
}

/** @brief Keeps bindings in memory. For tests, or where nothing should be saved. */
export class MemoryBindingStorage implements BindingStorage
{
    private readonly items = new Map<string, string>();

    getItem (key: string): string | null
    {
        return this.items.get(key) ?? null;
    }

    setItem (key: string, value: string): void
    {
        this.items.set(key, value);
    }

    removeItem (key: string): void
    {
        this.items.delete(key);
    }
}

/**
 * @brief The browser's `localStorage`, or `null` where it cannot be used (private mode, Node).
 * @return The storage, or `null`.
 */
function browserStorage (): BindingStorage | null
{
    try
    {
        return typeof localStorage === 'undefined' ? null : localStorage;
    }
    catch
    {
        return null;
    }
}

/**
 * @brief A fresh copy of the default bindings.
 * @return Bindings that can be changed freely.
 */
export function defaultBindings (): Bindings
{
    const keyboard = {} as Record<Button, string[]>;
    const gamepad = {} as Record<Button, number[]>;
    for (const button of BUTTONS)
    {
        keyboard[button] = [...DEFAULT_KEYBOARD[button]];
        gamepad[button] = [...DEFAULT_GAMEPAD[button]];
    }
    return { keyboard, gamepad };
}

/**
 * @brief Copy of `bindings` where one button uses other keys or gamepad buttons.
 *
 * The new codes are taken away from any other button that used them, so one
 * key never presses two buttons.
 *
 * @param bindings Current bindings (not changed).
 * @param device `keyboard` or `gamepad`.
 * @param button The game button.
 * @param codes `KeyboardEvent.code` values for the keyboard, button indices for the gamepad.
 * @return The changed bindings.
 */
export function rebind<D extends BindingDevice> (
    bindings: Bindings, device: D, button: Button, codes: Bindings[D][Button],
): Bindings
{
    const result = cloneBindings(bindings);
    const table = result[device] as Record<Button, (string | number)[]>;
    const taken = new Set<string | number>(codes);
    for (const other of BUTTONS) table[other] = table[other].filter((code) => !taken.has(code));
    table[button] = [...new Set<string | number>(codes)];
    return result;
}

/**
 * @brief Load the default bindings with the player's saved changes on top.
 *
 * Saved data that is broken or from an unknown version is ignored (with a
 * warning) rather than stopping the game.
 *
 * @param storage Where they were saved. Default: `localStorage`.
 * @return The bindings.
 */
export function loadBindings (storage: BindingStorage | null = browserStorage()): Bindings
{
    const bindings = defaultBindings();
    let text: string | null = null;
    try
    {
        text = storage?.getItem(BINDINGS_STORAGE_KEY) ?? null;
    }
    catch (error)
    {
        console.warn('[input] could not read saved bindings:', error);
    }
    if (!text) return bindings;

    let saved: unknown;
    try
    {
        saved = JSON.parse(text);
    }
    catch
    {
        console.warn('[input] saved bindings are not valid JSON; using the defaults');
        return bindings;
    }
    if (!isRecord(saved) || saved.version !== BINDINGS_VERSION)
    {
        console.warn('[input] saved bindings have an unknown format; using the defaults');
        return bindings;
    }
    applyOverrides(bindings.keyboard, saved.keyboard, (code): code is string => typeof code === 'string' && code.length > 0);
    applyOverrides(bindings.gamepad, saved.gamepad, (code): code is number => Number.isInteger(code) && (code as number) >= 0);
    return bindings;
}

/**
 * @brief Save the bindings. Only buttons that differ from the defaults are written.
 * @param bindings The bindings to keep.
 * @param storage Where to save them. Default: `localStorage`.
 * @return `false` if they could not be saved (storage full or blocked).
 */
export function saveBindings (bindings: Bindings, storage: BindingStorage | null = browserStorage()): boolean
{
    const keyboard: Partial<Record<Button, string[]>> = {};
    const gamepad: Partial<Record<Button, number[]>> = {};
    for (const button of BUTTONS)
    {
        if (!sameCodes(bindings.keyboard[button], DEFAULT_KEYBOARD[button])) keyboard[button] = [...bindings.keyboard[button]];
        if (!sameCodes(bindings.gamepad[button], DEFAULT_GAMEPAD[button])) gamepad[button] = [...bindings.gamepad[button]];
    }
    try
    {
        if (!storage) return false;
        storage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify({ version: BINDINGS_VERSION, keyboard, gamepad }));
        return true;
    }
    catch (error)
    {
        console.warn('[input] could not save bindings:', error);
        return false;
    }
}

/**
 * @brief Forget the player's changes.
 * @param storage Where they were saved. Default: `localStorage`.
 * @return The default bindings.
 */
export function resetBindings (storage: BindingStorage | null = browserStorage()): Bindings
{
    try
    {
        storage?.removeItem(BINDINGS_STORAGE_KEY);
    }
    catch (error)
    {
        console.warn('[input] could not clear saved bindings:', error);
    }
    return defaultBindings();
}

/**
 * @brief Copy bindings so the copy can be changed.
 * @param bindings Bindings to copy.
 * @return The copy.
 */
export function cloneBindings (bindings: Bindings): Bindings
{
    const result = defaultBindings();
    for (const button of BUTTONS)
    {
        result.keyboard[button] = [...bindings.keyboard[button]];
        result.gamepad[button] = [...bindings.gamepad[button]];
    }
    return result;
}

/** @brief Whether a value is a plain object. */
function isRecord (value: unknown): value is Record<string, unknown>
{
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @brief Whether two code lists are the same, in the same order. */
function sameCodes<T> (a: readonly T[], b: readonly T[]): boolean
{
    return a.length === b.length && a.every((code, index) => code === b[index]);
}

/**
 * @brief Copy valid saved entries into a binding table; unknown buttons and bad codes are skipped.
 * @param table Table to change.
 * @param saved Saved overrides for that device.
 * @param valid Checks one code.
 */
function applyOverrides<T> (table: Record<Button, T[]>, saved: unknown, valid: (code: unknown) => code is T): void
{
    if (!isRecord(saved)) return;
    for (const [button, codes] of Object.entries(saved))
    {
        if (!isButton(button) || !Array.isArray(codes)) continue;
        table[button] = codes.filter(valid);
    }
}
