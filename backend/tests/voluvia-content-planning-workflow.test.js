const test = require('node:test');
const assert = require('node:assert/strict');

const {
  voluviaTikTokContentPlanningAiWorkflow
} = require('../dist/workflows/definitions/voluvia-tiktok-content-planning-ai.workflow');
const contracts = require('../dist/workflows/examples/voluvia/planner/voluvia-content-planner-contracts');
const prompt = require('../dist/prompts/voluvia/de/content-planner-v2.prompt');
const {
  registerVoluviaContentPlannerOperation
} = require('../dist/workflows/examples/voluvia/planner/register-voluvia-content-planner-operation');
const { InMemoryOperationRegistry } = require('../dist/workflows/runtime/operation-registry');
const { DeclarativeConditionEvaluator } = require('../dist/workflows/runtime/condition-evaluator');
const { InMemoryWorkflowRunner } = require('../dist/workflows/runtime/workflow-runner');
const { WorkflowState } = require('../dist/workflows/runtime/workflow-state');
const { GraphWorkflowValidator } = require('../dist/workflows/workflow-validator');

function workflowInput() {
  return {
    product: {
      productKey: 'voluvia-remy-hair-topper', name: 'Remy Echthaar Hair Topper',
      category: 'hair-topper', material: '100% Remy Echthaar', hairType: 'human-hair',
      lengthCm: 32, colors: ['honig-blond', 'hell-blond', 'mittel-braun'],
      base: 'lightweight-hand-knotted-lace', clipCount: 3,
      price: { amount: 49, currency: 'EUR' }, shipsFrom: 'Germany'
    },
    approvedProductFacts: contracts.APPROVED_PRODUCT_FACT_IDS.map((factId) => ({
      factId, displayValue: contracts.APPROVED_PRODUCT_FACT_VALUES[factId]
    })),
    approvedSellingPoints: [...contracts.CONTENT_FOCUSES],
    forbiddenClaims: ['hair regrowth'],
    targetCustomer: { gender: 'women', concerns: [...contracts.AUDIENCE_CONCERNS] },
    brand: {
      mission: contracts.VOLUVIA_BRAND_MISSION, promise: contracts.VOLUVIA_BRAND_PROMISE,
      tone: [...contracts.BRAND_TONES], prohibitedTone: [...contracts.PROHIBITED_TONES]
    },
    contentGoal: 'product-education', targetPlatform: 'TikTok', targetLanguage: 'de-DE',
    preferredVideoDurationSeconds: 30,
    plannerControls: {
      preferredContentAngle: 'education', preferredContentFocus: 'what-is-a-hair-topper',
      excludedRecentlyUsedAngles: [], excludedRecentlyUsedFocuses: [],
      priceMayBeFeatured: false, shippingMayBeFeatured: false,
      realBeforeAfterEvidenceAvailable: false
    }
  };
}

function providerResult() {
  return {
    candidate: {
      audience: { gender: 'women', primaryConcern: 'hair-topper-unawareness', awarenessLevel: 'unaware' },
      strategy: {
        primaryProblem: 'hair-topper-unawareness', purchaseTrigger: 'alternative-to-full-wig',
        contentFocus: 'what-is-a-hair-topper', contentAngle: 'education',
        emotionalGoal: 'product-awareness', desiredAction: 'learn-more'
      },
      production: {
        recommendedVideoStyle: 'educational-explainer', recommendedHookStrategy: 'common-question',
        targetDurationSeconds: 30, visualProofRequired: false,
        suggestedScenes: ['product-close-up', 'lace-base-close-up']
      }
    },
    provider: 'fake', model: 'offline-model', responseId: 'offline-response',
    inputTokens: 1, outputTokens: 2, totalTokens: 3,
    promptId: contracts.VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptId,
    promptVersion: contracts.VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptVersion,
    promptContentHash: prompt.VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256
  };
}

function runner(client) {
  const registry = new InMemoryOperationRegistry();
  registerVoluviaContentPlannerOperation(registry, client);
  let time = 0;
  return new InMemoryWorkflowRunner(registry, new DeclarativeConditionEvaluator(),
    { now: () => new Date(time++) }, { next: () => 'planner-execution' });
}

test('planner workflow has exact frozen identity and linear topology', () => {
  assert.deepEqual(new GraphWorkflowValidator().validate(voluviaTikTokContentPlanningAiWorkflow),
    { valid: true, issues: [] });
  assert.equal(voluviaTikTokContentPlanningAiWorkflow.id,
    'voluvia.tiktok.contentplanning.ai.workflow');
  assert.equal(voluviaTikTokContentPlanningAiWorkflow.version, 1);
  assert.deepEqual(voluviaTikTokContentPlanningAiWorkflow.steps.map((step) => step.id),
    ['start', 'generate-content-plan', 'finish']);
  assert.equal(voluviaTikTokContentPlanningAiWorkflow.steps[1].operation,
    'voluvia.content.plan.ai');
  assert.deepEqual(voluviaTikTokContentPlanningAiWorkflow.edges, [
    { id: 'start-to-generate-content-plan', from: 'start', to: 'generate-content-plan' },
    { id: 'generate-content-plan-to-finish', from: 'generate-content-plan', to: 'finish' }
  ]);
});

test('planner workflow completes technically with pending manual review and immutable snapshots', async () => {
  const input = workflowInput();
  const initial = runner({ generatePlan: async () => providerResult() })
    .createExecution(voluviaTikTokContentPlanningAiWorkflow, input);
  const before = structuredClone(initial);
  const runtime = runner({ generatePlan: async () => providerResult() });
  const execution = await runtime.run(voluviaTikTokContentPlanningAiWorkflow, initial);
  assert.equal(execution.state, WorkflowState.COMPLETED);
  assert.equal(execution.workflowOutput.reviewStatus, 'pending_manual_review');
  assert.equal(execution.workflowOutput.plan.brandSafety.manualReviewRequired, true);
  assert.deepEqual(execution.completedSteps, ['start', 'generate-content-plan', 'finish']);
  assert.deepEqual(initial, before);
});

test('planner failures retain the existing generic operation_failed workflow boundary', async () => {
  const runtime = runner({ generatePlan: async () => { throw new Error('raw provider detail'); } });
  const execution = await runtime.run(
    voluviaTikTokContentPlanningAiWorkflow,
    runtime.createExecution(voluviaTikTokContentPlanningAiWorkflow, workflowInput())
  );
  assert.equal(execution.state, WorkflowState.FAILED);
  assert.equal(execution.failure.code, 'operation_failed');
  assert.equal(JSON.stringify(execution).includes('raw provider detail'), false);
  assert.equal(execution.workflowOutput, undefined);
  assert.equal(execution.completedSteps.includes('generate-content-plan'), false);
});
