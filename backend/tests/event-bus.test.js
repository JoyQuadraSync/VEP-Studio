const test = require('node:test');
const assert = require('node:assert/strict');

const { EventBus } = require('../dist/event-bus/event-bus');
const { SubscriberStatus } = require('../dist/runtime/subscriber-status');

test('EventBus supports sync and async subscribers, preserves order, and isolates subscriber failures', async () => {
  const bus = new EventBus();
  const seen = [];

  bus.subscribe({
    subscriberName: 'first',
    handler: (event) => {
      seen.push(`first:${event.eventId}`);
      return { statusCode: 200, body: { subscriber: 'first' } };
    }
  });

  bus.subscribe({
    subscriberName: 'second',
    handler: async (event) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(`second:${event.eventId}`);
      return { statusCode: 200, body: { subscriber: 'second' } };
    }
  });

  bus.subscribe({
    subscriberName: 'third',
    handler: () => {
      seen.push('third');
      throw new Error('boom');
    }
  });

  bus.subscribe({
    subscriberName: 'fourth',
    handler: (event) => {
      seen.push(`fourth:${event.eventId}`);
      return { statusCode: 200, body: { subscriber: 'fourth' } };
    }
  });

  const publishResult = await bus.publish({ eventId: 'evt-1' });

  assert.deepEqual(seen.slice(0, 2), ['first:evt-1', 'third']);
  assert.ok(seen.includes('fourth:evt-1'));
  assert.ok(seen.includes('second:evt-1'));
  assert.equal(publishResult.subscriberResults.length, 4);
  assert.deepEqual(publishResult.subscriberResults.map((entry) => entry.subscriberName), ['first', 'second', 'third', 'fourth']);
  assert.deepEqual(publishResult.subscriberResults[0].result, { statusCode: 200, body: { subscriber: 'first' } });
  assert.deepEqual(publishResult.subscriberResults[1].result, { statusCode: 200, body: { subscriber: 'second' } });
  assert.deepEqual(publishResult.subscriberResults[2].result, { statusCode: 500, body: { success: false, error: 'Subscriber failed' } });
  assert.deepEqual(publishResult.subscriberResults[3].result, { statusCode: 200, body: { subscriber: 'fourth' } });
  assert.equal(publishResult.eventId, 'evt-1');
  assert.equal(publishResult.successCount, 3);
  assert.equal(publishResult.failureCount, 1);
  assert.equal(publishResult.subscriberResults[0].status, SubscriberStatus.SUCCESS);
  assert.equal(publishResult.subscriberResults[2].status, SubscriberStatus.FAILED);
});

test('EventBus starts delayed subscribers concurrently and preserves registration order', async () => {
  const bus = new EventBus();
  const startedAt = Date.now();

  bus.subscribe({
    subscriberName: 'first',
    handler: async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { statusCode: 200, body: { subscriber: 'first' } };
    }
  });

  bus.subscribe({
    subscriberName: 'second',
    handler: async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { statusCode: 200, body: { subscriber: 'second' } };
    }
  });

  const publishResult = await bus.publish({ eventId: 'evt-2' });
  const elapsed = Date.now() - startedAt;

  assert.equal(publishResult.subscriberResults.length, 2);
  assert.deepEqual(publishResult.subscriberResults[0].result, { statusCode: 200, body: { subscriber: 'first' } });
  assert.deepEqual(publishResult.subscriberResults[1].result, { statusCode: 200, body: { subscriber: 'second' } });
  assert.equal(publishResult.successCount, 2);
  assert.equal(publishResult.failureCount, 0);
  assert.equal(publishResult.subscriberResults[0].status, SubscriberStatus.SUCCESS);
  assert.equal(publishResult.subscriberResults[1].status, SubscriberStatus.SUCCESS);
  assert.ok(elapsed < 120, `publish should finish closer to the longest delay than the sum of delays, elapsed=${elapsed}ms`);
  assert.ok(elapsed >= 35, `publish should wait for the delayed subscribers, elapsed=${elapsed}ms`);
});

test('PublishResult can resolve a named router subscriber without depending on registration order', async () => {
  const bus = new EventBus();

  bus.subscribe({
    subscriberName: 'audit',
    handler: () => ({ statusCode: 200, body: { subscriber: 'audit' } })
  });

  bus.subscribe({
    subscriberName: 'router',
    handler: () => ({ statusCode: 201, body: { subscriber: 'router' } })
  });

  const publishResult = await bus.publish({ eventId: 'evt-3' });
  const routerSubscriber = publishResult.subscriberResults.find((entry) => entry.subscriberName === 'router');

  assert.ok(routerSubscriber);
  assert.equal(routerSubscriber.result.statusCode, 201);
  assert.equal(routerSubscriber.result.body.subscriber, 'router');
});

test('EventBus exposes deterministic execution metadata through its Clock contract', async () => {
  const timestamps = [
    new Date('2026-08-03T10:00:00.000Z'),
    new Date('2026-08-03T10:00:00.010Z'),
    new Date('2026-08-03T10:00:00.025Z'),
    new Date('2026-08-03T10:00:00.030Z')
  ];
  const clock = {
    now() {
      const timestamp = timestamps.shift();

      if (!timestamp) {
        throw new Error('Test clock exhausted');
      }

      return timestamp;
    }
  };
  const bus = new EventBus(clock);

  bus.subscribe({
    subscriberName: 'router',
    handler: () => ({ statusCode: 200, body: { success: true } })
  });

  const publishResult = await bus.publish({ eventId: 'evt-clock' });

  assert.deepEqual(publishResult.executionContext, {
    startedAt: new Date('2026-08-03T10:00:00.000Z'),
    finishedAt: new Date('2026-08-03T10:00:00.030Z')
  });
  assert.equal(publishResult.durationMs, 30);
  assert.equal(publishResult.subscriberResults[0].durationMs, 15);
});
