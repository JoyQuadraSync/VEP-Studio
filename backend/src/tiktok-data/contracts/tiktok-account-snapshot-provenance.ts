export type SnapshotCompleteness = 'complete' | 'partial' | 'unknown';
export type SnapshotFreshness = 'fresh' | 'stale' | 'unknown';

export interface TikTokAccountSnapshotProvenance {
  readonly sourceSystem: 'tiktok_account';
  readonly connectionId: string;
  readonly providerAccountId: string;
  readonly apiVersion: string;
  readonly scopesUsed: readonly string[];
  readonly fetchedAt: string;
  readonly sourceUpdatedAt?: string;
  readonly completeness: SnapshotCompleteness;
}

export interface TikTokEphemeralUrl {
  readonly value: string;
  readonly persistenceKind: 'ephemeral_reference';
  readonly observedAt: string;
}
