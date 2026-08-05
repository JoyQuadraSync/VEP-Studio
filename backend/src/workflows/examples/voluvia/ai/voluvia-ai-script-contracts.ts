import { PromptReference } from '../../../../prompts/prompt-reference';
import { VoluviaNormalizedProduct } from '../voluvia-operation-contracts';

export const VOLUVIA_AI_SCRIPT_OPERATION_ID = 'voluvia.script.generate.ai';
export const VOLUVIA_AI_SCRIPT_SCHEMA_VERSION = 1;
export const VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE: PromptReference = Object.freeze({
  promptId: 'voluvia.tiktok.script.de',
  promptVersion: 1
});

export interface VoluviaAiWorkflowInput {
  readonly product: VoluviaNormalizedProduct;
  readonly targetLanguage: 'de-DE';
  readonly targetAudience: string;
  readonly brandVoice: string;
  readonly contentGoal: string;
  readonly videoLengthTargetSeconds: number;
  readonly prohibitedClaims: readonly string[];
  readonly requiredProductFacts: readonly string[];
}

export interface VoluviaAiScriptRequest extends VoluviaAiWorkflowInput {
  readonly prompt: PromptReference;
}

export interface VoluviaAiScriptContent {
  readonly hook: string;
  readonly body: string;
  readonly callToAction: string;
  readonly caption: string;
  readonly hashtagSuggestions: readonly string[];
  readonly language: 'de-DE';
  readonly claimsUsed: readonly string[];
}

export interface VoluviaAiScriptClientResult extends VoluviaAiScriptContent {
  readonly provider: string;
  readonly model: string;
  readonly responseId: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
  readonly promptSha256: string;
}

export interface VoluviaAiScriptResult extends VoluviaAiScriptContent {
  readonly generation: {
    readonly provider: string;
    readonly model: string;
    readonly operationId: typeof VOLUVIA_AI_SCRIPT_OPERATION_ID;
    readonly schemaVersion: typeof VOLUVIA_AI_SCRIPT_SCHEMA_VERSION;
    readonly promptId: string;
    readonly promptVersion: number;
    readonly promptSha256: string;
    readonly responseId: string;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
    };
  };
}
