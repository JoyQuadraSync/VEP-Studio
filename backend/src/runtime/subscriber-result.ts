import type { BusResult } from '../event-bus/event-bus';
import { SubscriberStatus } from './subscriber-status';

export interface SubscriberResult {
  subscriberName: string;
  success: boolean;
  durationMs: number;
  status: SubscriberStatus;
  result: BusResult;
}
