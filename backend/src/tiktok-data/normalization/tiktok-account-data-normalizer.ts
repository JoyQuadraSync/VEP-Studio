import { createHash } from 'node:crypto';
import { TikTokAccountConnectionId } from '../authorization/tiktok-account-connection-id';
import { TikTokAccountProfileSnapshot } from '../contracts/tiktok-account-profile-snapshot';
import { TikTokAccountProfileSource } from '../contracts/tiktok-account-profile-source';
import { SnapshotCompleteness, TikTokAccountSnapshotProvenance } from '../contracts/tiktok-account-snapshot-provenance';
import { TikTokAccountVideoSource } from '../contracts/tiktok-account-video-source';
import { TikTokVideoMetadataSnapshot } from '../contracts/tiktok-video-metadata-snapshot';
import { TikTokVideoMetricSnapshot } from '../contracts/tiktok-video-metric-snapshot';
import { TikTokAccountDataValidator } from '../validation/tiktok-account-data-validator';
import { canonicalizeTikTokValue, deepFreezeTikTokValue, isStrictTimestamp } from '../validation/tiktok-json-safety';
import { assertTikTokAccountConnectionId, serializeTikTokAccountConnectionId } from '../authorization/tiktok-account-connection-id';

export interface TikTokNormalizationContext {
  readonly connectionId: TikTokAccountConnectionId;
  readonly apiVersion: string;
  readonly scopesUsed: readonly string[];
  readonly fetchedAt: string;
  readonly measuredAt: string;
  readonly completeness: SnapshotCompleteness;
}

export class TikTokAccountDataNormalizer {
  private readonly validator: TikTokAccountDataValidator;
  constructor(validator: TikTokAccountDataValidator = new TikTokAccountDataValidator()) { this.validator = validator; }

  normalizeProfile(source: TikTokAccountProfileSource, context: TikTokNormalizationContext): TikTokAccountProfileSnapshot {
    this.validator.validateProfile(source); this.validateContext(context);
    const content = { providerAccountId: source.providerAccountId,
      ...(source.displayName === undefined ? {} : { displayName: source.displayName }),
      ...(source.avatarUrl === undefined ? {} : { avatarUrl: { value: source.avatarUrl, persistenceKind: 'ephemeral_reference' as const, observedAt: context.fetchedAt } }),
      ...(source.biography === undefined ? {} : { biography: source.biography }),
      ...(source.profileUrl === undefined ? {} : { profileUrl: source.profileUrl }) };
    const identityTail = source.sourceUpdatedAt ?? hash({ providerAccountId: source.providerAccountId,
      ...(source.displayName === undefined ? {} : { displayName: source.displayName }), ...(source.avatarUrl === undefined ? {} : { avatarUrl: source.avatarUrl }),
      ...(source.biography === undefined ? {} : { biography: source.biography }), ...(source.profileUrl === undefined ? {} : { profileUrl: source.profileUrl }) });
    const serializedConnectionId = serializeTikTokAccountConnectionId(context.connectionId);
    return deepFreezeTikTokValue({ snapshotId: hash(['tiktok_account_profile', serializedConnectionId, source.providerAccountId, identityTail]), revision: 1,
      ...content, provenance: this.provenance(source.providerAccountId, source.sourceUpdatedAt, context) });
  }

  normalizeVideo(source: TikTokAccountVideoSource, context: TikTokNormalizationContext): Readonly<{ metadata: TikTokVideoMetadataSnapshot; metrics: TikTokVideoMetricSnapshot }> {
    this.validator.validateVideo(source); this.validateContext(context);
    const metadataContent = { providerAccountId: source.providerAccountId, videoId: source.videoId, createdAt: source.createdAt,
      ...(source.title === undefined ? {} : { title: source.title }), ...(source.description === undefined ? {} : { description: source.description }),
      ...(source.durationSeconds === undefined ? {} : { durationSeconds: source.durationSeconds }), ...(source.shareUrl === undefined ? {} : { shareUrl: source.shareUrl }),
      ...(source.coverImageUrl === undefined ? {} : { coverImageUrl: { value: source.coverImageUrl, persistenceKind: 'ephemeral_reference' as const, observedAt: context.fetchedAt } }) };
    const metricContent = { ...(source.viewCount === undefined ? {} : { viewCount: source.viewCount }), ...(source.likeCount === undefined ? {} : { likeCount: source.likeCount }),
      ...(source.commentCount === undefined ? {} : { commentCount: source.commentCount }), ...(source.shareCount === undefined ? {} : { shareCount: source.shareCount }) };
    const provenance = this.provenance(source.providerAccountId, source.sourceUpdatedAt, context);
    return deepFreezeTikTokValue({
      metadata: { snapshotId: hash(['tiktok_video_metadata', serializeTikTokAccountConnectionId(context.connectionId), source.providerAccountId, source.videoId, source.sourceUpdatedAt ?? hash({
        providerAccountId: source.providerAccountId, videoId: source.videoId, createdAt: source.createdAt,
        ...(source.title === undefined ? {} : { title: source.title }), ...(source.description === undefined ? {} : { description: source.description }),
        ...(source.durationSeconds === undefined ? {} : { durationSeconds: source.durationSeconds }), ...(source.shareUrl === undefined ? {} : { shareUrl: source.shareUrl }),
        ...(source.coverImageUrl === undefined ? {} : { coverImageUrl: source.coverImageUrl })
      })]), revision: 1, ...metadataContent, provenance },
      metrics: { snapshotId: hash(['tiktok_video_metrics', serializeTikTokAccountConnectionId(context.connectionId), source.providerAccountId, source.videoId, context.measuredAt, hash(metricContent)]), revision: 1,
        providerAccountId: source.providerAccountId, videoId: source.videoId, measuredAt: context.measuredAt, ...metricContent, completeness: context.completeness, provenance }
    });
  }

  private provenance(providerAccountId: string, sourceUpdatedAt: string | undefined, context: TikTokNormalizationContext): TikTokAccountSnapshotProvenance {
    return { sourceSystem: 'tiktok_account', connectionId: serializeTikTokAccountConnectionId(context.connectionId), providerAccountId,
      apiVersion: context.apiVersion, scopesUsed: [...context.scopesUsed], fetchedAt: context.fetchedAt,
      ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }), completeness: context.completeness };
  }
  private validateContext(context: TikTokNormalizationContext): void {
    assertTikTokAccountConnectionId(context.connectionId);
    if (!context.apiVersion || !isStrictTimestamp(context.fetchedAt) || !isStrictTimestamp(context.measuredAt)) throw new TypeError('Normalization context is invalid.');
  }
}

export function hashTikTokValue(value: unknown): string { return hash(value); }
function hash(value: unknown): string { return createHash('sha256').update(canonicalizeTikTokValue(value), 'utf8').digest('hex'); }
