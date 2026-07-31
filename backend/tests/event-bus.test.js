const test = require('node:test');
const assert = require('node:assert/strict');

const { EventBus } = require('../dist/event-bus/event-bus');

test('EventBus supports sync and async subscribers, preserves order, and isolates subscriber failures', async () => {
  const bus = new EventBus();
  const seen = [];

  bus.subscribe((event) => {
    seen.push(`first:${event.event_id}`);
    return { statusCode: 200, body: { subscriber: 'first' } };
  });

  bus.subscribe(async (event) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    seen.push(`second:${event.event_id}`);
    return { statusCode: 200, body: { subscriber: 'second' } };
  });

  bus.subscribe(() => {
    seen.push('third');
    throw new Error('boom');
  });

  bus.subscribe(async (event) => {
    seen.push(`fourth:${event.event_id}`);
    return { statusCode: 200, body: { subscriber: 'fourth' } };
  });

  const results = await bus.publish({ event_id: 'evt-1' });

  assert.deepEqual(seen.slice(0, 2), ['first:evt-1', 'third']);
  assert.ok(seen.includes('fourth:evt-1'));
  assert.ok(seen.includes('second:evt-1'));
  assert.equal(results.length, 4);
  assert.deepEqual(results[0], { statusCode: 200, body: { subscriber: 'first' } });
  assert.deepEqual(results[1], { statusCode: 200, body: { subscriber: 'second' } });
  assert.deepEqual(results[2], { statusCode: 500, body: { success: false, error: 'Subscriber failed' } });
  assert.deepEqual(results[3], { statusCode: 200, body: { subscriber: 'fourth' } });
});

test('EventBus starts delayed subscribers concurrently and preserves registration order', async () => {
  const bus = new EventBus();
  const startedAt = Date.now();

  bus.subscribe(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { statusCode: 200, body: { subscriber: 'first' } };
  });

  bus.subscribe(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { statusCode: 200, body: { subscriber: 'second' } };
  });

  const results = await bus.publish({ event_id: 'evt-2' });
  const elapsed = Date.now() - startedAt;

  assert.equal(results.length, 2);
  assert.deepEqual(results[0], { statusCode: 200, body: { subscriber: 'first' } });
  assert.deepEqual(results[1], { statusCode: 200, body: { subscriber: 'second' } });
  assert.ok(elapsed < 120, `publish should finish closer to the longest delay than the sum of delays, elapsed=${elapsed}ms`);
  assert.ok(elapsed >= 35, `publish should wait for the delayed subscribers, elapsed=${elapsed}ms`);
});
