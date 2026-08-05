import { loadOpenAiConfig } from '../config/openai.config';
import {
  OpenAiDiagnosticFailure,
  OpenAiResponsesScriptGenerationClient,
  OpenAiSafeDiagnostic
} from '../integrations/openai/openai-responses-script-generation-client';
import { StaticPromptCatalog } from '../prompts/prompt-catalog';
import {
  VOLUVIA_AI_SCRIPT_OPERATION_ID,
  VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE,
  VoluviaAiScriptClientResult,
  VoluviaAiWorkflowInput
} from '../workflows/examples/voluvia/ai/voluvia-ai-script-contracts';
import { validateVoluviaAiClientResult } from '../workflows/examples/voluvia/ai/voluvia-ai-script-validator';

const smokeInput: VoluviaAiWorkflowInput = {
  product: {
    title: 'Voluvia Satin Evening Dress',
    description: 'Satin evening dress with a flowing silhouette.',
    color: 'Emerald green',
    length: 'Maxi',
    price: { amount: 89, currency: 'EUR' },
    audience: 'Adults',
    productKey: 'voluvia-satin-evening-dress'
  },
  targetLanguage: 'de-DE',
  targetAudience: 'Erwachsene Kundinnen, die elegante Abendmode suchen',
  brandVoice: 'Elegant, klar und zurückhaltend',
  contentGoal: 'Das Kleid sachlich und ansprechend vorstellen',
  videoLengthTargetSeconds: 30,
  prohibitedClaims: ['garantierter Erfolg'],
  requiredProductFacts: ['Satin-Abendkleid', 'Farbe Smaragdgrün', 'Maxi-Länge']
};

export function validateSmokeResult(
  result: VoluviaAiScriptClientResult,
  model: string
): VoluviaAiScriptClientResult {
  try {
    return validateVoluviaAiClientResult(result, smokeInput);
  } catch {
    throw new OpenAiDiagnosticFailure({
      category: 'local_validation',
      model,
      operationId: VOLUVIA_AI_SCRIPT_OPERATION_ID,
      requestAttempted: true
    });
  }
}

export function sanitizeSmokeFailure(
  error: unknown,
  configuredModel: string | undefined,
  requestAttempted: boolean
): OpenAiSafeDiagnostic {
  if (error instanceof OpenAiDiagnosticFailure) return error.diagnostic;
  return {
    category: configuredModel === undefined ? 'configuration' : 'unknown',
    ...(configuredModel === undefined ? {} : { model: configuredModel }),
    operationId: VOLUVIA_AI_SCRIPT_OPERATION_ID,
    requestAttempted
  };
}

export function formatSmokeDiagnostic(diagnostic: OpenAiSafeDiagnostic): string {
  return JSON.stringify({
    category: diagnostic.category,
    ...(diagnostic.status === undefined ? {} : { status: diagnostic.status }),
    ...(diagnostic.sdkErrorName === undefined ? {} : {
      sdkErrorName: diagnostic.sdkErrorName
    }),
    ...(diagnostic.requestId === undefined ? {} : { requestId: diagnostic.requestId }),
    ...(diagnostic.model === undefined ? {} : { model: diagnostic.model }),
    operationId: diagnostic.operationId,
    requestAttempted: diagnostic.requestAttempted
  });
}

async function main(): Promise<void> {
  process.stderr.write(
    'Warning: this smoke test makes one billable OpenAI API request. ' +
    '.env is not loaded; dotenv is intentionally absent. Set OPENAI_API_KEY and ' +
    'OPENAI_MODEL in the PowerShell/session environment or another process launcher. ' +
    'Generated German content and marketing claims require manual semantic review.\n'
  );
  let configuredModel: string | undefined;
  let requestAttempted = false;
  try {
    const config = loadOpenAiConfig();
    configuredModel = config.model;
    const client = new OpenAiResponsesScriptGenerationClient(config, new StaticPromptCatalog());
    requestAttempted = true;
    const result = validateSmokeResult(await client.generate({
      ...smokeInput,
      prompt: VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE
    }), config.model);
    process.stdout.write(`${JSON.stringify({
      provider: result.provider,
      model: result.model,
      responseId: result.responseId,
      usage: result.usage,
      content: {
        hook: result.hook,
        body: result.body,
        callToAction: result.callToAction,
        caption: result.caption,
        hashtagSuggestions: result.hashtagSuggestions,
        claimsUsed: result.claimsUsed
      }
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `OpenAI smoke diagnostic: ${formatSmokeDiagnostic(
        sanitizeSmokeFailure(error, configuredModel, requestAttempted)
      )}\n`
    );
    process.exitCode = 1;
  }
}

if (require.main === module) void main();
