export interface TikTokAccountFreshnessPolicy {
  readonly profileMaxAgeMs: number;
  readonly recentVideoListMaxAgeMs: number;
  readonly recentVideoMetricsMaxAgeMs: number;
  readonly olderVideoMetricsMaxAgeMs: number;
  readonly analyticsSummaryMaxAgeMs: number;
  readonly recentVideoAgeBoundaryMs: number;
}
export interface TikTokAccountAnalyticsPolicy { readonly topListLimit: number; readonly freshness: TikTokAccountFreshnessPolicy; }
export function validateTikTokAccountAnalyticsPolicy(policy: TikTokAccountAnalyticsPolicy): TikTokAccountAnalyticsPolicy {
  canonicalizeTikTokValue(policy);
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy) || Object.getPrototypeOf(policy) !== Object.prototype || Object.getOwnPropertySymbols(policy).length > 0) throw new TypeError('Analytics policy must be a plain object.');
  if (Object.getOwnPropertyNames(policy).some((name) => !['topListLimit','freshness'].includes(name))) throw new TypeError('Analytics policy contains an unknown property.');
  if (!Number.isSafeInteger(policy.topListLimit) || policy.topListLimit <= 0) throw new TypeError('Top-list limit is invalid.');
  for (const value of Object.values(policy.freshness)) if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Freshness values must be positive safe integers.');
  return Object.freeze({ topListLimit: policy.topListLimit, freshness: Object.freeze({ ...policy.freshness }) });
}
import { canonicalizeTikTokValue } from '../validation/tiktok-json-safety';
