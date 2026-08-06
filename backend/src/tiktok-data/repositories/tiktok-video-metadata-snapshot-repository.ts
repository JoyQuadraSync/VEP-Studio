import { serializeTikTokAccountConnectionId, TikTokAccountConnectionId, validateSerializedTikTokAccountConnectionId } from '../authorization/tiktok-account-connection-id';
import { TikTokVideoMetadataSnapshot } from '../contracts/tiktok-video-metadata-snapshot';
import { ImmutableSnapshotStore } from './snapshot-repository-support';
import { TikTokNormalizedSnapshotValidator } from '../validation/tiktok-normalized-snapshot-validator';

export interface TikTokVideoMetadataSnapshotRepository {
  save(snapshot: TikTokVideoMetadataSnapshot): Promise<TikTokVideoMetadataSnapshot>;
  findLatestByVideoId(connectionId: TikTokAccountConnectionId, videoId: string): Promise<TikTokVideoMetadataSnapshot | undefined>;
  findById(snapshotId: string): Promise<TikTokVideoMetadataSnapshot | undefined>;
}
export class InMemoryTikTokVideoMetadataSnapshotRepository implements TikTokVideoMetadataSnapshotRepository {
  private readonly store = new ImmutableSnapshotStore<TikTokVideoMetadataSnapshot>((item) => `${item.provenance.connectionId}\u0000${item.videoId}`);
  private readonly validator: TikTokNormalizedSnapshotValidator = new TikTokNormalizedSnapshotValidator();
  async save(snapshot: TikTokVideoMetadataSnapshot): Promise<TikTokVideoMetadataSnapshot> { this.validator.validateMetadata(snapshot); validateSerializedTikTokAccountConnectionId(snapshot.provenance.connectionId); return this.store.save(snapshot); }
  async findLatestByVideoId(connectionId: TikTokAccountConnectionId, videoId: string): Promise<TikTokVideoMetadataSnapshot | undefined> { return this.store.latest(`${serializeTikTokAccountConnectionId(connectionId)}\u0000${videoId}`); }
  async findById(snapshotId: string): Promise<TikTokVideoMetadataSnapshot | undefined> { return this.store.findById(snapshotId); }
  preflight(snapshot: TikTokVideoMetadataSnapshot): void { this.validator.validateMetadata(snapshot); this.store.preflight(snapshot); }
  captureState(): ReturnType<ImmutableSnapshotStore<TikTokVideoMetadataSnapshot>['capture']> { return this.store.capture(); }
  restoreState(state: ReturnType<ImmutableSnapshotStore<TikTokVideoMetadataSnapshot>['capture']>): void { this.store.restore(state); }
}
