import { BaseEvent, EventMap } from '../types/event';
import { EventSubscription } from '../event-bus/event-handler.type';

export function registerDelayedAuditSubscriber(eventBus: {
  subscribe(subscription: EventSubscription<'customer.comment.created'>): void;
}): void {
  const subscription: EventSubscription<'customer.comment.created'> = {
    subscriberName: 'delayed-audit',
    handler: async (event: BaseEvent<EventMap['customer.comment.created']>) => {
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
    }
  };

  eventBus.subscribe(subscription);
}
