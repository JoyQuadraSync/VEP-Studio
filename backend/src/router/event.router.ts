import { EventBus } from '../event-bus/event-bus';
import { EventPayload } from '../schemas/event.schema';
import { runCommentWorker } from '../workers/comment.worker';

export function registerEventRouter(eventBus: EventBus): void {
  eventBus.subscribe((event: EventPayload) => {
    if (event.event_type !== 'customer.comment.created') {
      return {
        statusCode: 422,
        body: {
          success: false,
          error: 'Unsupported event type'
        }
      };
    }

    const result = runCommentWorker({ event_id: event.event_id });

    return {
      statusCode: 200,
      body: {
        success: true,
        event_id: result.event_id,
        worker: result.worker,
        message: result.message
      }
    };
  });
}
