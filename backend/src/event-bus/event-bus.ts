import { BaseEvent, EventMap } from '../types/event';
import { EventHandler } from './event-handler.type';

export type BusResult = {
  statusCode: number;
  body: unknown;
};

export class EventBus<TEventType extends keyof EventMap = keyof EventMap> {
  private handlers: Array<EventHandler<TEventType>> = [];

  subscribe(handler: EventHandler<TEventType>): void {
    this.handlers.push(handler);
  }

  async publish(event: BaseEvent<EventMap[TEventType]>): Promise<BusResult[]> {
    const settledResults = this.handlers.map((handler) => {
      return Promise.resolve()
        .then(() => handler(event))
        .then((result) => result)
        .catch(() => ({
          statusCode: 500,
          body: {
            success: false,
            error: 'Subscriber failed'
          }
        }));
    });

    return Promise.all(settledResults);
  }
}
