const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOpenAiConfig } = require('../dist/config/openai.config');
const { StaticPromptCatalog } = require('../dist/prompts/prompt-catalog');
const { OpenAiResponsesVideoPackageGenerationClient } = require('../dist/integrations/openai/openai-responses-video-package-generation-client');
const { InMemoryOperationRegistry } = require('../dist/workflows/runtime/operation-registry');
const { registerVoluviaVideoPackageOperation } = require('../dist/workflows/examples/voluvia/video-package/register-voluvia-video-package-operation');
const { VOLUVIA_VIDEO_PACKAGE_OPERATION_ID } = require('../dist/workflows/examples/voluvia/video-package/voluvia-video-package-contracts');
const fixture = require('../tests/helpers/voluvia-video-package-fixture');

const optedIn = process.env.OPENAI_LIVE_TEST === 'true' &&
  process.env.OPENAI_LIVE_VIDEO_PACKAGE === 'true';

test('Voluvia video package live operation boundary', { skip: !optedIn }, async () => {
  const config = loadOpenAiConfig();
  const adapter = new OpenAiResponsesVideoPackageGenerationClient(config, new StaticPromptCatalog());
  let providerRequestCount = 0;
  const oneRequestClient = {
    async generatePackageCandidate(input) {
      if (providerRequestCount >= 1) throw new Error('Second provider request blocked.');
      providerRequestCount = 1;
      return adapter.generatePackageCandidate(input);
    }
  };
  let safeDiagnostics;
  const registry = new InMemoryOperationRegistry();
  registerVoluviaVideoPackageOperation(registry, oneRequestClient,
    { now: () => new Date() }, (value) => { safeDiagnostics = value; });
  const handler = registry.resolve(VOLUVIA_VIDEO_PACKAGE_OPERATION_ID);
  assert.ok(handler);
  const input = fixture.input();
  let failed = false;
  try {
    const result = await handler({
      executionId: 'voluvia-video-package-live',
      workflowId: 'voluvia.video.packagegeneration.ai.workflow', workflowVersion: 1,
      stepId: 'generate-video-package', workflowInput: input, stepInput: input
    });
    assert.equal(providerRequestCount, 1);
    assert.equal(result.packageReviewStatus, 'pending_manual_review');
    console.log(JSON.stringify({
      success: true, providerRequestCount,
      packageReviewStatus: result.packageReviewStatus,
      provider: safeDiagnostics?.provider,
      model: safeDiagnostics?.model,
      responseId: safeDiagnostics?.responseId,
      usage: safeDiagnostics?.usage
    }));
  } catch {
    failed = true;
    const failureDiagnostic = safeDiagnostics && 'diagnosticCategory' in safeDiagnostics
      ? safeDiagnostics
      : undefined;
    console.log(JSON.stringify({
      success: false,
      operationId: VOLUVIA_VIDEO_PACKAGE_OPERATION_ID,
      requestAttempted: failureDiagnostic?.requestAttempted ?? providerRequestCount > 0,
      providerRequestCount,
      configuredModel: config.model,
      ...(failureDiagnostic === undefined ? {} : {
        diagnosticCategory: failureDiagnostic.diagnosticCategory,
        ...('providerDiagnosticCategory' in failureDiagnostic ? {
          providerDiagnosticCategory: failureDiagnostic.providerDiagnosticCategory
        } : {}),
        ...('localValidationCode' in failureDiagnostic ? {
          localValidationCode: failureDiagnostic.localValidationCode,
          ...('unsupportedClaimReason' in failureDiagnostic &&
            failureDiagnostic.unsupportedClaimReason !== undefined ? {
              unsupportedClaimReason: failureDiagnostic.unsupportedClaimReason
            } : {}),
          ...('textLocation' in failureDiagnostic && failureDiagnostic.textLocation !== undefined ? {
            textLocation: failureDiagnostic.textLocation
          } : {}),
          ...('durationInvalidReason' in failureDiagnostic && failureDiagnostic.durationInvalidReason !== undefined ? {
            durationInvalidReason: failureDiagnostic.durationInvalidReason,
            ...(['targetDurationSeconds', 'estimatedSpokenSeconds', 'minimumAllowedSeconds',
              'maximumAllowedSeconds', 'sceneCount'].reduce((safe, key) =>
              typeof failureDiagnostic[key] === 'number' ?
                { ...safe, [key]: failureDiagnostic[key] } : safe, {}))
          } : {})
        } : {})
      })
    }));
  }
  assert.equal(failed, false, 'live test failed');
});
