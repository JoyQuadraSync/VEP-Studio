import { inspect } from 'node:util';
import { assertTikTokAccountConnectionId, equalTikTokAccountConnectionIds, serializeTikTokAccountConnectionId, TikTokAccountConnectionId } from './tiktok-account-connection-id';
import { TikTokAccountTrustedAdapterCapability, TikTokTrustedAdapterCredentialStatus } from './tiktok-account-credential-resolver';
import { assertEnumerableDataProperties } from '../validation/tiktok-json-safety';
import { createTikTokAccountDataFailure } from '../failures/tiktok-account-data-failure';

interface TikTokAccountCredentialInput { readonly connectionId: TikTokAccountConnectionId; readonly providerAccountId: string; readonly accessToken: string; readonly refreshToken?: string; readonly expiresAt: string; readonly revoked: boolean; }
export interface TikTokAccountCredentialStatus { readonly connectionId: string; readonly providerAccountId: string; readonly expiresAt: string; readonly revoked: boolean; }
export interface TikTokAccountCredentialStore {
  create(input: unknown): Promise<void>;
  findStatus(connectionId: TikTokAccountConnectionId): Promise<TikTokAccountCredentialStatus | undefined>;
  replace(connectionId: TikTokAccountConnectionId, input: unknown): Promise<void>;
  revoke(connectionId: TikTokAccountConnectionId): Promise<void>;
  createTrustedAdapter(now: () => Date): TikTokAccountTrustedAdapterCapability;
}

interface SecretData { readonly accessToken: string; readonly refreshToken?: string; }
interface StoredCredential { readonly status: TikTokAccountCredentialStatus; readonly secret: OpaqueTikTokCredential; }
const opaqueSecrets = new WeakMap<OpaqueTikTokCredential, SecretData>();
const storeRecords = new WeakMap<InMemoryTikTokAccountCredentialStore, Map<string, StoredCredential>>();

class OpaqueTikTokCredential {
  constructor(accessToken: string, refreshToken?: string) { opaqueSecrets.set(this, Object.freeze({ accessToken: `${accessToken}`, ...(refreshToken === undefined ? {} : { refreshToken: `${refreshToken}` }) })); Object.freeze(this); }
  verifyForTrustedAdapter(): void { const secret = opaqueSecrets.get(this); if (!secret || secret.accessToken.length === 0) throw new Error('Credential secret is unavailable.'); }
  [inspect.custom](): string { return 'OpaqueTikTokCredential { [REDACTED] }'; }
}

/* Credential-consuming provider adapters are trusted security-sensitive code. This
 * boundary prevents accidental propagation into business values; it does not claim
 * isolation from malicious code in this JavaScript process. Stronger isolation
 * requires a separate process or service boundary. */
class TrustedTikTokAccountAdapterCapability implements TikTokAccountTrustedAdapterCapability {
  constructor(private readonly store: InMemoryTikTokAccountCredentialStore, private readonly now: () => Date) {}
  async verifyCredential(connectionId: TikTokAccountConnectionId): Promise<TikTokTrustedAdapterCredentialStatus> {
    assertTikTokAccountConnectionId(connectionId); const stored = readStoredCredential(this.store, connectionId);
    if (!stored || stored.status.revoked) throw createTikTokAccountDataFailure({ code: 'authorization_required', operation: 'trusted_adapter_credentials', connectionId });
    if (new Date(stored.status.expiresAt).getTime() <= this.now().getTime()) throw createTikTokAccountDataFailure({ code: 'authorization_expired', operation: 'trusted_adapter_credentials', connectionId });
    stored.secret.verifyForTrustedAdapter();
    return Object.freeze({ providerAccountId: stored.status.providerAccountId, expiresAt: stored.status.expiresAt });
  }
}

export class InMemoryTikTokAccountCredentialStore implements TikTokAccountCredentialStore {
  constructor() { storeRecords.set(this, new Map()); Object.freeze(this); }
  async create(input: unknown): Promise<void> { this.validate(input); const records = this.records(); const key = serializeTikTokAccountConnectionId(input.connectionId); if (records.has(key)) throw new Error('Credential record already exists.'); records.set(key, this.store(input)); }
  async findStatus(connectionId: TikTokAccountConnectionId): Promise<TikTokAccountCredentialStatus | undefined> { const value = readStoredCredential(this, connectionId); return value ? Object.freeze({ ...value.status }) : undefined; }
  async replace(connectionId: TikTokAccountConnectionId, input: unknown): Promise<void> { assertTikTokAccountConnectionId(connectionId); this.validate(input); const key = serializeTikTokAccountConnectionId(connectionId); if (!equalTikTokAccountConnectionIds(connectionId, input.connectionId) || !this.records().has(key)) throw new Error('Credential record does not exist or identity differs.'); this.records().set(key, this.store(input)); }
  async revoke(connectionId: TikTokAccountConnectionId): Promise<void> { const key = serializeTikTokAccountConnectionId(connectionId); const value = this.records().get(key); if (!value) return; this.records().set(key, { ...value, status: Object.freeze({ ...value.status, revoked: true }) }); }
  createTrustedAdapter(now: () => Date): TikTokAccountTrustedAdapterCapability { return new TrustedTikTokAccountAdapterCapability(this, now); }
  private records(): Map<string, StoredCredential> { const records = storeRecords.get(this); if (!records) throw new Error('Credential store is unavailable.'); return records; }
  private store(input: TikTokAccountCredentialInput): StoredCredential { return Object.freeze({ status: Object.freeze({ connectionId: serializeTikTokAccountConnectionId(input.connectionId), providerAccountId: `${input.providerAccountId}`, expiresAt: `${input.expiresAt}`, revoked: input.revoked }), secret: new OpaqueTikTokCredential(input.accessToken, input.refreshToken) }); }
  private validate(input: unknown): asserts input is TikTokAccountCredentialInput { if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw new TypeError('Credential input must be a plain object.'); assertEnumerableDataProperties(input, ['connectionId','providerAccountId','accessToken','refreshToken','expiresAt','revoked']); const value = input as Record<string, unknown>; assertTikTokAccountConnectionId(value.connectionId); if (typeof value.providerAccountId !== 'string' || !value.providerAccountId || typeof value.accessToken !== 'string' || !value.accessToken || typeof value.expiresAt !== 'string' || !value.expiresAt || typeof value.revoked !== 'boolean' || (value.refreshToken !== undefined && typeof value.refreshToken !== 'string')) throw new TypeError('Credential input is invalid.'); }
}

function readStoredCredential(store: InMemoryTikTokAccountCredentialStore, connectionId: TikTokAccountConnectionId): StoredCredential | undefined {
  assertTikTokAccountConnectionId(connectionId); return storeRecords.get(store)?.get(serializeTikTokAccountConnectionId(connectionId));
}
