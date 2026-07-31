import { EventPayload } from '../schemas/event.schema';

export type BusResult = {
  statusCode: number;
  body: unknown;
};

export type EventHandler = (event: EventPayload) => BusResult | Promise<BusResult>;

export class EventBus {
  private handlers: EventHandler[] = [];

  subscribe(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  async publish(event: EventPayload): Promise<BusResult[]> {
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
