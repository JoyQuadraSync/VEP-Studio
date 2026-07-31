import { BaseEvent, EventMap } from '../types/event';
import { EventHandler } from '../event-bus/event-handler.type';

export function registerDelayedAuditSubscriber(eventBus: {
  subscribe(handler: EventHandler<'customer.comment.created'>): void;
}): void {
  eventBus.subscribe(async (event: BaseEvent<EventMap['customer.comment.created']>) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    console.log('Delayed audit event received');

    return {
      statusCode: 200,
      body: {
        success: true,
        subscriber: 'delayed-audit-subscriber',
        event_id: event.eventId
      }
    };
  });
}
