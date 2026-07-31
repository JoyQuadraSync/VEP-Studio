const test = require('node:test');
const assert = require('node:assert/strict');

const { EventBus } = require('../dist/event-bus/event-bus');

test('EventBus dispatches subscribed handlers and returns their results', () => {
  const bus = new EventBus();
  const seenEvents = [];

  bus.subscribe((event) => {
    seenEvents.push(event);
    return {
      statusCode: 200,
      body: { success: true }
    };
  });

  const results = bus.publish({ event_id: 'evt-1' });

  assert.deepEqual(seenEvents, [{ event_id: 'evt-1' }]);
  assert.deepEqual(results, [{ statusCode: 200, body: { success: true } }]);
});
