const test = require('node:test');
const assert = require('node:assert/strict');
const { voluviaVideoPackageGenerationAiWorkflow } = require('../dist/workflows/definitions/voluvia-video-package-generation-ai.workflow');
const { registerVoluviaVideoPackageOperation } = require('../dist/workflows/examples/voluvia/video-package/register-voluvia-video-package-operation');
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

function runtime(client) {
  const registry = new InMemoryOperationRegistry();
  registerVoluviaVideoPackageOperation(registry, client, { now: () => new Date('2026-08-06T12:00:00.000Z') });
  let time = 0;
  return new InMemoryWorkflowRunner(registry, new DeclarativeConditionEvaluator(), { now: () => new Date(time++) }, { next: () => 'video-package-execution' });
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
