import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { OpenAiConfig } from '../../config/openai.config';
import { AiScriptGenerationClient } from '../ai/ai-script-generation-client';
import { PromptCatalog } from '../../prompts/prompt-catalog';
import {
  VOLUVIA_AI_SCRIPT_OPERATION_ID,
  VoluviaAiScriptClientResult,
  VoluviaAiScriptRequest
} from '../../workflows/examples/voluvia/ai/voluvia-ai-script-contracts';
import { voluviaAiStructuredOutputSchema } from '../../workflows/examples/voluvia/ai/voluvia-ai-script-validator';

const structuredFormat = zodTextFormat(
  voluviaAiStructuredOutputSchema,
  'voluvia_ai_script'
);

export type OpenAiDiagnosticCategory =
  | 'configuration'
  | 'authentication'
  | 'permission_denied'
  | 'rate_limit'
  | 'invalid_request'
  | 'model_unavailable'
  | 'timeout'
  | 'network'
  | 'provider_server'
  | 'response_incomplete'
  | 'response_refused'
  | 'response_invalid'
  | 'local_validation'
  | 'unknown';

export type OpenAiSdkErrorName =
  | 'AuthenticationError'
  | 'PermissionDeniedError'
  | 'RateLimitError'
  | 'BadRequestError'
  | 'NotFoundError'
  | 'UnprocessableEntityError'
  | 'APIConnectionTimeoutError'
  | 'APIConnectionError'
  | 'InternalServerError'
  | 'APIError';

export interface OpenAiSafeDiagnostic {
  readonly category: OpenAiDiagnosticCategory;
  readonly model?: string;
  readonly operationId: typeof VOLUVIA_AI_SCRIPT_OPERATION_ID;
  readonly requestAttempted: boolean;
  readonly status?: number;
  readonly sdkErrorName?: OpenAiSdkErrorName;
  readonly requestId?: string;
}

export class OpenAiDiagnosticFailure {
  readonly name = 'OpenAiDiagnosticFailure';

  constructor(readonly diagnostic: OpenAiSafeDiagnostic) {}
}

export interface OpenAiScriptParseRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: string;
  readonly text: { readonly format: typeof structuredFormat };
  readonly store: false;
  readonly max_output_tokens: 800;
  readonly reasoning: { readonly effort: 'none' };
}

interface OpenAiScriptParsedResponse {
  readonly id: string;
  readonly model: string;
  readonly status?: string;
  readonly error?: unknown;
  readonly incomplete_details: unknown;
  readonly output_parsed: unknown;
  readonly usage?: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly total_tokens: number;
  };
  readonly output: readonly {
    readonly type: string;
    readonly content?: readonly { readonly type: string }[];
  }[];
}

export interface OpenAiSdkClient {
  readonly responses: {
    parse(request: OpenAiScriptParseRequest): Promise<OpenAiScriptParsedResponse>;
  };
}

export interface OpenAiSdkFactory {
  create(options: {
    readonly apiKey: string;
    readonly maxRetries: 0;
    readonly timeout: 60000;
  }): OpenAiSdkClient;
}

class OfficialOpenAiSdkFactory implements OpenAiSdkFactory {
  create(options: {
    readonly apiKey: string;
    readonly maxRetries: 0;
    readonly timeout: 60000;
  }): OpenAiSdkClient {
    const client = new OpenAI(options);
    return {
      responses: {
        parse: async (request) => client.responses.parse(request)
      }
    };
  }
}

export class OpenAiResponsesScriptGenerationClient implements AiScriptGenerationClient {
  private readonly client: OpenAiSdkClient;

  constructor(
    private readonly config: OpenAiConfig,
    private readonly promptCatalog: PromptCatalog,
    sdkFactory: OpenAiSdkFactory = new OfficialOpenAiSdkFactory()
  ) {
    this.client = sdkFactory.create({
      apiKey: config.apiKey,
      maxRetries: config.maxRetries,
      timeout: config.timeoutMs
    });
  }

  async generate(input: VoluviaAiScriptRequest): Promise<VoluviaAiScriptClientResult> {
    const prompt = this.promptCatalog.resolve(input.prompt);
    if (!prompt) throw this.diagnostic('configuration', false);

    let response: OpenAiScriptParsedResponse;
    try {
      response = await this.client.responses.parse({
        model: this.config.model,
        instructions: prompt.content,
        input: JSON.stringify({
          product: input.product,
          targetLanguage: input.targetLanguage,
          targetAudience: input.targetAudience,
          brandVoice: input.brandVoice,
          contentGoal: input.contentGoal,
          videoLengthTargetSeconds: input.videoLengthTargetSeconds,
          prohibitedClaims: input.prohibitedClaims,
          requiredProductFacts: input.requiredProductFacts
        }),
        text: { format: structuredFormat },
        store: this.config.store,
        max_output_tokens: this.config.maxOutputTokens,
        reasoning: { effort: 'none' }
      });
    } catch (error) {
      throw this.classifyProviderError(error);
    }

    if (response.status !== 'completed' || response.error != null) {
      throw this.diagnostic('response_incomplete', true);
    }
    if (this.containsRefusal(response)) {
      throw this.diagnostic('response_refused', true);
    }
    if (response.incomplete_details !== null) {
      throw this.diagnostic('response_incomplete', true);
    }
    if (!response.output_parsed || !response.usage) {
      throw this.diagnostic('response_invalid', true);
    }

    const content = voluviaAiStructuredOutputSchema.safeParse(response.output_parsed);
    if (!content.success) throw this.diagnostic('response_invalid', true);

    return {
      ...content.data,
      provider: 'openai',
      model: response.model,
      responseId: response.id,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens
      },
      promptSha256: prompt.sha256
    };
  }

  private containsRefusal(response: OpenAiScriptParsedResponse): boolean {
    return response.output.some(
      (item) => item.type === 'message' && item.content?.some((part) => part.type === 'refusal')
    );
  }

  private classifyProviderError(error: unknown): OpenAiDiagnosticFailure {
    if (error instanceof OpenAI.AuthenticationError) {
      return this.apiDiagnostic('authentication', error, 'AuthenticationError');
    }
    if (error instanceof OpenAI.PermissionDeniedError) {
      return this.apiDiagnostic('permission_denied', error, 'PermissionDeniedError');
    }
    if (error instanceof OpenAI.RateLimitError) {
      return this.apiDiagnostic('rate_limit', error, 'RateLimitError');
    }
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return this.apiDiagnostic('timeout', error, 'APIConnectionTimeoutError');
    }
    if (error instanceof OpenAI.APIConnectionError) {
      return this.apiDiagnostic('network', error, 'APIConnectionError');
    }
    if (error instanceof OpenAI.BadRequestError) {
      return this.apiDiagnostic('invalid_request', error, 'BadRequestError');
    }
    if (error instanceof OpenAI.NotFoundError) {
      const category = /\bmodel\b/iu.test(error.message)
        ? 'model_unavailable'
        : 'invalid_request';
      return this.apiDiagnostic(category, error, 'NotFoundError');
    }
    if (error instanceof OpenAI.UnprocessableEntityError) {
      return this.apiDiagnostic('invalid_request', error, 'UnprocessableEntityError');
    }
    if (error instanceof OpenAI.InternalServerError) {
      return this.apiDiagnostic('provider_server', error, 'InternalServerError');
    }
    if (error instanceof OpenAI.APIError && typeof error.status === 'number' && error.status >= 500) {
      return this.apiDiagnostic('provider_server', error, 'APIError');
    }
    return this.diagnostic('unknown', true);
  }

  private apiDiagnostic(
    category: OpenAiDiagnosticCategory,
    error: {
      readonly status?: number;
      readonly requestID?: string | null;
    },
    sdkErrorName: OpenAiSdkErrorName
  ): OpenAiDiagnosticFailure {
    const status = typeof error.status === 'number' ? error.status : undefined;
    const requestId = this.safeRequestId(error.requestID);
    return this.diagnostic(category, true, { status, sdkErrorName, requestId });
  }

  private safeRequestId(value: string | null | undefined): string | undefined {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(value)
      ? value
      : undefined;
  }

  private diagnostic(
    category: OpenAiDiagnosticCategory,
    requestAttempted: boolean,
    metadata: {
      readonly status?: number;
      readonly sdkErrorName?: OpenAiSdkErrorName;
      readonly requestId?: string;
    } = {}
  ): OpenAiDiagnosticFailure {
    return new OpenAiDiagnosticFailure({
      category,
      model: this.config.model,
      operationId: VOLUVIA_AI_SCRIPT_OPERATION_ID,
      requestAttempted,
      ...(metadata.status === undefined ? {} : { status: metadata.status }),
      ...(metadata.sdkErrorName === undefined ? {} : { sdkErrorName: metadata.sdkErrorName }),
      ...(metadata.requestId === undefined ? {} : { requestId: metadata.requestId })
    });
  }
}
