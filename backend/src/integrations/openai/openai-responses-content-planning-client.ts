import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { OpenAiConfig } from '../../config/openai.config';
import { PromptCatalog } from '../../prompts/prompt-catalog';
import {
  ContentPlanningClient,
  ContentPlanningClientRequest,
  ContentPlanningClientResult
} from '../ai/content-planning-client';
import { VOLUVIA_CONTENT_PLAN_OPERATION_ID } from '../../workflows/examples/voluvia/planner/voluvia-content-planner-contracts';
import { voluviaContentPlanningCandidateSchema } from '../../workflows/examples/voluvia/planner/voluvia-content-plan-validator';

const structuredFormat = zodTextFormat(
  voluviaContentPlanningCandidateSchema,
  'voluvia_content_plan'
);

export type OpenAiPlanningDiagnosticCategory =
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
  | 'unknown';

export interface OpenAiPlanningSafeDiagnostic {
  readonly category: OpenAiPlanningDiagnosticCategory;
  readonly operationId: typeof VOLUVIA_CONTENT_PLAN_OPERATION_ID;
  readonly requestAttempted: boolean;
  readonly status?: number;
  readonly requestId?: string;
}

export class OpenAiPlanningDiagnosticFailure {
  readonly name = 'OpenAiPlanningDiagnosticFailure';
  constructor(readonly diagnostic: OpenAiPlanningSafeDiagnostic) {}
}

export interface OpenAiPlanningParseRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: string;
  readonly text: { readonly format: typeof structuredFormat };
  readonly store: false;
  readonly max_output_tokens: 800;
  readonly reasoning: { readonly effort: 'none' };
}

interface OpenAiPlanningParsedResponse {
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

export interface OpenAiPlanningSdkClient {
  readonly responses: {
    parse(request: OpenAiPlanningParseRequest): Promise<OpenAiPlanningParsedResponse>;
  };
}

export interface OpenAiPlanningSdkFactory {
  create(options: {
    readonly apiKey: string;
    readonly maxRetries: 0;
    readonly timeout: 60000;
  }): OpenAiPlanningSdkClient;
}

class OfficialOpenAiPlanningSdkFactory implements OpenAiPlanningSdkFactory {
  create(options: {
    readonly apiKey: string;
    readonly maxRetries: 0;
    readonly timeout: 60000;
  }): OpenAiPlanningSdkClient {
    const client = new OpenAI(options);
    return {
      responses: {
        parse: async (request) => client.responses.parse(request)
      }
    };
  }
}

export class OpenAiResponsesContentPlanningClient implements ContentPlanningClient {
  private readonly client: OpenAiPlanningSdkClient;

  constructor(
    private readonly config: OpenAiConfig,
    private readonly promptCatalog: PromptCatalog,
    sdkFactory: OpenAiPlanningSdkFactory = new OfficialOpenAiPlanningSdkFactory()
  ) {
    this.client = sdkFactory.create({
      apiKey: config.apiKey,
      maxRetries: config.maxRetries,
      timeout: config.timeoutMs
    });
  }

  async generatePlan(
    request: ContentPlanningClientRequest
  ): Promise<ContentPlanningClientResult> {
    const prompt = this.promptCatalog.resolve(request.prompt);
    if (!prompt) throw this.diagnostic('configuration', false);

    let response: OpenAiPlanningParsedResponse;
    try {
      response = await this.client.responses.parse({
        model: this.config.model,
        instructions: prompt.content,
        input: JSON.stringify({
          product: request.product,
          approvedProductFacts: request.approvedProductFacts,
          approvedSellingPoints: request.approvedSellingPoints,
          forbiddenClaims: request.forbiddenClaims,
          targetCustomer: request.targetCustomer,
          brand: request.brand,
          contentGoal: request.contentGoal,
          targetPlatform: request.targetPlatform,
          targetLanguage: request.targetLanguage,
          preferredVideoDurationSeconds: request.preferredVideoDurationSeconds,
          plannerControls: request.plannerControls
        }),
        text: { format: structuredFormat },
        store: this.config.store,
        max_output_tokens: this.config.maxOutputTokens,
        reasoning: { effort: 'none' }
      });
    } catch (error) {
      throw this.classifyProviderError(error);
    }

    if (response.status !== 'completed' || response.error != null ||
        response.incomplete_details !== null) {
      throw this.diagnostic('response_incomplete', true);
    }
    if (response.output.some((item) =>
      item.type === 'message' && item.content?.some((part) => part.type === 'refusal'))) {
      throw this.diagnostic('response_refused', true);
    }
    const candidate = voluviaContentPlanningCandidateSchema.safeParse(response.output_parsed);
    if (!candidate.success || !response.usage) {
      throw this.diagnostic('response_invalid', true);
    }
    return {
      candidate: candidate.data,
      provider: 'openai',
      model: response.model,
      responseId: response.id,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.total_tokens,
      promptId: prompt.promptId,
      promptVersion: prompt.promptVersion,
      promptContentHash: prompt.sha256
    };
  }

  private classifyProviderError(error: unknown): OpenAiPlanningDiagnosticFailure {
    if (error instanceof OpenAI.AuthenticationError) return this.apiDiagnostic('authentication', error);
    if (error instanceof OpenAI.PermissionDeniedError) return this.apiDiagnostic('permission_denied', error);
    if (error instanceof OpenAI.RateLimitError) return this.apiDiagnostic('rate_limit', error);
    if (error instanceof OpenAI.APIConnectionTimeoutError) return this.apiDiagnostic('timeout', error);
    if (error instanceof OpenAI.APIConnectionError) return this.apiDiagnostic('network', error);
    if (error instanceof OpenAI.BadRequestError) return this.apiDiagnostic('invalid_request', error);
    if (error instanceof OpenAI.NotFoundError) {
      return this.apiDiagnostic(/\bmodel\b/iu.test(error.message)
        ? 'model_unavailable'
        : 'invalid_request', error);
    }
    if (error instanceof OpenAI.UnprocessableEntityError) return this.apiDiagnostic('invalid_request', error);
    if (error instanceof OpenAI.InternalServerError ||
        error instanceof OpenAI.APIError && typeof error.status === 'number' && error.status >= 500) {
      return this.apiDiagnostic('provider_server', error);
    }
    return this.diagnostic('unknown', true);
  }

  private apiDiagnostic(
    category: OpenAiPlanningDiagnosticCategory,
    error: { readonly status?: number; readonly requestID?: string | null }
  ): OpenAiPlanningDiagnosticFailure {
    return this.diagnostic(category, true, {
      status: typeof error.status === 'number' ? error.status : undefined,
      requestId: typeof error.requestID === 'string' &&
        /^[A-Za-z0-9_-]{1,200}$/u.test(error.requestID) ? error.requestID : undefined
    });
  }

  private diagnostic(
    category: OpenAiPlanningDiagnosticCategory,
    requestAttempted: boolean,
    metadata: { readonly status?: number; readonly requestId?: string } = {}
  ): OpenAiPlanningDiagnosticFailure {
    return new OpenAiPlanningDiagnosticFailure({
      category,
      operationId: VOLUVIA_CONTENT_PLAN_OPERATION_ID,
      requestAttempted,
      ...(metadata.status === undefined ? {} : { status: metadata.status }),
      ...(metadata.requestId === undefined ? {} : { requestId: metadata.requestId })
    });
  }
}
