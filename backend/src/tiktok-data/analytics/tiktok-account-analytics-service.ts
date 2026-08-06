import { TikTokAccountConnectionId, assertTikTokAccountConnectionId, serializeTikTokAccountConnectionId } from '../authorization/tiktok-account-connection-id';
import { TikTokVideoMetricSnapshot } from '../contracts/tiktok-video-metric-snapshot';
import { TikTokVideoMetadataSnapshot } from '../contracts/tiktok-video-metadata-snapshot';
import { hashTikTokValue } from '../normalization/tiktok-account-data-normalizer';
import { compareUtf16, deepFreezeTikTokValue, isStrictTimestamp } from '../validation/tiktok-json-safety';
import { TikTokAccountAnalyticsSummary, TikTokMetricUnavailableReason, TikTokVideoAnalytics } from './tiktok-account-analytics';
import { TikTokAccountAnalyticsPolicy, validateTikTokAccountAnalyticsPolicy } from './tiktok-account-analytics-policy';
import { TikTokAccountFreshnessService } from './tiktok-account-freshness-service';
export interface TikTokAnalyticsClock { now(): Date; }

export class TikTokAccountAnalyticsService {
  constructor(private readonly clock: TikTokAnalyticsClock) {}
  analyze(connectionId: TikTokAccountConnectionId, snapshots: readonly TikTokVideoMetricSnapshot[], inputPolicy: TikTokAccountAnalyticsPolicy, metadata: readonly TikTokVideoMetadataSnapshot[] = []): TikTokAccountAnalyticsSummary {
    assertTikTokAccountConnectionId(connectionId); if (snapshots.length === 0) throw new TypeError('Analytics requires metric snapshots.');
    const serializedConnectionId = serializeTikTokAccountConnectionId(connectionId);
    const policy = validateTikTokAccountAnalyticsPolicy(inputPolicy); const now = this.clock.now(); if (!Number.isFinite(now.getTime())) throw new TypeError('Clock returned invalid time.');
    const ordered = [...snapshots].sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt) || compareUtf16(a.videoId, b.videoId) || a.revision - b.revision || compareUtf16(a.snapshotId, b.snapshotId));
    if (ordered.some((item) => item.provenance.connectionId !== serializedConnectionId || !isStrictTimestamp(item.measuredAt))) throw new TypeError('Metric snapshot does not belong to analytics input.');
    const latest = new Map<string, TikTokVideoMetricSnapshot>(); const previous = new Map<string, TikTokVideoMetricSnapshot>();
    for (const snapshot of ordered) { const old = latest.get(snapshot.videoId); if (old) previous.set(snapshot.videoId, old); latest.set(snapshot.videoId, snapshot); }
    const createdAt = new Map(metadata.map((item) => [item.videoId, item.createdAt]));
    const videos = [...latest.values()].sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt) || compareUtf16(a.videoId, b.videoId) || a.revision - b.revision || compareUtf16(a.snapshotId, b.snapshotId)).map((item) => this.video(item, previous.get(item.videoId), now, policy, createdAt.get(item.videoId)));
    const top = [...videos].sort(topComparator).slice(0, policy.topListLimit); const generatedAt = now.toISOString();
    const freshness: 'fresh' | 'stale' = videos.some((video) => video.unavailableReasons.includes('stale_snapshot')) ? 'stale' : 'fresh';
    const completeness: 'complete' | 'partial' = [...latest.values()].every((item) => item.completeness === 'complete') ? 'complete' : 'partial';
    const base = { connectionId: serializedConnectionId, generatedAt, observationWindow: { from: ordered[0].measuredAt, to: ordered[ordered.length - 1].measuredAt }, freshness, completeness, sampleSize: latest.size, videos, topVideosByViews: top };
    return deepFreezeTikTokValue({ summaryId: hashTikTokValue(base), ...base });
  }
  private video(current: TikTokVideoMetricSnapshot, previous: TikTokVideoMetricSnapshot | undefined, now: Date, policy: TikTokAccountAnalyticsPolicy, createdAt?: string): TikTokVideoAnalytics {
    const reasons: TikTokMetricUnavailableReason[] = []; const partial = current.completeness !== 'complete'; if (partial) reasons.push('partial_snapshot');
    const freshness = new TikTokAccountFreshnessService({ now: () => new Date(now) }).videoMetric(createdAt ?? current.measuredAt, current.measuredAt, policy.freshness); if (freshness === 'stale') reasons.push('stale_snapshot'); else if (freshness === 'unknown') reasons.push('unknown_freshness');
    const engagements = [current.likeCount, current.commentCount, current.shareCount];
    const sum = engagements.every(validCount) ? engagements.reduce<number>((total, value) => total + (value ?? 0), 0) : undefined;
    const engagementCount = !partial && sum !== undefined && Number.isSafeInteger(sum) ? sum : undefined;
    if (sum !== undefined && !Number.isSafeInteger(sum)) reasons.push('unsafe_aggregate');
    if (engagementCount === undefined) reasons.push('missing_engagement_counter');
    if (current.viewCount === undefined) reasons.push('missing_view_count'); else if (current.viewCount === 0) reasons.push('zero_view_count');
    const engagementRate = engagementCount !== undefined && current.viewCount !== undefined && current.viewCount > 0 ? engagementCount / current.viewCount : undefined;
    let viewsPerDay: number | undefined;
    if (!previous) reasons.push('missing_previous_measurement');
    else if (current.viewCount !== undefined && previous.viewCount !== undefined && current.completeness === 'complete' && previous.completeness === 'complete') {
      const elapsed = Date.parse(current.measuredAt) - Date.parse(previous.measuredAt);
      if (elapsed <= 0) reasons.push('non_increasing_measurement_time'); else if (current.viewCount < previous.viewCount) reasons.push('counter_regression'); else viewsPerDay = (current.viewCount - previous.viewCount) / (elapsed / 86_400_000);
    }
    return { videoId: current.videoId, measuredAt: current.measuredAt,
      ...(current.viewCount === undefined ? {} : { viewCount: current.viewCount }),
      ...(engagementCount === undefined ? {} : { engagementCount }), ...(engagementRate === undefined ? {} : { engagementRate }),
      ...(viewsPerDay === undefined ? {} : { viewsPerDay }), unavailableReasons: [...new Set(reasons)] };
  }
}
function validCount(value: number | undefined): boolean { return value !== undefined && Number.isSafeInteger(value) && value >= 0; }
function topComparator(a: TikTokVideoAnalytics, b: TikTokVideoAnalytics): number { if ((a.viewCount !== undefined) !== (b.viewCount !== undefined)) return a.viewCount !== undefined ? -1 : 1; if ((b.viewCount ?? 0) !== (a.viewCount ?? 0)) return (b.viewCount ?? 0) - (a.viewCount ?? 0); if ((a.engagementCount !== undefined) !== (b.engagementCount !== undefined)) return a.engagementCount !== undefined ? -1 : 1; if ((b.engagementCount ?? 0) !== (a.engagementCount ?? 0)) return (b.engagementCount ?? 0) - (a.engagementCount ?? 0); return compareUtf16(a.videoId, b.videoId); }
