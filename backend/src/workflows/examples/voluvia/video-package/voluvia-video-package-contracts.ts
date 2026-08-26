import { PromptReference } from '../../../../prompts/prompt-reference';
import {
  ApprovedProductFact,
  ApprovedProductFactId,
  DesiredAction,
  ProhibitedTone,
  SuggestedScene,
  VoluviaContentPlanningResult
} from '../planner/voluvia-content-planner-contracts';

export const VOLUVIA_VIDEO_PACKAGE_OPERATION_ID = 'voluvia.video.package.generate.ai';
export const VOLUVIA_VIDEO_PACKAGE_OPERATION_V2_ID = 'voluvia.video.package.generate.ai.v2';
export const VOLUVIA_VIDEO_PACKAGE_WORKFLOW_ID = 'voluvia.video.packagegeneration.ai.workflow';
export const VOLUVIA_VIDEO_PACKAGE_WORKFLOW_VERSION = 1;
export const VOLUVIA_VIDEO_PACKAGE_WORKFLOW_V2_VERSION = 2;
export const VOLUVIA_VIDEO_PACKAGE_SCHEMA_VERSION = 1;
// The released v4 lineage remains immutable at workflow version 1.
export const VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE: PromptReference = Object.freeze({
  promptId: 'voluvia.video.package-generator.de', promptVersion: 4
});
export const VOLUVIA_VIDEO_PACKAGE_V5_PROMPT_REFERENCE: PromptReference = Object.freeze({
  promptId: 'voluvia.video.package-generator.de', promptVersion: 5
});
export type VideoPackageLineage = 'v4' | 'v5';

export const PLANNER_REVIEW_DECISIONS = ['approved_for_package_generation', 'rejected'] as const;
export type PlannerReviewDecision = typeof PLANNER_REVIEW_DECISIONS[number];
export type PackageReviewStatus = 'pending_manual_review';

export const VOLUVIA_VIDEO_ASSET_IDS = [
  'product-front', 'product-back', 'lace-base-close-up', 'clip-close-up',
  'color-comparison', 'package-front', 'package-and-product', 'mirror-application',
  'finished-natural-look', 'human-hair-styling', 'crown-before-view',
  'crown-after-view', 'parting-before-view', 'parting-after-view',
  'presenter-avatar', 'presenter-voice', 'logo', 'brand-background'
] as const;
export type VoluviaVideoAssetId = typeof VOLUVIA_VIDEO_ASSET_IDS[number];

export const VIDEO_CAMERA_FRAMINGS = ['macro', 'close-up', 'medium', 'mirror', 'overhead', 'product-tabletop'] as const;
export type VideoCameraFraming = typeof VIDEO_CAMERA_FRAMINGS[number];
export const VIDEO_TRANSITION_TYPES = ['cut', 'match-cut', 'fade', 'none'] as const;
export type VideoTransitionType = typeof VIDEO_TRANSITION_TYPES[number];
export const VIDEO_TEXT_STYLE_ROLES = ['hook', 'product-fact', 'educational-label', 'CTA', 'disclaimer'] as const;
export type VideoTextStyleRole = typeof VIDEO_TEXT_STYLE_ROLES[number];
export const VIDEO_VISUAL_PROOF_ROLES = ['none', 'product-detail', 'application-demonstration', 'before-evidence', 'after-evidence'] as const;
export type VideoVisualProofRole = typeof VIDEO_VISUAL_PROOF_ROLES[number];
export type VideoPresenterMode = 'product-only' | 'presenter-plus-product';

export interface VoluviaVideoBrandPolicy {
  readonly tone: readonly ('premium' | 'authentic' | 'elegant' | 'calm' | 'warm' | 'trustworthy')[];
  readonly prohibitedTone: readonly ProhibitedTone[];
  readonly forbiddenClaims: readonly string[];
}

export interface VoluviaVideoControls {
  readonly targetLanguage: 'de-DE';
  readonly platform: 'TikTok';
  readonly targetDurationSeconds: 20 | 30 | 45;
  readonly presenterMode: VideoPresenterMode;
  readonly voiceStyle: 'calm' | 'warm' | 'educational' | 'elegant';
  readonly subtitleMode: 'burn-in-ready';
  readonly priceMayBeFeatured: boolean;
  readonly shippingMayBeFeatured: boolean;
  readonly realBeforeAfterEvidenceAvailable: boolean;
  readonly desiredAction: DesiredAction;
}

export interface VoluviaVideoPackageGenerationInput {
  readonly reviewedPlannerResult: {
    readonly workflowId: 'voluvia.tiktok.contentplanning.ai.workflow';
    readonly workflowVersion: 1;
    readonly operationId: 'voluvia.content.plan.ai';
    readonly plannerPrompt: { readonly promptId: 'voluvia.tiktok.content-planner.de'; readonly promptVersion: 2; readonly promptContentHash: string };
    readonly plannerReviewDecision: PlannerReviewDecision;
    readonly result: VoluviaContentPlanningResult;
  };
  readonly approvedProductFacts: readonly ApprovedProductFact[];
  readonly brandPolicy: VoluviaVideoBrandPolicy;
  readonly videoControls: VoluviaVideoControls;
  readonly availableAssetIds: readonly VoluviaVideoAssetId[];
}

export interface VideoPackageProviderInput {
  readonly audience: VoluviaContentPlanningResult['plan']['audience'];
  readonly strategy: VoluviaContentPlanningResult['plan']['strategy'];
  readonly production: VoluviaContentPlanningResult['plan']['production'];
  readonly approvedProductFacts: readonly ApprovedProductFact[];
  readonly brandPolicy: VoluviaVideoBrandPolicy;
  readonly videoControls: VoluviaVideoControls;
  readonly availableAssetIds: readonly VoluviaVideoAssetId[];
  readonly prompt: PromptReference;
}

export interface VideoPackageCandidate {
  readonly hook: { readonly spokenHook: string; readonly onScreenHook: string; readonly visualHookInstruction?: string };
  readonly voiceover: { readonly segments: readonly { readonly sourceScene: SuggestedScene; readonly spokenText: string; readonly proposedFactIds: readonly ApprovedProductFactId[] }[] };
  readonly scenes: readonly { readonly sourceSuggestedScene: SuggestedScene; readonly durationSeconds: number; readonly cameraFraming: VideoCameraFraming; readonly visualAction: string; readonly requiredAssetIds: readonly VoluviaVideoAssetId[]; readonly onScreenTextKeys: readonly string[]; readonly productionNotes: string; readonly visualProofRole: VideoVisualProofRole; readonly transitionType: VideoTransitionType }[];
  readonly onScreenText: readonly { readonly key: string; readonly sourceScene: SuggestedScene; readonly text: string; readonly startOffsetSecond: number; readonly endOffsetSecond: number; readonly proposedFactIds: readonly ApprovedProductFactId[]; readonly styleRole: VideoTextStyleRole }[];
  readonly cover: { readonly coverTitle: string; readonly coverSubtitle?: string; readonly selectedCoverScene: SuggestedScene; readonly requiredAssetIds: readonly VoluviaVideoAssetId[] };
  readonly caption: { readonly text: string; readonly callToAction: string; readonly proposedFactIds: readonly ApprovedProductFactId[]; readonly disclosureText?: string };
  readonly hashtags: readonly string[];
  readonly assetUsageProposal: readonly { readonly assetId: VoluviaVideoAssetId; readonly sourceScenes: readonly SuggestedScene[]; readonly productionInstruction: string }[];
  readonly backgroundAssetId?: VoluviaVideoAssetId;
}

export type VideoPackageProviderDiagnosticCategory = 'configuration' | 'authentication' | 'permission_denied' | 'rate_limit' | 'invalid_request' | 'model_unavailable' | 'timeout' | 'network' | 'provider_server' | 'response_incomplete' | 'response_refused' | 'response_invalid' | 'unknown';
export const VIDEO_PACKAGE_UNSUPPORTED_CLAIM_REASONS = [
  'fact_attribution_missing', 'fact_attribution_mismatch', 'unapproved_fact',
  'prohibited_medical_claim', 'prohibited_therapeutic_claim', 'prohibited_clinical_claim',
  'prohibited_certification_claim', 'prohibited_permanent_outcome', 'prohibited_guarantee',
  'prohibited_natural_appearance_guarantee', 'prohibited_confidence_or_social_guarantee',
  'prohibited_urgency', 'prohibited_scarcity', 'prohibited_discount_claim',
  'prohibited_value_or_investment_claim', 'prohibited_invented_demographic',
  'prohibited_shame', 'prohibited_fear', 'prohibited_pity', 'prohibited_beauty_anxiety',
  'full_wig_degradation', 'universal_need_claim', 'delivery_claim',
  'prohibited_hashtag',
  'other_unsupported_claim'
] as const;
export type VideoPackageUnsupportedClaimReason = typeof VIDEO_PACKAGE_UNSUPPORTED_CLAIM_REASONS[number];
export const VIDEO_PACKAGE_TEXT_LOCATIONS = [
  'spoken_hook', 'on_screen_hook', 'visual_hook_instruction', 'voiceover_segment',
  'scene_visual_action', 'scene_production_notes', 'on_screen_text', 'cover_title',
  'cover_subtitle', 'caption', 'cta', 'disclosure', 'hashtag',
  'asset_production_instruction'
] as const;
export type VideoPackageTextLocation = typeof VIDEO_PACKAGE_TEXT_LOCATIONS[number];
export const VIDEO_PACKAGE_DURATION_INVALID_REASONS = [
  'invalid_scene_count', 'scene_duration_not_integer', 'scene_duration_below_minimum',
  'scene_duration_above_maximum', 'scene_duration_sum_mismatch',
  'segment_count_mismatch', 'segment_scene_mismatch', 'segment_duration_exceeds_scene',
  'narration_below_occupancy', 'narration_above_occupancy',
  'subtitle_line_too_long', 'subtitle_zero_duration', 'subtitle_outside_scene',
  'onscreen_text_timing_invalid', 'onscreen_text_duration_invalid',
  'other_duration_invalid'
] as const;
export type VideoPackageDurationInvalidReason = typeof VIDEO_PACKAGE_DURATION_INVALID_REASONS[number];
export interface VideoPackageDurationDiagnosticContext {
  readonly targetDurationSeconds?: number;
  readonly estimatedSpokenSeconds?: number;
  readonly minimumAllowedSeconds?: number;
  readonly maximumAllowedSeconds?: number;
  readonly sceneCount?: number;
}
export interface VideoPackageGenerationDiagnostics { readonly provider: string; readonly model: string; readonly requestAttempted: boolean; readonly responseId?: string; readonly usage?: { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number }; readonly startedAt?: string; readonly completedAt?: string; readonly category?: VideoPackageProviderDiagnosticCategory }
export type VideoPackageFailureDiagnostic =
  | { readonly diagnosticCategory: 'configuration' | 'provider'; readonly providerDiagnosticCategory: VideoPackageProviderDiagnosticCategory; readonly requestAttempted: boolean }
  | { readonly diagnosticCategory: 'local_validation'; readonly localValidationCode: VideoPackageLocalValidationCode; readonly requestAttempted: boolean; readonly unsupportedClaimReason?: VideoPackageUnsupportedClaimReason; readonly textLocation?: VideoPackageTextLocation; readonly durationInvalidReason?: VideoPackageDurationInvalidReason; readonly targetDurationSeconds?: number; readonly estimatedSpokenSeconds?: number; readonly minimumAllowedSeconds?: number; readonly maximumAllowedSeconds?: number; readonly sceneCount?: number };
export type VideoPackageOperationDiagnostic = VideoPackageGenerationDiagnostics | VideoPackageFailureDiagnostic;
export interface VideoPackageClientResult { readonly candidate: VideoPackageCandidate; readonly provenance: { readonly provider: string; readonly model: string; readonly promptId: string; readonly promptVersion: number; readonly promptContentHash: string }; readonly diagnostics?: VideoPackageGenerationDiagnostics }

export interface CanonicalVoiceoverSegment { readonly segmentId: string; readonly sceneId: string; readonly sourceScene: SuggestedScene; readonly spokenText: string; readonly estimatedSeconds: number; readonly claimsUsed: readonly ApprovedProductFactId[] }
export interface VideoPackageScene { readonly sceneId: string; readonly sourceSuggestedScene: SuggestedScene; readonly sequence: number; readonly startSecond: number; readonly durationSeconds: number; readonly cameraFraming: VideoCameraFraming; readonly visualAction: string; readonly requiredAssetIds: readonly VoluviaVideoAssetId[]; readonly voiceoverSegmentId: string; readonly onScreenTextIds: readonly string[]; readonly productionNotes: string; readonly visualProofRole: VideoVisualProofRole; readonly transitionType: VideoTransitionType }
export interface VideoOnScreenText { readonly textId: string; readonly sceneId: string; readonly text: string; readonly startSecond: number; readonly endSecond: number; readonly semanticFactIds: readonly ApprovedProductFactId[]; readonly styleRole: VideoTextStyleRole }
export interface SubtitleCue { readonly cueId: string; readonly sceneId: string; readonly lines: readonly string[]; readonly startSecond: number; readonly endSecond: number }
export interface VideoAssetChecklistItem { readonly assetId: VoluviaVideoAssetId; readonly required: boolean; readonly usedBySceneIds: readonly string[]; readonly productionInstruction: string; readonly missingAssetBehavior: 'reject-package' | 'manual-substitution-required' }

export interface VoluviaVideoPackage {
  readonly packageId: string; readonly operationId: typeof VOLUVIA_VIDEO_PACKAGE_OPERATION_ID | typeof VOLUVIA_VIDEO_PACKAGE_OPERATION_V2_ID; readonly schemaVersion: 1;
  readonly sourcePlan: { readonly workflowId: 'voluvia.tiktok.contentplanning.ai.workflow'; readonly workflowVersion: 1; readonly operationId: 'voluvia.content.plan.ai'; readonly sourcePlanHash: string };
  readonly provenance: { readonly provider: string; readonly model: string; readonly promptId: typeof VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE.promptId; readonly promptVersion: 4 | 5; readonly promptContentHash: string; readonly generatedAt: string };
  readonly summary: { readonly audience: VoluviaContentPlanningResult['plan']['audience']; readonly strategy: VoluviaContentPlanningResult['plan']['strategy']; readonly language: 'de-DE'; readonly platform: 'TikTok'; readonly targetDurationSeconds: 20 | 30 | 45; readonly estimatedDurationSeconds: 20 | 30 | 45; readonly videoStyle: VoluviaContentPlanningResult['plan']['production']['recommendedVideoStyle']; readonly hookStrategy: VoluviaContentPlanningResult['plan']['production']['recommendedHookStrategy']; readonly visualProofRequired: boolean; readonly presenterMode: VideoPresenterMode };
  readonly hook: VideoPackageCandidate['hook'];
  readonly voiceover: { readonly segments: readonly CanonicalVoiceoverSegment[]; readonly fullScript: string; readonly estimatedSpokenSeconds: number };
  readonly scenes: readonly VideoPackageScene[]; readonly onScreenText: readonly VideoOnScreenText[];
  readonly cover: { readonly coverTitle: string; readonly coverSubtitle?: string; readonly selectedCoverSceneId: string; readonly requiredAssetIds: readonly VoluviaVideoAssetId[] };
  readonly caption: { readonly text: string; readonly callToAction: string; readonly semanticFactIds: readonly ApprovedProductFactId[]; readonly disclosureText?: string };
  readonly hashtags: readonly string[]; readonly assetChecklist: readonly VideoAssetChecklistItem[];
  readonly narrationPackage: { readonly presenterMode: VideoPresenterMode; readonly narrationText: string; readonly sceneNarrationSegments: readonly CanonicalVoiceoverSegment[]; readonly subtitleLines: readonly SubtitleCue[]; readonly avatarRequired: boolean; readonly voiceRequired: boolean; readonly backgroundAssetId?: VoluviaVideoAssetId; readonly aspectRatio: '9:16'; readonly resolutionClass: 'vertical-hd' };
  readonly safety: { readonly approvedFacts: readonly ApprovedProductFact[]; readonly claimsUsed: readonly ApprovedProductFactId[]; readonly forbiddenClaims: readonly string[]; readonly prohibitedTone: readonly ProhibitedTone[]; readonly manualReviewRequired: true; readonly commerceControlsApplied: { readonly priceEnabled: boolean; readonly shippingEnabled: boolean; readonly deliveryClaimsEnabled: false }; readonly unsupportedClaimScanPassed: true; readonly sceneCompatibilityPassed: true; readonly assetCompatibilityPassed: true };
  readonly packageReviewStatus: PackageReviewStatus;
}

export type VideoPackageLocalValidationCode = 'invalid_input' | 'invalid_review_state' | 'source_plan_mismatch' | 'prompt_identity_mismatch' | 'prompt_hash_mismatch' | 'strategy_mismatch' | 'scene_mismatch' | 'asset_mismatch' | 'duration_invalid' | 'unsupported_claim' | 'commerce_control_violation' | 'unsafe_json' | 'unknown_field' | 'local_validation';
