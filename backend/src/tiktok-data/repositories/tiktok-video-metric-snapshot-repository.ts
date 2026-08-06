import { serializeTikTokAccountConnectionId, TikTokAccountConnectionId, validateSerializedTikTokAccountConnectionId } from '../authorization/tiktok-account-connection-id';
import { TikTokVideoMetricSnapshot } from '../contracts/tiktok-video-metric-snapshot';
import { ImmutableSnapshotStore } from './snapshot-repository-support';
import { TikTokNormalizedSnapshotValidator } from '../validation/tiktok-normalized-snapshot-validator';

export interface TikTokVideoMetricSnapshotRepository {
  save(snapshot: TikTokVideoMetricSnapshot): Promise<TikTokVideoMetricSnapshot>;
  listByVideoId(connectionId: TikTokAccountConnectionId, videoId: string): Promise<readonly TikTokVideoMetricSnapshot[]>;
  findById(snapshotId: string): Promise<TikTokVideoMetricSnapshot | undefined>;
}
export class InMemoryTikTokVideoMetricSnapshotRepository implements TikTokVideoMetricSnapshotRepository {
  private readonly store = new ImmutableSnapshotStore<TikTokVideoMetricSnapshot>((item) => `${item.provenance.connectionId}\u0000${item.videoId}`);
  private readonly validator: TikTokNormalizedSnapshotValidator = new TikTokNormalizedSnapshotValidator();
  async save(snapshot: TikTokVideoMetricSnapshot): Promise<TikTokVideoMetricSnapshot> { this.validator.validateMetrics(snapshot); validateSerializedTikTokAccountConnectionId(snapshot.provenance.connectionId); return this.store.save(snapshot); }
  async listByVideoId(connectionId: TikTokAccountConnectionId, videoId: string): Promise<readonly TikTokVideoMetricSnapshot[]> {
    return [...this.store.list(`${serializeTikTokAccountConnectionId(connectionId)}\u0000${videoId}`)].sort((a, b) => a.measuredAt < b.measuredAt ? -1 : a.measuredAt > b.measuredAt ? 1 : a.snapshotId < b.snapshotId ? -1 : 1);
  }
  async findById(snapshotId: string): Promise<TikTokVideoMetricSnapshot | undefined> { return this.store.findById(snapshotId); }
  preflight(snapshot: TikTokVideoMetricSnapshot): void { this.validator.validateMetrics(snapshot); this.store.preflight(snapshot); }
  captureState(): ReturnType<ImmutableSnapshotStore<TikTokVideoMetricSnapshot>['capture']> { return this.store.capture(); }
  restoreState(state: ReturnType<ImmutableSnapshotStore<TikTokVideoMetricSnapshot>['capture']>): void { this.store.restore(state); }
}
