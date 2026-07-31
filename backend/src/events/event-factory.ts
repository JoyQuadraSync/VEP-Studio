import { BaseEvent, EventMap } from '../types/event';
import { CustomerCommentCreatedPayload } from '../types/payloads';

export interface CreateCustomerCommentCreatedEventOptions {
  eventId: string;
  eventType?: string;
  correlationId?: string | null;
  causationId?: string | null;
  payload?: Partial<CustomerCommentCreatedPayload>;
}

export function createCustomerCommentCreatedEvent(
  options: CreateCustomerCommentCreatedEventOptions
): BaseEvent<EventMap['customer.comment.created']> {
  return {
    eventId: options.eventId,
    eventType: options.eventType ?? 'customer.comment.created',
    correlationId: options.correlationId ?? undefined,
    causationId: options.causationId ?? undefined,
    payload: {
      customerId: options.payload?.customerId ?? '',
      comment: options.payload?.comment ?? ''
    }
  };
}
