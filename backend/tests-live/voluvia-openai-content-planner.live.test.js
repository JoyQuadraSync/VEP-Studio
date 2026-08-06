const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPlannerLiveFailure } = require('./voluvia-planner-live-diagnostic');

const liveEnabled = process.env.OPENAI_LIVE_TEST === 'true';

// Explicit opt-in only. This test makes exactly one billable provider request.
// VEP Studio does not load .env files. Configure OPENAI_API_KEY, OPENAI_MODEL,
// and OPENAI_LIVE_TEST=true in the process that launches this one test file.
// Every returned plan requires manual semantic review.
test('Voluvia OpenAI content planner through the operation boundary', {
  skip: !liveEnabled
}, async () => {
  const { loadOpenAiConfig } = require('../dist/config/openai.config');
  const { StaticPromptCatalog } = require('../dist/prompts/prompt-catalog');
  const {
    OpenAiPlanningDiagnosticFailure,
    OpenAiResponsesContentPlanningClient
  } = require('../dist/integrations/openai/openai-responses-content-planning-client');
  const contracts = require(
    '../dist/workflows/examples/voluvia/planner/voluvia-content-planner-contracts'
  );
  const {
    createVoluviaContentPlanOperation
  } = require('../dist/workflows/examples/voluvia/planner/voluvia-content-plan.operation');

  let providerCalls = 0;
  let safeDiagnostic;
  let localValidationDiagnostic;
  let configuredModel;
  try {
    const config = loadOpenAiConfig();
    configuredModel = config.model;
    const realClient = new OpenAiResponsesContentPlanningClient(
      config,
      new StaticPromptCatalog()
    );
  const countedClient = {
    generatePlan: async (request) => {
      providerCalls += 1;
      if (providerCalls !== 1) throw new Error('A second provider request was blocked.');
      try {
        return await realClient.generatePlan(request);
      } catch (error) {
        if (error instanceof OpenAiPlanningDiagnosticFailure) {
          safeDiagnostic = error.diagnostic;
        }
        throw error;
      }
    }
  };
  const operation = createVoluviaContentPlanOperation(
    countedClient,
    (diagnostic) => { localValidationDiagnostic = diagnostic; }
  );

  const approvedFacts = contracts.APPROVED_PRODUCT_FACT_IDS.map((factId) => ({
    factId,
    displayValue: contracts.APPROVED_PRODUCT_FACT_VALUES[factId]
  }));
  const plannerInput = {
    product: {
      productKey: 'voluvia-remy-hair-topper',
      name: 'Remy Echthaar Hair Topper',
      category: 'hair-topper',
      material: '100% Remy Echthaar',
      hairType: 'human-hair',
      lengthCm: 32,
      colors: ['honig-blond', 'hell-blond', 'mittel-braun'],
      base: 'lightweight-hand-knotted-lace',
      clipCount: 3,
      price: { amount: 49, currency: 'EUR' },
      shipsFrom: 'Germany'
    },
    approvedProductFacts: approvedFacts,
    approvedSellingPoints: [...contracts.CONTENT_FOCUSES],
    forbiddenClaims: [
      'hair regrowth',
      'treatment of hair loss',
      'medical certification',
      'permanent effect',
      '100% guarantee',
      'clinically proven',
      'stops hair loss'
    ],
    targetCustomer: {
      gender: 'women',
      concerns: [...contracts.AUDIENCE_CONCERNS]
    },
    brand: {
      mission: contracts.VOLUVIA_BRAND_MISSION,
      promise: contracts.VOLUVIA_BRAND_PROMISE,
      tone: [...contracts.BRAND_TONES],
      prohibitedTone: [...contracts.PROHIBITED_TONES]
    },
    contentGoal: 'product-awareness',
    targetPlatform: 'TikTok',
    targetLanguage: 'de-DE',
    preferredVideoDurationSeconds: 30,
    plannerControls: {
      preferredContentAngle: 'education',
      preferredContentFocus: 'what-is-a-hair-topper',
      excludedRecentlyUsedAngles: [],
      excludedRecentlyUsedFocuses: [],
      priceMayBeFeatured: false,
      shippingMayBeFeatured: false,
      realBeforeAfterEvidenceAvailable: false
    }
  };

    const result = await operation({
      executionId: 'voluvia-content-planner-live',
      workflowId: contracts.VOLUVIA_CONTENT_PLANNER_WORKFLOW_ID,
      workflowVersion: contracts.VOLUVIA_CONTENT_PLANNER_WORKFLOW_VERSION,
      stepId: 'generate-content-plan',
      workflowInput: plannerInput,
      stepInput: plannerInput
    });

  assert.equal(providerCalls, 1);
  assert.equal(result.reviewStatus, 'pending_manual_review');
  assert.equal(result.plan.brandSafety.manualReviewRequired, true);
  assert.equal(result.plan.strategy.contentFocus, 'what-is-a-hair-topper');
  assert.equal(result.plan.strategy.contentAngle, 'education');
  assert.equal(result.plan.brandSafety.approvedFacts.some(
    (fact) => fact.factId === 'price-49-eur'), false);
  assert.equal(result.plan.brandSafety.approvedFacts.some(
    (fact) => fact.factId === 'ships-from-germany'), false);
  assert.equal(result.plan.production.suggestedScenes.some(
    (scene) => scene.includes('-before-') || scene.includes('-after-')), false);

  const serialized = JSON.stringify(result).toLocaleLowerCase('de-DE');
  assert.equal(/\b49\b|\bprice\b|\bpreis\b|price-49-eur/u.test(serialized), false);
  assert.equal(/\bshipping\b|\bships\b|\bversand\b|ships-from-germany/u.test(serialized), false);
  assert.equal(/\bdelivery\b|\bliefer(?:ung|zeit)\b|within-one-week/u.test(serialized), false);

  process.stdout.write(`${JSON.stringify({
    success: true,
    providerRequestCount: providerCalls,
    requestId: result.generation.responseId,
    provider: result.generation.provider,
    actualModel: result.generation.model,
    tokenCounts: {
      input: result.generation.inputTokens,
      output: result.generation.outputTokens,
      total: result.generation.totalTokens
    },
    validatedPlan: {
      audience: result.plan.audience,
      strategy: result.plan.strategy,
      production: result.plan.production
    },
    reviewStatus: result.reviewStatus,
    brandSafety: result.plan.brandSafety,
    disabledCommerceFacts: {
      priceAbsent: true,
      shippingAbsent: true,
      deliveryClaimAbsent: true
    }
  })}\n`);
  } catch {
    process.stdout.write(`${formatPlannerLiveFailure({
      providerCalls,
      safeDiagnostic,
      localValidationDiagnostic,
      operationId: contracts.VOLUVIA_CONTENT_PLAN_OPERATION_ID,
      configuredModel
    })}\n`);
    process.exitCode = 1;
  }
});
