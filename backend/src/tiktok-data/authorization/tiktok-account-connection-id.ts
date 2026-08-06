const MAX_CONNECTION_ID_LENGTH = 128;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const connectionIdPrototype = Object.freeze(Object.create(null));
const mintedConnectionIds = new WeakSet<object>();

export interface TikTokAccountConnectionId { readonly value: string; }

export function createTikTokAccountConnectionId(value: unknown): TikTokAccountConnectionId {
  validateSerializedTikTokAccountConnectionId(value);
  const id = Object.create(connectionIdPrototype) as TikTokAccountConnectionId;
  Object.defineProperty(id, 'value', { value, enumerable: false, writable: false, configurable: false });
  mintedConnectionIds.add(id);
  return Object.freeze(id);
}

export function isTikTokAccountConnectionId(value: unknown): value is TikTokAccountConnectionId {
  return typeof value === 'object' && value !== null && mintedConnectionIds.has(value);
}

export function assertTikTokAccountConnectionId(value: unknown): asserts value is TikTokAccountConnectionId {
  if (!isTikTokAccountConnectionId(value)) throw new TypeError('TikTok account connection ID was not minted by the trusted factory.');
}

export function serializeTikTokAccountConnectionId(id: TikTokAccountConnectionId): string {
  assertTikTokAccountConnectionId(id); return id.value;
}

export function importTikTokAccountConnectionId(value: unknown): TikTokAccountConnectionId { return createTikTokAccountConnectionId(value); }

export function validateSerializedTikTokAccountConnectionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0 || value.length > MAX_CONNECTION_ID_LENGTH || CONTROL_CHARACTER.test(value)) throw new TypeError('Serialized TikTok account connection ID is invalid.');
}

export function equalTikTokAccountConnectionIds(left: TikTokAccountConnectionId, right: TikTokAccountConnectionId): boolean {
  return serializeTikTokAccountConnectionId(left) === serializeTikTokAccountConnectionId(right);
}
