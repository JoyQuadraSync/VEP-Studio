import { EventPayload } from '../schemas/event.schema';

export function registerAuditSubscriber(eventBus: {
  subscribe(handler: (event: EventPayload) => unknown): void;
}): void {
  eventBus.subscribe((event: EventPayload) => {
    console.log('Audit event received');

    return {
      statusCode: 200,
      body: {
        success: true,
        subscriber: 'audit-subscriber',
        event_id: event.event_id
      }
    };
  });
}
