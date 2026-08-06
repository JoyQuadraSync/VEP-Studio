import { validateSerializedTikTokAccountConnectionId } from '../authorization/tiktok-account-connection-id';
import { deepFreezeTikTokValue } from '../validation/tiktok-json-safety';

export type TikTokAccountSyncStatus = 'in_progress' | 'complete' | 'partial' | 'failed';
export interface TikTokAccountSyncCheckpoint {
  readonly synchronizationId: string;
  readonly connectionId: string;
  readonly apiVersion: string;
  readonly incomingCursor?: string;
  readonly nextCursor?: string;
  readonly pagesCompleted: number;
  readonly itemsObserved: number;
  readonly seenCursors: readonly string[];
  readonly seenVideoIds: readonly string[];
  readonly status: TikTokAccountSyncStatus;
  readonly updatedAt: string;
}
export interface TikTokSyncCheckpointRepository {
  create(checkpoint: TikTokAccountSyncCheckpoint): Promise<TikTokAccountSyncCheckpoint>;
  save(checkpoint: TikTokAccountSyncCheckpoint): Promise<TikTokAccountSyncCheckpoint>;
  find(synchronizationId: string): Promise<TikTokAccountSyncCheckpoint | undefined>;
}
export class InMemoryTikTokSyncCheckpointRepository implements TikTokSyncCheckpointRepository {
  private readonly values = new Map<string, TikTokAccountSyncCheckpoint>();
  async create(checkpoint: TikTokAccountSyncCheckpoint): Promise<TikTokAccountSyncCheckpoint> {
    validateSerializedTikTokAccountConnectionId(checkpoint.connectionId); if (this.values.has(checkpoint.synchronizationId)) throw new Error('Synchronization attempt already exists.');
    return this.store(checkpoint);
  }
  async save(checkpoint: TikTokAccountSyncCheckpoint): Promise<TikTokAccountSyncCheckpoint> {
    validateSerializedTikTokAccountConnectionId(checkpoint.connectionId); const existing = this.values.get(checkpoint.synchronizationId);
    if (!existing || existing.connectionId !== checkpoint.connectionId || existing.apiVersion !== checkpoint.apiVersion) throw new Error('Synchronization checkpoint identity mismatch.');
    if (checkpoint.pagesCompleted < existing.pagesCompleted || checkpoint.itemsObserved < existing.itemsObserved) throw new Error('Synchronization checkpoint cannot regress.');
    return this.store(checkpoint);
  }
  async find(id: string): Promise<TikTokAccountSyncCheckpoint | undefined> { const value = this.values.get(id); return value ? deepFreezeTikTokValue(structuredClone(value)) : undefined; }
  private store(checkpoint: TikTokAccountSyncCheckpoint): TikTokAccountSyncCheckpoint {
    const stored = deepFreezeTikTokValue(structuredClone(checkpoint)); this.values.set(checkpoint.synchronizationId, stored); return structuredClone(stored);
  }
}
