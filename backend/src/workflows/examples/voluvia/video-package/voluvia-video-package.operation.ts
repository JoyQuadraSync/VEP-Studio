import { VideoPackageGenerationClient } from '../../../../integrations/ai/video-package-generation-client';
import { VideoPackageProviderFailure } from '../../../../integrations/ai/video-package-generation-client';
import { Clock } from '../../../../runtime/services/clock';
import { OperationHandler } from '../../../runtime/operation-handler';
import { PROHIBITED_TONES } from '../planner/voluvia-content-planner-contracts';
import {
  VOLUVIA_VIDEO_PACKAGE_OPERATION_ID, VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE,
  VOLUVIA_VIDEO_PACKAGE_SCHEMA_VERSION, VoluviaVideoPackage,
  VideoPackageOperationDiagnostic, VideoPackageScene, VideoOnScreenText,
  VIDEO_PACKAGE_TEXT_LOCATIONS, VIDEO_PACKAGE_UNSUPPORTED_CLAIM_REASONS,
  VIDEO_PACKAGE_DURATION_INVALID_REASONS,
  VideoAssetChecklistItem
} from './voluvia-video-package-contracts';
import {
  canonicalizeVideoPackageValue, deriveEffectiveVideoFacts, hashVideoPackageValue,
  validateAndDeriveCandidate, validateFinalVideoPackage, validateVideoPackageClientResult,
  validateVideoPackageInput, VideoPackageLocalValidationFailure
} from './voluvia-video-package-validator';

export function createVoluviaVideoPackageOperation(
  client: VideoPackageGenerationClient,
  clock: Clock,
  onDiagnostics?: (diagnostics: VideoPackageOperationDiagnostic) => void
): OperationHandler {
  const report = (diagnostic: VideoPackageOperationDiagnostic): void => {
    try { onDiagnostics?.(diagnostic); } catch { /* Observers cannot alter workflow semantics. */ }
  };
  return async ({ stepInput }) => {
    let providerRequestAttempted = false;
    try {
      const input = validateVideoPackageInput(stepInput);
      const effectiveFacts = deriveEffectiveVideoFacts(input);
      const planner = input.reviewedPlannerResult.result.plan;
      providerRequestAttempted = true;
      const clientResult = validateVideoPackageClientResult(await client.generatePackageCandidate({
        audience: { ...planner.audience },
        strategy: { ...planner.strategy },
        production: { ...planner.production, suggestedScenes: [...planner.production.suggestedScenes] },
        approvedProductFacts: effectiveFacts.map((fact) => ({ ...fact })),
        brandPolicy: { tone: [...input.brandPolicy.tone], prohibitedTone: [...input.brandPolicy.prohibitedTone], forbiddenClaims: [...input.brandPolicy.forbiddenClaims] },
        videoControls: { ...input.videoControls },
        availableAssetIds: [...input.availableAssetIds],
        prompt: { ...VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE }
      }));
      if (clientResult.diagnostics) {
        report(clientResult.diagnostics);
      }
      const derived = validateAndDeriveCandidate(clientResult, input, effectiveFacts);
      const sourcePlanHash = hashVideoPackageValue(input.reviewedPlannerResult.result);
      const generatedAt = clock.now().toISOString();
      const packageId = hashVideoPackageValue({
        operationId: VOLUVIA_VIDEO_PACKAGE_OPERATION_ID,
        schemaVersion: VOLUVIA_VIDEO_PACKAGE_SCHEMA_VERSION,
        sourcePlanHash,
        prompt: { ...VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE, promptContentHash: clientResult.provenance.promptContentHash },
        controls: input.videoControls,
        candidate: derived.candidate
      });
      const scenes: VideoPackageScene[] = []; let sceneStart = 0;
      derived.candidate.scenes.forEach((scene, index) => {
        const sceneId = `scene-${String(index + 1).padStart(2, '0')}`;
        scenes.push({
          sceneId, sourceSuggestedScene: scene.sourceSuggestedScene, sequence: index + 1,
          startSecond: sceneStart, durationSeconds: scene.durationSeconds,
          cameraFraming: scene.cameraFraming, visualAction: scene.visualAction,
          requiredAssetIds: [...scene.requiredAssetIds], voiceoverSegmentId: derived.segments[index]!.segmentId,
          onScreenTextIds: scene.onScreenTextKeys.map((key) => `text-${key}`),
          productionNotes: scene.productionNotes, visualProofRole: scene.visualProofRole,
          transitionType: scene.transitionType
        });
        sceneStart += scene.durationSeconds;
      });
      const onScreenText: VideoOnScreenText[] = derived.candidate.onScreenText.map((item) => {
        const sceneIndex = planner.production.suggestedScenes.indexOf(item.sourceScene);
        const scene = scenes[sceneIndex]!;
        return { textId: `text-${item.key}`, sceneId: scene.sceneId, text: item.text,
          startSecond: scene.startSecond + item.startOffsetSecond,
          endSecond: scene.startSecond + item.endOffsetSecond,
          semanticFactIds: [...item.proposedFactIds], styleRole: item.styleRole };
      });
      const checklist: VideoAssetChecklistItem[] = derived.candidate.assetUsageProposal.map((item) => ({
        assetId: item.assetId, required: true,
        usedBySceneIds: item.sourceScenes.map((source) => scenes[planner.production.suggestedScenes.indexOf(source)]!.sceneId),
        productionInstruction: item.productionInstruction, missingAssetBehavior: 'reject-package'
      }));
      const coverScene = scenes[planner.production.suggestedScenes.indexOf(derived.candidate.cover.selectedCoverScene)]!;
      const forbiddenClaims = [...new Set([
        ...input.reviewedPlannerResult.result.plan.brandSafety.forbiddenClaims,
        ...input.brandPolicy.forbiddenClaims
      ])];
      const prohibitedTone = PROHIBITED_TONES.filter((tone) =>
        input.reviewedPlannerResult.result.plan.brandSafety.prohibitedTone.includes(tone) ||
        input.brandPolicy.prohibitedTone.includes(tone));
      const result: VoluviaVideoPackage = {
        packageId, operationId: VOLUVIA_VIDEO_PACKAGE_OPERATION_ID, schemaVersion: 1,
        sourcePlan: { workflowId: input.reviewedPlannerResult.workflowId, workflowVersion: 1, operationId: input.reviewedPlannerResult.operationId, sourcePlanHash },
        provenance: { provider: clientResult.provenance.provider, model: clientResult.provenance.model,
          promptId: VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE.promptId, promptVersion: 4,
          promptContentHash: clientResult.provenance.promptContentHash, generatedAt },
        summary: { audience: { ...planner.audience }, strategy: { ...planner.strategy }, language: 'de-DE', platform: 'TikTok',
          targetDurationSeconds: input.videoControls.targetDurationSeconds,
          estimatedDurationSeconds: input.videoControls.targetDurationSeconds,
          videoStyle: planner.production.recommendedVideoStyle,
          hookStrategy: planner.production.recommendedHookStrategy,
          visualProofRequired: planner.production.visualProofRequired,
          presenterMode: input.videoControls.presenterMode },
        hook: { ...derived.candidate.hook },
        voiceover: { segments: derived.segments.map((segment) => ({ ...segment, claimsUsed: [...segment.claimsUsed] })), fullScript: derived.fullScript, estimatedSpokenSeconds: derived.estimatedSpokenSeconds },
        scenes, onScreenText,
        cover: { coverTitle: derived.candidate.cover.coverTitle,
          ...(derived.candidate.cover.coverSubtitle === undefined ? {} : { coverSubtitle: derived.candidate.cover.coverSubtitle }),
          selectedCoverSceneId: coverScene.sceneId, requiredAssetIds: [...derived.candidate.cover.requiredAssetIds] },
        caption: { text: derived.candidate.caption.text, callToAction: derived.candidate.caption.callToAction,
          semanticFactIds: [...derived.candidate.caption.proposedFactIds],
          ...(derived.candidate.caption.disclosureText === undefined ? {} : { disclosureText: derived.candidate.caption.disclosureText }) },
        hashtags: [...derived.candidate.hashtags], assetChecklist: checklist,
        narrationPackage: { presenterMode: input.videoControls.presenterMode, narrationText: derived.fullScript,
          sceneNarrationSegments: derived.segments.map((segment) => ({ ...segment, claimsUsed: [...segment.claimsUsed] })),
          subtitleLines: derived.subtitles.map((cue) => ({ ...cue, lines: [...cue.lines] })),
          avatarRequired: input.videoControls.presenterMode === 'presenter-plus-product',
          voiceRequired: input.videoControls.presenterMode === 'presenter-plus-product',
          ...(derived.candidate.backgroundAssetId === undefined ? {} : { backgroundAssetId: derived.candidate.backgroundAssetId }),
          aspectRatio: '9:16', resolutionClass: 'vertical-hd' },
        safety: { approvedFacts: effectiveFacts.map((fact) => ({ ...fact })), claimsUsed: [...derived.claimsUsed],
          forbiddenClaims, prohibitedTone,
          manualReviewRequired: true,
          commerceControlsApplied: { priceEnabled: input.videoControls.priceMayBeFeatured && effectiveFacts.some((fact) => fact.factId === 'price-49-eur'), shippingEnabled: input.videoControls.shippingMayBeFeatured && effectiveFacts.some((fact) => fact.factId === 'ships-from-germany'), deliveryClaimsEnabled: false },
          unsupportedClaimScanPassed: true, sceneCompatibilityPassed: true, assetCompatibilityPassed: true },
        packageReviewStatus: 'pending_manual_review'
      };
      canonicalizeVideoPackageValue(result);
      return validateFinalVideoPackage(result, { input, clientResult, effectiveFacts });
    } catch (error) {
      if (error instanceof VideoPackageLocalValidationFailure) {
        const safeReason = error.code === 'unsupported_claim' && error.unsupportedClaimReason !== undefined &&
          VIDEO_PACKAGE_UNSUPPORTED_CLAIM_REASONS.includes(error.unsupportedClaimReason) ?
          error.unsupportedClaimReason : undefined;
        const safeLocation = error.code === 'unsupported_claim' && error.textLocation !== undefined &&
          VIDEO_PACKAGE_TEXT_LOCATIONS.includes(error.textLocation) ? error.textLocation : undefined;
        const safeDurationReason = error.code === 'duration_invalid' && error.durationInvalidReason !== undefined &&
          VIDEO_PACKAGE_DURATION_INVALID_REASONS.includes(error.durationInvalidReason) ?
          error.durationInvalidReason : undefined;
        const safeNumber = (value: number | undefined): number | undefined =>
          value !== undefined && Number.isFinite(value) && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
        const durationContext = error.code === 'duration_invalid' ? error.durationContext : undefined;
        report({ diagnosticCategory: 'local_validation', localValidationCode: error.code,
          requestAttempted: providerRequestAttempted,
          ...(safeReason === undefined ? {} : { unsupportedClaimReason: safeReason }),
          ...(safeLocation === undefined ? {} : { textLocation: safeLocation }),
          ...(safeDurationReason === undefined ? {} : { durationInvalidReason: safeDurationReason }),
          ...(safeNumber(durationContext?.targetDurationSeconds) === undefined ? {} : { targetDurationSeconds: safeNumber(durationContext?.targetDurationSeconds) }),
          ...(safeNumber(durationContext?.estimatedSpokenSeconds) === undefined ? {} : { estimatedSpokenSeconds: safeNumber(durationContext?.estimatedSpokenSeconds) }),
          ...(safeNumber(durationContext?.minimumAllowedSeconds) === undefined ? {} : { minimumAllowedSeconds: safeNumber(durationContext?.minimumAllowedSeconds) }),
          ...(safeNumber(durationContext?.maximumAllowedSeconds) === undefined ? {} : { maximumAllowedSeconds: safeNumber(durationContext?.maximumAllowedSeconds) }),
          ...(safeNumber(durationContext?.sceneCount) === undefined ? {} : { sceneCount: safeNumber(durationContext?.sceneCount) }) });
        throw new Error('AI video package generation failed.');
      }
      if (error instanceof VideoPackageProviderFailure) {
        report({ diagnosticCategory: error.category === 'configuration' ? 'configuration' : 'provider',
          providerDiagnosticCategory: error.category, requestAttempted: error.requestAttempted });
      } else {
        report({ diagnosticCategory: 'provider', providerDiagnosticCategory: 'unknown',
          requestAttempted: true });
      }
      throw new Error('AI video package generation failed.');
    }
  };
}
