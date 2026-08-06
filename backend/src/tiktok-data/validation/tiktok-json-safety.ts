export function canonicalizeTikTokValue(value: unknown, active = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Values must contain finite numbers.');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value !== 'object') throw new TypeError('Values must be JSON-safe.');
  if (active.has(value)) throw new TypeError('Values must not contain cycles.');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const result: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError('Arrays must not contain holes.');
        result.push(canonicalizeTikTokValue(value[index], active));
      }
      assertEnumerableDataProperties(value, Array.from({ length: value.length }, (_, index) => String(index)).concat('length'), true);
      return `[${result.join(',')}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('Objects must be plain.');
    const keys = assertEnumerableDataProperties(value);
    return `{${keys.sort(compareUtf16).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      return `${JSON.stringify(key)}:${canonicalizeTikTokValue(descriptor.value, active)}`;
    }).join(',')}}`;
  } finally { active.delete(value); }
}

export function compareUtf16(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
export function assertEnumerableDataProperties(value: object, allowedKeys?: readonly string[], allowArrayLength = false): string[] {
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('Symbol properties are prohibited.');
  const names = Object.getOwnPropertyNames(value);
  const result: string[] = [];
  for (const name of names) {
    if (allowArrayLength && name === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Enumerable data properties are required.');
    if (allowedKeys && !allowedKeys.includes(name)) throw new TypeError('Unknown property is prohibited.');
    result.push(name);
  }
  return result;
}
export function isStrictTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value;
}
export function deepFreezeTikTokValue<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreezeTikTokValue(item);
    Object.freeze(value);
  }
  return value;
}
