import { BaseEvent, EventMap } from '../types/event';
import type { BusResult } from './event-bus';

export type EventHandler<TEventType extends keyof EventMap = keyof EventMap> = (
  event: BaseEvent<EventMap[TEventType]>
) => BusResult | Promise<BusResult>;

export interface EventSubscription<TEventType extends keyof EventMap = keyof EventMap> {
  subscriberName: string;
  handler: EventHandler<TEventType>;
}
