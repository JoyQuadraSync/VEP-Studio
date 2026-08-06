export interface TikTokAccountSyncPolicy {
  readonly maxPages: number;
  readonly maxItems: number;
  readonly apiVersion: string;
  readonly videoQueryBatchSize?: number;
  readonly scopesUsed: readonly string[];
}

export function validateTikTokAccountSyncPolicy(policy: TikTokAccountSyncPolicy): TikTokAccountSyncPolicy {
  canonicalizeTikTokValue(policy);
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy) || Object.getPrototypeOf(policy) !== Object.prototype || Object.getOwnPropertySymbols(policy).length > 0) throw new TypeError('Synchronization policy must be a plain object.');
  const allowed = ['maxPages','maxItems','apiVersion','videoQueryBatchSize','scopesUsed'];
  for (const name of Object.getOwnPropertyNames(policy)) { const descriptor = Object.getOwnPropertyDescriptor(policy, name); if (!allowed.includes(name) || !descriptor?.enumerable || !('value' in descriptor)) throw new TypeError('Synchronization policy contains an invalid property.'); }
  for (const value of [policy.maxPages, policy.maxItems]) if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Synchronization limits must be positive safe integers.');
  if (policy.videoQueryBatchSize !== undefined && (!Number.isSafeInteger(policy.videoQueryBatchSize) || policy.videoQueryBatchSize <= 0)) throw new TypeError('Video query batch size is invalid.');
  if (!policy.apiVersion || policy.apiVersion !== policy.apiVersion.trim()) throw new TypeError('API version is invalid.');
  if (!Array.isArray(policy.scopesUsed) || policy.scopesUsed.some((scope) => !scope || scope !== scope.trim())) throw new TypeError('Synchronization scopes are invalid.');
  return Object.freeze({ ...policy, scopesUsed: Object.freeze([...policy.scopesUsed]) });
}
import { canonicalizeTikTokValue } from '../validation/tiktok-json-safety';
