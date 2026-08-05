import { z } from 'zod';
import {
  VOLUVIA_AI_SCRIPT_OPERATION_ID,
  VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE,
  VOLUVIA_AI_SCRIPT_SCHEMA_VERSION,
  VoluviaAiScriptClientResult,
  VoluviaAiScriptResult,
  VoluviaAiWorkflowInput
} from './voluvia-ai-script-contracts';
import { VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT_SHA256 } from '../../../../prompts/voluvia/de/script-v1.prompt';

const codePoints = (value: string): number => Array.from(value).length;
const boundedText = (minimum: number, maximum: number) => z.string()
  .refine((value) => codePoints(value) >= minimum && codePoints(value) <= maximum);
const finiteNumber = z.number().finite();
const normalizedProductSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  color: z.string().min(1),
  length: z.string().min(1),
  price: z.object({ amount: finiteNumber, currency: z.string().min(1) }).strict(),
  audience: z.string().min(1),
  productKey: z.string().min(1)
}).strict();

export const voluviaAiWorkflowInputSchema = z.object({
  product: normalizedProductSchema,
  targetLanguage: z.literal('de-DE'),
  targetAudience: boundedText(1, 200),
  brandVoice: boundedText(1, 200),
  contentGoal: boundedText(1, 200),
  videoLengthTargetSeconds: z.number().int().min(10).max(60),
  prohibitedClaims: z.array(boundedText(1, 300)).max(20),
  requiredProductFacts: z.array(boundedText(1, 300)).min(1).max(20)
}).strict();

export const voluviaAiStructuredOutputSchema = z.object({
  hook: boundedText(1, 100),
  body: boundedText(1, 500),
  callToAction: boundedText(1, 120),
  caption: boundedText(1, 800),
  hashtagSuggestions: z.array(z.string()).min(3).max(8),
  language: z.literal('de-DE'),
  claimsUsed: z.array(z.string()).max(20)
}).strict();

const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative().finite(),
  outputTokens: z.number().int().nonnegative().finite(),
  totalTokens: z.number().int().nonnegative().finite()
}).strict();
const clientResultSchema = voluviaAiStructuredOutputSchema.extend({
  provider: z.string().min(1),
  model: z.string().min(1),
  responseId: z.string().min(1),
  usage: usageSchema,
  promptSha256: z.literal(VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT_SHA256)
}).strict();

const markdownPattern = /```|`[^`\n]+`|(?:^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s)|\[[^\]]+\]\([^\)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__/u;
const hashtagPattern = /^#[\p{L}\p{N}_]+$/u;
const medicalPromiseDenylist = [
  'heilt',
  'heilung',
  'garantiert gesund',
  'medizinisch bewiesen',
  'therapiert',
  'verhindert krankheit',
  'behandelt krankheit'
] as const;
const commercialClaimDenylistV1 = [
  'Rabatt',
  'reduziert',
  'sparen',
  'sale',
  'discount',
  'nur heute',
  'nur noch heute',
  'heute verfügbar',
  'limited time',
  'today only',
  'ends today',
  'nur wenige verfügbar',
  'fast ausverkauft',
  'letzte Chance',
  'limited stock',
  'almost sold out',
  'last chance',
  'garantiert',
  'Garantie',
  'garantiertes Ergebnis',
  'guaranteed',
  'guarantee',
  'guaranteed result',
  'zertifiziert',
  'zertifizierter Wert',
  'geprüft',
  'offiziell bestätigt',
  'certified',
  'officially approved',
  'clinically proven',
  'Wert von',
  'garantierter Wert',
  'bestes Preis-Leistungs-Verhältnis',
  'value of',
  'guaranteed value',
  'best value'
] as const;
const numericClaimPattern = /€\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:EUR|€|%|cm|mm|kg|g|Stunden?|Tage?|Wochen?|Stück|Teile?)?/giu;

function normalizedForSafety(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('de-DE');
}

function compactForSafety(value: string): string {
  return normalizedForSafety(value).replace(/[^\p{L}\p{N}]/gu, '');
}

function normalizedCommercialText(value: string): string {
  return normalizedForSafety(value)
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function containsCommercialClaim(text: string): boolean {
  const normalizedText = ` ${normalizedCommercialText(text)} `;
  const listedClaim = commercialClaimDenylistV1.some((claim) => {
    const normalizedClaim = normalizedCommercialText(claim);
    return normalizedText.includes(` ${normalizedClaim} `);
  });
  const contextualEnglishOff = /(?:\d+(?:[.,]\d+)?\s*%\s*off|\boff\s+(?:the\s+)?(?:price|preis)\b)/iu
    .test(normalizedText);
  return listedClaim || contextualEnglishOff;
}

function containsSafetyPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizedForSafety(phrase);
  const compactPhrase = compactForSafety(phrase);
  return normalizedForSafety(text).includes(normalizedPhrase) ||
    compactPhrase.length > 0 && compactForSafety(text).includes(compactPhrase);
}

function numericClaimKeys(value: string): readonly string[] {
  return [...value.matchAll(numericClaimPattern)].map((match) => {
    const token = match[0].normalize('NFKC').toLocaleLowerCase('de-DE');
    const numeric = token.match(/\d+(?:[.,]\d+)?/u)?.[0];
    if (!numeric) return '';
    const amount = Number.parseFloat(numeric.replace(',', '.'));
    let qualifier = token.replace(numeric, '').replace(/\s/gu, '');
    if (qualifier === '€' || qualifier === 'eur') qualifier = 'eur';
    return `${amount}|${qualifier}`;
  }).filter((key) => key.length > 0);
}

function authorizedNumericClaims(input: VoluviaAiWorkflowInput): ReadonlySet<string> {
  const productFacts = [
    input.product.title,
    input.product.description,
    input.product.color,
    input.product.length,
    input.product.audience,
    input.product.productKey,
    `${input.product.price.amount} ${input.product.price.currency}`,
    ...input.requiredProductFacts
  ];
  return new Set(productFacts.flatMap(numericClaimKeys));
}

function isJsonSafe(value: unknown, ancestors: Set<object> = new Set()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  ancestors.add(value);
  const safe = Array.isArray(value) ? value.every((entry) => isJsonSafe(entry, ancestors)) :
    Object.getPrototypeOf(value) === Object.prototype &&
      Object.entries(value).every(([, entry]) => isJsonSafe(entry, ancestors));
  ancestors.delete(value);
  return safe;
}

function validateBusinessContent(
  result: z.infer<typeof voluviaAiStructuredOutputSchema>,
  input: VoluviaAiWorkflowInput
): void {
  const proseFields = [result.hook, result.body, result.callToAction, result.caption];
  const allTextFields = [
    ...proseFields,
    ...result.hashtagSuggestions,
    ...result.claimsUsed
  ];
  if (allTextFields.some((value) => markdownPattern.test(value))) {
    throw new Error('AI script output must not contain Markdown.');
  }

  if (
    new Set(result.hashtagSuggestions).size !== result.hashtagSuggestions.length ||
    result.hashtagSuggestions.some(
      (hashtag) => !hashtagPattern.test(hashtag) || /\s/u.test(hashtag)
    )
  ) {
    throw new Error('AI script output contains invalid or duplicate hashtags.');
  }

  if (result.claimsUsed.some((claim) => !input.requiredProductFacts.includes(claim))) {
    throw new Error('AI script output contains a claim outside the required-fact allowlist.');
  }

  const combined = allTextFields.join('\n');
  if (input.prohibitedClaims.some((claim) => containsSafetyPhrase(combined, claim))) {
    throw new Error('AI script output contains an explicitly prohibited claim.');
  }

  if (medicalPromiseDenylist.some((claim) => containsSafetyPhrase(combined, claim))) {
    throw new Error('AI script output contains a prohibited medical promise.');
  }

  if (containsCommercialClaim(combined)) {
    throw new Error('AI script output contains an unsupported commercial claim.');
  }

  const supportedClaims = authorizedNumericClaims(input);
  if (numericClaimKeys(combined).some((claim) => !supportedClaims.has(claim))) {
    throw new Error('AI script output contains an unsupported numeric claim.');
  }
}

export function validateVoluviaAiWorkflowInput(value: unknown): VoluviaAiWorkflowInput {
  if (!isJsonSafe(value)) throw new Error('AI workflow input must be JSON-safe.');
  const parsed = voluviaAiWorkflowInputSchema.safeParse(value);
  if (!parsed.success) throw new Error('AI workflow input is invalid.');
  return parsed.data;
}

export function validateVoluviaAiClientResult(
  value: unknown,
  input: VoluviaAiWorkflowInput
): VoluviaAiScriptClientResult {
  if (!isJsonSafe(value)) throw new Error('AI provider result must be JSON-safe.');
  const parsed = clientResultSchema.safeParse(value);
  if (!parsed.success) throw new Error('AI provider result is malformed.');
  validateBusinessContent(parsed.data, input);
  if (parsed.data.usage.totalTokens !== parsed.data.usage.inputTokens + parsed.data.usage.outputTokens) {
    throw new Error('AI provider usage metadata is inconsistent.');
  }
  return parsed.data;
}

export function validateVoluviaAiScriptResult(value: unknown): VoluviaAiScriptResult {
  if (!isJsonSafe(value)) throw new Error('AI script result must be JSON-safe.');
  const resultSchema = voluviaAiStructuredOutputSchema.extend({
    generation: z.object({
      provider: z.string().min(1),
      model: z.string().min(1),
      operationId: z.literal(VOLUVIA_AI_SCRIPT_OPERATION_ID),
      schemaVersion: z.literal(VOLUVIA_AI_SCRIPT_SCHEMA_VERSION),
      promptId: z.literal(VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE.promptId),
      promptVersion: z.literal(VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE.promptVersion),
      promptSha256: z.string().regex(/^[a-f0-9]{64}$/),
      responseId: z.string().min(1),
      usage: usageSchema
    }).strict()
  }).strict();
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new Error('AI script result is invalid.');
  return parsed.data;
}
