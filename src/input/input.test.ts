/**
 * @file input.test.ts
 * @brief Tests for the input system: button state, bindings and gamepads. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    BINDINGS_STORAGE_KEY, defaultBindings, loadBindings, MemoryBindingStorage, rebind, resetBindings, saveBindings,
} from './bindings.ts';
import { InputManager, stickDirection } from './InputManager.ts';
import { InputState } from './InputState.ts';
import type { ButtonEvent } from './InputState.ts';

test('a press shows in justPressed for exactly one frame', () =>
{
    const state = new InputState();
    state.press('a', 'key:KeyZ', 'keyboard');
    assert.equal(state.isDown('a'), true);
    assert.equal(state.justPressed('a'), false, 'not before the frame starts');
    state.tick();
    assert.equal(state.justPressed('a'), true);
    state.tick();
    assert.equal(state.justPressed('a'), false);
    assert.equal(state.isDown('a'), true);
    state.release('a', 'key:KeyZ', 'keyboard');
    state.tick();
    assert.equal(state.justReleased('a'), true);
    assert.equal(state.isDown('a'), false);
});

test('a tap between two frames is not lost', () =>
{
    const state = new InputState();
    state.press('a', 'pointer:1', 'touch');
    state.release('a', 'pointer:1', 'touch');
    state.tick();
    assert.equal(state.justPressed('a'), true);
    assert.equal(state.justReleased('a'), true);
    assert.equal(state.isDown('a'), false);
});

test('a button stays held until every source lets go', () =>
{
    const state = new InputState();
    const events: ButtonEvent[] = [];
    state.on((event) => events.push(event));
    state.press('b', 'key:KeyX', 'keyboard');
    state.press('b', 'pad:0', 'gamepad');
    state.release('b', 'key:KeyX', 'keyboard');
    assert.equal(state.isDown('b'), true);
    state.release('b', 'pad:0', 'gamepad');
    assert.equal(state.isDown('b'), false);
    assert.deepEqual(events.map((event) => `${event.type}:${event.device}`), ['press:keyboard', 'release:gamepad']);
});

test('consume hides a press from justPressed', () =>
{
    const state = new InputState();
    state.press('a', 'key:Space', 'keyboard');
    state.consume('a');
    state.tick();
    assert.equal(state.justPressed('a'), false);
    assert.equal(state.isDown('a'), true);

    state.release('a', 'key:Space', 'keyboard');
    state.press('a', 'key:Space', 'keyboard');
    state.tick();
    state.consume('a');
    assert.equal(state.justPressed('a'), false, 'also during the frame');
});

test('releaseSources lets go of matching sources only', () =>
{
    const state = new InputState();
    state.press('up', 'key:ArrowUp', 'keyboard');
    state.press('a', 'pad:0', 'gamepad');
    state.releaseSources('key:', 'keyboard');
    assert.equal(state.isDown('up'), false);
    assert.equal(state.isDown('a'), true);
});

test('device changes are reported once per switch', () =>
{
    const state = new InputState();
    const devices: string[] = [];
    state.onDeviceChange((device) => devices.push(device));
    state.press('a', 'key:KeyZ', 'keyboard');
    state.press('up', 'key:KeyW', 'keyboard');
    state.press('b', 'pad:0', 'gamepad');
    state.press('x', 'virtual:pad', 'touch');
    assert.deepEqual(devices, ['keyboard', 'gamepad', 'touch']);
    assert.equal(state.lastDevice, 'touch');
});

test('a failing listener does not stop the others', () =>
{
    const state = new InputState();
    let called = false;
    const error = console.error;
    console.error = () => {};
    try
    {
        state.on(() => { throw new Error('boom'); });
        state.on(() => { called = true; });
        state.press('start', 'key:Enter', 'keyboard');
    }
    finally
    {
        console.error = error;
    }
    assert.equal(called, true);
});

test('rebind moves keys away from other buttons', () =>
{
    const bindings = rebind(defaultBindings(), 'keyboard', 'a', ['KeyX']);
    assert.deepEqual(bindings.keyboard.a, ['KeyX']);
    assert.deepEqual(bindings.keyboard.b, ['Escape', 'Backspace']);
    assert.deepEqual(defaultBindings().keyboard.a, ['KeyZ', 'Space'], 'defaults are not changed');

    const pad = rebind(bindings, 'gamepad', 'start', [9, 9, 16]);
    assert.deepEqual(pad.gamepad.start, [9, 16]);
});

test('bindings survive a save and load, and only changes are written', () =>
{
    const storage = new MemoryBindingStorage();
    const changed = rebind(defaultBindings(), 'keyboard', 'y', ['KeyF']);
    assert.equal(saveBindings(changed, storage), true);
    const saved = JSON.parse(storage.getItem(BINDINGS_STORAGE_KEY)!);
    assert.deepEqual(saved, { version: 1, keyboard: { y: ['KeyF'] }, gamepad: {} });
    assert.deepEqual(loadBindings(storage), changed);

    assert.deepEqual(resetBindings(storage), defaultBindings());
    assert.equal(storage.getItem(BINDINGS_STORAGE_KEY), null);
});

test('broken saved bindings fall back to the defaults', () =>
{
    const warn = console.warn;
    console.warn = () => {};
    try
    {
        const storage = new MemoryBindingStorage();
        storage.setItem(BINDINGS_STORAGE_KEY, '{nope');
        assert.deepEqual(loadBindings(storage), defaultBindings());
        storage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify({ version: 99, keyboard: { a: ['KeyQ'] } }));
        assert.deepEqual(loadBindings(storage), defaultBindings());
        storage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify({
            version: 1, keyboard: { a: ['KeyJ', 5, ''], jump: ['KeyK'] }, gamepad: { b: [2, -1, 1.5, 'x'] },
        }));
        const bindings = loadBindings(storage);
        assert.deepEqual(bindings.keyboard.a, ['KeyJ']);
        assert.deepEqual(bindings.gamepad.b, [2]);
        assert.equal(loadBindings(null).keyboard.a.length, 2, 'no storage: defaults');
    }
    finally
    {
        console.warn = warn;
    }
});

test('the stick works as a D-pad outside the dead zone', () =>
{
    assert.equal(stickDirection(0.2, -0.3), null);
    assert.equal(stickDirection(-0.9, 0.2), 'left');
    assert.equal(stickDirection(0.3, 0.8), 'down');
    assert.equal(stickDirection(0, -0.6), 'up');
});

/** @brief A pretend standard gamepad. */
function fakePad (index: number, pressed: number[], axes: number[] = [0, 0]): Gamepad
{
    const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), touched: false, value: pressed.includes(i) ? 1 : 0 }));
    return { index, id: `pad ${index}`, connected: true, mapping: 'standard', axes, buttons, timestamp: 0 } as unknown as Gamepad;
}

test('gamepads are read on update and unplugging releases their buttons', (t) =>
{
    let pads: (Gamepad | null)[] = [];
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
    t.after(() =>
    {
        if (original) Object.defineProperty(globalThis, 'navigator', original);
        else delete (globalThis as { navigator?: unknown }).navigator;
    });

    const manager = new InputManager(new MemoryBindingStorage());
    pads = [fakePad(0, [0, 6], [0, 0.9])];
    manager.update();
    assert.equal(manager.justPressed('a'), true);
    assert.equal(manager.isDown('l'), true, 'left trigger');
    assert.equal(manager.direction(), 'down', 'stick');
    assert.equal(manager.lastDevice, 'gamepad');

    pads = [fakePad(0, [9])];
    manager.update();
    assert.equal(manager.justReleased('a'), true);
    assert.equal(manager.justPressed('start'), true);
    assert.equal(manager.direction(), null);

    pads = [];
    manager.update();
    assert.equal(manager.isDown('start'), false);
});

test('rebinding the gamepad changes which button is read', (t) =>
{
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [fakePad(0, [2])] } });
    t.after(() =>
    {
        if (original) Object.defineProperty(globalThis, 'navigator', original);
        else delete (globalThis as { navigator?: unknown }).navigator;
    });

    const storage = new MemoryBindingStorage();
    const manager = new InputManager(storage);
    manager.rebind('gamepad', 'a', [2]);
    manager.update();
    assert.equal(manager.isDown('a'), true);
    assert.equal(manager.isDown('x'), false, 'index 2 was taken from X');
    assert.deepEqual(new InputManager(storage).getBindings().gamepad.a, [2], 'saved');

    manager.resetBindings();
    assert.deepEqual(manager.getBindings(), defaultBindings());
});

test('on-screen controls press buttons as touch', () =>
{
    const manager = new InputManager(null);
    manager.setVirtual('select', true);
    manager.update();
    assert.equal(manager.justPressed('select'), true);
    assert.equal(manager.lastDevice, 'touch');
    manager.setVirtual('select', false);
    assert.equal(manager.isDown('select'), false);
});
