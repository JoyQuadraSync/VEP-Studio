const test = require('node:test');
const assert = require('node:assert/strict');
const { voluviaVideoPackageGenerationAiWorkflow, voluviaVideoPackageGenerationAiWorkflowV2 } = require('../dist/workflows/definitions/voluvia-video-package-generation-ai.workflow');
const { registerVoluviaVideoPackageOperation, registerVoluviaVideoPackageV2Operation } = require('../dist/workflows/examples/voluvia/video-package/register-voluvia-video-package-operation');
const { InMemoryOperationRegistry } = require('../dist/workflows/runtime/operation-registry');
const { DeclarativeConditionEvaluator } = require('../dist/workflows/runtime/condition-evaluator');
const { InMemoryWorkflowRunner } = require('../dist/workflows/runtime/workflow-runner');
const { GraphWorkflowValidator } = require('../dist/workflows/workflow-validator');
const { WorkflowState } = require('../dist/workflows/runtime/workflow-state');
const fixture = require('./helpers/voluvia-video-package-fixture');

test('video package workflow has frozen valid linear topology', () => {
  assert.deepEqual(new GraphWorkflowValidator().validate(voluviaVideoPackageGenerationAiWorkflow), { valid: true, issues: [] });
  assert.equal(voluviaVideoPackageGenerationAiWorkflow.id, 'voluvia.video.packagegeneration.ai.workflow');
  assert.deepEqual(voluviaVideoPackageGenerationAiWorkflow.steps.map((step) => step.id), ['start', 'generate-video-package', 'finish']);
  assert.equal(voluviaVideoPackageGenerationAiWorkflow.steps[1].operation, 'voluvia.video.package.generate.ai');
});

test('video package workflow v2 is independently registered to operation v2 while v1 is unchanged', () => {
  assert.deepEqual(new GraphWorkflowValidator().validate(voluviaVideoPackageGenerationAiWorkflowV2), { valid: true, issues: [] });
  assert.equal(voluviaVideoPackageGenerationAiWorkflow.version, 1);
  assert.equal(voluviaVideoPackageGenerationAiWorkflow.steps[1].operation, 'voluvia.video.package.generate.ai');
  assert.equal(voluviaVideoPackageGenerationAiWorkflowV2.id, 'voluvia.video.packagegeneration.ai.workflow');
  assert.equal(voluviaVideoPackageGenerationAiWorkflowV2.version, 2);
  assert.equal(voluviaVideoPackageGenerationAiWorkflowV2.steps[1].operation, 'voluvia.video.package.generate.ai.v2');
});

function runtime(client) {
  const registry = new InMemoryOperationRegistry();
  registerVoluviaVideoPackageOperation(registry, client, { now: () => new Date('2026-08-06T12:00:00.000Z') });
  let time = 0;
  return new InMemoryWorkflowRunner(registry, new DeclarativeConditionEvaluator(), { now: () => new Date(time++) }, { next: () => 'video-package-execution' });
}

function runtimeV2(client) {
  const registry = new InMemoryOperationRegistry();
  registerVoluviaVideoPackageV2Operation(registry, client, { now: () => new Date('2026-08-06T12:00:00.000Z') });
  let time = 0;
  return new InMemoryWorkflowRunner(registry, new DeclarativeConditionEvaluator(),
    { now: () => new Date(time++) }, { next: () => 'video-package-v2-execution' });
}

test('workflow completes technically with a pending immutable package and no downstream action', async () => {
  const runner = runtime({ generatePackageCandidate: async () => fixture.clientResult() }); const value = fixture.input();
  const initial = runner.createExecution(voluviaVideoPackageGenerationAiWorkflow, value); const before = structuredClone(initial);
  const result = await runner.run(voluviaVideoPackageGenerationAiWorkflow, initial);
  assert.equal(result.state, WorkflowState.COMPLETED); assert.equal(result.workflowOutput.packageReviewStatus, 'pending_manual_review');
  assert.equal(result.workflowOutput.safety.manualReviewRequired, true); assert.deepEqual(result.completedSteps, ['start', 'generate-video-package', 'finish']);
  assert.deepEqual(initial, before);
});

test('workflow failure stays generic and retains no provider detail', async () => {
  const runner = runtime({ generatePackageCandidate: async () => { throw new Error('raw provider secret'); } });
  const result = await runner.run(voluviaVideoPackageGenerationAiWorkflow, runner.createExecution(voluviaVideoPackageGenerationAiWorkflow, fixture.input()));
  assert.equal(result.state, WorkflowState.FAILED); assert.equal(result.failure.code, 'operation_failed');
  assert.equal(JSON.stringify(result).includes('raw provider secret'), false); assert.equal(result.completedSteps.includes('generate-video-package'), false);
});

test('workflow v2 completes only through operation v2 and Prompt v5', async () => {
  const runner = runtimeV2({ generatePackageCandidate: async input => {
    assert.deepEqual(input.prompt, { promptId: 'voluvia.video.package-generator.de', promptVersion: 5 });
    return fixture.clientResultV5();
  } });
  const result = await runner.run(voluviaVideoPackageGenerationAiWorkflowV2,
    runner.createExecution(voluviaVideoPackageGenerationAiWorkflowV2, fixture.input()));
  assert.equal(result.state, WorkflowState.COMPLETED);
  assert.equal(result.workflowOutput.operationId, 'voluvia.video.package.generate.ai.v2');
  assert.equal(result.workflowOutput.provenance.promptVersion, 5);
  assert.equal(result.workflowOutput.schemaVersion, 1);
});
