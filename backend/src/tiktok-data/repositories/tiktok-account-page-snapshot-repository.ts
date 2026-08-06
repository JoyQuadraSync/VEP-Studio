import { TikTokVideoMetadataSnapshot } from '../contracts/tiktok-video-metadata-snapshot';
import { TikTokVideoMetricSnapshot } from '../contracts/tiktok-video-metric-snapshot';
import { InMemoryTikTokVideoMetadataSnapshotRepository } from './tiktok-video-metadata-snapshot-repository';
import { InMemoryTikTokVideoMetricSnapshotRepository } from './tiktok-video-metric-snapshot-repository';

export interface TikTokAccountNormalizedPage { readonly metadata: readonly TikTokVideoMetadataSnapshot[]; readonly metrics: readonly TikTokVideoMetricSnapshot[]; }
export interface TikTokAccountPageSnapshotRepository { savePage(page: TikTokAccountNormalizedPage): Promise<void>; }

export class InMemoryTikTokAccountPageSnapshotRepository implements TikTokAccountPageSnapshotRepository {
  constructor(readonly metadata: InMemoryTikTokVideoMetadataSnapshotRepository, readonly metrics: InMemoryTikTokVideoMetricSnapshotRepository) {}
  async savePage(page: TikTokAccountNormalizedPage): Promise<void> {
    const metadataState = this.metadata.captureState(); const metricState = this.metrics.captureState();
    try {
      for (const snapshot of page.metadata) this.metadata.preflight(snapshot);
      for (const snapshot of page.metrics) this.metrics.preflight(snapshot);
      for (const snapshot of page.metadata) await this.metadata.save(snapshot);
      for (const snapshot of page.metrics) await this.metrics.save(snapshot);
    } catch (error: unknown) {
      this.metadata.restoreState(metadataState); this.metrics.restoreState(metricState); throw error;
    }
  }
}
