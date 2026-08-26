import { VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256 } from '../../prompts/voluvia/de/video-package-generator-v4.prompt';
import { VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_SHA256 } from '../../prompts/voluvia/de/video-package-generator-v5.prompt';
import { z } from 'zod';
import {
  APPROVED_PRODUCT_FACT_IDS, AUDIENCE_AWARENESS_LEVELS, AUDIENCE_CONCERNS,
  CONTENT_ANGLES, CONTENT_FOCUSES, DESIRED_ACTIONS, EMOTIONAL_GOALS, HOOK_STRATEGIES,
  PROHIBITED_TONES, PURCHASE_TRIGGERS, SUGGESTED_SCENES, VIDEO_STYLES
} from '../../workflows/examples/voluvia/planner/voluvia-content-planner-contracts';
import {
  VIDEO_CAMERA_FRAMINGS, VIDEO_TEXT_STYLE_ROLES, VIDEO_TRANSITION_TYPES,
  VIDEO_VISUAL_PROOF_ROLES, VOLUVIA_VIDEO_ASSET_IDS, VOLUVIA_VIDEO_PACKAGE_OPERATION_ID,
  VOLUVIA_VIDEO_PACKAGE_OPERATION_V2_ID, VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE,
  VoluviaVideoPackage
} from '../../workflows/examples/voluvia/video-package/voluvia-video-package-contracts';
import {
  canonicalizeVideoPackageValue, hashVideoPackageValue
} from '../../workflows/examples/voluvia/video-package/voluvia-video-package-validator';
import { RenderingPhaseOneFailure } from '../failures/rendering-phase-one-failure';

export interface ValidatedM3Package {
  readonly package: VoluviaVideoPackage;
  readonly packageId: string;
  readonly packageRevisionHash: string;
}
export interface M3PackageIntegrityOptions { readonly expectedPackageRevisionHash?: string }

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const fact = z.object({ factId: z.enum(APPROVED_PRODUCT_FACT_IDS), displayValue: z.string().min(1) }).strict();
const strategy = z.object({ primaryProblem: z.enum(AUDIENCE_CONCERNS), purchaseTrigger: z.enum(PURCHASE_TRIGGERS),
  contentFocus: z.enum(CONTENT_FOCUSES), contentAngle: z.enum(CONTENT_ANGLES),
  emotionalGoal: z.enum(EMOTIONAL_GOALS), desiredAction: z.enum(DESIRED_ACTIONS) }).strict();
const segment = z.object({ segmentId: z.string().regex(/^segment-[0-9]{2}$/u),
  sceneId: z.string().regex(/^scene-[0-9]{2}$/u), sourceScene: z.enum(SUGGESTED_SCENES),
  spokenText: z.string().min(1), estimatedSeconds: z.number().int().positive().safe(),
  claimsUsed: z.array(z.enum(APPROVED_PRODUCT_FACT_IDS)) }).strict();
const finalPackageShape = {
  packageId: sha,
  sourcePlan: z.object({ workflowId: z.literal('voluvia.tiktok.contentplanning.ai.workflow'),
    workflowVersion: z.literal(1), operationId: z.literal('voluvia.content.plan.ai'), sourcePlanHash: sha }).strict(),
  summary: z.object({ audience: z.object({ gender: z.literal('women'), primaryConcern: z.enum(AUDIENCE_CONCERNS),
    awarenessLevel: z.enum(AUDIENCE_AWARENESS_LEVELS) }).strict(), strategy,
    language: z.literal('de-DE'), platform: z.literal('TikTok'),
    targetDurationSeconds: z.union([z.literal(20), z.literal(30), z.literal(45)]),
    estimatedDurationSeconds: z.union([z.literal(20), z.literal(30), z.literal(45)]),
    videoStyle: z.enum(VIDEO_STYLES), hookStrategy: z.enum(HOOK_STRATEGIES), visualProofRequired: z.boolean(),
    presenterMode: z.enum(['product-only', 'presenter-plus-product']) }).strict(),
  hook: z.object({ spokenHook: z.string().min(1), onScreenHook: z.string().min(1),
    visualHookInstruction: z.string().min(1).optional() }).strict(),
  voiceover: z.object({ segments: z.array(segment).min(2).max(5), fullScript: z.string().min(1),
    estimatedSpokenSeconds: z.number().int().positive().safe() }).strict(),
  scenes: z.array(z.object({ sceneId: z.string().regex(/^scene-[0-9]{2}$/u), sourceSuggestedScene: z.enum(SUGGESTED_SCENES),
    sequence: z.number().int().positive().safe(), startSecond: z.number().int().nonnegative().safe(),
    durationSeconds: z.number().int().min(3).max(25).safe(), cameraFraming: z.enum(VIDEO_CAMERA_FRAMINGS),
    visualAction: z.string().min(1), requiredAssetIds: z.array(z.enum(VOLUVIA_VIDEO_ASSET_IDS)).min(1),
    voiceoverSegmentId: z.string().regex(/^segment-[0-9]{2}$/u),
    onScreenTextIds: z.array(z.string().regex(/^text-[a-z][a-z0-9-]{0,49}$/u)),
    productionNotes: z.string().min(1), visualProofRole: z.enum(VIDEO_VISUAL_PROOF_ROLES),
    transitionType: z.enum(VIDEO_TRANSITION_TYPES) }).strict()).min(2).max(5),
  onScreenText: z.array(z.object({ textId: z.string().regex(/^text-[a-z][a-z0-9-]{0,49}$/u),
    sceneId: z.string().regex(/^scene-[0-9]{2}$/u), text: z.string().min(1),
    startSecond: z.number().nonnegative().finite().safe(), endSecond: z.number().positive().finite().safe(),
    semanticFactIds: z.array(z.enum(APPROVED_PRODUCT_FACT_IDS)), styleRole: z.enum(VIDEO_TEXT_STYLE_ROLES) }).strict()),
  cover: z.object({ coverTitle: z.string().min(1), coverSubtitle: z.string().min(1).optional(),
    selectedCoverSceneId: z.string().regex(/^scene-[0-9]{2}$/u), requiredAssetIds: z.array(z.enum(VOLUVIA_VIDEO_ASSET_IDS)).min(1) }).strict(),
  caption: z.object({ text: z.string().min(1), callToAction: z.string().min(1),
    semanticFactIds: z.array(z.enum(APPROVED_PRODUCT_FACT_IDS)), disclosureText: z.string().min(1).optional() }).strict(),
  hashtags: z.array(z.string().min(1)).min(3).max(5),
  assetChecklist: z.array(z.object({ assetId: z.enum(VOLUVIA_VIDEO_ASSET_IDS), required: z.boolean(),
    usedBySceneIds: z.array(z.string().regex(/^scene-[0-9]{2}$/u)), productionInstruction: z.string().min(1),
    missingAssetBehavior: z.enum(['reject-package', 'manual-substitution-required']) }).strict()),
  narrationPackage: z.object({ presenterMode: z.enum(['product-only', 'presenter-plus-product']), narrationText: z.string().min(1),
    sceneNarrationSegments: z.array(segment), subtitleLines: z.array(z.object({ cueId: z.string().regex(/^cue-[0-9]{2}$/u),
      sceneId: z.string().regex(/^scene-[0-9]{2}$/u), lines: z.array(z.string().min(1)).min(1).max(2),
      startSecond: z.number().nonnegative().finite().safe(), endSecond: z.number().positive().finite().safe() }).strict()),
    avatarRequired: z.boolean(), voiceRequired: z.boolean(), backgroundAssetId: z.enum(VOLUVIA_VIDEO_ASSET_IDS).optional(),
    aspectRatio: z.literal('9:16'), resolutionClass: z.literal('vertical-hd') }).strict(),
  safety: z.object({ approvedFacts: z.array(fact), claimsUsed: z.array(z.enum(APPROVED_PRODUCT_FACT_IDS)),
    forbiddenClaims: z.array(z.string()), prohibitedTone: z.array(z.enum(PROHIBITED_TONES)), manualReviewRequired: z.literal(true),
    commerceControlsApplied: z.object({ priceEnabled: z.boolean(), shippingEnabled: z.boolean(),
      deliveryClaimsEnabled: z.literal(false) }).strict(), unsupportedClaimScanPassed: z.literal(true),
    sceneCompatibilityPassed: z.literal(true), assetCompatibilityPassed: z.literal(true) }).strict(),
  packageReviewStatus: z.literal('pending_manual_review')
} as const;
const provenanceShape = { provider: z.string().min(1).max(100), model: z.string().min(1).max(200),
  promptId: z.literal(VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE.promptId),
  generatedAt: z.string().datetime({ offset: true }) } as const;
const finalPackageSchema = z.discriminatedUnion('operationId', [
  z.object({ ...finalPackageShape, operationId: z.literal(VOLUVIA_VIDEO_PACKAGE_OPERATION_ID),
    schemaVersion: z.literal(1), provenance: z.object({ ...provenanceShape, promptVersion: z.literal(4),
      promptContentHash: z.literal(VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256) }).strict() }).strict(),
  z.object({ ...finalPackageShape, operationId: z.literal(VOLUVIA_VIDEO_PACKAGE_OPERATION_V2_ID),
    schemaVersion: z.literal(1), provenance: z.object({ ...provenanceShape, promptVersion: z.literal(5),
      promptContentHash: z.literal(VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_SHA256) }).strict() }).strict()
]);

const ROOT_KEYS = ['assetChecklist', 'caption', 'cover', 'hashtags', 'hook', 'narrationPackage',
  'onScreenText', 'operationId', 'packageId', 'packageReviewStatus', 'provenance', 'safety',
  'scenes', 'schemaVersion', 'sourcePlan', 'summary', 'voiceover'] as const;
const KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  sourcePlan: ['operationId', 'sourcePlanHash', 'workflowId', 'workflowVersion'],
  provenance: ['generatedAt', 'model', 'promptContentHash', 'promptId', 'promptVersion', 'provider'],
  summary: ['audience', 'estimatedDurationSeconds', 'hookStrategy', 'language', 'platform',
    'presenterMode', 'strategy', 'targetDurationSeconds', 'videoStyle', 'visualProofRequired'],
  audience: ['awarenessLevel', 'gender', 'primaryConcern'],
  strategy: ['contentAngle', 'contentFocus', 'desiredAction', 'emotionalGoal', 'primaryProblem', 'purchaseTrigger'],
  hook: ['onScreenHook', 'spokenHook', 'visualHookInstruction'],
  voiceover: ['estimatedSpokenSeconds', 'fullScript', 'segments'],
  segment: ['claimsUsed', 'estimatedSeconds', 'sceneId', 'segmentId', 'sourceScene', 'spokenText'],
  scene: ['cameraFraming', 'durationSeconds', 'onScreenTextIds', 'productionNotes', 'requiredAssetIds',
    'sceneId', 'sequence', 'sourceSuggestedScene', 'startSecond', 'transitionType', 'visualAction',
    'visualProofRole', 'voiceoverSegmentId'],
  subtitle: ['cueId', 'endSecond', 'lines', 'sceneId', 'startSecond'],
  narrationPackage: ['aspectRatio', 'avatarRequired', 'backgroundAssetId', 'narrationText',
    'presenterMode', 'resolutionClass', 'sceneNarrationSegments', 'subtitleLines', 'voiceRequired'],
  asset: ['assetId', 'missingAssetBehavior', 'productionInstruction', 'required', 'usedBySceneIds'],
  text: ['endSecond', 'sceneId', 'semanticFactIds', 'startSecond', 'styleRole', 'text', 'textId'],
  cover: ['coverSubtitle', 'coverTitle', 'requiredAssetIds', 'selectedCoverSceneId'],
  caption: ['callToAction', 'disclosureText', 'semanticFactIds', 'text'],
  safety: ['approvedFacts', 'assetCompatibilityPassed', 'claimsUsed', 'commerceControlsApplied',
    'forbiddenClaims', 'manualReviewRequired', 'prohibitedTone', 'sceneCompatibilityPassed',
    'unsupportedClaimScanPassed'],
  commerce: ['deliveryClaimsEnabled', 'priceEnabled', 'shippingEnabled'],
  fact: ['displayValue', 'factId']
});

function fail(code: ConstructorParameters<typeof RenderingPhaseOneFailure>[0]): never {
  throw new RenderingPhaseOneFailure(code);
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('package_validation_failed');
  return value as Record<string, unknown>;
}
function exact(value: unknown, allowed: readonly string[]): void {
  const keys = Object.keys(object(value)).sort();
  if (keys.length !== allowed.length || keys.some((key, index) => key !== [...allowed].sort()[index])) fail('unknown_field');
}
function exactOptional(value: unknown, allowed: readonly string[], optional: readonly string[]): void {
  const keys = Object.keys(object(value));
  if (keys.some((key) => !allowed.includes(key)) || allowed.some((key) => !optional.includes(key) && !keys.includes(key))) fail('unknown_field');
}
function equal(left: unknown, right: unknown): boolean {
  try { return canonicalizeVideoPackageValue(left) === canonicalizeVideoPackageValue(right); }
  catch { fail('unsafe_json'); }
}
function detachFreeze<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (typeof item === 'object' && item !== null && !Object.isFrozen(item)) {
      Object.freeze(item); Object.values(item).forEach(freeze);
    }
  };
  freeze(copy); return copy;
}

export function validateStandaloneM3Package(value: unknown, options: M3PackageIntegrityOptions = {}): ValidatedM3Package {
  try { canonicalizeVideoPackageValue(value); } catch { fail('unsafe_json'); }
  if (typeof value === 'object' && value !== null && !Array.isArray(value) &&
      Object.keys(value).some((key) => !ROOT_KEYS.includes(key as typeof ROOT_KEYS[number]))) fail('unknown_field');
  const parsed = finalPackageSchema.safeParse(value);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys')) fail('unknown_field');
    if (parsed.error.issues.some((issue) => ['packageId', 'operationId', 'schemaVersion', 'sourcePlan.workflowId',
      'sourcePlan.workflowVersion', 'sourcePlan.operationId', 'sourcePlan.sourcePlanHash', 'provenance.promptId', 'provenance.promptVersion',
      'provenance.promptContentHash'].some((path) => issue.path.join('.') === path))) fail('invalid_source_identity');
    fail('package_validation_failed');
  }
  const candidate = parsed.data as VoluviaVideoPackage;
  if (!/^[a-f0-9]{64}$/u.test(candidate.packageId) || candidate.schemaVersion !== 1 ||
      candidate.packageReviewStatus !== 'pending_manual_review') fail('invalid_source_identity');
  exact(candidate.sourcePlan, KEYS.sourcePlan!);
  if (candidate.sourcePlan.workflowId !== 'voluvia.tiktok.contentplanning.ai.workflow' ||
      candidate.sourcePlan.workflowVersion !== 1 || candidate.sourcePlan.operationId !== 'voluvia.content.plan.ai' ||
      !/^[a-f0-9]{64}$/u.test(candidate.sourcePlan.sourcePlanHash)) fail('invalid_source_identity');
  exact(candidate.provenance, KEYS.provenance!);
  if (!Number.isFinite(Date.parse(candidate.provenance.generatedAt))) fail('invalid_source_identity');
  exact(candidate.summary, KEYS.summary!); exact(candidate.summary.audience, KEYS.audience!);
  exact(candidate.summary.strategy, KEYS.strategy!); exactOptional(candidate.hook, KEYS.hook!, ['visualHookInstruction']);
  exact(candidate.voiceover, KEYS.voiceover!); exactOptional(candidate.narrationPackage, KEYS.narrationPackage!, ['backgroundAssetId']);
  if (candidate.summary.targetDurationSeconds !== candidate.summary.estimatedDurationSeconds ||
      candidate.narrationPackage.narrationText !== candidate.voiceover.fullScript ||
      !equal(candidate.narrationPackage.sceneNarrationSegments, candidate.voiceover.segments) ||
      candidate.voiceover.fullScript !== candidate.voiceover.segments.map((segment) => segment.spokenText).join('\n')) fail('package_validation_failed');
  if (candidate.scenes.length < 2 || candidate.scenes.length > 5 || candidate.voiceover.segments.length !== candidate.scenes.length) fail('package_validation_failed');
  const sourceScenes = new Set(candidate.scenes.map((scene) => scene.sourceSuggestedScene));
  for (const [before, after] of [
    ['parting-before-view', 'parting-after-view'],
    ['crown-before-view', 'crown-after-view']
  ] as const) {
    if (sourceScenes.has(before) !== sourceScenes.has(after)) fail('package_validation_failed');
  }
  let cursor = 0;
  candidate.scenes.forEach((scene, index) => {
    exact(scene, KEYS.scene!); const segment = candidate.voiceover.segments[index];
    if (scene.sequence !== index + 1 || scene.sceneId !== `scene-${String(index + 1).padStart(2, '0')}` ||
        scene.startSecond !== cursor || !Number.isSafeInteger(scene.durationSeconds) || scene.durationSeconds <= 0 ||
        !segment || segment.sceneId !== scene.sceneId ||
        segment.segmentId !== scene.voiceoverSegmentId || segment.sourceScene !== scene.sourceSuggestedScene) fail('package_validation_failed');
    exact(segment, KEYS.segment!); cursor += scene.durationSeconds;
  });
  if (cursor !== candidate.summary.targetDurationSeconds) fail('package_validation_failed');
  const sceneById = new Map(candidate.scenes.map((scene) => [scene.sceneId, scene]));
  let cueEnd = 0;
  candidate.narrationPackage.subtitleLines.forEach((cue, index) => {
    exact(cue, KEYS.subtitle!); const scene = sceneById.get(cue.sceneId);
    if (cue.cueId !== `cue-${String(index + 1).padStart(2, '0')}` || !scene || cue.startSecond < cueEnd ||
        cue.endSecond <= cue.startSecond || cue.startSecond < scene.startSecond ||
        cue.endSecond > scene.startSecond + scene.durationSeconds || cue.lines.some((line) => !line)) fail('package_validation_failed');
    cueEnd = cue.endSecond;
  });
  const cueText = candidate.narrationPackage.subtitleLines.flatMap((cue) => cue.lines).join(' ');
  const narrationWords = candidate.voiceover.fullScript.replace(/\s+/gu, ' ').trim();
  if (cueText.replace(/\s+/gu, ' ').trim() !== narrationWords) fail('package_validation_failed');
  const checklist = new Map(candidate.assetChecklist.map((item) => [item.assetId, item]));
  const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
  if (!unique(candidate.scenes.map((scene) => scene.sceneId)) ||
      !unique(candidate.voiceover.segments.map((item) => item.segmentId)) ||
      !unique(candidate.narrationPackage.subtitleLines.map((cue) => cue.cueId)) ||
      !unique(candidate.onScreenText.map((item) => item.textId)) ||
      !unique(candidate.assetChecklist.map((item) => item.assetId)) ||
      !unique(candidate.safety.approvedFacts.map((item) => item.factId)) ||
      !unique(candidate.safety.claimsUsed) || !unique(candidate.hashtags) ||
      candidate.scenes.some((scene) => !unique(scene.requiredAssetIds) || !unique(scene.onScreenTextIds)) ||
      candidate.voiceover.segments.some((item) => !unique(item.claimsUsed)) ||
      candidate.onScreenText.some((item) => !unique(item.semanticFactIds))) fail('package_validation_failed');
  candidate.assetChecklist.forEach((item) => exact(item, KEYS.asset!));
  candidate.onScreenText.forEach((item) => exact(item, KEYS.text!));
  exactOptional(candidate.cover, KEYS.cover!, ['coverSubtitle']);
  exactOptional(candidate.caption, KEYS.caption!, ['disclosureText']);
  exact(candidate.safety, KEYS.safety!); exact(candidate.safety.commerceControlsApplied, KEYS.commerce!);
  candidate.safety.approvedFacts.forEach((fact) => exact(fact, KEYS.fact!));
  for (const scene of candidate.scenes) for (const assetId of scene.requiredAssetIds) {
    const item = checklist.get(assetId);
    if (!item || !item.required || item.missingAssetBehavior !== 'reject-package' || !item.usedBySceneIds.includes(scene.sceneId)) fail('package_validation_failed');
  }
  if (!candidate.safety.manualReviewRequired || !candidate.safety.unsupportedClaimScanPassed ||
      !candidate.safety.sceneCompatibilityPassed || !candidate.safety.assetCompatibilityPassed ||
      candidate.safety.commerceControlsApplied.deliveryClaimsEnabled !== false) fail('package_validation_failed');
  const validated = detachFreeze(candidate); const packageRevisionHash = hashVideoPackageValue(validated);
  if (options.expectedPackageRevisionHash !== undefined) {
    if (!/^[a-f0-9]{64}$/u.test(options.expectedPackageRevisionHash)) fail('package_validation_failed');
    if (options.expectedPackageRevisionHash !== packageRevisionHash) fail('package_revision_mismatch');
  }
  return Object.freeze({ package: validated, packageId: validated.packageId, packageRevisionHash });
}
