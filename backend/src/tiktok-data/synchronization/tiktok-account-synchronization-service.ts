import { assertTikTokAccountConnectionId, serializeTikTokAccountConnectionId, TikTokAccountConnectionId } from '../authorization/tiktok-account-connection-id';
import { TikTokAccountDataClient } from '../clients/tiktok-account-data-client';
import { createTikTokAccountDataFailure, isTikTokAccountDataFailure, TikTokAccountDataFailure } from '../failures/tiktok-account-data-failure';
import { TikTokAccountDataNormalizer } from '../normalization/tiktok-account-data-normalizer';
import { TikTokProfileSnapshotRepository } from '../repositories/tiktok-profile-snapshot-repository';
import { TikTokSyncCheckpointRepository, TikTokAccountSyncCheckpoint } from '../repositories/tiktok-sync-checkpoint-repository';
import { TikTokVideoMetadataSnapshotRepository } from '../repositories/tiktok-video-metadata-snapshot-repository';
import { TikTokVideoMetricSnapshotRepository } from '../repositories/tiktok-video-metric-snapshot-repository';
import { TikTokAccountPageSnapshotRepository } from '../repositories/tiktok-account-page-snapshot-repository';
import { compareUtf16 } from '../validation/tiktok-json-safety';
import { TikTokAccountDataValidator } from '../validation/tiktok-account-data-validator';
import { TikTokNormalizedSnapshotValidator } from '../validation/tiktok-normalized-snapshot-validator';
import { TikTokAccountSyncPolicy, validateTikTokAccountSyncPolicy } from './tiktok-account-sync-policy';

export interface TikTokSynchronizationClock { now(): Date; }
export interface TikTokSynchronizationIdGenerator { next(): string; }
export interface TikTokAccountSynchronizationResult {
  readonly synchronizationId: string;
  readonly status: 'complete' | 'partial';
  readonly pagesCompleted: number;
  readonly itemsObserved: number;
  readonly uniqueVideosSaved: number;
  readonly checkpoint: TikTokAccountSyncCheckpoint;
  readonly failure?: TikTokAccountDataFailure;
}

export class TikTokAccountSynchronizationService {
  private readonly normalized: TikTokNormalizedSnapshotValidator = new TikTokNormalizedSnapshotValidator();
  constructor(private readonly client: TikTokAccountDataClient, private readonly validator: TikTokAccountDataValidator,
    private readonly normalizer: TikTokAccountDataNormalizer, private readonly profiles: TikTokProfileSnapshotRepository,
    private readonly metadata: TikTokVideoMetadataSnapshotRepository, private readonly metrics: TikTokVideoMetricSnapshotRepository,
    private readonly pageRepository: TikTokAccountPageSnapshotRepository,
    private readonly checkpoints: TikTokSyncCheckpointRepository, private readonly clock: TikTokSynchronizationClock,
    private readonly ids: TikTokSynchronizationIdGenerator) {}

  async synchronize(connectionId: TikTokAccountConnectionId, inputPolicy: TikTokAccountSyncPolicy): Promise<TikTokAccountSynchronizationResult> {
    assertTikTokAccountConnectionId(connectionId); const policy = validateTikTokAccountSyncPolicy(inputPolicy); const synchronizationId = this.ids.next();
    let checkpoint = await this.createCheckpoint({ synchronizationId, connectionId: serializeTikTokAccountConnectionId(connectionId), apiVersion: policy.apiVersion,
      pagesCompleted: 0, itemsObserved: 0, seenCursors: [], seenVideoIds: [], status: 'in_progress', updatedAt: this.timestamp() }, connectionId);
    try {
      const profileSource = await this.client.getProfile(connectionId); this.validateProfile(profileSource, connectionId);
      const initialTime = this.timestamp();
      const profile = this.normalizeProfile(profileSource, { connectionId, apiVersion: policy.apiVersion,
        scopesUsed: policy.scopesUsed, fetchedAt: initialTime, measuredAt: initialTime, completeness: 'complete' }, connectionId);
      await this.saveProfile(profile, connectionId);
      return this.crawl(connectionId, policy, checkpoint);
    } catch (error: unknown) {
      const failure = isTikTokAccountDataFailure(error) ? error : createTikTokAccountDataFailure({ code: 'unknown', operation: 'synchronize_profile', connectionId });
      checkpoint = await this.saveCheckpoint({ ...checkpoint, status: 'partial', updatedAt: this.timestamp() }, connectionId);
      return { ...this.result(checkpoint, 0), failure };
    }
  }

  async resume(connectionId: TikTokAccountConnectionId, synchronizationId: string, inputPolicy: TikTokAccountSyncPolicy): Promise<TikTokAccountSynchronizationResult> {
    assertTikTokAccountConnectionId(connectionId); const policy = validateTikTokAccountSyncPolicy(inputPolicy); const existing = await this.findCheckpoint(synchronizationId, connectionId);
    if (!existing || existing.connectionId !== serializeTikTokAccountConnectionId(connectionId) || existing.apiVersion !== policy.apiVersion || existing.status !== 'partial') throw createTikTokAccountDataFailure({ code: 'pagination_invalid', operation: 'resume_sync', connectionId });
    return this.crawl(connectionId, policy, { ...existing, status: 'in_progress', updatedAt: this.timestamp() });
  }

  private async crawl(connectionId: TikTokAccountConnectionId, policy: TikTokAccountSyncPolicy, initial: TikTokAccountSyncCheckpoint): Promise<TikTokAccountSynchronizationResult> {
    let checkpoint = initial; let cursor = checkpoint.nextCursor; const seenCursors = new Set(checkpoint.seenCursors); const seenVideos = new Set(checkpoint.seenVideoIds);
    try {
      while (checkpoint.pagesCompleted < policy.maxPages && checkpoint.itemsObserved < policy.maxItems) {
        const page = await this.client.listVideosPage(connectionId, cursor);
        if (isMissingRequiredNextCursor(page)) throw createTikTokAccountDataFailure({ code: 'pagination_invalid', operation: 'list_videos', connectionId });
        this.validatePage(page, connectionId);
        if (page.hasMore && (page.nextCursor === cursor || seenCursors.has(page.nextCursor!))) throw createTikTokAccountDataFailure({ code: 'pagination_invalid', operation: 'list_videos', connectionId });
        const pageIds = new Set<string>(); const unique = page.videos.filter((video) => { if (seenVideos.has(video.videoId) || pageIds.has(video.videoId)) return false; pageIds.add(video.videoId); return true; });
        if (checkpoint.itemsObserved + unique.length > policy.maxItems) return this.partial(checkpoint, connectionId);
        const time = this.timestamp(); const queried = await this.queryMetrics(connectionId, unique, policy);
        const normalized = unique.map((video) => { const metrics = queried.get(video.videoId)!; return this.normalizeVideo({ ...video,
          viewCount: metrics.viewCount, likeCount: metrics.likeCount, commentCount: metrics.commentCount, shareCount: metrics.shareCount }, { connectionId, apiVersion: policy.apiVersion,
          scopesUsed: policy.scopesUsed, fetchedAt: time, measuredAt: time, completeness: 'complete' }, connectionId); });
        await this.savePage({ metadata: normalized.map((item) => item.metadata), metrics: normalized.map((item) => item.metrics) }, connectionId);
        unique.forEach((video) => seenVideos.add(video.videoId));
        checkpoint = await this.saveCheckpoint({ ...checkpoint, incomingCursor: cursor, nextCursor: page.nextCursor,
          pagesCompleted: checkpoint.pagesCompleted + 1, itemsObserved: checkpoint.itemsObserved + unique.length,
          seenCursors: [...seenCursors, ...(page.nextCursor === undefined ? [] : [page.nextCursor])], seenVideoIds: [...seenVideos].sort(compareUtf16),
          status: page.hasMore ? 'in_progress' : 'complete', updatedAt: time }, connectionId);
        if (!page.hasMore) return this.result(checkpoint, seenVideos.size);
        cursor = page.nextCursor; seenCursors.add(cursor!);
      }
      return this.partial(checkpoint, connectionId, seenVideos.size);
    } catch (error: unknown) {
      const failure = isTikTokAccountDataFailure(error) ? error : createTikTokAccountDataFailure({ code: 'unknown', operation: 'synchronize', connectionId });
      checkpoint = await this.saveCheckpoint({ ...checkpoint, status: 'partial', updatedAt: this.timestamp() }, connectionId);
      return { ...this.result(checkpoint, seenVideos.size), failure };
    }
  }
  private async queryMetrics(connectionId: TikTokAccountConnectionId, listed: readonly import('../contracts/tiktok-account-video-source').TikTokAccountVideoSource[], policy: TikTokAccountSyncPolicy): Promise<Map<string, import('../contracts/tiktok-account-video-source').TikTokAccountVideoSource>> {
    const ids = listed.map((item) => item.videoId).sort(compareUtf16); const batchSize = policy.videoQueryBatchSize ?? Math.max(1, ids.length); const result = new Map<string, import('../contracts/tiktok-account-video-source').TikTokAccountVideoSource>();
    for (let index = 0; index < ids.length; index += batchSize) {
      const batch = ids.slice(index, index + batchSize); const response = await this.client.getVideosByIds(connectionId, batch);
      if (!Array.isArray(response)) throw createTikTokAccountDataFailure({ code: 'response_invalid', operation: 'query_video_metrics', connectionId });
      for (const item of response) { this.validateVideo(item, connectionId); const listedItem = listed.find((candidate) => candidate.videoId === item.videoId); if (!batch.includes(item.videoId) || result.has(item.videoId) || !listedItem || listedItem.providerAccountId !== item.providerAccountId) throw createTikTokAccountDataFailure({ code: 'response_invalid', operation: 'query_video_metrics', connectionId }); result.set(item.videoId, item); }
      for (const id of batch) if (!result.has(id)) throw createTikTokAccountDataFailure({ code: 'response_invalid', operation: 'query_video_metrics', connectionId });
    }
    for (const item of listed) { const authoritative = result.get(item.videoId)!; for (const key of ['viewCount','likeCount','commentCount','shareCount'] as const) if (item[key] !== undefined && item[key] !== authoritative[key]) throw createTikTokAccountDataFailure({ code: 'response_invalid', operation: 'query_video_metrics', connectionId }); }
    return result;
  }
  private async partial(checkpoint: TikTokAccountSyncCheckpoint, connectionId: TikTokAccountConnectionId, unique = 0): Promise<TikTokAccountSynchronizationResult> {
    const stored = await this.saveCheckpoint({ ...checkpoint, status: 'partial', updatedAt: this.timestamp() }, connectionId); return this.result(stored, unique);
  }
  private result(checkpoint: TikTokAccountSyncCheckpoint, unique: number): TikTokAccountSynchronizationResult {
    return Object.freeze({ synchronizationId: checkpoint.synchronizationId, status: checkpoint.status === 'complete' ? 'complete' : 'partial', pagesCompleted: checkpoint.pagesCompleted,
      itemsObserved: checkpoint.itemsObserved, uniqueVideosSaved: unique, checkpoint });
  }
  private timestamp(): string { const value = this.clock.now(); if (!Number.isFinite(value.getTime())) throw new TypeError('Clock returned invalid time.'); return value.toISOString(); }

  private validateProfile(value: unknown, connectionId: TikTokAccountConnectionId): void { try { this.validator.validateProfile(value); } catch { throw createTikTokAccountDataFailure({ code: 'response_invalid', operation: 'validate_profile_source', connectionId }); } }
  private validatePage(value: unknown, connectionId: TikTokAccountConnectionId): void { try { this.validator.validatePage(value); } catch { throw createTikTokAccountDataFailure({ code: 'response_invalid', operation: 'validate_video_page_source', connectionId }); } }
  private validateVideo(value: unknown, connectionId: TikTokAccountConnectionId): void { try { this.validator.validateVideo(value); } catch { throw createTikTokAccountDataFailure({ code: 'response_invalid', operation: 'validate_video_source', connectionId }); } }
  private normalizeProfile(source: Parameters<TikTokAccountDataNormalizer['normalizeProfile']>[0], context: Parameters<TikTokAccountDataNormalizer['normalizeProfile']>[1], connectionId: TikTokAccountConnectionId): ReturnType<TikTokAccountDataNormalizer['normalizeProfile']> { try { const value = this.normalizer.normalizeProfile(source, context); this.normalized.validateProfile(value); return value; } catch { throw createTikTokAccountDataFailure({ code: 'snapshot_validation_failed', operation: 'normalize_profile', connectionId }); } }
  private normalizeVideo(source: Parameters<TikTokAccountDataNormalizer['normalizeVideo']>[0], context: Parameters<TikTokAccountDataNormalizer['normalizeVideo']>[1], connectionId: TikTokAccountConnectionId): ReturnType<TikTokAccountDataNormalizer['normalizeVideo']> { try { const value = this.normalizer.normalizeVideo(source, context); this.normalized.validateMetadata(value.metadata); this.normalized.validateMetrics(value.metrics); return value; } catch { throw createTikTokAccountDataFailure({ code: 'snapshot_validation_failed', operation: 'normalize_video', connectionId }); } }
  private async saveProfile(snapshot: Parameters<TikTokProfileSnapshotRepository['save']>[0], connectionId: TikTokAccountConnectionId): Promise<void> { try { await this.profiles.save(snapshot); } catch (error: unknown) { if (isTikTokAccountDataFailure(error)) throw error; throw createTikTokAccountDataFailure({ code: 'repository_unavailable', operation: 'save_profile_snapshot', connectionId }); } }
  private async savePage(page: Parameters<TikTokAccountPageSnapshotRepository['savePage']>[0], connectionId: TikTokAccountConnectionId): Promise<void> { try { await this.pageRepository.savePage(page); } catch (error: unknown) { if (isTikTokAccountDataFailure(error)) throw error; throw createTikTokAccountDataFailure({ code: 'repository_unavailable', operation: 'save_video_page', connectionId }); } }
  private async createCheckpoint(checkpoint: TikTokAccountSyncCheckpoint, connectionId: TikTokAccountConnectionId): Promise<TikTokAccountSyncCheckpoint> { try { return await this.checkpoints.create(checkpoint); } catch (error: unknown) { if (isTikTokAccountDataFailure(error)) throw error; throw createTikTokAccountDataFailure({ code: 'repository_unavailable', operation: 'create_sync_checkpoint', connectionId }); } }
  private async saveCheckpoint(checkpoint: TikTokAccountSyncCheckpoint, connectionId: TikTokAccountConnectionId): Promise<TikTokAccountSyncCheckpoint> { try { return await this.checkpoints.save(checkpoint); } catch (error: unknown) { if (isTikTokAccountDataFailure(error)) throw error; throw createTikTokAccountDataFailure({ code: 'repository_unavailable', operation: 'save_sync_checkpoint', connectionId }); } }
  private async findCheckpoint(synchronizationId: string, connectionId: TikTokAccountConnectionId): Promise<TikTokAccountSyncCheckpoint | undefined> { try { return await this.checkpoints.find(synchronizationId); } catch (error: unknown) { if (isTikTokAccountDataFailure(error)) throw error; throw createTikTokAccountDataFailure({ code: 'repository_unavailable', operation: 'find_sync_checkpoint', connectionId }); } }
}

function isMissingRequiredNextCursor(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as Record<string, unknown>).hasMore === true && typeof (value as Record<string, unknown>).nextCursor !== 'string';
}
