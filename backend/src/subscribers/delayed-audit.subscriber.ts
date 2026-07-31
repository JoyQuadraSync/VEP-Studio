import { EventPayload } from '../schemas/event.schema';

export function registerDelayedAuditSubscriber(eventBus: {
  subscribe(handler: (event: EventPayload) => Promise<unknown> | unknown): void;
}): void {
  eventBus.subscribe(async (event: EventPayload) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    console.log('Delayed audit event received');

    return {
      statusCode: 200,
      body: {
        success: true,
        subscriber: 'delayed-audit-subscriber',
        event_id: event.event_id
      }
    };
  });
}
