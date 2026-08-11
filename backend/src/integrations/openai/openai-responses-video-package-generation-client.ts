import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { OpenAiConfig } from '../../config/openai.config';
import { PromptCatalog } from '../../prompts/prompt-catalog';
import { VideoPackageGenerationClient, VideoPackageProviderFailure } from '../ai/video-package-generation-client';
import { videoPackageCandidateSchema, videoPackageStructuredCandidateSchema } from '../../workflows/examples/voluvia/video-package/voluvia-video-package-validator';
import { VideoPackageClientResult, VideoPackageProviderDiagnosticCategory, VideoPackageProviderInput } from '../../workflows/examples/voluvia/video-package/voluvia-video-package-contracts';

const format = zodTextFormat(videoPackageStructuredCandidateSchema, 'voluvia_video_package_candidate');
export interface OpenAiVideoPackageParseRequest { readonly model: string; readonly instructions: string; readonly input: string; readonly text: { readonly format: typeof format }; readonly store: false; readonly max_output_tokens: 3000; readonly reasoning: { readonly effort: 'none' } }
interface ParsedResponse { readonly id: string; readonly model: string; readonly status?: string; readonly error?: unknown; readonly incomplete_details: unknown; readonly output_parsed: unknown; readonly usage?: { readonly input_tokens: number; readonly output_tokens: number; readonly total_tokens: number }; readonly output: readonly { readonly type: string; readonly content?: readonly { readonly type: string }[] }[] }
export interface OpenAiVideoPackageSdkClient { readonly responses: { parse(request: OpenAiVideoPackageParseRequest): Promise<ParsedResponse> } }
export interface OpenAiVideoPackageSdkFactory { create(options: { readonly apiKey: string; readonly maxRetries: 0; readonly timeout: 60000 }): OpenAiVideoPackageSdkClient }

class OfficialFactory implements OpenAiVideoPackageSdkFactory {
  create(options: { readonly apiKey: string; readonly maxRetries: 0; readonly timeout: 60000 }): OpenAiVideoPackageSdkClient {
    const client = new OpenAI(options);
    return { responses: { parse: async (request) => client.responses.parse(request) } };
  }
}

export class OpenAiVideoPackageDiagnosticFailure extends VideoPackageProviderFailure {
  readonly name = 'OpenAiVideoPackageDiagnosticFailure';
  constructor(category: VideoPackageProviderDiagnosticCategory, requestAttempted: boolean, status?: number, responseId?: string) {
    super(category, requestAttempted, status, responseId);
  }
}

export class OpenAiResponsesVideoPackageGenerationClient implements VideoPackageGenerationClient {
  private readonly client: OpenAiVideoPackageSdkClient;
  constructor(private readonly config: OpenAiConfig, private readonly promptCatalog: PromptCatalog, factory: OpenAiVideoPackageSdkFactory = new OfficialFactory()) {
    this.client = factory.create({ apiKey: config.apiKey, maxRetries: config.maxRetries, timeout: config.timeoutMs });
  }

  async generatePackageCandidate(input: VideoPackageProviderInput): Promise<VideoPackageClientResult> {
    const prompt = this.promptCatalog.resolve(input.prompt);
    if (!prompt) throw new OpenAiVideoPackageDiagnosticFailure('configuration', false);
    let response: ParsedResponse;
    try {
      response = await this.client.responses.parse({ model: this.config.model, instructions: prompt.content,
        input: JSON.stringify({ audience: input.audience, strategy: input.strategy, production: input.production,
          approvedProductFacts: input.approvedProductFacts, brandPolicy: input.brandPolicy,
          videoControls: input.videoControls, availableAssetIds: input.availableAssetIds }),
        text: { format }, store: false, max_output_tokens: 3000, reasoning: { effort: 'none' } });
    } catch (error) { throw this.classify(error); }
    if (response.status !== 'completed' || response.error != null || response.incomplete_details !== null) throw new OpenAiVideoPackageDiagnosticFailure('response_incomplete', true);
    if (response.output.some((item) => item.type === 'message' && item.content?.some((part) => part.type === 'refusal'))) throw new OpenAiVideoPackageDiagnosticFailure('response_refused', true);
    const wireCandidate = videoPackageStructuredCandidateSchema.safeParse(response.output_parsed);
    const candidate = wireCandidate.success ? videoPackageCandidateSchema.safeParse({
      voiceover: wireCandidate.data.voiceover,
      scenes: wireCandidate.data.scenes,
      onScreenText: wireCandidate.data.onScreenText,
      hashtags: wireCandidate.data.hashtags,
      assetUsageProposal: wireCandidate.data.assetUsageProposal,
      hook: {
        spokenHook: wireCandidate.data.hook.spokenHook,
        onScreenHook: wireCandidate.data.hook.onScreenHook,
        ...(wireCandidate.data.hook.visualHookInstruction === null ? {} : {
          visualHookInstruction: wireCandidate.data.hook.visualHookInstruction
        })
      },
      cover: {
        coverTitle: wireCandidate.data.cover.coverTitle,
        selectedCoverScene: wireCandidate.data.cover.selectedCoverScene,
        requiredAssetIds: wireCandidate.data.cover.requiredAssetIds,
        ...(wireCandidate.data.cover.coverSubtitle === null ? {} : {
          coverSubtitle: wireCandidate.data.cover.coverSubtitle
        })
      },
      caption: {
        text: wireCandidate.data.caption.text,
        callToAction: wireCandidate.data.caption.callToAction,
        proposedFactIds: wireCandidate.data.caption.proposedFactIds,
        ...(wireCandidate.data.caption.disclosureText === null ? {} : {
          disclosureText: wireCandidate.data.caption.disclosureText
        })
      },
      ...(wireCandidate.data.backgroundAssetId === null ? {} : {
        backgroundAssetId: wireCandidate.data.backgroundAssetId
      })
    }) : wireCandidate;
    if (!candidate.success || !response.usage || response.usage.total_tokens !== response.usage.input_tokens + response.usage.output_tokens) throw new OpenAiVideoPackageDiagnosticFailure('response_invalid', true);
    const safeResponseId = /^[A-Za-z0-9_-]{1,200}$/u.test(response.id)
      ? response.id
      : undefined;
    return {
      candidate: candidate.data,
      provenance: { provider: 'openai', model: response.model, promptId: prompt.promptId, promptVersion: prompt.promptVersion, promptContentHash: prompt.sha256 },
      diagnostics: { provider: 'openai', model: response.model, requestAttempted: true,
        ...(safeResponseId === undefined ? {} : { responseId: safeResponseId }),
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens } }
    };
  }

  private classify(error: unknown): OpenAiVideoPackageDiagnosticFailure {
    if (error instanceof OpenAI.AuthenticationError) return this.api('authentication', error);
    if (error instanceof OpenAI.PermissionDeniedError) return this.api('permission_denied', error);
    if (error instanceof OpenAI.RateLimitError) return this.api('rate_limit', error);
    if (error instanceof OpenAI.APIConnectionTimeoutError) return this.api('timeout', error);
    if (error instanceof OpenAI.APIConnectionError) return this.api('network', error);
    if (error instanceof OpenAI.BadRequestError || error instanceof OpenAI.UnprocessableEntityError) return this.api('invalid_request', error);
    if (error instanceof OpenAI.NotFoundError) return this.api(/\bmodel\b/iu.test(error.message) ? 'model_unavailable' : 'invalid_request', error);
    if (error instanceof OpenAI.InternalServerError || error instanceof OpenAI.APIError && typeof error.status === 'number' && error.status >= 500) return this.api('provider_server', error);
    return new OpenAiVideoPackageDiagnosticFailure('unknown', true);
  }
  private api(category: VideoPackageProviderDiagnosticCategory, error: { readonly status?: number; readonly requestID?: string | null }): OpenAiVideoPackageDiagnosticFailure {
    const id = typeof error.requestID === 'string' && /^[A-Za-z0-9_-]{1,200}$/u.test(error.requestID) ? error.requestID : undefined;
    return new OpenAiVideoPackageDiagnosticFailure(category, true, error.status, id);
  }
}
