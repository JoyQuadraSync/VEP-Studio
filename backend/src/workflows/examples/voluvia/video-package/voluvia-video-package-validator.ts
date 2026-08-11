import { createHash } from 'node:crypto';
import { z } from 'zod';
import { VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256 } from '../../../../prompts/voluvia/de/content-planner-v2.prompt';
import { VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256 } from '../../../../prompts/voluvia/de/video-package-generator-v4.prompt';
import {
  validateReviewedVoluviaContentPlanningResult,
  VoluviaContentPlanLocalValidationFailure
} from '../planner/voluvia-content-plan-validator';
import {
  APPROVED_PRODUCT_FACT_IDS, APPROVED_PRODUCT_FACT_VALUES, AUDIENCE_AWARENESS_LEVELS,
  AUDIENCE_CONCERNS, BRAND_TONES, CONTENT_ANGLES, CONTENT_FOCUSES, DESIRED_ACTIONS,
  EMOTIONAL_GOALS, HOOK_STRATEGIES, PROHIBITED_TONES, PURCHASE_TRIGGERS,
  SUGGESTED_SCENES, VIDEO_STYLES, ApprovedProductFact, ApprovedProductFactId
} from '../planner/voluvia-content-planner-contracts';
import { containsVoluviaForbiddenClaim, containsVoluviaMedicalClaim, containsVoluviaProhibitedTone, containsVoluviaUnsupportedCommercialClaim } from '../policy/voluvia-content-policy';
import { containsMarkdown, countUnicodeCodePoints, normalizeVoluviaText } from '../policy/voluvia-text-normalization';
import {
  PRESENTER_ASSETS, VIDEO_SCENE_ASSETS, VIDEO_SCENE_DURATION, VIDEO_SCENE_FRAMINGS,
  VIDEO_SCENE_TEXT_ROLES, VIDEO_STYLE_TRANSITIONS, VOLUVIA_VIDEO_HASHTAG_ALLOWLIST
} from './voluvia-video-package-compatibility';
import {
  PLANNER_REVIEW_DECISIONS, VIDEO_CAMERA_FRAMINGS, VIDEO_TEXT_STYLE_ROLES,
  VIDEO_TRANSITION_TYPES, VIDEO_VISUAL_PROOF_ROLES, VOLUVIA_VIDEO_ASSET_IDS,
  VOLUVIA_VIDEO_PACKAGE_OPERATION_ID, VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE,
  VOLUVIA_VIDEO_PACKAGE_SCHEMA_VERSION,
  VideoPackageDurationDiagnosticContext, VideoPackageDurationInvalidReason,
  VideoPackageTextLocation, VideoPackageUnsupportedClaimReason,
  VideoPackageCandidate, VideoPackageClientResult,
  VideoPackageLocalValidationCode, VoluviaVideoPackage, VoluviaVideoPackageGenerationInput,
  CanonicalVoiceoverSegment, SubtitleCue
} from './voluvia-video-package-contracts';

export class VideoPackageLocalValidationFailure {
  readonly name = 'VideoPackageLocalValidationFailure';
  constructor(readonly code: VideoPackageLocalValidationCode,
    readonly unsupportedClaimReason?: VideoPackageUnsupportedClaimReason,
    readonly textLocation?: VideoPackageTextLocation,
    readonly durationInvalidReason?: VideoPackageDurationInvalidReason,
    readonly durationContext?: VideoPackageDurationDiagnosticContext) {}
}
function fail(code: VideoPackageLocalValidationCode,
  unsupportedClaimReason?: VideoPackageUnsupportedClaimReason,
  textLocation?: VideoPackageTextLocation): never {
  throw new VideoPackageLocalValidationFailure(code, unsupportedClaimReason, textLocation);
}
function failDuration(reason: VideoPackageDurationInvalidReason,
  durationContext?: VideoPackageDurationDiagnosticContext): never {
  throw new VideoPackageLocalValidationFailure('duration_invalid', undefined, undefined,
    reason, durationContext);
}
const text = (max: number) => z.string().min(1).refine((value) => countUnicodeCodePoints(value) <= max);
const factSchema = z.object({ factId: z.enum(APPROVED_PRODUCT_FACT_IDS), displayValue: z.string().min(1) }).strict();
const strategySchema = z.object({
  primaryProblem: z.enum(AUDIENCE_CONCERNS), purchaseTrigger: z.enum(PURCHASE_TRIGGERS),
  contentFocus: z.enum(CONTENT_FOCUSES), contentAngle: z.enum(CONTENT_ANGLES),
  emotionalGoal: z.enum(EMOTIONAL_GOALS), desiredAction: z.enum(DESIRED_ACTIONS)
}).strict();
const productionSchema = z.object({
  recommendedVideoStyle: z.enum(VIDEO_STYLES), recommendedHookStrategy: z.enum(HOOK_STRATEGIES),
  targetDurationSeconds: z.number().int().min(15).max(90), visualProofRequired: z.boolean(),
  suggestedScenes: z.array(z.enum(SUGGESTED_SCENES)).min(2).max(5)
}).strict();
const plannerResultSchema = z.object({
  reviewStatus: z.literal('pending_manual_review'),
  plan: z.object({
    audience: z.object({ gender: z.literal('women'), primaryConcern: z.enum(AUDIENCE_CONCERNS), awarenessLevel: z.enum(AUDIENCE_AWARENESS_LEVELS) }).strict(),
    strategy: strategySchema, production: productionSchema,
    brandSafety: z.object({ approvedFacts: z.array(factSchema), forbiddenClaims: z.array(z.string()), prohibitedTone: z.array(z.enum(PROHIBITED_TONES)), manualReviewRequired: z.literal(true) }).strict()
  }).strict(),
  generation: z.object({
    provider: z.string().min(1), model: z.string().min(1), operationId: z.literal('voluvia.content.plan.ai'), schemaVersion: z.literal(1),
    promptId: z.literal('voluvia.tiktok.content-planner.de'), promptVersion: z.literal(2),
    promptContentHash: z.literal(VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256), responseId: z.string().min(1),
    inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative()
  }).strict()
}).strict();

const inputSchema = z.object({
  reviewedPlannerResult: z.object({
    workflowId: z.literal('voluvia.tiktok.contentplanning.ai.workflow'), workflowVersion: z.literal(1),
    operationId: z.literal('voluvia.content.plan.ai'),
    plannerPrompt: z.object({ promptId: z.literal('voluvia.tiktok.content-planner.de'), promptVersion: z.literal(2), promptContentHash: z.literal(VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256) }).strict(),
    plannerReviewDecision: z.enum(PLANNER_REVIEW_DECISIONS), result: plannerResultSchema
  }).strict(),
  approvedProductFacts: z.array(factSchema).min(1),
  brandPolicy: z.object({ tone: z.array(z.enum(BRAND_TONES)).min(1), prohibitedTone: z.array(z.enum(PROHIBITED_TONES)), forbiddenClaims: z.array(z.string()) }).strict(),
  videoControls: z.object({
    targetLanguage: z.literal('de-DE'), platform: z.literal('TikTok'), targetDurationSeconds: z.union([z.literal(20), z.literal(30), z.literal(45)]),
    presenterMode: z.enum(['product-only', 'presenter-plus-product']), voiceStyle: z.enum(['calm', 'warm', 'educational', 'elegant']),
    subtitleMode: z.literal('burn-in-ready'), priceMayBeFeatured: z.boolean(), shippingMayBeFeatured: z.boolean(),
    realBeforeAfterEvidenceAvailable: z.boolean(), desiredAction: z.enum(DESIRED_ACTIONS)
  }).strict(),
  availableAssetIds: z.array(z.enum(VOLUVIA_VIDEO_ASSET_IDS)).min(1)
}).strict();

export const videoPackageCandidateSchema = z.object({
  hook: z.object({ spokenHook: text(100), onScreenHook: text(60), visualHookInstruction: text(200).optional() }).strict(),
  voiceover: z.object({ segments: z.array(z.object({ sourceScene: z.enum(SUGGESTED_SCENES), spokenText: z.string().min(1), proposedFactIds: z.array(z.enum(APPROVED_PRODUCT_FACT_IDS)) }).strict()).min(2).max(5) }).strict(),
  scenes: z.array(z.object({ sourceSuggestedScene: z.enum(SUGGESTED_SCENES), durationSeconds: z.number().int().min(3).max(25), cameraFraming: z.enum(VIDEO_CAMERA_FRAMINGS), visualAction: text(300), requiredAssetIds: z.array(z.enum(VOLUVIA_VIDEO_ASSET_IDS)).min(1), onScreenTextKeys: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,49}$/u)), productionNotes: text(300), visualProofRole: z.enum(VIDEO_VISUAL_PROOF_ROLES), transitionType: z.enum(VIDEO_TRANSITION_TYPES) }).strict()).min(2).max(5),
  onScreenText: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{0,49}$/u), sourceScene: z.enum(SUGGESTED_SCENES), text: text(60), startOffsetSecond: z.number().nonnegative().finite(), endOffsetSecond: z.number().positive().finite(), proposedFactIds: z.array(z.enum(APPROVED_PRODUCT_FACT_IDS)), styleRole: z.enum(VIDEO_TEXT_STYLE_ROLES) }).strict()),
  cover: z.object({ coverTitle: text(40), coverSubtitle: text(60).optional(), selectedCoverScene: z.enum(SUGGESTED_SCENES), requiredAssetIds: z.array(z.enum(VOLUVIA_VIDEO_ASSET_IDS)).min(1) }).strict(),
  caption: z.object({ text: text(800), callToAction: text(120), proposedFactIds: z.array(z.enum(APPROVED_PRODUCT_FACT_IDS)), disclosureText: text(200).optional() }).strict(),
  hashtags: z.array(z.string()).min(3).max(5),
  assetUsageProposal: z.array(z.object({ assetId: z.enum(VOLUVIA_VIDEO_ASSET_IDS), sourceScenes: z.array(z.enum(SUGGESTED_SCENES)).min(1), productionInstruction: text(300) }).strict()),
  backgroundAssetId: z.enum(VOLUVIA_VIDEO_ASSET_IDS).optional()
}).strict();

export const videoPackageStructuredCandidateSchema = videoPackageCandidateSchema.extend({
  hook: videoPackageCandidateSchema.shape.hook.extend({
    visualHookInstruction: text(200).nullable()
  }).strict(),
  cover: videoPackageCandidateSchema.shape.cover.extend({
    coverSubtitle: text(60).nullable()
  }).strict(),
  caption: videoPackageCandidateSchema.shape.caption.extend({
    disclosureText: text(200).nullable()
  }).strict(),
  backgroundAssetId: z.enum(VOLUVIA_VIDEO_ASSET_IDS).nullable()
}).strict();

const canonicalSegmentSchema = z.object({
  segmentId: z.string().regex(/^segment-[0-9]{2}$/u), sceneId: z.string().regex(/^scene-[0-9]{2}$/u),
  sourceScene: z.enum(SUGGESTED_SCENES), spokenText: z.string().min(1),
  estimatedSeconds: z.number().int().positive(), claimsUsed: z.array(z.enum(APPROVED_PRODUCT_FACT_IDS))
}).strict();
const subtitleCueSchema = z.object({
  cueId: z.string().regex(/^cue-[0-9]{2}$/u), sceneId: z.string().regex(/^scene-[0-9]{2}$/u),
  lines: z.array(z.string().min(1)).min(1).max(2), startSecond: z.number().nonnegative().finite(),
  endSecond: z.number().positive().finite()
}).strict();
const finalPackageSchema = z.object({
  packageId: z.string().regex(/^[a-f0-9]{64}$/u), operationId: z.literal(VOLUVIA_VIDEO_PACKAGE_OPERATION_ID),
  schemaVersion: z.literal(1),
  sourcePlan: z.object({ workflowId: z.literal('voluvia.tiktok.contentplanning.ai.workflow'),
    workflowVersion: z.literal(1), operationId: z.literal('voluvia.content.plan.ai'),
    sourcePlanHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  provenance: z.object({ provider: z.string().min(1).max(100), model: z.string().min(1).max(200),
    promptId: z.literal(VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE.promptId), promptVersion: z.literal(4),
    promptContentHash: z.literal(VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256),
    generatedAt: z.string().datetime({ offset: true }) }).strict(),
  summary: z.object({
    audience: z.object({ gender: z.literal('women'), primaryConcern: z.enum(AUDIENCE_CONCERNS), awarenessLevel: z.enum(AUDIENCE_AWARENESS_LEVELS) }).strict(),
    strategy: strategySchema, language: z.literal('de-DE'), platform: z.literal('TikTok'),
    targetDurationSeconds: z.union([z.literal(20), z.literal(30), z.literal(45)]),
    estimatedDurationSeconds: z.union([z.literal(20), z.literal(30), z.literal(45)]),
    videoStyle: z.enum(VIDEO_STYLES), hookStrategy: z.enum(HOOK_STRATEGIES),
    visualProofRequired: z.boolean(), presenterMode: z.enum(['product-only', 'presenter-plus-product'])
  }).strict(),
  hook: videoPackageCandidateSchema.shape.hook,
  voiceover: z.object({ segments: z.array(canonicalSegmentSchema).min(2).max(5),
    fullScript: z.string().min(1), estimatedSpokenSeconds: z.number().int().positive() }).strict(),
  scenes: z.array(z.object({
    sceneId: z.string().regex(/^scene-[0-9]{2}$/u), sourceSuggestedScene: z.enum(SUGGESTED_SCENES),
    sequence: z.number().int().positive(), startSecond: z.number().int().nonnegative(),
    durationSeconds: z.number().int().min(3).max(25), cameraFraming: z.enum(VIDEO_CAMERA_FRAMINGS),
    visualAction: z.string().min(1), requiredAssetIds: z.array(z.enum(VOLUVIA_VIDEO_ASSET_IDS)).min(1),
    voiceoverSegmentId: z.string().regex(/^segment-[0-9]{2}$/u),
    onScreenTextIds: z.array(z.string().regex(/^text-[a-z][a-z0-9-]{0,49}$/u)),
    productionNotes: z.string().min(1), visualProofRole: z.enum(VIDEO_VISUAL_PROOF_ROLES),
    transitionType: z.enum(VIDEO_TRANSITION_TYPES)
  }).strict()).min(2).max(5),
  onScreenText: z.array(z.object({
    textId: z.string().regex(/^text-[a-z][a-z0-9-]{0,49}$/u), sceneId: z.string().regex(/^scene-[0-9]{2}$/u),
    text: z.string().min(1), startSecond: z.number().nonnegative().finite(),
    endSecond: z.number().positive().finite(), semanticFactIds: z.array(z.enum(APPROVED_PRODUCT_FACT_IDS)),
    styleRole: z.enum(VIDEO_TEXT_STYLE_ROLES)
  }).strict()),
  cover: z.object({ coverTitle: z.string().min(1), coverSubtitle: z.string().min(1).optional(),
    selectedCoverSceneId: z.string().regex(/^scene-[0-9]{2}$/u),
    requiredAssetIds: z.array(z.enum(VOLUVIA_VIDEO_ASSET_IDS)).min(1) }).strict(),
  caption: z.object({ text: z.string().min(1), callToAction: z.string().min(1),
    semanticFactIds: z.array(z.enum(APPROVED_PRODUCT_FACT_IDS)), disclosureText: z.string().min(1).optional() }).strict(),
  hashtags: z.array(z.string()).min(3).max(5),
  assetChecklist: z.array(z.object({ assetId: z.enum(VOLUVIA_VIDEO_ASSET_IDS), required: z.boolean(),
    usedBySceneIds: z.array(z.string().regex(/^scene-[0-9]{2}$/u)), productionInstruction: z.string().min(1),
    missingAssetBehavior: z.enum(['reject-package', 'manual-substitution-required']) }).strict()),
  narrationPackage: z.object({ presenterMode: z.enum(['product-only', 'presenter-plus-product']),
    narrationText: z.string().min(1), sceneNarrationSegments: z.array(canonicalSegmentSchema),
    subtitleLines: z.array(subtitleCueSchema), avatarRequired: z.boolean(), voiceRequired: z.boolean(),
    backgroundAssetId: z.enum(VOLUVIA_VIDEO_ASSET_IDS).optional(), aspectRatio: z.literal('9:16'),
    resolutionClass: z.literal('vertical-hd') }).strict(),
  safety: z.object({ approvedFacts: z.array(factSchema), claimsUsed: z.array(z.enum(APPROVED_PRODUCT_FACT_IDS)),
    forbiddenClaims: z.array(z.string()), prohibitedTone: z.array(z.enum(PROHIBITED_TONES)),
    manualReviewRequired: z.literal(true), commerceControlsApplied: z.object({
      priceEnabled: z.boolean(), shippingEnabled: z.boolean(), deliveryClaimsEnabled: z.literal(false)
    }).strict(), unsupportedClaimScanPassed: z.literal(true), sceneCompatibilityPassed: z.literal(true),
    assetCompatibilityPassed: z.literal(true) }).strict(),
  packageReviewStatus: z.literal('pending_manual_review')
}).strict();

export function canonicalizeVideoPackageValue(value: unknown, active = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('unsafe_json'); return Object.is(value, -0) ? '0' : String(value); }
  if (typeof value !== 'object' || active.has(value)) fail('unsafe_json');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) fail('unsafe_json');
      const parts: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('unsafe_json');
        parts.push(canonicalizeVideoPackageValue(descriptor.value, active));
      }
      if (Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)) fail('unsafe_json');
      return `[${parts.join(',')}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) fail('unsafe_json');
    const keys = Object.getOwnPropertyNames(value).sort();
    return `{${keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('unsafe_json');
      return `${JSON.stringify(key)}:${canonicalizeVideoPackageValue(descriptor.value, active)}`;
    }).join(',')}}`;
  } finally { active.delete(value); }
}

export function hashVideoPackageValue(value: unknown): string {
  return createHash('sha256').update(Buffer.from(canonicalizeVideoPackageValue(value), 'utf8')).digest('hex');
}

function assertUnique(values: readonly string[], code: VideoPackageLocalValidationCode): void {
  if (new Set(values).size !== values.length) fail(code);
}

export function validateVideoPackageInput(value: unknown): VoluviaVideoPackageGenerationInput {
  canonicalizeVideoPackageValue(value);
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) {
    const keys = parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys');
    if (keys) fail('unknown_field');
    const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
    if (paths.some((path) => path.includes('plannerReviewDecision'))) fail('invalid_review_state');
    if (paths.some((path) => path.includes('plannerPrompt.promptContentHash'))) fail('prompt_hash_mismatch');
    if (paths.some((path) => path.includes('plannerPrompt'))) fail('prompt_identity_mismatch');
    if (paths.some((path) => path.startsWith('reviewedPlannerResult'))) fail('source_plan_mismatch');
    fail('invalid_input');
  }
  const input = parsed.data;
  if (input.reviewedPlannerResult.plannerReviewDecision !== 'approved_for_package_generation') fail('invalid_review_state');
  const planner = input.reviewedPlannerResult.result;
  try {
    validateReviewedVoluviaContentPlanningResult(planner, {
      realBeforeAfterEvidenceAvailable: input.videoControls.realBeforeAfterEvidenceAvailable
    });
  } catch (error) {
    if (error instanceof VoluviaContentPlanLocalValidationFailure && error.code === 'unsafe_json') {
      fail('unsafe_json');
    }
    fail('source_plan_mismatch');
  }
  if (input.videoControls.targetDurationSeconds !== planner.plan.production.targetDurationSeconds || input.videoControls.desiredAction !== planner.plan.strategy.desiredAction) fail('strategy_mismatch');
  assertUnique(input.approvedProductFacts.map((fact) => fact.factId), 'invalid_input');
  for (const fact of input.approvedProductFacts) if (APPROVED_PRODUCT_FACT_VALUES[fact.factId] !== fact.displayValue) fail('invalid_input');
  const plannerFacts = planner.plan.brandSafety.approvedFacts.map((fact) => fact.factId);
  if (input.approvedProductFacts.some((fact) => !plannerFacts.includes(fact.factId))) fail('source_plan_mismatch');
  assertUnique(input.availableAssetIds, 'asset_mismatch');
  for (const asset of PRESENTER_ASSETS[input.videoControls.presenterMode]) if (!input.availableAssetIds.includes(asset)) fail('asset_mismatch');
  for (const scene of planner.plan.production.suggestedScenes) for (const asset of VIDEO_SCENE_ASSETS[scene]) if (!input.availableAssetIds.includes(asset)) fail('asset_mismatch');
  validateBeforeAfter(input);
  return input;
}

function validateBeforeAfter(input: VoluviaVideoPackageGenerationInput): void {
  const scenes = input.reviewedPlannerResult.result.plan.production.suggestedScenes;
  const parting = scenes.includes('parting-before-view') || scenes.includes('parting-after-view');
  const crown = scenes.includes('crown-before-view') || scenes.includes('crown-after-view');
  if (!parting && !crown) return;
  const partingComplete = scenes.includes('parting-before-view') && scenes.includes('parting-after-view');
  const crownComplete = scenes.includes('crown-before-view') && scenes.includes('crown-after-view');
  if (!input.videoControls.realBeforeAfterEvidenceAvailable || !input.reviewedPlannerResult.result.plan.production.visualProofRequired || (!partingComplete && !crownComplete) || parting && !partingComplete || crown && !crownComplete) fail('scene_mismatch');
}

export function deriveEffectiveVideoFacts(input: VoluviaVideoPackageGenerationInput): readonly ApprovedProductFact[] {
  const plannerFacts = input.reviewedPlannerResult.result.plan.brandSafety.approvedFacts;
  return input.approvedProductFacts.filter((fact) => plannerFacts.some((plannerFact) => plannerFact.factId === fact.factId) && (fact.factId !== 'price-49-eur' || input.videoControls.priceMayBeFeatured) && (fact.factId !== 'ships-from-germany' || input.videoControls.shippingMayBeFeatured));
}

export function validateVideoPackageClientResult(value: unknown): VideoPackageClientResult {
  canonicalizeVideoPackageValue(value);
  const schema = z.object({
    candidate: videoPackageCandidateSchema,
    provenance: z.object({ provider: z.string().min(1).max(100), model: z.string().min(1).max(200), promptId: z.literal(VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE.promptId), promptVersion: z.literal(4), promptContentHash: z.literal(VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256) }).strict(),
    diagnostics: z.object({ provider: z.string().min(1).max(100), model: z.string().min(1).max(200), requestAttempted: z.boolean(), responseId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/u).optional(), usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative() }).strict().optional(), startedAt: z.string().datetime().optional(), completedAt: z.string().datetime().optional(), category: z.enum(['configuration','authentication','permission_denied','rate_limit','invalid_request','model_unavailable','timeout','network','provider_server','response_incomplete','response_refused','response_invalid','unknown']).optional() }).strict().optional()
  }).strict();
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys')) fail('unknown_field');
    const durationIssue = parsed.error.issues.find((issue) => {
      const path = issue.path.join('.');
      return path === 'candidate.scenes' || path === 'candidate.voiceover.segments' ||
        /candidate\.scenes\.\d+\.durationSeconds/u.test(path) ||
        /candidate\.onScreenText\.\d+\.(?:startOffsetSecond|endOffsetSecond)/u.test(path);
    });
    if (durationIssue) {
      const path = durationIssue.path.join('.');
      if (path === 'candidate.scenes') failDuration('invalid_scene_count');
      if (path === 'candidate.voiceover.segments') failDuration('segment_count_mismatch');
      if (path.endsWith('.durationSeconds')) {
        if (durationIssue.code === 'too_small') failDuration('scene_duration_below_minimum');
        if (durationIssue.code === 'too_big') failDuration('scene_duration_above_maximum');
        failDuration('scene_duration_not_integer');
      }
      failDuration('onscreen_text_timing_invalid');
    }
    fail('local_validation');
  }
  if (parsed.data.diagnostics?.usage && parsed.data.diagnostics.usage.totalTokens !== parsed.data.diagnostics.usage.inputTokens + parsed.data.diagnostics.usage.outputTokens) fail('local_validation');
  return parsed.data;
}

function normalizeNarration(value: string): string { return value.normalize('NFKC').replace(/\r\n?/gu, '\n').trim().replace(/\s+/gu, ' '); }
function wordCount(value: string): number { return value.length === 0 ? 0 : value.split(/\s+/u).length; }

function wrapSubtitle(value: string): readonly string[][] {
  const words = value.split(' '); const lines: string[] = []; let line = '';
  for (const word of words) {
    if (countUnicodeCodePoints(word) > 42) failDuration('subtitle_line_too_long');
    const next = line.length === 0 ? word : `${line} ${word}`;
    if (countUnicodeCodePoints(next) <= 42) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  const cues: string[][] = [];
  for (let index = 0; index < lines.length; index += 2) cues.push(lines.slice(index, index + 2));
  return cues;
}

function unsupportedReason(value: string): VideoPackageUnsupportedClaimReason | undefined {
  const normalized = ` ${value.normalize('NFKC').toLocaleLowerCase('de-DE').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/gu, ' ').trim()} `;
  const has = (...phrases: readonly string[]): boolean => phrases.some((phrase) => normalized.includes(` ${phrase} `));
  if (has('klinisch', 'clinical')) return 'prohibited_clinical_claim';
  if (has('therapiert', 'behandelt haarausfall', 'stops hair loss', 'stoppt haarausfall')) return 'prohibited_therapeutic_claim';
  if (has('haarwachstum', 'hair regrowth', 'heilt', 'heilung', 'medizinisch', 'medical')) return 'prohibited_medical_claim';
  if (has('zertifiziert', 'certified', 'offiziell bestätigt', 'officially approved')) return 'prohibited_certification_claim';
  if (has('dauerhafte wirkung', 'dauerhaftes ergebnis', 'permanent result')) return 'prohibited_permanent_outcome';
  if (has('garantiert natürlich', 'garantierte natürlichkeit', 'guaranteed natural appearance')) return 'prohibited_natural_appearance_guarantee';
  if (has('garantiert selbstbewusst', 'garantiertes selbstvertrauen', 'guaranteed confidence', 'garantierter sozialer erfolg', 'guaranteed social outcome')) return 'prohibited_confidence_or_social_guarantee';
  if (has('garantiert', 'garantie', 'guaranteed')) return 'prohibited_guarantee';
  if (has('nur heute', 'limited time', 'today only', 'letzte chance', 'last chance')) return 'prohibited_urgency';
  if (has('nur wenige verfügbar', 'fast ausverkauft', 'limited stock', 'almost sold out')) return 'prohibited_scarcity';
  if (has('rabatt', 'reduziert', 'sparen', 'sale', 'discount')) return 'prohibited_discount_claim';
  if (has('wert von', 'value of', 'bestes preis leistungs verhältnis', 'best value')) return 'prohibited_value_or_investment_claim';
  if (has('mitleid', 'bemitleidenswert', 'pity')) return 'prohibited_pity';
  if (has('besser als eine vollperücke', 'vollperücken sind', 'better than a full wig')) return 'full_wig_degradation';
  if (has('jede frau braucht', 'alle frauen brauchen', 'every woman needs')) return 'universal_need_claim';
  if (has('du solltest dich schämen', 'schäm dich', 'shame')) return 'prohibited_shame';
  if (has('angst', 'fear')) return 'prohibited_fear';
  if (has('beauty anxiety')) return 'prohibited_beauty_anxiety';
  if (/liefer(?:zeit|ung in)|delivery\s+(?:time|in)/iu.test(value)) return 'delivery_claim';
  return undefined;
}

function validateCopy(value: string, input: VoluviaVideoPackageGenerationInput,
  location: VideoPackageTextLocation): void {
  if (containsMarkdown(value) || /<\/?[A-Za-z][^>]*>|\{\{|\}\}|\[\[|\]\]|\b(?:system|assistant|tool)\s*:/iu.test(value)) fail('unsupported_claim', 'other_unsupported_claim', location);
  const reason = unsupportedReason(value);
  if (reason) fail('unsupported_claim', reason, location);
  if (containsVoluviaMedicalClaim(value) || containsVoluviaUnsupportedCommercialClaim(value) ||
      containsVoluviaProhibitedTone(value) || containsVoluviaForbiddenClaim(value,
        [...input.brandPolicy.forbiddenClaims, ...input.reviewedPlannerResult.result.plan.brandSafety.forbiddenClaims])) {
    fail('unsupported_claim', 'other_unsupported_claim', location);
  }
}

function detectedFactIds(value: string): readonly ApprovedProductFactId[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}€]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  const patterns: Readonly<Record<ApprovedProductFactId, readonly RegExp[]>> = {
    'material-remy-human-hair-100-percent': [/\b100\s*(?:prozent|%)?\s*remy\s+echthaar\b/u, /\bremy\s+echthaar\b/u],
    'length-32-cm': [/\b32\s*cm\b/u],
    'clip-count-3': [/\b(?:3|drei)\s+clips?\b/u],
    'base-lightweight-hand-knotted-lace': [/\blace\s+basis\b/u, /\bhandgeknüpfte\s+lace\b/u],
    'ships-from-germany': [/\bversand\s+aus\s+deutschland\b/u],
    'price-49-eur': [/(?<![\p{L}\p{N}])(?:49\s*(?:eur|euro|€)|(?:eur|euro|€)\s*49)(?![\p{L}\p{N}])/u],
    'color-honig-blond': [/\bhonig\s+blond\b/u],
    'color-hell-blond': [/\bhell\s+blond\b/u],
    'color-mittel-braun': [/\bmittel\s+braun\b/u]
  };
  return APPROVED_PRODUCT_FACT_IDS.filter((id) => patterns[id].some((pattern) => pattern.test(normalized)));
}

function validateAttributedText(
  value: string,
  proposed: readonly ApprovedProductFactId[] | undefined,
  input: VoluviaVideoPackageGenerationInput,
  effectiveIds: readonly ApprovedProductFactId[],
  claims: Set<ApprovedProductFactId>,
  location: VideoPackageTextLocation
): void {
  validateCopy(value, input, location);
  const detected = detectedFactIds(value);
  for (const id of detected) {
    if (!effectiveIds.includes(id)) fail('unsupported_claim', 'unapproved_fact', location);
    claims.add(id);
  }
  if (proposed !== undefined) {
    if (new Set(proposed).size !== proposed.length) fail('unsupported_claim', 'fact_attribution_mismatch', location);
    const canonicalProposed = APPROVED_PRODUCT_FACT_IDS.filter((id) => proposed.includes(id));
    if (JSON.stringify(proposed) !== JSON.stringify(canonicalProposed) ||
        JSON.stringify(canonicalProposed) !== JSON.stringify(detected)) {
      fail('unsupported_claim', detected.length > 0 && proposed.length === 0 ?
        'fact_attribution_missing' : 'fact_attribution_mismatch', location);
    }
  }
}

export interface ValidatedCandidateDerivation { readonly candidate: VideoPackageCandidate; readonly segments: readonly CanonicalVoiceoverSegment[]; readonly fullScript: string; readonly estimatedSpokenSeconds: number; readonly subtitles: readonly SubtitleCue[]; readonly claimsUsed: readonly ApprovedProductFactId[] }

export function validateAndDeriveCandidate(clientResult: VideoPackageClientResult, input: VoluviaVideoPackageGenerationInput, effectiveFacts: readonly ApprovedProductFact[]): ValidatedCandidateDerivation {
  const candidate = clientResult.candidate; const plannerScenes = input.reviewedPlannerResult.result.plan.production.suggestedScenes;
  if (candidate.scenes.length !== plannerScenes.length) failDuration('invalid_scene_count', {
    targetDurationSeconds: input.videoControls.targetDurationSeconds,
    sceneCount: candidate.scenes.length
  });
  if (candidate.voiceover.segments.length !== plannerScenes.length) failDuration('segment_count_mismatch', {
    targetDurationSeconds: input.videoControls.targetDurationSeconds,
    sceneCount: candidate.scenes.length
  });
  const effectiveIds = effectiveFacts.map((fact) => fact.factId);
  const sceneStarts: number[] = []; let current = 0;
  candidate.scenes.forEach((scene, index) => {
    if (scene.sourceSuggestedScene !== plannerScenes[index]) fail('scene_mismatch');
    if (candidate.voiceover.segments[index]?.sourceScene !== plannerScenes[index]) failDuration('segment_scene_mismatch', {
      targetDurationSeconds: input.videoControls.targetDurationSeconds,
      sceneCount: candidate.scenes.length
    });
    if (!VIDEO_SCENE_FRAMINGS[scene.sourceSuggestedScene].includes(scene.cameraFraming) || !VIDEO_STYLE_TRANSITIONS[input.reviewedPlannerResult.result.plan.production.recommendedVideoStyle].includes(scene.transitionType)) fail('scene_mismatch');
    for (const asset of VIDEO_SCENE_ASSETS[scene.sourceSuggestedScene]) if (!scene.requiredAssetIds.includes(asset)) fail('asset_mismatch');
    for (const asset of scene.requiredAssetIds) if (!input.availableAssetIds.includes(asset)) fail('asset_mismatch');
    if ((scene.visualProofRole === 'before-evidence' && !scene.sourceSuggestedScene.endsWith('-before-view')) ||
        (scene.visualProofRole === 'after-evidence' && !scene.sourceSuggestedScene.endsWith('-after-view')) ||
        ((scene.sourceSuggestedScene.endsWith('-before-view') || scene.sourceSuggestedScene.endsWith('-after-view')) && scene.visualProofRole !== (scene.sourceSuggestedScene.endsWith('-before-view') ? 'before-evidence' : 'after-evidence'))) fail('scene_mismatch');
    sceneStarts.push(current); current += scene.durationSeconds;
  });
  if (current !== input.videoControls.targetDurationSeconds) failDuration('scene_duration_sum_mismatch', {
    targetDurationSeconds: input.videoControls.targetDurationSeconds,
    sceneCount: candidate.scenes.length
  });
  const segments: CanonicalVoiceoverSegment[] = []; const subtitles: SubtitleCue[] = []; const claimSet = new Set<ApprovedProductFactId>();
  candidate.voiceover.segments.forEach((segment, index) => {
    const normalized = normalizeNarration(segment.spokenText); if (!normalized) failDuration('other_duration_invalid');
    validateAttributedText(normalized, segment.proposedFactIds, input, effectiveIds, claimSet, 'voiceover_segment');
    const estimatedSeconds = Math.ceil(wordCount(normalized) / 2.25); if (estimatedSeconds > candidate.scenes[index]!.durationSeconds) failDuration('segment_duration_exceeds_scene', {
      targetDurationSeconds: input.videoControls.targetDurationSeconds,
      estimatedSpokenSeconds: estimatedSeconds,
      maximumAllowedSeconds: candidate.scenes[index]!.durationSeconds,
      sceneCount: candidate.scenes.length
    });
    const sceneId = `scene-${String(index + 1).padStart(2, '0')}`; const segmentId = `segment-${String(index + 1).padStart(2, '0')}`;
    segments.push({ segmentId, sceneId, sourceScene: segment.sourceScene, spokenText: normalized, estimatedSeconds, claimsUsed: [...segment.proposedFactIds] });
    const cueLines = wrapSubtitle(normalized); const totalPoints = cueLines.reduce((sum, lines) => sum + countUnicodeCodePoints(lines.join(' ')), 0); const totalMs = estimatedSeconds * 1000; let usedMs = 0;
    cueLines.forEach((lines, cueIndex) => {
      const durationMs = cueIndex === cueLines.length - 1 ? totalMs - usedMs : Math.floor(totalMs * countUnicodeCodePoints(lines.join(' ')) / totalPoints);
      if (durationMs <= 0) failDuration('subtitle_zero_duration'); const startMs = sceneStarts[index]! * 1000 + usedMs; const endMs = startMs + durationMs;
      if (endMs > (sceneStarts[index]! + candidate.scenes[index]!.durationSeconds) * 1000) failDuration('subtitle_outside_scene');
      subtitles.push({ cueId: `cue-${String(subtitles.length + 1).padStart(2, '0')}`, sceneId, lines, startSecond: startMs / 1000, endSecond: endMs / 1000 }); usedMs += durationMs;
    });
  });
  const fullScript = segments.map((segment) => segment.spokenText).join('\n'); const estimatedSpokenSeconds = Math.ceil(wordCount(fullScript.replace(/\n/gu, ' ')) / 2.25);
  const bounds = input.videoControls.presenterMode === 'product-only' ? { min: Math.ceil(input.videoControls.targetDurationSeconds * .5), max: Math.floor(input.videoControls.targetDurationSeconds * .9) } : { min: Math.ceil(input.videoControls.targetDurationSeconds * .65), max: input.videoControls.targetDurationSeconds };
  if (estimatedSpokenSeconds < bounds.min) failDuration('narration_below_occupancy', {
    targetDurationSeconds: input.videoControls.targetDurationSeconds,
    estimatedSpokenSeconds, minimumAllowedSeconds: bounds.min,
    maximumAllowedSeconds: bounds.max, sceneCount: candidate.scenes.length
  });
  if (estimatedSpokenSeconds > bounds.max) failDuration('narration_above_occupancy', {
    targetDurationSeconds: input.videoControls.targetDurationSeconds,
    estimatedSpokenSeconds, minimumAllowedSeconds: bounds.min,
    maximumAllowedSeconds: bounds.max, sceneCount: candidate.scenes.length
  });
  const unattributedCopy: readonly { readonly value: string | undefined; readonly location: VideoPackageTextLocation }[] = [
    { value: candidate.hook.spokenHook, location: 'spoken_hook' },
    { value: candidate.hook.onScreenHook, location: 'on_screen_hook' },
    { value: candidate.hook.visualHookInstruction, location: 'visual_hook_instruction' },
    { value: candidate.cover.coverTitle, location: 'cover_title' },
    { value: candidate.cover.coverSubtitle, location: 'cover_subtitle' },
    { value: candidate.caption.callToAction, location: 'cta' },
    { value: candidate.caption.disclosureText, location: 'disclosure' },
    ...candidate.scenes.flatMap((scene) => [
      { value: scene.visualAction, location: 'scene_visual_action' as const },
      { value: scene.productionNotes, location: 'scene_production_notes' as const }
    ]),
    ...candidate.assetUsageProposal.map((item) => ({ value: item.productionInstruction,
      location: 'asset_production_instruction' as const }))
  ];
  validateHashtags(candidate.hashtags);
  unattributedCopy.forEach(({ value, location }) => {
    if (value !== undefined) validateAttributedText(value, undefined, input, effectiveIds, claimSet, location);
  });
  if (input.reviewedPlannerResult.result.plan.production.recommendedHookStrategy === 'common-question' &&
      !candidate.hook.spokenHook.trim().endsWith('?')) fail('strategy_mismatch');
  assertUnique(candidate.onScreenText.map((item) => item.key), 'scene_mismatch');
  const textKeys = candidate.onScreenText.map((item) => item.key);
  if (candidate.scenes.some((scene) => scene.onScreenTextKeys.some((key) => !textKeys.includes(key))) ||
      candidate.onScreenText.some((item) => !candidate.scenes[plannerScenes.indexOf(item.sourceScene)]?.onScreenTextKeys.includes(item.key))) fail('scene_mismatch');
  candidate.onScreenText.forEach((item) => {
    const sceneIndex = plannerScenes.indexOf(item.sourceScene); const scene = candidate.scenes[sceneIndex];
    if (!scene || !VIDEO_SCENE_TEXT_ROLES[item.sourceScene].includes(item.styleRole)) fail('scene_mismatch');
    if (item.endOffsetSecond <= item.startOffsetSecond) failDuration('onscreen_text_duration_invalid', {
      targetDurationSeconds: input.videoControls.targetDurationSeconds,
      sceneCount: candidate.scenes.length
    });
    if (item.endOffsetSecond > scene.durationSeconds) failDuration('onscreen_text_timing_invalid', {
      targetDurationSeconds: input.videoControls.targetDurationSeconds,
      maximumAllowedSeconds: scene.durationSeconds, sceneCount: candidate.scenes.length
    });
    validateAttributedText(item.text, item.proposedFactIds, input, effectiveIds, claimSet, 'on_screen_text');
  });
  validateAttributedText(candidate.caption.text, candidate.caption.proposedFactIds, input, effectiveIds, claimSet, 'caption');
  for (const asset of [...candidate.cover.requiredAssetIds, ...candidate.assetUsageProposal.map((item) => item.assetId), ...(candidate.backgroundAssetId ? [candidate.backgroundAssetId] : [])]) if (!input.availableAssetIds.includes(asset)) fail('asset_mismatch');
  if (!plannerScenes.includes(candidate.cover.selectedCoverScene) || candidate.assetUsageProposal.some((item) => item.sourceScenes.some((scene) => !plannerScenes.includes(scene)))) fail('scene_mismatch');
  validateCommerce(candidate, input, claimSet);
  return { candidate, segments, fullScript, estimatedSpokenSeconds, subtitles, claimsUsed: APPROVED_PRODUCT_FACT_IDS.filter((id) => claimSet.has(id)) };
}

function validateHashtags(values: readonly string[]): void {
  if (values.length < 3 || values.length > 5) fail('unsupported_claim', 'prohibited_hashtag', 'hashtag');
  const normalized = values.map((value) => value.normalize('NFKC').toLocaleLowerCase('de-DE'));
  if (new Set(normalized).size !== normalized.length || normalized.some((value, index) =>
    value !== values[index] || !VOLUVIA_VIDEO_HASHTAG_ALLOWLIST.some((allowed) => allowed === value))) {
    fail('unsupported_claim', 'prohibited_hashtag', 'hashtag');
  }
  const canonical = VOLUVIA_VIDEO_HASHTAG_ALLOWLIST.filter((value) => normalized.includes(value));
  if (JSON.stringify(normalized) !== JSON.stringify(canonical)) {
    fail('unsupported_claim', 'prohibited_hashtag', 'hashtag');
  }
}

function validateCommerce(candidate: VideoPackageCandidate, input: VoluviaVideoPackageGenerationInput, claims: ReadonlySet<ApprovedProductFactId>): void {
  const textValue = canonicalizeVideoPackageValue(candidate).normalize('NFKC').toLocaleLowerCase('de-DE');
  const plannerFacts = input.reviewedPlannerResult.result.plan.brandSafety.approvedFacts.map((fact) => fact.factId);
  const priceAllowed = input.videoControls.priceMayBeFeatured && plannerFacts.includes('price-49-eur') && input.approvedProductFacts.some((fact) => fact.factId === 'price-49-eur');
  const shippingAllowed = input.videoControls.shippingMayBeFeatured && plannerFacts.includes('ships-from-germany') && input.approvedProductFacts.some((fact) => fact.factId === 'ships-from-germany');
  if ((!priceAllowed && (claims.has('price-49-eur') || /49\s*(?:eur|€)|€\s*49/u.test(textValue))) || (!shippingAllowed && (claims.has('ships-from-germany') || /versand aus deutschland|shipping from germany/u.test(textValue)))) fail('commerce_control_violation');
}

export interface FinalVideoPackageValidationContext {
  readonly input: VoluviaVideoPackageGenerationInput;
  readonly clientResult: VideoPackageClientResult;
  readonly effectiveFacts: readonly ApprovedProductFact[];
}

export function validateFinalVideoPackage(
  value: unknown,
  context: FinalVideoPackageValidationContext
): VoluviaVideoPackage {
  canonicalizeVideoPackageValue(value);
  const parsed = finalPackageSchema.safeParse(value);
  if (!parsed.success) fail(parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys') ? 'unknown_field' : 'local_validation');
  const packageValue = parsed.data;
  const { input, clientResult, effectiveFacts } = context;
  const derived = validateAndDeriveCandidate(clientResult, input, effectiveFacts);
  const planner = input.reviewedPlannerResult.result.plan;
  const sourcePlanHash = hashVideoPackageValue(input.reviewedPlannerResult.result);
  const expectedPackageId = hashVideoPackageValue({
    operationId: VOLUVIA_VIDEO_PACKAGE_OPERATION_ID,
    schemaVersion: VOLUVIA_VIDEO_PACKAGE_SCHEMA_VERSION,
    sourcePlanHash,
    prompt: { ...VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE,
      promptContentHash: clientResult.provenance.promptContentHash },
    controls: input.videoControls,
    candidate: derived.candidate
  });
  const expectedScenes: VoluviaVideoPackage['scenes'][number][] = [];
  let sceneStart = 0;
  derived.candidate.scenes.forEach((scene, index) => {
    expectedScenes.push({
      sceneId: `scene-${String(index + 1).padStart(2, '0')}`,
      sourceSuggestedScene: scene.sourceSuggestedScene, sequence: index + 1,
      startSecond: sceneStart, durationSeconds: scene.durationSeconds,
      cameraFraming: scene.cameraFraming, visualAction: scene.visualAction,
      requiredAssetIds: [...scene.requiredAssetIds],
      voiceoverSegmentId: derived.segments[index]!.segmentId,
      onScreenTextIds: scene.onScreenTextKeys.map((key) => `text-${key}`),
      productionNotes: scene.productionNotes, visualProofRole: scene.visualProofRole,
      transitionType: scene.transitionType
    });
    sceneStart += scene.durationSeconds;
  });
  const expectedText = derived.candidate.onScreenText.map((item) => {
    const index = planner.production.suggestedScenes.indexOf(item.sourceScene);
    return { textId: `text-${item.key}`, sceneId: expectedScenes[index]!.sceneId,
      text: item.text, startSecond: expectedScenes[index]!.startSecond + item.startOffsetSecond,
      endSecond: expectedScenes[index]!.startSecond + item.endOffsetSecond,
      semanticFactIds: [...item.proposedFactIds], styleRole: item.styleRole };
  });
  const expectedChecklist = derived.candidate.assetUsageProposal.map((item) => ({
    assetId: item.assetId, required: true,
    usedBySceneIds: item.sourceScenes.map((scene) => expectedScenes[planner.production.suggestedScenes.indexOf(scene)]!.sceneId),
    productionInstruction: item.productionInstruction,
    missingAssetBehavior: 'reject-package' as const
  }));
  const coverIndex = planner.production.suggestedScenes.indexOf(derived.candidate.cover.selectedCoverScene);
  const expectedForbidden = [...new Set([
    ...input.reviewedPlannerResult.result.plan.brandSafety.forbiddenClaims,
    ...input.brandPolicy.forbiddenClaims
  ])];
  const expectedProhibitedTone = PROHIBITED_TONES.filter((tone) =>
    input.reviewedPlannerResult.result.plan.brandSafety.prohibitedTone.includes(tone) ||
    input.brandPolicy.prohibitedTone.includes(tone));
  const same = (left: unknown, right: unknown): boolean =>
    canonicalizeVideoPackageValue(left) === canonicalizeVideoPackageValue(right);
  const checks: readonly [unknown, unknown][] = [
    [packageValue.packageId, expectedPackageId],
    [packageValue.sourcePlan, { workflowId: input.reviewedPlannerResult.workflowId,
      workflowVersion: 1, operationId: input.reviewedPlannerResult.operationId, sourcePlanHash }],
    [{ provider: packageValue.provenance.provider, model: packageValue.provenance.model,
      promptId: packageValue.provenance.promptId, promptVersion: packageValue.provenance.promptVersion,
      promptContentHash: packageValue.provenance.promptContentHash }, {
      provider: clientResult.provenance.provider, model: clientResult.provenance.model,
      promptId: VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE.promptId, promptVersion: 4,
      promptContentHash: clientResult.provenance.promptContentHash
    }],
    [packageValue.summary, { audience: planner.audience, strategy: planner.strategy,
      language: 'de-DE', platform: 'TikTok', targetDurationSeconds: input.videoControls.targetDurationSeconds,
      estimatedDurationSeconds: input.videoControls.targetDurationSeconds,
      videoStyle: planner.production.recommendedVideoStyle,
      hookStrategy: planner.production.recommendedHookStrategy,
      visualProofRequired: planner.production.visualProofRequired,
      presenterMode: input.videoControls.presenterMode }],
    [packageValue.hook, derived.candidate.hook],
    [packageValue.voiceover, { segments: derived.segments, fullScript: derived.fullScript,
      estimatedSpokenSeconds: derived.estimatedSpokenSeconds }],
    [packageValue.scenes, expectedScenes], [packageValue.onScreenText, expectedText],
    [packageValue.cover, { coverTitle: derived.candidate.cover.coverTitle,
      ...(derived.candidate.cover.coverSubtitle === undefined ? {} : { coverSubtitle: derived.candidate.cover.coverSubtitle }),
      selectedCoverSceneId: expectedScenes[coverIndex]!.sceneId,
      requiredAssetIds: derived.candidate.cover.requiredAssetIds }],
    [packageValue.caption, { text: derived.candidate.caption.text,
      callToAction: derived.candidate.caption.callToAction,
      semanticFactIds: derived.candidate.caption.proposedFactIds,
      ...(derived.candidate.caption.disclosureText === undefined ? {} : { disclosureText: derived.candidate.caption.disclosureText }) }],
    [packageValue.hashtags, derived.candidate.hashtags],
    [packageValue.assetChecklist, expectedChecklist],
    [packageValue.narrationPackage, { presenterMode: input.videoControls.presenterMode,
      narrationText: derived.fullScript, sceneNarrationSegments: derived.segments,
      subtitleLines: derived.subtitles,
      avatarRequired: input.videoControls.presenterMode === 'presenter-plus-product',
      voiceRequired: input.videoControls.presenterMode === 'presenter-plus-product',
      ...(derived.candidate.backgroundAssetId === undefined ? {} : { backgroundAssetId: derived.candidate.backgroundAssetId }),
      aspectRatio: '9:16', resolutionClass: 'vertical-hd' }],
    [packageValue.safety, { approvedFacts: effectiveFacts, claimsUsed: derived.claimsUsed,
      forbiddenClaims: expectedForbidden, prohibitedTone: expectedProhibitedTone,
      manualReviewRequired: true, commerceControlsApplied: {
        priceEnabled: input.videoControls.priceMayBeFeatured && effectiveFacts.some((fact) => fact.factId === 'price-49-eur'),
        shippingEnabled: input.videoControls.shippingMayBeFeatured && effectiveFacts.some((fact) => fact.factId === 'ships-from-germany'),
        deliveryClaimsEnabled: false
      }, unsupportedClaimScanPassed: true, sceneCompatibilityPassed: true,
      assetCompatibilityPassed: true }],
    [packageValue.packageReviewStatus, 'pending_manual_review']
  ];
  if (checks.some(([actual, expected]) => !same(actual, expected))) fail('local_validation');
  return deepFreeze(packageValue) as VoluviaVideoPackage;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach((entry) => deepFreeze(entry));
  }
  return value;
}
