export function isVoluviaJsonSafe(
  value: unknown,
  ancestors: Set<object> = new Set()
): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;

  ancestors.add(value);
  const safe = Array.isArray(value)
    ? value.every((entry) => isVoluviaJsonSafe(entry, ancestors))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every((entry) => isVoluviaJsonSafe(entry, ancestors));
  ancestors.delete(value);
  return safe;
}
