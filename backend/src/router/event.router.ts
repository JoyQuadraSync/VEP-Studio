import { EventBus } from '../event-bus/event-bus';
import { EventSubscription } from '../event-bus/event-handler.type';
import { BaseEvent, EventMap } from '../types/event';
import { runCommentWorker } from '../workers/comment.worker';

export function registerEventRouter(eventBus: EventBus<'customer.comment.created'>): void {
  const subscription: EventSubscription<'customer.comment.created'> = {
    subscriberName: 'router',
    handler: (event: BaseEvent<EventMap['customer.comment.created']>) => {
      if (event.eventType !== 'customer.comment.created') {
        return {
          statusCode: 422,
          body: {
            success: false,
            error: 'Unsupported event type'
          }
        };
      }

      const result = runCommentWorker({ event_id: event.eventId });

      return {
        statusCode: 200,
        body: {
          success: true,
          event_id: result.event_id,
          worker: result.worker,
          message: result.message
        }
      };
    }
  };

  eventBus.subscribe(subscription);
}
