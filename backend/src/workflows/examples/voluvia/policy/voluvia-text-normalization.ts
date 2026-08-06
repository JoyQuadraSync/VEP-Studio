export function normalizeVoluviaText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

export function normalizeVoluviaTextForMatching(value: string): string {
  return normalizeVoluviaText(value).toLocaleLowerCase('de-DE');
}

export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

export function containsMarkdown(value: string): boolean {
  return /```|`[^`\n]+`|(?:^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s)|\[[^\]]+\]\([^\)]+\)|\*\*[^*\n]+\*|__[^_\n]+__/u
    .test(value);
}
