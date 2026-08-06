import { assertTikTokAccountConnectionId, serializeTikTokAccountConnectionId, TikTokAccountConnectionId, validateSerializedTikTokAccountConnectionId } from '../authorization/tiktok-account-connection-id';
import { assertEnumerableDataProperties, deepFreezeTikTokValue } from '../validation/tiktok-json-safety';

export type TikTokAccountDataFailureCode =
  | 'configuration' | 'authorization_required' | 'authentication'
  | 'authorization_expired' | 'permission_denied' | 'rate_limit'
  | 'invalid_request' | 'resource_not_found' | 'provider_unavailable'
  | 'timeout' | 'network' | 'response_invalid' | 'pagination_invalid'
  | 'snapshot_validation_failed' | 'repository_conflict'
  | 'repository_unavailable' | 'unknown';

export interface TikTokAccountDataFailure {
  readonly code: TikTokAccountDataFailureCode;
  readonly operation: string;
  readonly connectionId?: string;
  readonly httpStatus?: number;
  readonly safeRequestId?: string;
  readonly retryEligibleAt?: string;
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const FAILURE_CODES: readonly TikTokAccountDataFailureCode[] = ['configuration','authorization_required','authentication','authorization_expired','permission_denied','rate_limit','invalid_request','resource_not_found','provider_unavailable','timeout','network','response_invalid','pagination_invalid','snapshot_validation_failed','repository_conflict','repository_unavailable','unknown'];
const FAILURE_KEYS = ['code', 'operation', 'connectionId', 'httpStatus', 'safeRequestId', 'retryEligibleAt'];

export function createTikTokAccountDataFailure(
  input: unknown
): TikTokAccountDataFailure {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw new TypeError('Failure input must be a plain object.');
  assertEnumerableDataProperties(input, FAILURE_KEYS);
  const candidate = input as unknown as Omit<TikTokAccountDataFailure, 'connectionId'> & { readonly connectionId?: TikTokAccountConnectionId };
  if (!FAILURE_CODES.includes(candidate.code)) throw new TypeError('Failure code is invalid.');
  if (!candidate.operation || candidate.operation !== candidate.operation.trim()) {
    throw new TypeError('Failure operation is invalid.');
  }
  if (candidate.httpStatus !== undefined && (!Number.isInteger(candidate.httpStatus) || candidate.httpStatus < 100 || candidate.httpStatus > 599)) {
    throw new TypeError('Failure HTTP status is invalid.');
  }
  if (candidate.safeRequestId !== undefined && !SAFE_REQUEST_ID.test(candidate.safeRequestId)) {
    throw new TypeError('Failure request ID is invalid.');
  }
  if (candidate.retryEligibleAt !== undefined && !isStrictTimestamp(candidate.retryEligibleAt)) {
    throw new TypeError('Failure retry timestamp is invalid.');
  }
  if (candidate.connectionId !== undefined) assertTikTokAccountConnectionId(candidate.connectionId);
  const result: TikTokAccountDataFailure = {
    code: candidate.code, operation: candidate.operation,
    ...(candidate.connectionId === undefined ? {} : { connectionId: serializeTikTokAccountConnectionId(candidate.connectionId) }),
    ...(candidate.httpStatus === undefined ? {} : { httpStatus: candidate.httpStatus }),
    ...(candidate.safeRequestId === undefined ? {} : { safeRequestId: candidate.safeRequestId }),
    ...(candidate.retryEligibleAt === undefined ? {} : { retryEligibleAt: candidate.retryEligibleAt })
  };
  return deepFreezeTikTokValue(result);
}

export function isTikTokAccountDataFailure(value: unknown): value is TikTokAccountDataFailure {
  if (!isRecord(value)) return false;
  try {
    assertEnumerableDataProperties(value, FAILURE_KEYS); if (!FAILURE_CODES.includes(value.code as TikTokAccountDataFailureCode) || typeof value.operation !== 'string' || !value.operation || value.operation !== value.operation.trim()) return false;
    if (value.connectionId !== undefined) validateSerializedTikTokAccountConnectionId(value.connectionId);
    if (value.httpStatus !== undefined && (!Number.isInteger(value.httpStatus) || (value.httpStatus as number) < 100 || (value.httpStatus as number) > 599)) return false;
    if (value.safeRequestId !== undefined && (typeof value.safeRequestId !== 'string' || !SAFE_REQUEST_ID.test(value.safeRequestId))) return false;
    if (value.retryEligibleAt !== undefined && (typeof value.retryEligibleAt !== 'string' || !isStrictTimestamp(value.retryEligibleAt))) return false;
    return true;
  } catch { return false; }
}

function isStrictTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    new Date(value).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
