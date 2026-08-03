import { BaseEvent, EventMap } from '../types/event';
import { EventSubscription } from '../event-bus/event-handler.type';

export function registerAuditSubscriber(eventBus: {
  subscribe(subscription: EventSubscription<'customer.comment.created'>): void;
}): void {
  const subscription: EventSubscription<'customer.comment.created'> = {
    subscriberName: 'audit',
    handler: (event: BaseEvent<EventMap['customer.comment.created']>) => {
      console.log('Audit event received');

      return {
        statusCode: 200,
        body: {
          success: true,
          subscriber: 'audit-subscriber',
          event_id: event.eventId
        }
      };
    }
  };

  eventBus.subscribe(subscription);
}
