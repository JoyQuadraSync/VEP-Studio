import { AiScriptGenerationClient } from '../../../../integrations/ai/ai-script-generation-client';
import { OperationHandler } from '../../../runtime/operation-handler';
import {
  VOLUVIA_AI_SCRIPT_OPERATION_ID,
  VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE,
  VOLUVIA_AI_SCRIPT_SCHEMA_VERSION,
  VoluviaAiScriptRequest,
  VoluviaAiScriptResult
} from './voluvia-ai-script-contracts';
import {
  validateVoluviaAiClientResult,
  validateVoluviaAiScriptResult,
  validateVoluviaAiWorkflowInput
} from './voluvia-ai-script-validator';

export function createVoluviaAiScriptOperation(
  client: AiScriptGenerationClient
): OperationHandler {
  return async ({ stepInput }) => {
    try {
      const input = validateVoluviaAiWorkflowInput(stepInput);
      const request: VoluviaAiScriptRequest = {
        product: { ...input.product, price: { ...input.product.price } },
        targetLanguage: input.targetLanguage,
        targetAudience: input.targetAudience,
        brandVoice: input.brandVoice,
        contentGoal: input.contentGoal,
        videoLengthTargetSeconds: input.videoLengthTargetSeconds,
        prohibitedClaims: [...input.prohibitedClaims],
        requiredProductFacts: [...input.requiredProductFacts],
        prompt: { ...VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE }
      };
      const providerResult = validateVoluviaAiClientResult(
        await client.generate(request),
        input
      );
      const result: VoluviaAiScriptResult = {
        hook: providerResult.hook,
        body: providerResult.body,
        callToAction: providerResult.callToAction,
        caption: providerResult.caption,
        hashtagSuggestions: [...providerResult.hashtagSuggestions],
        language: providerResult.language,
        claimsUsed: [...providerResult.claimsUsed],
        generation: {
          provider: providerResult.provider,
          model: providerResult.model,
          operationId: VOLUVIA_AI_SCRIPT_OPERATION_ID,
          schemaVersion: VOLUVIA_AI_SCRIPT_SCHEMA_VERSION,
          promptId: request.prompt.promptId,
          promptVersion: request.prompt.promptVersion,
          promptSha256: providerResult.promptSha256,
          responseId: providerResult.responseId,
          usage: { ...providerResult.usage }
        }
      };
      return validateVoluviaAiScriptResult(result);
    } catch {
      throw new Error('AI script generation failed.');
    }
  };
}
