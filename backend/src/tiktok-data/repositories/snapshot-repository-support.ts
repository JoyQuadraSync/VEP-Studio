import { createTikTokAccountDataFailure } from '../failures/tiktok-account-data-failure';
import { canonicalizeTikTokValue, deepFreezeTikTokValue } from '../validation/tiktok-json-safety';

export interface RevisionedSnapshot { readonly snapshotId: string; readonly revision: number; }

export class ImmutableSnapshotStore<T extends RevisionedSnapshot> {
  private readonly byId = new Map<string, T>();
  private readonly streams = new Map<string, T[]>();
  constructor(private readonly entityKey: (value: T) => string) {}
  save(candidate: T): T {
    const existing = this.byId.get(candidate.snapshotId);
    if (existing) {
      const withExistingRevision = { ...candidate, revision: existing.revision };
      if (canonicalizeTikTokValue(contentForComparison(existing)) !== canonicalizeTikTokValue(contentForComparison(withExistingRevision))) {
        throw createTikTokAccountDataFailure({ code: 'repository_conflict', operation: 'save_snapshot' });
      }
      return clone(existing);
    }
    const key = this.entityKey(candidate);
    const stream = this.streams.get(key) ?? [];
    const stored = deepFreezeTikTokValue({ ...candidate, revision: stream.length + 1 }) as T;
    this.byId.set(stored.snapshotId, stored); stream.push(stored); this.streams.set(key, stream);
    return clone(stored);
  }
  findById(id: string): T | undefined { const value = this.byId.get(id); return value ? clone(value) : undefined; }
  latest(key: string): T | undefined { const stream = this.streams.get(key); return stream?.length ? clone(stream[stream.length - 1]) : undefined; }
  list(key: string): readonly T[] { return (this.streams.get(key) ?? []).map(clone); }
  capture(): Readonly<{ byId: readonly T[]; streams: readonly (readonly [string, readonly T[]])[] }> { return { byId: [...this.byId.values()].map(clone), streams: [...this.streams.entries()].map(([key, values]) => [key, values.map(clone)] as const) }; }
  restore(state: Readonly<{ byId: readonly T[]; streams: readonly (readonly [string, readonly T[]])[] }>): void { this.byId.clear(); this.streams.clear(); for (const value of state.byId) this.byId.set(value.snapshotId, deepFreezeTikTokValue(structuredClone(value))); for (const [key, values] of state.streams) this.streams.set(key, values.map((value) => deepFreezeTikTokValue(structuredClone(value)))); }
  preflight(candidate: T): void { const state = this.capture(); try { this.save(candidate); } finally { this.restore(state); } }
}

function clone<T>(value: T): T { return deepFreezeTikTokValue(structuredClone(value)); }
function contentForComparison<T>(value: T): T {
  const copy = structuredClone(value);
  removeObservationMetadata(copy);
  return copy;
}
function removeObservationMetadata(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(removeObservationMetadata); return; }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  delete record.fetchedAt;
  delete record.observedAt;
  for (const child of Object.values(record)) removeObservationMetadata(child);
}
