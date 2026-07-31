import { EventHandler } from './event-handler.type';
import { EventPayload } from '../schemas/event.schema';

export type BusResult = {
  statusCode: number;
  body: unknown;
};

export class EventBus {
  private handlers: EventHandler[] = [];

  subscribe(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  publish(event: EventPayload): BusResult[] {
    return this.handlers.map((handler) => handler(event) as BusResult);
  }
}
