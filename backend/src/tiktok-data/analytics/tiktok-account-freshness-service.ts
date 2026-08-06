import { SnapshotFreshness } from '../contracts/tiktok-account-snapshot-provenance';
import { isStrictTimestamp } from '../validation/tiktok-json-safety';
import { TikTokAccountFreshnessPolicy } from './tiktok-account-analytics-policy';

export interface TikTokFreshnessClock { now(): Date; }
export class TikTokAccountFreshnessService {
  constructor(private readonly clock: TikTokFreshnessClock) {}
  profile(timestamp: string, policy: TikTokAccountFreshnessPolicy): SnapshotFreshness { return this.classify(timestamp, policy.profileMaxAgeMs); }
  videoList(timestamp: string, policy: TikTokAccountFreshnessPolicy): SnapshotFreshness { return this.classify(timestamp, policy.recentVideoListMaxAgeMs); }
  videoMetric(createdAt: string | undefined, measuredAt: string, policy: TikTokAccountFreshnessPolicy): SnapshotFreshness {
    const now = this.now(); if (createdAt === undefined || !isStrictTimestamp(createdAt) || Date.parse(createdAt) > now) return 'unknown';
    const recent = now - Date.parse(createdAt) <= policy.recentVideoAgeBoundaryMs;
    return this.classifyAt(measuredAt, recent ? policy.recentVideoMetricsMaxAgeMs : policy.olderVideoMetricsMaxAgeMs, now);
  }
  analyticsSummary(timestamp: string, policy: TikTokAccountFreshnessPolicy): SnapshotFreshness { return this.classify(timestamp, policy.analyticsSummaryMaxAgeMs); }
  private classify(timestamp: string, maxAgeMs: number): SnapshotFreshness { return this.classifyAt(timestamp, maxAgeMs, this.now()); }
  private classifyAt(timestamp: string, maxAgeMs: number, now: number): SnapshotFreshness { if (!isStrictTimestamp(timestamp)) return 'unknown'; const observed = Date.parse(timestamp); if (observed > now) return 'unknown'; return now - observed <= maxAgeMs ? 'fresh' : 'stale'; }
  private now(): number { const value = this.clock.now().getTime(); if (!Number.isFinite(value)) throw new TypeError('Clock returned invalid time.'); return value; }
}
