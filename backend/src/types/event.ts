import { CustomerCommentCreatedPayload } from './payloads';

export interface BaseEvent<TPayload> {
  eventId: string;
  eventType: string;
  correlationId?: string;
  causationId?: string;
  payload: TPayload;
}

export interface EventMap {
  'customer.comment.created': CustomerCommentCreatedPayload;
}
