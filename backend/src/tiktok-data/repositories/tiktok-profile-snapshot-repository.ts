import { serializeTikTokAccountConnectionId, TikTokAccountConnectionId, validateSerializedTikTokAccountConnectionId } from '../authorization/tiktok-account-connection-id';
import { TikTokAccountProfileSnapshot } from '../contracts/tiktok-account-profile-snapshot';
import { ImmutableSnapshotStore } from './snapshot-repository-support';
import { TikTokNormalizedSnapshotValidator } from '../validation/tiktok-normalized-snapshot-validator';

export interface TikTokProfileSnapshotRepository {
  save(snapshot: TikTokAccountProfileSnapshot): Promise<TikTokAccountProfileSnapshot>;
  findLatest(connectionId: TikTokAccountConnectionId): Promise<TikTokAccountProfileSnapshot | undefined>;
  findById(snapshotId: string): Promise<TikTokAccountProfileSnapshot | undefined>;
}
export class InMemoryTikTokProfileSnapshotRepository implements TikTokProfileSnapshotRepository {
  private readonly store = new ImmutableSnapshotStore<TikTokAccountProfileSnapshot>((item) => item.provenance.connectionId);
  private readonly validator: TikTokNormalizedSnapshotValidator = new TikTokNormalizedSnapshotValidator();
  async save(snapshot: TikTokAccountProfileSnapshot): Promise<TikTokAccountProfileSnapshot> { this.validator.validateProfile(snapshot); validateSerializedTikTokAccountConnectionId(snapshot.provenance.connectionId); return this.store.save(snapshot); }
  async findLatest(connectionId: TikTokAccountConnectionId): Promise<TikTokAccountProfileSnapshot | undefined> { return this.store.latest(serializeTikTokAccountConnectionId(connectionId)); }
  async findById(snapshotId: string): Promise<TikTokAccountProfileSnapshot | undefined> { return this.store.findById(snapshotId); }
}
