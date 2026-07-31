import { BaseEvent, EventMap } from '../types/event';
import { EventHandler } from '../event-bus/event-handler.type';

export function registerAuditSubscriber(eventBus: {
  subscribe(handler: EventHandler<'customer.comment.created'>): void;
}): void {
  eventBus.subscribe((event: BaseEvent<EventMap['customer.comment.created']>) => {
    console.log('Audit event received');

    return {
      statusCode: 200,
      body: {
        success: true,
        subscriber: 'audit-subscriber',
        event_id: event.eventId
      }
    };
  });
}
