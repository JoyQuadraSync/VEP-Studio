import { BaseEvent, EventMap } from '../types/event';
import { BusResult } from './event-bus';

export type EventHandler<TEventType extends keyof EventMap = keyof EventMap> = (
  event: BaseEvent<EventMap[TEventType]>
) => BusResult | Promise<BusResult>;
