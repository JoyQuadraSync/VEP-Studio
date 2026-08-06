import { normalizeVoluviaTextForMatching } from './voluvia-text-normalization';

const MEDICAL_CLAIMS = [
  'haarwachstum', 'hair regrowth', 'heilt', 'heilung', 'therapiert', 'behandelt haarausfall',
  'stops hair loss', 'stoppt haarausfall', 'medizinisch', 'medical', 'klinisch', 'clinical'
] as const;

const COMMERCIAL_CLAIMS = [
  'rabatt', 'reduziert', 'sparen', 'sale', 'discount', 'nur heute', 'limited time',
  'today only', 'nur wenige verfügbar', 'fast ausverkauft', 'limited stock',
  'almost sold out', 'letzte chance', 'last chance', 'garantiert', 'garantie',
  'guaranteed', 'zertifiziert', 'certified', 'offiziell bestätigt', 'officially approved',
  'wert von', 'value of', 'bestes preis leistungs verhältnis', 'best value'
] as const;

const PROHIBITED_TONE_TERMS = [
  'schäm dich', 'shame', 'angst', 'fear', 'hässlich', 'ugly', 'peinlich', 'embarrassing',
  'du musst', 'you must', 'verzweifelt', 'desperate'
] as const;

function normalizedPhraseMatch(value: string, phrase: string): boolean {
  const normalizeForPolicy = (text: string): string => normalizeVoluviaTextForMatching(text)
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const normalizedValue = ` ${normalizeForPolicy(value)} `;
  const normalizedPhrase = normalizeForPolicy(phrase);
  return normalizedValue.includes(` ${normalizedPhrase} `);
}

export function containsVoluviaMedicalClaim(value: string): boolean {
  return MEDICAL_CLAIMS.some((claim) => normalizedPhraseMatch(value, claim));
}

export function containsVoluviaUnsupportedCommercialClaim(value: string): boolean {
  const listed = COMMERCIAL_CLAIMS.some((claim) => normalizedPhraseMatch(value, claim));
  const contextualOff = /(?:\d+(?:[.,]\d+)?\s*%\s*off|\boff\s+(?:the\s+)?(?:price|preis)\b)/iu
    .test(value);
  return listed || contextualOff;
}

export function containsVoluviaProhibitedTone(value: string): boolean {
  return PROHIBITED_TONE_TERMS.some((term) => normalizedPhraseMatch(value, term));
}

export function containsVoluviaForbiddenClaim(
  value: string,
  forbiddenClaims: readonly string[]
): boolean {
  return forbiddenClaims.some((claim) => normalizedPhraseMatch(value, claim));
}
