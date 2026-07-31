import { EventPayload } from '../schemas/event.schema';

export type EventHandler = (event: EventPayload) => unknown;
