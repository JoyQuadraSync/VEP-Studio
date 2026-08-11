import { z } from 'zod';
import { VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256 } from '../../../../prompts/voluvia/de/content-planner-v2.prompt';
import { isVoluviaJsonSafe } from '../policy/voluvia-json-safety';
import { containsMarkdown, countUnicodeCodePoints } from '../policy/voluvia-text-normalization';
import {
  APPROVED_PRODUCT_FACT_IDS,
  APPROVED_PRODUCT_FACT_VALUES,
  AUDIENCE_AWARENESS_LEVELS,
  AUDIENCE_CONCERNS,
  BRAND_TONES,
  CONTENT_ANGLES,
  CONTENT_FOCUSES,
  CONTENT_GOALS,
  DESIRED_ACTIONS,
  EMOTIONAL_GOALS,
  HOOK_STRATEGIES,
  PROHIBITED_TONES,
  PURCHASE_TRIGGERS,
  SUGGESTED_SCENES,
  VIDEO_STYLES,
  VOLUVIA_BRAND_MISSION,
  VOLUVIA_BRAND_PROMISE,
  VOLUVIA_COLORS,
  VOLUVIA_CONTENT_PLAN_OPERATION_ID,
  VOLUVIA_CONTENT_PLAN_SCHEMA_VERSION,
  VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE,
  ApprovedProductFact,
  ApprovedProductFactId,
  AudienceConcern,
  ContentAngle,
  ContentFocus,
  ContentPlanningCandidate,
  DesiredAction,
  HookStrategy,
  PurchaseTrigger,
  SuggestedScene,
  VideoStyle,
  VoluviaContentPlannerInput,
  VoluviaContentPlanningResult
} from './voluvia-content-planner-contracts';
import {
  ANGLE_HOOK_STRATEGIES,
  CONCERN_PURCHASE_TRIGGERS,
  DESIRED_ACTION_ANGLES,
  FOCUS_REQUIRED_FACTS,
  FOCUS_SCENES,
  FOCUS_STYLES,
  STYLE_SCENES
} from './voluvia-content-planner-compatibility';
import { ContentPlanningClientResult } from '../../../../integrations/ai/content-planning-client';

export type VoluviaContentPlanLocalValidationCode =
  | 'invalid_input'
  | 'invalid_product_facts'
  | 'invalid_candidate_shape'
  | 'invalid_generation_metadata'
  | 'prompt_identity_mismatch'
  | 'prompt_hash_mismatch'
  | 'preferred_focus_mismatch'
  | 'preferred_angle_mismatch'
  | 'excluded_focus_selected'
  | 'excluded_angle_selected'
  | 'no_feasible_focus'
  | 'concern_problem_mismatch'
  | 'concern_trigger_incompatible'
  | 'focus_not_approved'
  | 'focus_missing_required_fact'
  | 'focus_style_incompatible'
  | 'focus_scene_incompatible'
  | 'angle_hook_incompatible'
  | 'desired_action_angle_incompatible'
  | 'scene_count_invalid'
  | 'scene_duplicate'
  | 'before_after_pair_incomplete'
  | 'before_after_evidence_missing'
  | 'visual_proof_mismatch'
  | 'duration_mismatch'
  | 'price_reference_disabled'
  | 'shipping_reference_disabled'
  | 'delivery_reference_forbidden'
  | 'unsafe_json'
  | 'unknown_field'
  | 'other_local_validation';

export interface VoluviaConcernTriggerDiagnosticContext {
  readonly selectedConcern: AudienceConcern;
  readonly selectedPurchaseTrigger: PurchaseTrigger;
}

export interface VoluviaFocusSceneDiagnosticContext {
  readonly selectedFocus: ContentFocus;
  readonly selectedScenes: readonly SuggestedScene[];
}

export interface VoluviaContentPlanLocalValidationDiagnostic {
  readonly code: VoluviaContentPlanLocalValidationCode;
  readonly context?: VoluviaConcernTriggerDiagnosticContext | VoluviaFocusSceneDiagnosticContext;
}

export class VoluviaContentPlanLocalValidationFailure {
  readonly name = 'VoluviaContentPlanLocalValidationFailure';
  readonly context?: VoluviaConcernTriggerDiagnosticContext | VoluviaFocusSceneDiagnosticContext;

  constructor(
    readonly code: VoluviaContentPlanLocalValidationCode,
    context?: Readonly<{
      selectedConcern?: unknown;
      selectedPurchaseTrigger?: unknown;
      selectedFocus?: unknown;
      selectedScenes?: unknown;
    }>
  ) {
    if (code === 'concern_trigger_incompatible' &&
        typeof context?.selectedConcern === 'string' &&
        AUDIENCE_CONCERNS.includes(context.selectedConcern as AudienceConcern) &&
        typeof context.selectedPurchaseTrigger === 'string' &&
        PURCHASE_TRIGGERS.includes(context.selectedPurchaseTrigger as PurchaseTrigger)) {
      this.context = Object.freeze({
        selectedConcern: context.selectedConcern as AudienceConcern,
        selectedPurchaseTrigger: context.selectedPurchaseTrigger as PurchaseTrigger
      });
    } else if (code === 'focus_scene_incompatible' &&
        typeof context?.selectedFocus === 'string' &&
        CONTENT_FOCUSES.includes(context.selectedFocus as ContentFocus) &&
        Array.isArray(context.selectedScenes) &&
        context.selectedScenes.length <= 5 &&
        context.selectedScenes.every((scene) =>
          typeof scene === 'string' && SUGGESTED_SCENES.includes(scene as SuggestedScene))) {
      this.context = Object.freeze({
        selectedFocus: context.selectedFocus as ContentFocus,
        selectedScenes: Object.freeze([...context.selectedScenes] as SuggestedScene[])
      });
    }
  }

  toDiagnostic(): VoluviaContentPlanLocalValidationDiagnostic {
    return Object.freeze({
      code: this.code,
      ...(this.context === undefined ? {} : { context: this.context })
    });
  }
}

function fail(code: VoluviaContentPlanLocalValidationCode): never {
  throw new VoluviaContentPlanLocalValidationFailure(code);
}

function failConcernTrigger(
  selectedConcern: AudienceConcern,
  selectedPurchaseTrigger: PurchaseTrigger
): never {
  throw new VoluviaContentPlanLocalValidationFailure('concern_trigger_incompatible', {
    selectedConcern,
    selectedPurchaseTrigger
  });
}

function failFocusScene(
  selectedFocus: ContentFocus,
  selectedScenes: readonly SuggestedScene[]
): never {
  throw new VoluviaContentPlanLocalValidationFailure('focus_scene_incompatible', {
    selectedFocus,
    selectedScenes
  });
}

function classifyShapeFailure(
  error: z.ZodError,
  fallback: VoluviaContentPlanLocalValidationCode
): VoluviaContentPlanLocalValidationCode {
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      const keys = issue.keys.map((key) => key.toLocaleLowerCase('en-US'));
      if (keys.some((key) => key.includes('price') || key.includes('preis'))) {
        return 'price_reference_disabled';
      }
      if (keys.some((key) => key.includes('shipping') || key.includes('ships') ||
          key.includes('versand'))) {
        return 'shipping_reference_disabled';
      }
      if (keys.some((key) => key.includes('delivery') || key.includes('liefer'))) {
        return 'delivery_reference_forbidden';
      }
      return 'unknown_field';
    }
    if (issue.path.at(-1) === 'suggestedScenes' &&
        (issue.code === 'too_small' || issue.code === 'too_big')) {
      return 'scene_count_invalid';
    }
  }
  return fallback;
}

const boundedText = (minimum: number, maximum: number) => z.string().refine((value) => {
  const count = countUnicodeCodePoints(value);
  return count >= minimum && count <= maximum;
});

const factIdSchema = z.enum(APPROVED_PRODUCT_FACT_IDS);
const factSchema = z.object({
  factId: factIdSchema,
  displayValue: boundedText(1, 120)
}).strict();

const productSchema = z.object({
  productKey: z.literal('voluvia-remy-hair-topper'),
  name: z.literal('Remy Echthaar Hair Topper'),
  category: z.literal('hair-topper'),
  material: z.literal('100% Remy Echthaar'),
  hairType: z.literal('human-hair'),
  lengthCm: z.literal(32),
  colors: z.array(z.enum(VOLUVIA_COLORS)).length(3),
  base: z.literal('lightweight-hand-knotted-lace'),
  clipCount: z.literal(3),
  price: z.object({ amount: z.literal(49), currency: z.literal('EUR') }).strict(),
  shipsFrom: z.literal('Germany')
}).strict();

const controlsSchema = z.object({
  preferredContentAngle: z.enum(CONTENT_ANGLES).optional(),
  preferredContentFocus: z.enum(CONTENT_FOCUSES).optional(),
  excludedRecentlyUsedAngles: z.array(z.enum(CONTENT_ANGLES)),
  excludedRecentlyUsedFocuses: z.array(z.enum(CONTENT_FOCUSES)),
  priceMayBeFeatured: z.boolean(),
  shippingMayBeFeatured: z.boolean(),
  realBeforeAfterEvidenceAvailable: z.boolean()
}).strict();

const plannerInputSchema = z.object({
  product: productSchema,
  approvedProductFacts: z.array(factSchema).min(1).max(APPROVED_PRODUCT_FACT_IDS.length),
  approvedSellingPoints: z.array(z.enum(CONTENT_FOCUSES)).min(1),
  forbiddenClaims: z.array(boundedText(1, 200)).max(30),
  targetCustomer: z.object({
    gender: z.literal('women'),
    concerns: z.array(z.enum(AUDIENCE_CONCERNS)).min(1)
  }).strict(),
  brand: z.object({
    mission: z.literal(VOLUVIA_BRAND_MISSION),
    promise: z.literal(VOLUVIA_BRAND_PROMISE),
    tone: z.array(z.enum(BRAND_TONES)).min(1),
    prohibitedTone: z.array(z.enum(PROHIBITED_TONES)).min(1)
  }).strict(),
  contentGoal: z.enum(CONTENT_GOALS),
  targetPlatform: z.literal('TikTok'),
  targetLanguage: z.literal('de-DE'),
  preferredVideoDurationSeconds: z.number().int().min(15).max(90),
  plannerControls: controlsSchema
}).strict();

export const voluviaContentPlanningCandidateSchema = z.object({
  audience: z.object({
    gender: z.literal('women'),
    primaryConcern: z.enum(AUDIENCE_CONCERNS),
    awarenessLevel: z.enum(AUDIENCE_AWARENESS_LEVELS)
  }).strict(),
  strategy: z.object({
    primaryProblem: z.enum(AUDIENCE_CONCERNS),
    purchaseTrigger: z.enum(PURCHASE_TRIGGERS),
    contentFocus: z.enum(CONTENT_FOCUSES),
    contentAngle: z.enum(CONTENT_ANGLES),
    emotionalGoal: z.enum(EMOTIONAL_GOALS),
    desiredAction: z.enum(DESIRED_ACTIONS)
  }).strict(),
  production: z.object({
    recommendedVideoStyle: z.enum(VIDEO_STYLES),
    recommendedHookStrategy: z.enum(HOOK_STRATEGIES),
    targetDurationSeconds: z.number().int().min(15).max(90),
    visualProofRequired: z.boolean(),
    suggestedScenes: z.array(z.enum(SUGGESTED_SCENES)).min(2).max(5)
  }).strict()
}).strict();

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

function canonicalFacts(facts: readonly ApprovedProductFact[]): readonly ApprovedProductFact[] {
  const byId = new Map(facts.map((fact) => [fact.factId, fact]));
  return APPROVED_PRODUCT_FACT_IDS.flatMap((factId) => {
    const fact = byId.get(factId);
    return fact ? [{ ...fact }] : [];
  });
}

function validateFacts(facts: readonly ApprovedProductFact[]): void {
  if (!unique(facts.map((fact) => fact.factId))) fail('invalid_product_facts');
  for (const fact of facts) {
    if (APPROVED_PRODUCT_FACT_VALUES[fact.factId] !== fact.displayValue) {
      fail('invalid_product_facts');
    }
  }
}

function focusHasRequiredFacts(
  focus: ContentFocus,
  factIds: readonly ApprovedProductFactId[]
): boolean {
  return (FOCUS_REQUIRED_FACTS[focus] ?? []).every((factId) => factIds.includes(factId));
}

function requireIncludes<T>(
  values: readonly T[],
  required: T,
  code: VoluviaContentPlanLocalValidationCode
): void {
  if (!values.includes(required)) fail(code);
}

export function validateVoluviaContentPlannerInput(value: unknown): VoluviaContentPlannerInput {
  if (!isVoluviaJsonSafe(value)) fail('unsafe_json');
  const parsed = plannerInputSchema.safeParse(value);
  if (!parsed.success) fail(classifyShapeFailure(parsed.error, 'invalid_input'));
  const input = parsed.data;
  if (!unique(input.product.colors) || input.product.colors.some((color) => !VOLUVIA_COLORS.includes(color))) {
    fail('invalid_input');
  }
  if (!unique(input.approvedSellingPoints) || !unique(input.targetCustomer.concerns) ||
      !unique(input.brand.tone) || !unique(input.brand.prohibitedTone) ||
      !unique(input.plannerControls.excludedRecentlyUsedAngles) ||
      !unique(input.plannerControls.excludedRecentlyUsedFocuses)) {
    fail('invalid_input');
  }
  validateFacts(input.approvedProductFacts);
  const controls = input.plannerControls;
  if (controls.preferredContentAngle && controls.excludedRecentlyUsedAngles.includes(controls.preferredContentAngle)) {
    fail('invalid_input');
  }
  if (controls.preferredContentFocus && controls.excludedRecentlyUsedFocuses.includes(controls.preferredContentFocus)) {
    fail('invalid_input');
  }
  const effectiveFactIds = deriveEffectivePlannerFacts(input).map((fact) => fact.factId);
  const availableFocuses = input.approvedSellingPoints.filter(
    (focus) => !controls.excludedRecentlyUsedFocuses.includes(focus) &&
      (focus !== 'german-shipping' || controls.shippingMayBeFeatured) &&
      focusHasRequiredFacts(focus, effectiveFactIds)
  );
  if (availableFocuses.length === 0) fail('no_feasible_focus');
  if (controls.preferredContentFocus && !availableFocuses.includes(controls.preferredContentFocus)) {
    fail('preferred_focus_mismatch');
  }
  if (controls.excludedRecentlyUsedAngles.length === CONTENT_ANGLES.length) {
    fail('invalid_input');
  }
  return {
    ...input,
    product: { ...input.product, colors: [...input.product.colors], price: { ...input.product.price } },
    approvedProductFacts: canonicalFacts(input.approvedProductFacts),
    approvedSellingPoints: [...input.approvedSellingPoints],
    forbiddenClaims: [...input.forbiddenClaims],
    targetCustomer: { ...input.targetCustomer, concerns: [...input.targetCustomer.concerns] },
    brand: { ...input.brand, tone: [...input.brand.tone], prohibitedTone: [...input.brand.prohibitedTone] },
    plannerControls: {
      ...input.plannerControls,
      excludedRecentlyUsedAngles: [...input.plannerControls.excludedRecentlyUsedAngles],
      excludedRecentlyUsedFocuses: [...input.plannerControls.excludedRecentlyUsedFocuses]
    }
  };
}

export function deriveEffectivePlannerFacts(
  input: VoluviaContentPlannerInput
): readonly ApprovedProductFact[] {
  return canonicalFacts(input.approvedProductFacts.filter((fact) =>
    (fact.factId !== 'price-49-eur' || input.plannerControls.priceMayBeFeatured) &&
    (fact.factId !== 'ships-from-germany' || input.plannerControls.shippingMayBeFeatured)
  ));
}

export function validateContentPlanningCandidate(
  value: unknown,
  input: VoluviaContentPlannerInput,
  effectiveFacts: readonly ApprovedProductFact[]
): ContentPlanningCandidate {
  if (!isVoluviaJsonSafe(value)) fail('unsafe_json');
  const parsed = voluviaContentPlanningCandidateSchema.safeParse(value);
  if (!parsed.success) fail(classifyShapeFailure(parsed.error, 'invalid_candidate_shape'));
  const candidate = parsed.data;
  const { strategy, production, audience } = candidate;
  if (audience.primaryConcern !== strategy.primaryProblem ||
      !input.targetCustomer.concerns.includes(audience.primaryConcern)) {
    fail('concern_problem_mismatch');
  }
  if (!CONCERN_PURCHASE_TRIGGERS[audience.primaryConcern].includes(strategy.purchaseTrigger)) {
    failConcernTrigger(audience.primaryConcern, strategy.purchaseTrigger);
  }
  requireIncludes(input.approvedSellingPoints, strategy.contentFocus,
    'focus_not_approved');
  requireIncludes(FOCUS_STYLES[strategy.contentFocus], production.recommendedVideoStyle,
    'focus_style_incompatible');
  requireIncludes(ANGLE_HOOK_STRATEGIES[strategy.contentAngle], production.recommendedHookStrategy,
    'angle_hook_incompatible');
  requireIncludes(DESIRED_ACTION_ANGLES[strategy.desiredAction], strategy.contentAngle,
    'desired_action_angle_incompatible');
  if (!unique(production.suggestedScenes)) fail('scene_duplicate');
  for (const scene of production.suggestedScenes) {
    if (!FOCUS_SCENES[strategy.contentFocus].includes(scene) ||
        !STYLE_SCENES[production.recommendedVideoStyle].includes(scene)) {
      failFocusScene(strategy.contentFocus, production.suggestedScenes);
    }
  }
  const factIds = effectiveFacts.map((fact) => fact.factId);
  for (const factId of FOCUS_REQUIRED_FACTS[strategy.contentFocus] ?? []) {
    requireIncludes(factIds, factId, 'focus_missing_required_fact');
  }
  if (strategy.contentFocus === 'german-shipping' && !input.plannerControls.shippingMayBeFeatured) {
    fail('shipping_reference_disabled');
  }
  if (input.plannerControls.preferredContentFocus &&
      strategy.contentFocus !== input.plannerControls.preferredContentFocus) {
    fail('preferred_focus_mismatch');
  }
  if (input.plannerControls.preferredContentAngle &&
      strategy.contentAngle !== input.plannerControls.preferredContentAngle) {
    fail('preferred_angle_mismatch');
  }
  if (input.plannerControls.excludedRecentlyUsedFocuses.includes(strategy.contentFocus)) {
    fail('excluded_focus_selected');
  }
  if (input.plannerControls.excludedRecentlyUsedAngles.includes(strategy.contentAngle)) {
    fail('excluded_angle_selected');
  }
  if (production.targetDurationSeconds !== input.preferredVideoDurationSeconds) {
    fail('duration_mismatch');
  }
  const beforeAfter = production.recommendedVideoStyle === 'before-after' ||
    strategy.contentAngle === 'before-after';
  const partingPair = production.suggestedScenes.includes('parting-before-view') &&
    production.suggestedScenes.includes('parting-after-view');
  const crownPair = production.suggestedScenes.includes('crown-before-view') &&
    production.suggestedScenes.includes('crown-after-view');
  const hasPartingMember = production.suggestedScenes.includes('parting-before-view') ||
    production.suggestedScenes.includes('parting-after-view');
  const hasCrownMember = production.suggestedScenes.includes('crown-before-view') ||
    production.suggestedScenes.includes('crown-after-view');
  const containsBeforeAfterScene = production.suggestedScenes.some((scene) =>
    scene.includes('-before-') || scene.includes('-after-'));
  if (beforeAfter || containsBeforeAfterScene) {
    if (!input.plannerControls.realBeforeAfterEvidenceAvailable ||
        !production.visualProofRequired) fail('before_after_evidence_missing');
    if ((!partingPair && !crownPair) || (hasPartingMember && !partingPair) ||
        (hasCrownMember && !crownPair)) fail('before_after_pair_incomplete');
  } else if (production.visualProofRequired) {
    fail('visual_proof_mismatch');
  }
  return candidate;
}

const clientMetadataSchema = z.object({
  provider: boundedText(1, 100),
  model: boundedText(1, 200),
  responseId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/u),
  inputTokens: z.number().int().nonnegative().finite(),
  outputTokens: z.number().int().nonnegative().finite(),
  totalTokens: z.number().int().nonnegative().finite(),
  promptId: z.literal(VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptId),
  promptVersion: z.literal(VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptVersion),
  promptContentHash: z.literal(VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256)
}).strict();

const contentPlanningResultSchema = z.object({
  reviewStatus: z.literal('pending_manual_review'),
  plan: voluviaContentPlanningCandidateSchema.extend({
    brandSafety: z.object({
      approvedFacts: z.array(factSchema),
      forbiddenClaims: z.array(z.string()),
      prohibitedTone: z.array(z.enum(PROHIBITED_TONES)),
      manualReviewRequired: z.literal(true)
    }).strict()
  }).strict(),
  generation: clientMetadataSchema.extend({
    operationId: z.literal(VOLUVIA_CONTENT_PLAN_OPERATION_ID),
    schemaVersion: z.literal(VOLUVIA_CONTENT_PLAN_SCHEMA_VERSION)
  }).strict()
}).strict();

export interface ReviewedVoluviaContentPlanValidationContext {
  readonly realBeforeAfterEvidenceAvailable: boolean;
}

/**
 * Revalidates a stored Planner result without invoking a provider or changing
 * Planner operation behavior. This is the recovery/read boundary used by
 * downstream operations that consume an immutable reviewed plan.
 */
export function validateReviewedVoluviaContentPlanningResult(
  value: unknown,
  context: ReviewedVoluviaContentPlanValidationContext
): VoluviaContentPlanningResult {
  if (!isVoluviaJsonSafe(value)) fail('unsafe_json');
  const parsed = contentPlanningResultSchema.safeParse(value);
  if (!parsed.success) fail(classifyShapeFailure(parsed.error, 'other_local_validation'));
  const result = parsed.data;
  const facts = result.plan.brandSafety.approvedFacts;
  validateFacts(facts);
  if (JSON.stringify(facts) !== JSON.stringify(canonicalFacts(facts)) ||
      !unique(result.plan.brandSafety.prohibitedTone) ||
      result.generation.totalTokens !== result.generation.inputTokens + result.generation.outputTokens) {
    fail('other_local_validation');
  }
  const factIds = facts.map((fact) => fact.factId);
  const syntheticInput: VoluviaContentPlannerInput = {
    product: {
      productKey: 'voluvia-remy-hair-topper', name: 'Remy Echthaar Hair Topper',
      category: 'hair-topper', material: '100% Remy Echthaar', hairType: 'human-hair',
      lengthCm: 32, colors: [...VOLUVIA_COLORS], base: 'lightweight-hand-knotted-lace',
      clipCount: 3, price: { amount: 49, currency: 'EUR' }, shipsFrom: 'Germany'
    },
    approvedProductFacts: facts.map((fact) => ({ ...fact })),
    approvedSellingPoints: [...CONTENT_FOCUSES],
    forbiddenClaims: [...result.plan.brandSafety.forbiddenClaims],
    targetCustomer: { gender: 'women', concerns: [result.plan.audience.primaryConcern] },
    brand: {
      mission: VOLUVIA_BRAND_MISSION, promise: VOLUVIA_BRAND_PROMISE,
      tone: [...BRAND_TONES], prohibitedTone: [...result.plan.brandSafety.prohibitedTone]
    },
    contentGoal: 'product-awareness', targetPlatform: 'TikTok', targetLanguage: 'de-DE',
    preferredVideoDurationSeconds: result.plan.production.targetDurationSeconds,
    plannerControls: {
      preferredContentAngle: result.plan.strategy.contentAngle,
      preferredContentFocus: result.plan.strategy.contentFocus,
      excludedRecentlyUsedAngles: [], excludedRecentlyUsedFocuses: [],
      priceMayBeFeatured: factIds.includes('price-49-eur'),
      shippingMayBeFeatured: factIds.includes('ships-from-germany'),
      realBeforeAfterEvidenceAvailable: context.realBeforeAfterEvidenceAvailable
    }
  };
  validateContentPlanningCandidate({
    audience: result.plan.audience,
    strategy: result.plan.strategy,
    production: result.plan.production
  }, syntheticInput, facts);
  return result;
}

export function validateContentPlanningClientResult(
  value: unknown,
  input: VoluviaContentPlannerInput,
  effectiveFacts: readonly ApprovedProductFact[]
): ContentPlanningClientResult {
  if (!isVoluviaJsonSafe(value)) fail('unsafe_json');
  const rootSchema = z.object({
    candidate: z.unknown(),
    provider: boundedText(1, 100),
    model: boundedText(1, 200),
    responseId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/u),
    inputTokens: z.number().int().nonnegative().finite(),
    outputTokens: z.number().int().nonnegative().finite(),
    totalTokens: z.number().int().nonnegative().finite(),
    promptId: boundedText(1, 200),
    promptVersion: z.number().int().positive(),
    promptContentHash: z.string().regex(/^[a-f0-9]{64}$/u)
  }).strict();
  const root = rootSchema.safeParse(value);
  if (!root.success) fail(classifyShapeFailure(root.error, 'invalid_generation_metadata'));
  const candidate = validateContentPlanningCandidate(root.data.candidate, input, effectiveFacts);
  if (root.data.promptId !== VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptId ||
      root.data.promptVersion !== VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptVersion) {
    fail('prompt_identity_mismatch');
  }
  if (root.data.promptContentHash !== VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256) {
    fail('prompt_hash_mismatch');
  }
  const metadataValue = {
    provider: root.data.provider,
    model: root.data.model,
    responseId: root.data.responseId,
    inputTokens: root.data.inputTokens,
    outputTokens: root.data.outputTokens,
    totalTokens: root.data.totalTokens,
    promptId: root.data.promptId,
    promptVersion: root.data.promptVersion,
    promptContentHash: root.data.promptContentHash
  };
  const metadata = clientMetadataSchema.safeParse(metadataValue);
  if (!metadata.success || metadata.data.totalTokens !==
      metadata.data.inputTokens + metadata.data.outputTokens) {
    fail('invalid_generation_metadata');
  }
  return { candidate, ...metadata.data };
}

export function validateVoluviaContentPlanningResult(
  value: unknown,
  input: VoluviaContentPlannerInput,
  effectiveFacts: readonly ApprovedProductFact[]
): VoluviaContentPlanningResult {
  if (!isVoluviaJsonSafe(value)) fail('unsafe_json');
  const parsed = contentPlanningResultSchema.safeParse(value);
  if (!parsed.success) fail(classifyShapeFailure(parsed.error, 'other_local_validation'));
  validateContentPlanningCandidate({
    audience: parsed.data.plan.audience,
    strategy: parsed.data.plan.strategy,
    production: parsed.data.plan.production
  }, input, effectiveFacts);
  if (JSON.stringify(parsed.data.plan.brandSafety.approvedFacts) !== JSON.stringify(effectiveFacts) ||
      JSON.stringify(parsed.data.plan.brandSafety.forbiddenClaims) !== JSON.stringify(input.forbiddenClaims) ||
      JSON.stringify(parsed.data.plan.brandSafety.prohibitedTone) !== JSON.stringify(input.brand.prohibitedTone)) {
    fail('other_local_validation');
  }
  return parsed.data;
}
