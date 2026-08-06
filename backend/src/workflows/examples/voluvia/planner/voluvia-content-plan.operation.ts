import { ContentPlanningClient, ContentPlanningClientRequest } from '../../../../integrations/ai/content-planning-client';
import { OperationHandler } from '../../../runtime/operation-handler';
import {
  VOLUVIA_CONTENT_PLAN_OPERATION_ID,
  VOLUVIA_CONTENT_PLAN_SCHEMA_VERSION,
  VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE,
  VoluviaContentPlanningResult
} from './voluvia-content-planner-contracts';
import {
  deriveEffectivePlannerFacts,
  validateContentPlanningClientResult,
  validateVoluviaContentPlannerInput,
  validateVoluviaContentPlanningResult,
  VoluviaContentPlanLocalValidationDiagnostic,
  VoluviaContentPlanLocalValidationFailure
} from './voluvia-content-plan-validator';

export function createVoluviaContentPlanOperation(
  client: ContentPlanningClient,
  onLocalValidationFailure?: (diagnostic: VoluviaContentPlanLocalValidationDiagnostic) => void
): OperationHandler {
  return async ({ stepInput }) => {
    try {
      const input = validateVoluviaContentPlannerInput(stepInput);
      const effectiveFacts = deriveEffectivePlannerFacts(input);
      const request: ContentPlanningClientRequest = {
        product: {
          productKey: input.product.productKey,
          name: input.product.name,
          category: input.product.category,
          material: input.product.material,
          hairType: input.product.hairType,
          lengthCm: input.product.lengthCm,
          colors: [...input.product.colors],
          base: input.product.base,
          clipCount: input.product.clipCount,
          ...(input.plannerControls.priceMayBeFeatured
            ? { price: { ...input.product.price } }
            : {}),
          ...(input.plannerControls.shippingMayBeFeatured
            ? { shipsFrom: input.product.shipsFrom }
            : {})
        },
        approvedProductFacts: effectiveFacts.map((fact) => ({ ...fact })),
        approvedSellingPoints: input.approvedSellingPoints.filter((focus) =>
          focus !== 'german-shipping' || input.plannerControls.shippingMayBeFeatured),
        forbiddenClaims: [...input.forbiddenClaims],
        targetCustomer: {
          ...input.targetCustomer,
          concerns: [...input.targetCustomer.concerns]
        },
        brand: {
          ...input.brand,
          tone: [...input.brand.tone],
          prohibitedTone: [...input.brand.prohibitedTone]
        },
        contentGoal: input.contentGoal,
        targetPlatform: input.targetPlatform,
        targetLanguage: input.targetLanguage,
        preferredVideoDurationSeconds: input.preferredVideoDurationSeconds,
        plannerControls: {
          ...(input.plannerControls.preferredContentAngle === undefined
            ? {}
            : { preferredContentAngle: input.plannerControls.preferredContentAngle }),
          ...(input.plannerControls.preferredContentFocus === undefined
            ? {}
            : { preferredContentFocus: input.plannerControls.preferredContentFocus }),
          excludedRecentlyUsedAngles: [...input.plannerControls.excludedRecentlyUsedAngles],
          excludedRecentlyUsedFocuses: [...input.plannerControls.excludedRecentlyUsedFocuses],
          realBeforeAfterEvidenceAvailable:
            input.plannerControls.realBeforeAfterEvidenceAvailable
        },
        prompt: { ...VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE }
      };
      const clientResult = validateContentPlanningClientResult(
        await client.generatePlan(request), input, effectiveFacts
      );
      const result: VoluviaContentPlanningResult = {
        reviewStatus: 'pending_manual_review',
        plan: {
          audience: { ...clientResult.candidate.audience },
          strategy: { ...clientResult.candidate.strategy },
          production: {
            ...clientResult.candidate.production,
            suggestedScenes: [...clientResult.candidate.production.suggestedScenes]
          },
          brandSafety: {
            approvedFacts: effectiveFacts.map((fact) => ({ ...fact })),
            forbiddenClaims: [...input.forbiddenClaims],
            prohibitedTone: [...input.brand.prohibitedTone],
            manualReviewRequired: true
          }
        },
        generation: {
          provider: clientResult.provider,
          model: clientResult.model,
          operationId: VOLUVIA_CONTENT_PLAN_OPERATION_ID,
          schemaVersion: VOLUVIA_CONTENT_PLAN_SCHEMA_VERSION,
          promptId: VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptId,
          promptVersion: VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptVersion,
          promptContentHash: clientResult.promptContentHash,
          responseId: clientResult.responseId,
          inputTokens: clientResult.inputTokens,
          outputTokens: clientResult.outputTokens,
          totalTokens: clientResult.totalTokens
        }
      };
      return validateVoluviaContentPlanningResult(result, input, effectiveFacts);
    } catch (error) {
      if (error instanceof VoluviaContentPlanLocalValidationFailure) {
        try {
          onLocalValidationFailure?.(error.toDiagnostic());
        } catch {
          // Diagnostic observers must never alter workflow failure semantics.
        }
      }
      throw new Error('AI content planning failed.');
    }
  };
}
