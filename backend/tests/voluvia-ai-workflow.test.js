const test = require('node:test');
const assert = require('node:assert/strict');

const {
  voluviaTikTokContentAiWorkflow
} = require('../dist/workflows/definitions/voluvia-tiktok-content-ai.workflow');
const {
  OpenAiDiagnosticFailure
} = require('../dist/integrations/openai/openai-responses-script-generation-client');
const {
  voluviaTikTokContentWorkflow
} = require('../dist/workflows/definitions/voluvia-tiktok-content.workflow');
const {
  VOLUVIA_AI_SCRIPT_OPERATION_ID
} = require('../dist/workflows/examples/voluvia/ai/voluvia-ai-script-contracts');
const {
  registerVoluviaAiOperation
} = require('../dist/workflows/examples/voluvia/ai/register-voluvia-ai-operation');
const { InMemoryOperationRegistry } = require('../dist/workflows/runtime/operation-registry');
const { DeclarativeConditionEvaluator } = require('../dist/workflows/runtime/condition-evaluator');
const { InMemoryWorkflowRunner } = require('../dist/workflows/runtime/workflow-runner');
const { WorkflowState } = require('../dist/workflows/runtime/workflow-state');
const { GraphWorkflowValidator } = require('../dist/workflows/workflow-validator');

function input() {
  return {
    product: {
      title: 'Dress', description: 'Satin dress', color: 'Green', length: 'Maxi',
      price: { amount: 89, currency: 'EUR' }, audience: 'Adults', productKey: 'dress'
    },
    targetLanguage: 'de-DE', targetAudience: 'Erwachsene Kundinnen',
    brandVoice: 'Elegant und klar', contentGoal: 'Das Kleid vorstellen',
    videoLengthTargetSeconds: 30, prohibitedClaims: [],
    requiredProductFacts: ['Satin-Abendkleid']
  };
}

function providerResult() {
  return {
    hook: 'Ein eleganter Auftritt.', body: 'Ein Satin-Abendkleid für besondere Momente.',
    callToAction: 'Entdecke den Look.', caption: 'Ein Satin-Abendkleid.',
    hashtagSuggestions: ['#Voluvia', '#Abendkleid', '#Mode'], language: 'de-DE',
    claimsUsed: ['Satin-Abendkleid'], provider: 'openai', model: 'configured-model',
    responseId: 'resp_safe', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    promptSha256: 'e583c11c7e05ad340c3d16b20865c36f0a4e32e18570724a6a0c3596463f2a38'
  };
}

function runner(client) {
  const registry = new InMemoryOperationRegistry();
  registerVoluviaAiOperation(registry, client);
  let time = 0;
  return new InMemoryWorkflowRunner(
    registry,
    new DeclarativeConditionEvaluator(),
    { now: () => new Date(time++) },
    { next: () => 'ai-execution-1' }
  );
}

test('pilot workflow has exact provider-neutral identity and linear topology while v1 remains unchanged', () => {
  assert.deepEqual(new GraphWorkflowValidator().validate(voluviaTikTokContentAiWorkflow), {
    valid: true, issues: []
  });
  assert.equal(voluviaTikTokContentAiWorkflow.id, 'voluvia.tiktok.content.ai.workflow');
  assert.equal(voluviaTikTokContentAiWorkflow.version, 1);
  assert.deepEqual(voluviaTikTokContentAiWorkflow.steps.map((step) => step.id), [
    'start', 'generate-ai-script', 'finish'
  ]);
  assert.equal(voluviaTikTokContentAiWorkflow.steps[1].operation, VOLUVIA_AI_SCRIPT_OPERATION_ID);
  assert.deepEqual(voluviaTikTokContentAiWorkflow.edges, [
    { id: 'start-to-generate-ai-script', from: 'start', to: 'generate-ai-script' },
    { id: 'generate-ai-script-to-finish', from: 'generate-ai-script', to: 'finish' }
  ]);
  assert.equal(voluviaTikTokContentWorkflow.id, 'voluvia.tiktok.content.workflow');
  assert.equal(voluviaTikTokContentWorkflow.steps.find((step) => step.id === 'generate-script').operation,
    'voluvia.script.generate');
});

test('AI pilot completes with immutable snapshots and no EventBus or Coordinator dependency', async () => {
  const runtime = runner({ generate: async () => providerResult() });
  const initial = runtime.createExecution(voluviaTikTokContentAiWorkflow, input());
  const before = structuredClone(initial);
  const result = await runtime.run(voluviaTikTokContentAiWorkflow, initial);
  assert.equal(result.state, WorkflowState.COMPLETED);
  assert.equal(result.workflowOutput.generation.operationId, VOLUVIA_AI_SCRIPT_OPERATION_ID);
  assert.deepEqual(result.completedSteps, ['start', 'generate-ai-script', 'finish']);
  assert.deepEqual(initial, before);
  assert.notEqual(result, initial);
});

test('AI pilot normalizes operation errors to existing operation_failed without raw provider state', async () => {
  const runtime = runner({ generate: async () => { throw new OpenAiDiagnosticFailure({
    category: 'authentication',
    status: 401,
    sdkErrorName: 'AuthenticationError',
    requestId: 'req_safe_123',
    model: 'configured-model',
    operationId: VOLUVIA_AI_SCRIPT_OPERATION_ID,
    requestAttempted: true
  }); } });
  const result = await runtime.run(
    voluviaTikTokContentAiWorkflow,
    runtime.createExecution(voluviaTikTokContentAiWorkflow, input())
  );
  assert.equal(result.state, WorkflowState.FAILED);
  assert.equal(result.failure.code, 'operation_failed');
  assert.equal(result.failure.operationId, VOLUVIA_AI_SCRIPT_OPERATION_ID);
  assert.equal(JSON.stringify(result).includes('authentication'), false);
  assert.equal(JSON.stringify(result).includes('req_safe_123'), false);
  assert.equal(JSON.stringify(result).includes('configured-model'), false);
  assert.equal(result.completedSteps.includes('generate-ai-script'), false);
});

test('AI pilot persists no output when the client reports a different valid prompt hash', async () => {
  const resultWithWrongHash = {
    ...providerResult(),
    promptSha256: 'a'.repeat(64)
  };
  const runtime = runner({ generate: async () => resultWithWrongHash });
  const result = await runtime.run(
    voluviaTikTokContentAiWorkflow,
    runtime.createExecution(voluviaTikTokContentAiWorkflow, input())
  );
  assert.equal(result.state, WorkflowState.FAILED);
  assert.equal(result.failure.code, 'operation_failed');
  assert.equal(result.workflowOutput, undefined);
  assert.equal(result.completedSteps.includes('generate-ai-script'), false);
});
