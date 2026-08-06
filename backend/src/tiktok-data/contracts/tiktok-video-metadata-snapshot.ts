import { TikTokAccountSnapshotProvenance, TikTokEphemeralUrl } from './tiktok-account-snapshot-provenance';

export interface TikTokVideoMetadataSnapshot {
  readonly snapshotId: string;
  readonly revision: number;
  readonly providerAccountId: string;
  readonly videoId: string;
  readonly createdAt: string;
  readonly title?: string;
  readonly description?: string;
  readonly durationSeconds?: number;
  readonly shareUrl?: string;
  readonly coverImageUrl?: TikTokEphemeralUrl;
  readonly provenance: TikTokAccountSnapshotProvenance;
}
