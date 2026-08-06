import { PromptReference } from '../../../../prompts/prompt-reference';

export const VOLUVIA_CONTENT_PLANNER_WORKFLOW_ID =
  'voluvia.tiktok.contentplanning.ai.workflow';
export const VOLUVIA_CONTENT_PLANNER_WORKFLOW_VERSION = 1;
export const VOLUVIA_CONTENT_PLAN_OPERATION_ID = 'voluvia.content.plan.ai';
export const VOLUVIA_CONTENT_PLAN_SCHEMA_VERSION = 1;
export const VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE: PromptReference = Object.freeze({
  promptId: 'voluvia.tiktok.content-planner.de',
  promptVersion: 2
});

export const APPROVED_PRODUCT_FACT_IDS = [
  'material-remy-human-hair-100-percent',
  'length-32-cm',
  'clip-count-3',
  'base-lightweight-hand-knotted-lace',
  'ships-from-germany',
  'price-49-eur',
  'color-honig-blond',
  'color-hell-blond',
  'color-mittel-braun'
] as const;
export type ApprovedProductFactId = typeof APPROVED_PRODUCT_FACT_IDS[number];

export const APPROVED_PRODUCT_FACT_VALUES: Readonly<Record<ApprovedProductFactId, string>> =
  Object.freeze({
    'material-remy-human-hair-100-percent': '100% Remy Echthaar',
    'length-32-cm': '32 cm',
    'clip-count-3': '3 Clips',
    'base-lightweight-hand-knotted-lace': 'Leichte, handgeknüpfte Lace-Basis',
    'ships-from-germany': 'Versand aus Deutschland',
    'price-49-eur': '49 EUR',
    'color-honig-blond': 'Honig Blond',
    'color-hell-blond': 'Hell Blond',
    'color-mittel-braun': 'Mittel Braun'
  });

export interface ApprovedProductFact {
  readonly factId: ApprovedProductFactId;
  readonly displayValue: string;
}

export const VOLUVIA_COLORS = ['honig-blond', 'hell-blond', 'mittel-braun'] as const;
export type VoluviaColor = typeof VOLUVIA_COLORS[number];

export const CONTENT_ANGLES = [
  'education', 'product-demonstration', 'daily-routine', 'styling',
  'objection-handling', 'product-discovery', 'before-after'
] as const;
export type ContentAngle = typeof CONTENT_ANGLES[number];

export const CONTENT_FOCUSES = [
  'what-is-a-hair-topper', 'natural-appearance', 'lightweight-construction',
  'easy-application', 'human-hair-styling', 'fuller-looking-crown',
  'visible-parting-coverage', 'small-grey-area-coverage', 'available-colors',
  'german-shipping'
] as const;
export type ContentFocus = typeof CONTENT_FOCUSES[number];

export const AUDIENCE_CONCERNS = [
  'visible-thinning-crown', 'wide-hair-parting', 'lack-of-volume',
  'naturalness-uncertainty', 'hair-topper-unawareness', 'fake-appearance-concern',
  'application-complexity', 'small-grey-area-coverage', 'color-selection'
] as const;
export type AudienceConcern = typeof AUDIENCE_CONCERNS[number];

export const AUDIENCE_AWARENESS_LEVELS = [
  'unaware', 'problem-aware', 'solution-aware', 'product-aware'
] as const;
export type AudienceAwarenessLevel = typeof AUDIENCE_AWARENESS_LEVELS[number];

export const PURCHASE_TRIGGERS = [
  'naturally-fuller-looking-hair', 'less-visible-wide-parting',
  'discreet-natural-appearance', 'alternative-to-full-wig',
  'easy-daily-application', 'greater-social-confidence',
  'cover-small-grey-areas', 'find-suitable-color'
] as const;
export type PurchaseTrigger = typeof PURCHASE_TRIGGERS[number];

export const EMOTIONAL_GOALS = [
  'curiosity', 'reassurance', 'confidence', 'relief', 'recognition', 'trust',
  'product-awareness'
] as const;
export type EmotionalGoal = typeof EMOTIONAL_GOALS[number];

export const DESIRED_ACTIONS = [
  'learn-more', 'view-product', 'compare-colors', 'explore-how-it-works',
  'save-for-later', 'visit-shop'
] as const;
export type DesiredAction = typeof DESIRED_ACTIONS[number];

export const BRAND_TONES = [
  'premium', 'authentic', 'elegant', 'calm', 'warm', 'trustworthy'
] as const;
export type BrandTone = typeof BRAND_TONES[number];

export const PROHIBITED_TONES = [
  'exaggerated', 'medical', 'mlm-style', 'cheap', 'aggressive-sales',
  'fear-marketing', 'shame-marketing', 'beauty-anxiety-marketing',
  'fake-urgency', 'fake-scarcity'
] as const;
export type ProhibitedTone = typeof PROHIBITED_TONES[number];

export const VIDEO_STYLES = [
  'before-after', 'hands-on-demo', 'mirror-demo', 'educational-explainer',
  'morning-routine', 'close-up-product-demo', 'styling-demo', 'product-only'
] as const;
export type VideoStyle = typeof VIDEO_STYLES[number];

export const HOOK_STRATEGIES = [
  'product-discovery', 'visual-transformation', 'common-question', 'misconception',
  'problem-recognition', 'product-demonstration', 'naturalness-proof', 'simple-how-to'
] as const;
export type HookStrategy = typeof HOOK_STRATEGIES[number];

export const SUGGESTED_SCENES = [
  'product-close-up', 'lace-base-close-up', 'clip-demonstration',
  'parting-before-view', 'parting-after-view', 'crown-before-view',
  'crown-after-view', 'mirror-application', 'color-comparison',
  'human-hair-styling', 'finished-natural-look', 'package-and-product'
] as const;
export type SuggestedScene = typeof SUGGESTED_SCENES[number];

export const CONTENT_GOALS = [
  'product-awareness', 'product-education', 'objection-resolution',
  'product-consideration', 'color-discovery'
] as const;
export type ContentGoal = typeof CONTENT_GOALS[number];

export const VOLUVIA_BRAND_MISSION = 'Voluvia believes every woman has the right to pursue beauty and the freedom to decide how she presents herself. If thinning hair affects her confidence, she should not have to accept it silently. Voluvia aims to provide natural, comfortable and authentic Hair Toppers that offer women a choice rather than forcing them to compromise.';
export const VOLUVIA_BRAND_PROMISE =
  'Natural beauty should always be a choice, never a compromise.';

export interface VoluviaContentPlannerInput {
  readonly product: {
    readonly productKey: 'voluvia-remy-hair-topper';
    readonly name: 'Remy Echthaar Hair Topper';
    readonly category: 'hair-topper';
    readonly material: '100% Remy Echthaar';
    readonly hairType: 'human-hair';
    readonly lengthCm: 32;
    readonly colors: readonly VoluviaColor[];
    readonly base: 'lightweight-hand-knotted-lace';
    readonly clipCount: 3;
    readonly price: { readonly amount: 49; readonly currency: 'EUR' };
    readonly shipsFrom: 'Germany';
  };
  readonly approvedProductFacts: readonly ApprovedProductFact[];
  readonly approvedSellingPoints: readonly ContentFocus[];
  readonly forbiddenClaims: readonly string[];
  readonly targetCustomer: {
    readonly gender: 'women';
    readonly concerns: readonly AudienceConcern[];
  };
  readonly brand: {
    readonly mission: typeof VOLUVIA_BRAND_MISSION;
    readonly promise: typeof VOLUVIA_BRAND_PROMISE;
    readonly tone: readonly BrandTone[];
    readonly prohibitedTone: readonly ProhibitedTone[];
  };
  readonly contentGoal: ContentGoal;
  readonly targetPlatform: 'TikTok';
  readonly targetLanguage: 'de-DE';
  readonly preferredVideoDurationSeconds: number;
  readonly plannerControls: {
    readonly preferredContentAngle?: ContentAngle;
    readonly preferredContentFocus?: ContentFocus;
    readonly excludedRecentlyUsedAngles: readonly ContentAngle[];
    readonly excludedRecentlyUsedFocuses: readonly ContentFocus[];
    readonly priceMayBeFeatured: boolean;
    readonly shippingMayBeFeatured: boolean;
    readonly realBeforeAfterEvidenceAvailable: boolean;
  };
}

export interface ContentPlanningCandidate {
  readonly audience: {
    readonly gender: 'women';
    readonly primaryConcern: AudienceConcern;
    readonly awarenessLevel: AudienceAwarenessLevel;
  };
  readonly strategy: {
    readonly primaryProblem: AudienceConcern;
    readonly purchaseTrigger: PurchaseTrigger;
    readonly contentFocus: ContentFocus;
    readonly contentAngle: ContentAngle;
    readonly emotionalGoal: EmotionalGoal;
    readonly desiredAction: DesiredAction;
  };
  readonly production: {
    readonly recommendedVideoStyle: VideoStyle;
    readonly recommendedHookStrategy: HookStrategy;
    readonly targetDurationSeconds: number;
    readonly visualProofRequired: boolean;
    readonly suggestedScenes: readonly SuggestedScene[];
  };
}

export interface VoluviaContentPlan extends ContentPlanningCandidate {
  readonly brandSafety: {
    readonly approvedFacts: readonly ApprovedProductFact[];
    readonly forbiddenClaims: readonly string[];
    readonly prohibitedTone: readonly ProhibitedTone[];
    readonly manualReviewRequired: true;
  };
}

export interface VoluviaContentPlanGenerationMetadata {
  readonly provider: string;
  readonly model: string;
  readonly operationId: typeof VOLUVIA_CONTENT_PLAN_OPERATION_ID;
  readonly schemaVersion: typeof VOLUVIA_CONTENT_PLAN_SCHEMA_VERSION;
  readonly promptId: typeof VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptId;
  readonly promptVersion: typeof VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptVersion;
  readonly promptContentHash: string;
  readonly responseId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface VoluviaContentPlanningResult {
  readonly reviewStatus: 'pending_manual_review';
  readonly plan: VoluviaContentPlan;
  readonly generation: VoluviaContentPlanGenerationMetadata;
}
