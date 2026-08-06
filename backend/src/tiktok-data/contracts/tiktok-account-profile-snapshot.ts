import { TikTokAccountSnapshotProvenance, TikTokEphemeralUrl } from './tiktok-account-snapshot-provenance';

export interface TikTokAccountProfileSnapshot {
  readonly snapshotId: string;
  readonly revision: number;
  readonly providerAccountId: string;
  readonly displayName?: string;
  readonly avatarUrl?: TikTokEphemeralUrl;
  readonly biography?: string;
  readonly profileUrl?: string;
  readonly provenance: TikTokAccountSnapshotProvenance;
}
