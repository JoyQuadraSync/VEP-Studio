import { ExecutionContext } from './execution-context';
import { SubscriberResult } from './subscriber-result';

export interface PublishResult {
  eventId: string;
  executionContext: ExecutionContext;
  durationMs: number;
  successCount: number;
  failureCount: number;
  subscriberResults: SubscriberResult[];
}
