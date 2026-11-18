/**
 * @file bus.test.ts
 * @brief Tests for the typed event bus. Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TypedEventBus } from './EventBus.ts';

interface TestEvents
{
    ping: { n: number };
    bare: void;
}

test('listeners get the payload, in the order they were added', () =>
{
    const bus = new TypedEventBus<TestEvents>();
    const seen: string[] = [];
    bus.on('ping', ({ n }) => seen.push(`a${n}`));
    bus.on('ping', ({ n }) => seen.push(`b${n}`));
    assert.equal(bus.emit('ping', { n: 1 }), true);
    assert.deepEqual(seen, ['a1', 'b1']);
});

test('events without data are emitted without arguments', () =>
{
    const bus = new TypedEventBus<TestEvents>();
    let count = 0;
    bus.on('bare', () => count++);
    bus.emit('bare');
    assert.equal(count, 1);
    assert.equal(bus.emit('ping', { n: 0 }), false, 'nobody listens to ping');
});

test('once listeners run a single time', () =>
{
    const bus = new TypedEventBus<TestEvents>();
    let count = 0;
    bus.once('bare', () => count++);
    bus.emit('bare');
    bus.emit('bare');
    assert.equal(count, 1);
    assert.equal(bus.listenerCount('bare'), 0);
});

test('off removes by function, and by context when given', () =>
{
    const bus = new TypedEventBus<TestEvents>();
    const a = {}, b = {};
    const calls: unknown[] = [];
    const fn = function (this: unknown) { calls.push(this); };
    bus.on('bare', fn, a);
    bus.on('bare', fn, b);
    bus.off('bare', fn, a);
    bus.emit('bare');
    assert.deepEqual(calls, [b], 'only the listener with the other context is left');
    bus.off('bare', fn);
    assert.equal(bus.listenerCount('bare'), 0);
});

test('a listener can remove itself while the event is being sent', () =>
{
    const bus = new TypedEventBus<TestEvents>();
    const seen: string[] = [];
    const first = () => { seen.push('first'); bus.off('bare', first); };
    bus.on('bare', first);
    bus.on('bare', () => seen.push('second'));
    bus.emit('bare');
    bus.emit('bare');
    assert.deepEqual(seen, ['first', 'second', 'second']);
});
