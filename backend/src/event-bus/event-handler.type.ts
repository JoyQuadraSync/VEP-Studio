import { EventPayload } from '../schemas/event.schema';
import { BusResult } from './event-bus';

export type EventHandler = (event: EventPayload) => BusResult | Promise<BusResult>;
