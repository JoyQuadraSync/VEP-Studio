import { PublishResult } from '../runtime/publish-result';
import { SubscriberResult } from '../runtime/subscriber-result';
import { SubscriberStatus } from '../runtime/subscriber-status';
import { Clock, SystemClock } from '../runtime/services/clock';
import { BaseEvent, EventMap } from '../types/event';
import { EventSubscription } from './event-handler.type';

export type BusResult = {
  statusCode: number;
  body: unknown;
};

export class EventBus<TEventType extends keyof EventMap = keyof EventMap> {
  private subscriptions: Array<EventSubscription<TEventType>> = [];

  constructor(private readonly clock: Clock = new SystemClock()) {}

  subscribe(subscription: EventSubscription<TEventType>): void {
    this.subscriptions.push(subscription);
  }

  async publish(event: BaseEvent<EventMap[TEventType]>): Promise<PublishResult> {
    const startedAt = this.clock.now();

    const subscriberResults = await Promise.all(
      this.subscriptions.map(async (subscription) => {
        const executionStartedAt = this.clock.now();

        try {
          const result = await Promise.resolve(subscription.handler(event));
          const executionFinishedAt = this.clock.now();
          const subscriberResult: SubscriberResult = {
            subscriberName: subscription.subscriberName,
            success: true,
            status: SubscriberStatus.SUCCESS,
            durationMs: executionFinishedAt.getTime() - executionStartedAt.getTime(),
            result
          };

          return subscriberResult;
        } catch {
          const executionFinishedAt = this.clock.now();
          const subscriberResult: SubscriberResult = {
            subscriberName: subscription.subscriberName,
            success: false,
            status: SubscriberStatus.FAILED,
            durationMs: executionFinishedAt.getTime() - executionStartedAt.getTime(),
            result: {
              statusCode: 500,
              body: {
                success: false,
                error: 'Subscriber failed'
              }
            }
          };

          return subscriberResult;
        }
      })
    );

    const finishedAt = this.clock.now();
    const successCount = subscriberResults.filter((result) => result.success).length;
    const failureCount = subscriberResults.length - successCount;

    return {
      eventId: event.eventId,
      executionContext: {
        startedAt,
        finishedAt
      },
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      successCount,
      failureCount,
      subscriberResults
    };
  }
}
