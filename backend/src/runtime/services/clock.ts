/**
 * Provides the current time for runtime services.
 *
 * Abstracting time behind an interface makes
 * timeout, retry, metrics and tests deterministic.
 */
export interface Clock {
  now(): Date;
}

/**
 * Default production implementation.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}