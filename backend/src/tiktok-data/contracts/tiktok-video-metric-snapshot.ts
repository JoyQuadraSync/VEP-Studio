import { SnapshotCompleteness, TikTokAccountSnapshotProvenance } from './tiktok-account-snapshot-provenance';

export interface TikTokVideoMetricSnapshot {
  readonly snapshotId: string;
  readonly revision: number;
  readonly providerAccountId: string;
  readonly videoId: string;
  readonly measuredAt: string;
  readonly viewCount?: number;
  readonly likeCount?: number;
  readonly commentCount?: number;
  readonly shareCount?: number;
  readonly completeness: SnapshotCompleteness;
  readonly provenance: TikTokAccountSnapshotProvenance;
}
