import { TikTokAccountProfileSnapshot } from '../contracts/tiktok-account-profile-snapshot';
import { SnapshotCompleteness, TikTokAccountSnapshotProvenance, TikTokEphemeralUrl } from '../contracts/tiktok-account-snapshot-provenance';
import { TikTokVideoMetadataSnapshot } from '../contracts/tiktok-video-metadata-snapshot';
import { TikTokVideoMetricSnapshot } from '../contracts/tiktok-video-metric-snapshot';
import { validateSerializedTikTokAccountConnectionId } from '../authorization/tiktok-account-connection-id';
import { assertEnumerableDataProperties, canonicalizeTikTokValue, isStrictTimestamp } from './tiktok-json-safety';

const COMPLETENESS: readonly SnapshotCompleteness[] = ['complete', 'partial', 'unknown'];
const PROFILE_KEYS = ['snapshotId','revision','providerAccountId','displayName','avatarUrl','biography','profileUrl','provenance'];
const METADATA_KEYS = ['snapshotId','revision','providerAccountId','videoId','createdAt','title','description','durationSeconds','shareUrl','coverImageUrl','provenance'];
const METRIC_KEYS = ['snapshotId','revision','providerAccountId','videoId','measuredAt','viewCount','likeCount','commentCount','shareCount','completeness','provenance'];
const PROVENANCE_KEYS = ['sourceSystem','connectionId','providerAccountId','apiVersion','scopesUsed','fetchedAt','sourceUpdatedAt','completeness'];

export class TikTokNormalizedSnapshotValidator {
  validateProfile(value: unknown): asserts value is TikTokAccountProfileSnapshot {
    const record = requireRecord(value, PROFILE_KEYS); validateCommon(record); optionalText(record, ['displayName','biography']);
    if (record.profileUrl !== undefined) requireOfficialUrl(record.profileUrl);
    if (record.avatarUrl !== undefined) validateEphemeralUrl(record.avatarUrl);
    validateProvenance(record.provenance, record.providerAccountId as string); canonicalizeTikTokValue(value);
  }
  validateMetadata(value: unknown): asserts value is TikTokVideoMetadataSnapshot {
    const record = requireRecord(value, METADATA_KEYS); validateCommon(record); requireId(record.videoId); if (!isStrictTimestamp(record.createdAt)) throw new TypeError('Metadata creation timestamp is invalid.');
    optionalText(record, ['title','description']); if (record.durationSeconds !== undefined && (typeof record.durationSeconds !== 'number' || !Number.isFinite(record.durationSeconds) || record.durationSeconds < 0)) throw new TypeError('Metadata duration is invalid.');
    if (record.shareUrl !== undefined) requireOfficialUrl(record.shareUrl); if (record.coverImageUrl !== undefined) validateEphemeralUrl(record.coverImageUrl);
    validateProvenance(record.provenance, record.providerAccountId as string); canonicalizeTikTokValue(value);
  }
  validateMetrics(value: unknown): asserts value is TikTokVideoMetricSnapshot {
    const record = requireRecord(value, METRIC_KEYS); validateCommon(record); requireId(record.videoId); if (!isStrictTimestamp(record.measuredAt)) throw new TypeError('Metric timestamp is invalid.');
    for (const key of ['viewCount','likeCount','commentCount','shareCount']) { const count = record[key]; if (count !== undefined && (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) throw new TypeError('Metric counter is invalid.'); }
    requireCompleteness(record.completeness); validateProvenance(record.provenance, record.providerAccountId as string); canonicalizeTikTokValue(value);
  }
}

function validateCommon(record: Record<string, unknown>): void { requireId(record.snapshotId); if (!Number.isSafeInteger(record.revision) || (record.revision as number) <= 0) throw new TypeError('Snapshot revision is invalid.'); requireId(record.providerAccountId); }
function validateProvenance(value: unknown, providerAccountId: string): asserts value is TikTokAccountSnapshotProvenance {
  const record = requireRecord(value, PROVENANCE_KEYS); if (record.sourceSystem !== 'tiktok_account') throw new TypeError('Provenance source is invalid.'); validateSerializedTikTokAccountConnectionId(record.connectionId);
  requireId(record.providerAccountId); if (record.providerAccountId !== providerAccountId) throw new TypeError('Provenance account identity differs.'); requireId(record.apiVersion);
  if (!Array.isArray(record.scopesUsed)) throw new TypeError('Provenance scopes are invalid.'); canonicalizeTikTokValue(record.scopesUsed); const seen = new Set<string>(); for (const scope of record.scopesUsed) { requireId(scope); if (seen.has(scope)) throw new TypeError('Provenance scopes contain duplicates.'); seen.add(scope); }
  if (!isStrictTimestamp(record.fetchedAt) || (record.sourceUpdatedAt !== undefined && !isStrictTimestamp(record.sourceUpdatedAt))) throw new TypeError('Provenance timestamp is invalid.'); requireCompleteness(record.completeness);
}
function validateEphemeralUrl(value: unknown): asserts value is TikTokEphemeralUrl { const record = requireRecord(value, ['value','persistenceKind','observedAt']); requireOfficialUrl(record.value); if (record.persistenceKind !== 'ephemeral_reference' || !isStrictTimestamp(record.observedAt)) throw new TypeError('Ephemeral URL is invalid.'); }
function requireRecord(value: unknown, keys: readonly string[]): Record<string, unknown> { if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Normalized value must be a plain object.'); assertEnumerableDataProperties(value, keys); return value as Record<string, unknown>; }
function requireId(value: unknown): asserts value is string { if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Normalized identity is invalid.'); }
function optionalText(record: Record<string, unknown>, keys: readonly string[]): void { for (const key of keys) if (record[key] !== undefined && typeof record[key] !== 'string') throw new TypeError('Normalized text is invalid.'); }
function requireCompleteness(value: unknown): asserts value is SnapshotCompleteness { if (!COMPLETENESS.includes(value as SnapshotCompleteness)) throw new TypeError('Snapshot completeness is invalid.'); }
function requireOfficialUrl(value: unknown): asserts value is string { if (typeof value !== 'string') throw new TypeError('Snapshot URL is invalid.'); let parsed: URL; try { parsed = new URL(value); } catch { throw new TypeError('Snapshot URL is invalid.'); } if (!['https:','http:'].includes(parsed.protocol) || !parsed.hostname) throw new TypeError('Snapshot URL is invalid.'); }
