import { z } from 'zod';

export const eventSchema = z.object({
  event_id: z.string().min(1, 'event_id must be a non-empty string'),
  event_type: z.string().min(1, 'event_type must be a non-empty string'),
  event_version: z.string().min(1, 'event_version must be a non-empty string'),
  source: z.string().min(1, 'source must be a non-empty string'),
  occurred_at: z.string().datetime({ message: 'occurred_at must be a valid ISO datetime string' }),
  correlation_id: z.string().min(1, 'correlation_id must be a non-empty string'),
  causation_id: z.string().nullable(),
  payload: z.object({})
});

export type EventPayload = z.infer<typeof eventSchema>;
