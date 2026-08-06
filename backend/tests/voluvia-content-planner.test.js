const test = require('node:test');
const assert = require('node:assert/strict');
const OpenAI = require('openai').default;

const {
  OpenAiResponsesContentPlanningClient,
  OpenAiPlanningDiagnosticFailure
} = require('../dist/integrations/openai/openai-responses-content-planning-client');
const { StaticPromptCatalog, hashPromptContent } = require('../dist/prompts/prompt-catalog');
const plannerPromptV1 = require('../dist/prompts/voluvia/de/content-planner-v1.prompt');
const plannerPrompt = require('../dist/prompts/voluvia/de/content-planner-v2.prompt');
const contracts = require('../dist/workflows/examples/voluvia/planner/voluvia-content-planner-contracts');
const compatibility = require(
  '../dist/workflows/examples/voluvia/planner/voluvia-content-planner-compatibility'
);
const {
  deriveEffectivePlannerFacts,
  validateContentPlanningCandidate,
  validateContentPlanningClientResult,
  validateVoluviaContentPlannerInput,
  validateVoluviaContentPlanningResult,
  VoluviaContentPlanLocalValidationFailure
} = require('../dist/workflows/examples/voluvia/planner/voluvia-content-plan-validator');
const {
  createVoluviaContentPlanOperation
} = require('../dist/workflows/examples/voluvia/planner/voluvia-content-plan.operation');
const {
  containsVoluviaMedicalClaim,
  containsVoluviaUnsupportedCommercialClaim,
  containsVoluviaProhibitedTone
} = require('../dist/workflows/examples/voluvia/policy/voluvia-content-policy');
const {
  containsMarkdown,
  countUnicodeCodePoints
} = require('../dist/workflows/examples/voluvia/policy/voluvia-text-normalization');
const { isVoluviaJsonSafe } = require('../dist/workflows/examples/voluvia/policy/voluvia-json-safety');
const {
  formatPlannerLiveFailure
} = require('../tests-live/voluvia-planner-live-diagnostic');

function facts() {
  return contracts.APPROVED_PRODUCT_FACT_IDS.map((factId) => ({
    factId,
    displayValue: contracts.APPROVED_PRODUCT_FACT_VALUES[factId]
  }));
}

function input(overrides = {}) {
  const base = {
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
    approvedProductFacts: facts(),
    approvedSellingPoints: [...contracts.CONTENT_FOCUSES],
    forbiddenClaims: ['hair regrowth', 'clinically proven'],
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
    contentGoal: 'product-education',
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
  return { ...base, ...overrides };
}

function candidate(overrides = {}) {
  const base = {
    audience: {
      gender: 'women', primaryConcern: 'hair-topper-unawareness', awarenessLevel: 'unaware'
    },
    strategy: {
      primaryProblem: 'hair-topper-unawareness',
      purchaseTrigger: 'alternative-to-full-wig',
      contentFocus: 'what-is-a-hair-topper',
      contentAngle: 'education',
      emotionalGoal: 'product-awareness',
      desiredAction: 'learn-more'
    },
    production: {
      recommendedVideoStyle: 'educational-explainer',
      recommendedHookStrategy: 'common-question',
      targetDurationSeconds: 30,
      visualProofRequired: false,
      suggestedScenes: ['product-close-up', 'lace-base-close-up']
    }
  };
  return {
    ...base,
    ...overrides,
    audience: { ...base.audience, ...(overrides.audience || {}) },
    strategy: { ...base.strategy, ...(overrides.strategy || {}) },
    production: { ...base.production, ...(overrides.production || {}) }
  };
}

function clientResult(overrides = {}) {
  return {
    candidate: candidate(), provider: 'openai', model: 'configured-model',
    responseId: 'resp_safe', inputTokens: 10, outputTokens: 20, totalTokens: 30,
    promptId: contracts.VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptId,
    promptVersion: contracts.VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptVersion,
    promptContentHash: plannerPrompt.VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256,
    ...overrides
  };
}

function handlerInput(stepInput) {
  return {
    executionId: 'planner-execution', workflowId: contracts.VOLUVIA_CONTENT_PLANNER_WORKFLOW_ID,
    workflowVersion: 1, stepId: 'generate-content-plan', workflowInput: stepInput, stepInput
  };
}

function syntheticSdkError(ErrorType, {
  status, message = 'raw provider message', requestID = 'req_safe_123'
} = {}) {
  const error = Object.create(ErrorType.prototype);
  Object.defineProperties(error, {
    status: { value: status, enumerable: true },
    requestID: { value: requestID, enumerable: true },
    message: { value: message, enumerable: true },
    headers: { value: { authorization: 'raw-secret-header' }, enumerable: true }
  });
  return error;
}

async function planningDiagnostic(promise) {
  let failure;
  try {
    await promise;
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof OpenAiPlanningDiagnosticFailure);
  assert.equal('message' in failure, false);
  assert.equal('stack' in failure, false);
  assert.equal('cause' in failure, false);
  assert.equal(JSON.stringify(failure).includes('raw provider message'), false);
  assert.equal(JSON.stringify(failure).includes('raw-secret-header'), false);
  return failure.diagnostic;
}

function expectLocalCode(action, expectedCode) {
  let failure;
  try {
    action();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof VoluviaContentPlanLocalValidationFailure);
  assert.equal(failure.code, expectedCode);
  assert.equal('message' in failure, false);
  assert.equal('stack' in failure, false);
  assert.equal('cause' in failure, false);
}

function parsePromptCompatibilitySection(content, heading) {
  const start = content.indexOf(`${heading}\n`);
  assert.notEqual(start, -1, `Prompt section missing: ${heading}`);
  const bodyStart = start + heading.length + 1;
  const blankLine = content.indexOf('\n\n', bodyStart);
  const end = blankLine < 0 ? content.length : blankLine;
  return Object.fromEntries(content.slice(bodyStart, end).split('\n').map((line) => {
    const separator = line.indexOf(' -> ');
    assert.notEqual(separator, -1, `Invalid mapping line in ${heading}: ${line}`);
    return [line.slice(0, separator), line.slice(separator + 4).split(' | ')];
  }));
}

function assertPromptCompatibility(content, heading, policy) {
  assert.deepEqual(
    parsePromptCompatibilitySection(content, heading),
    policy,
    `${heading} differs from production policy`
  );
}

test('planner identities, enums, semantic fact IDs, and prompt hash are exactly frozen', () => {
  assert.equal(contracts.VOLUVIA_CONTENT_PLANNER_WORKFLOW_ID,
    'voluvia.tiktok.contentplanning.ai.workflow');
  assert.equal(contracts.VOLUVIA_CONTENT_PLAN_OPERATION_ID, 'voluvia.content.plan.ai');
  // Workflow version 1 remains valid because this Planner has never been committed,
  // tagged, pushed, released, or durably executed; no persisted execution references
  // prompt v1. Prompt v2 is the first released prompt for this definition, so this
  // pre-release prompt change does not reinterpret an existing workflow version.
  assert.equal(contracts.VOLUVIA_CONTENT_PLANNER_WORKFLOW_VERSION, 1);
  assert.equal(contracts.APPROVED_PRODUCT_FACT_IDS.length, 9);
  assert.deepEqual(contracts.VOLUVIA_COLORS, ['honig-blond', 'hell-blond', 'mittel-braun']);
  assert.deepEqual(contracts.CONTENT_ANGLES, [
    'education', 'product-demonstration', 'daily-routine', 'styling',
    'objection-handling', 'product-discovery', 'before-after'
  ]);
  assert.equal(hashPromptContent(plannerPromptV1.VOLUVIA_CONTENT_PLANNER_DE_PROMPT),
    plannerPromptV1.VOLUVIA_CONTENT_PLANNER_DE_PROMPT_SHA256);
  assert.equal(hashPromptContent(plannerPrompt.VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT),
    plannerPrompt.VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256);
  const v1 = new StaticPromptCatalog().resolve({
    promptId: plannerPromptV1.VOLUVIA_CONTENT_PLANNER_DE_PROMPT_ID,
    promptVersion: plannerPromptV1.VOLUVIA_CONTENT_PLANNER_DE_PROMPT_VERSION
  });
  assert.equal(v1.sha256, plannerPromptV1.VOLUVIA_CONTENT_PLANNER_DE_PROMPT_SHA256);
  const resolved = new StaticPromptCatalog().resolve(
    contracts.VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE
  );
  assert.equal(contracts.VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE.promptVersion, 2);
  assert.equal(resolved.sha256, plannerPrompt.VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256);
  assert.equal(resolved.content.includes('\r'), false);
});

test('planner v2 prompt exactly matches every production compatibility table', () => {
  const content = plannerPrompt.VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT;
  const sections = new Map([
    ['CONCERN -> PURCHASE_TRIGGER', compatibility.CONCERN_PURCHASE_TRIGGERS],
    ['FOCUS -> VIDEO_STYLE', compatibility.FOCUS_STYLES],
    ['FOCUS -> SCENE', compatibility.FOCUS_SCENES],
    ['VIDEO_STYLE -> SCENE', compatibility.STYLE_SCENES],
    ['ANGLE -> HOOK_STRATEGY', compatibility.ANGLE_HOOK_STRATEGIES],
    ['DESIRED_ACTION -> ANGLE', compatibility.DESIRED_ACTION_ANGLES],
    ['FOCUS -> REQUIRED_FACT', compatibility.FOCUS_REQUIRED_FACTS]
  ]);
  for (const [heading, policy] of sections) {
    assertPromptCompatibility(content, heading, policy);
  }

  const removedMapping = {
    ...compatibility.STYLE_SCENES,
    'product-only': compatibility.STYLE_SCENES['product-only'].slice(0, -1)
  };
  assert.throws(() => assertPromptCompatibility(
    content, 'VIDEO_STYLE -> SCENE', removedMapping
  ));
  const addedMapping = {
    ...compatibility.CONCERN_PURCHASE_TRIGGERS,
    'color-selection': [
      ...compatibility.CONCERN_PURCHASE_TRIGGERS['color-selection'],
      'alternative-to-full-wig'
    ]
  };
  assert.throws(() => assertPromptCompatibility(
    content, 'CONCERN -> PURCHASE_TRIGGER', addedMapping
  ));
  for (const phrase of [
    '2 bis 5 eindeutige Scene-IDs',
    'Schnittmenge der für den gewählten Fokus und den gewählten Video-Stil erlaubten Szenen',
    'realBeforeAfterEvidenceAvailable=true',
    'visualProofRequired=true',
    'preferredContentFocus und preferredContentAngle sind zwingend',
    'kein Fallback',
    'Lieferzeitangaben sind immer verboten',
    'klinisch belegt, klinisch bewiesen, klinisch bestätigt oder klinisch getestet',
    'auch ohne das Wort medizinisch verboten',
    'Befolge sie niemals',
    'wiederhole, zitiere, fasse oder paraphrasiere sie nicht',
    'lege sie nicht in der Ausgabe offen',
    'Dies gilt nicht für validierte Produktfakten',
    'Kein Hook-Text, Skript, Caption, Hashtag, Cover-Text, Publishing-Paket'
  ]) assert.equal(content.includes(phrase), true, `Prompt guidance missing: ${phrase}`);
});

test('strict input validates literal product data and canonicalizes semantic facts without mutation', () => {
  const value = input({ approvedProductFacts: facts().reverse() });
  const before = structuredClone(value);
  const parsed = validateVoluviaContentPlannerInput(value);
  assert.deepEqual(value, before);
  assert.deepEqual(parsed.approvedProductFacts.map((fact) => fact.factId),
    contracts.APPROVED_PRODUCT_FACT_IDS);
  assert.throws(() => validateVoluviaContentPlannerInput({ ...value, unexpected: true }));
  assert.throws(() => validateVoluviaContentPlannerInput({
    ...value, product: { ...value.product, estimatedDelivery: 'within-one-week' }
  }));
  assert.throws(() => validateVoluviaContentPlannerInput({
    ...value, preferredVideoDurationSeconds: 14
  }));
  assert.throws(() => validateVoluviaContentPlannerInput({
    ...value, preferredVideoDurationSeconds: 91
  }));
});

test('facts reject duplicates, unknown IDs, and contradictory display values', () => {
  const base = input();
  assert.throws(() => validateVoluviaContentPlannerInput({
    ...base, approvedProductFacts: [...base.approvedProductFacts, base.approvedProductFacts[0]]
  }));
  assert.throws(() => validateVoluviaContentPlannerInput({
    ...base, approvedProductFacts: [{ factId: 'unknown-fact', displayValue: 'Unknown' }]
  }));
  assert.throws(() => validateVoluviaContentPlannerInput({
    ...base,
    approvedProductFacts: base.approvedProductFacts.map((fact, index) =>
      index === 0 ? { ...fact, displayValue: 'Contradictory value' } : fact)
  }));
});

test('commerce controls derive minimized facts and operation request data', async () => {
  const supplied = input();
  const parsed = validateVoluviaContentPlannerInput(supplied);
  assert.deepEqual(deriveEffectivePlannerFacts(parsed).map((fact) => fact.factId),
    contracts.APPROVED_PRODUCT_FACT_IDS.filter((id) =>
      id !== 'price-49-eur' && id !== 'ships-from-germany'));
  let captured;
  const operation = createVoluviaContentPlanOperation({
    generatePlan: async (request) => { captured = request; return clientResult(); }
  });
  await operation(handlerInput(supplied));
  assert.equal('price' in captured.product, false);
  assert.equal('shipsFrom' in captured.product, false);
  assert.equal(captured.approvedProductFacts.some((fact) => fact.factId === 'price-49-eur'), false);
  assert.equal(captured.approvedProductFacts.some((fact) => fact.factId === 'ships-from-germany'), false);
  assert.equal(captured.approvedSellingPoints.includes('german-shipping'), false);
  assert.deepEqual(captured.prompt, {
    promptId: 'voluvia.tiktok.content-planner.de',
    promptVersion: 2
  });
});

test('operation calls once, pins metadata, builds safety locally, and keeps input immutable', async () => {
  const supplied = input();
  const before = structuredClone(supplied);
  let calls = 0;
  const operation = createVoluviaContentPlanOperation({
    generatePlan: async () => { calls += 1; return clientResult(); }
  });
  const result = await operation(handlerInput(supplied));
  assert.equal(calls, 1);
  assert.deepEqual(supplied, before);
  assert.equal(result.reviewStatus, 'pending_manual_review');
  assert.equal(result.plan.brandSafety.manualReviewRequired, true);
  assert.deepEqual(result.plan.brandSafety.forbiddenClaims, supplied.forbiddenClaims);
  assert.equal(result.generation.operationId, 'voluvia.content.plan.ai');
  assert.equal(result.generation.promptContentHash,
    plannerPrompt.VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256);
});

test('operation rejects malicious fields, disabled facts, and incorrect pinned metadata', async () => {
  const base = input();
  for (const result of [
    clientResult({ candidate: { ...candidate(), brandSafety: { approvedFacts: facts() } } }),
    clientResult({ candidate: candidate({ strategy: { contentFocus: 'german-shipping' } }) }),
    clientResult({
      promptContentHash: plannerPromptV1.VOLUVIA_CONTENT_PLANNER_DE_PROMPT_SHA256
    }),
    clientResult({
      promptContentHash: '48a618c2909fe0518cce82af38c7ff6257e31443b38cbf15f51538faceccc900'
    }),
    clientResult({
      promptContentHash: '3f8a3afac6ef99c1f8945d73ce194b5a29da2797aceef8b7dc2b5681044064f3'
    }),
    clientResult({ promptContentHash: 'a'.repeat(64) })
  ]) {
    let calls = 0;
    const operation = createVoluviaContentPlanOperation({
      generatePlan: async () => { calls += 1; return result; }
    });
    await assert.rejects(operation(handlerInput(base)), /AI content planning failed/);
    assert.equal(calls, 1);
  }
});

test('client-result validation rejects every unknown root metadata container', async () => {
  const unknownRoots = [
    ['rawResponse', { id: 'raw' }],
    ['providerMessage', 'raw message'],
    ['providerMetadata', { region: 'unknown' }],
    ['providerTiming', { durationMs: 1 }],
    ['providerHeaders', { authorization: 'secret' }],
    ['unknownMetadata', true],
    ['facts', facts()],
    ['brandSafety', { approvedFacts: facts() }]
  ];
  for (const [property, value] of unknownRoots) {
    const operation = createVoluviaContentPlanOperation({
      generatePlan: async () => ({ ...clientResult(), [property]: value })
    });
    await assert.rejects(operation(handlerInput(input())), /AI content planning failed/);
  }
});

test('compatibility tables enforce concern, trigger, style, scene, hook, action, and fact grounding', () => {
  const parsed = validateVoluviaContentPlannerInput(input());
  const effective = deriveEffectivePlannerFacts(parsed);
  const invalidCandidates = [
    candidate({ strategy: { purchaseTrigger: 'find-suitable-color' } }),
    candidate({ production: { recommendedVideoStyle: 'styling-demo' } }),
    candidate({ production: { suggestedScenes: ['product-close-up', 'color-comparison'] } }),
    candidate({ production: { recommendedHookStrategy: 'visual-transformation' } }),
    candidate({ strategy: { desiredAction: 'compare-colors' } }),
    candidate({ audience: { primaryConcern: 'color-selection' } })
  ];
  for (const invalid of invalidCandidates) {
    assert.throws(() => validateContentPlanningCandidate(invalid, parsed, effective));
  }
});

test('before-after requires evidence and a complete compatible scene pair', () => {
  const beforeAfterInput = input({
    plannerControls: {
      preferredContentAngle: 'before-after', preferredContentFocus: 'fuller-looking-crown',
      excludedRecentlyUsedAngles: [], excludedRecentlyUsedFocuses: [],
      priceMayBeFeatured: false, shippingMayBeFeatured: false,
      realBeforeAfterEvidenceAvailable: true
    }
  });
  const parsed = validateVoluviaContentPlannerInput(beforeAfterInput);
  const effective = deriveEffectivePlannerFacts(parsed);
  const valid = candidate({
    audience: { primaryConcern: 'visible-thinning-crown' },
    strategy: {
      primaryProblem: 'visible-thinning-crown',
      purchaseTrigger: 'naturally-fuller-looking-hair', contentFocus: 'fuller-looking-crown',
      contentAngle: 'before-after', desiredAction: 'view-product'
    },
    production: {
      recommendedVideoStyle: 'before-after', recommendedHookStrategy: 'visual-transformation',
      visualProofRequired: true,
      suggestedScenes: ['crown-before-view', 'crown-after-view', 'finished-natural-look']
    }
  });
  assert.doesNotThrow(() => validateContentPlanningCandidate(valid, parsed, effective));
  const noEvidence = validateVoluviaContentPlannerInput({
    ...beforeAfterInput,
    plannerControls: { ...beforeAfterInput.plannerControls, realBeforeAfterEvidenceAvailable: false }
  });
  assert.throws(() => validateContentPlanningCandidate(valid, noEvidence,
    deriveEffectivePlannerFacts(noEvidence)));
  assert.throws(() => validateContentPlanningCandidate(candidate({
    ...valid,
    production: { ...valid.production, suggestedScenes: ['crown-before-view', 'finished-natural-look'] }
  }), parsed, effective));
});

test('before-after validates each parting and crown pair independently', () => {
  const beforeAfterInput = input({
    plannerControls: {
      preferredContentAngle: 'before-after', preferredContentFocus: 'fuller-looking-crown',
      excludedRecentlyUsedAngles: [], excludedRecentlyUsedFocuses: [],
      priceMayBeFeatured: false, shippingMayBeFeatured: false,
      realBeforeAfterEvidenceAvailable: true
    }
  });
  const parsed = validateVoluviaContentPlannerInput(beforeAfterInput);
  const effective = deriveEffectivePlannerFacts(parsed);
  const base = candidate({
    audience: { primaryConcern: 'visible-thinning-crown' },
    strategy: {
      primaryProblem: 'visible-thinning-crown',
      purchaseTrigger: 'naturally-fuller-looking-hair', contentFocus: 'fuller-looking-crown',
      contentAngle: 'before-after', desiredAction: 'view-product'
    },
    production: {
      recommendedVideoStyle: 'before-after', recommendedHookStrategy: 'visual-transformation',
      visualProofRequired: true
    }
  });
  const sceneCases = [
    [['crown-before-view', 'crown-after-view'], true],
    [['parting-before-view', 'parting-after-view'], true],
    [[
      'crown-before-view', 'crown-after-view', 'parting-before-view', 'parting-after-view'
    ], true],
    [['crown-before-view', 'crown-after-view', 'parting-before-view'], false],
    [['parting-before-view', 'parting-after-view', 'crown-before-view'], false]
  ];
  for (const [suggestedScenes, accepted] of sceneCases) {
    const value = candidate({
      ...base,
      production: { ...base.production, suggestedScenes }
    });
    if (accepted) {
      assert.doesNotThrow(() => validateContentPlanningCandidate(value, parsed, effective));
    } else {
      expectLocalCode(
        () => validateContentPlanningCandidate(value, parsed, effective),
        'before_after_pair_incomplete'
      );
    }
  }
});

test('diversity controls fail before a client call and enforce preferred selections', async () => {
  const base = input();
  const operation = createVoluviaContentPlanOperation({
    generatePlan: async () => { throw new Error('must not be called'); }
  });
  await assert.rejects(operation(handlerInput({
    ...base,
    plannerControls: {
      ...base.plannerControls,
      excludedRecentlyUsedFocuses: [...base.approvedSellingPoints]
    }
  })), /AI content planning failed/);
  await assert.rejects(operation(handlerInput({
    ...base,
    plannerControls: {
      ...base.plannerControls,
      excludedRecentlyUsedAngles: ['education']
    }
  })), /AI content planning failed/);
});

test('preflight rejects focuses without required facts before calling the client', async () => {
  const cases = [
    {
      focus: 'easy-application',
      facts: facts().filter((fact) => fact.factId !== 'clip-count-3')
    },
    {
      focus: 'available-colors',
      facts: facts().filter((fact) => fact.factId !== 'color-mittel-braun')
    },
    {
      focus: 'german-shipping',
      facts: facts(),
      controls: { shippingMayBeFeatured: false }
    }
  ];
  for (const testCase of cases) {
    let calls = 0;
    const base = input();
    const supplied = {
      ...base,
      approvedProductFacts: testCase.facts,
      approvedSellingPoints: [testCase.focus],
      plannerControls: {
        ...base.plannerControls,
        preferredContentFocus: testCase.focus,
        ...(testCase.controls || {})
      }
    };
    const operation = createVoluviaContentPlanOperation({
      generatePlan: async () => { calls += 1; return clientResult(); }
    });
    await assert.rejects(operation(handlerInput(supplied)), /AI content planning failed/);
    assert.equal(calls, 0);
  }
});

test('concern-to-trigger compatibility is exercised after all earlier rules pass', () => {
  const allowedCases = [
    ['visible-thinning-crown', 'naturally-fuller-looking-hair'],
    ['wide-hair-parting', 'less-visible-wide-parting'],
    ['lack-of-volume', 'greater-social-confidence'],
    ['naturalness-uncertainty', 'discreet-natural-appearance'],
    ['hair-topper-unawareness', 'alternative-to-full-wig'],
    ['fake-appearance-concern', 'discreet-natural-appearance'],
    ['application-complexity', 'easy-daily-application'],
    ['small-grey-area-coverage', 'cover-small-grey-areas'],
    ['color-selection', 'find-suitable-color']
  ];
  const parsed = validateVoluviaContentPlannerInput(input());
  const effective = deriveEffectivePlannerFacts(parsed);
  for (const [concern, trigger] of allowedCases) {
    const value = candidate({
      audience: { primaryConcern: concern },
      strategy: { primaryProblem: concern, purchaseTrigger: trigger }
    });
    assert.doesNotThrow(() => validateContentPlanningCandidate(value, parsed, effective));
    const invalid = candidate({
      audience: { primaryConcern: concern },
      strategy: { primaryProblem: concern, purchaseTrigger: 'find-suitable-color' }
    });
    if (concern !== 'color-selection') {
      expectLocalCode(
        () => validateContentPlanningCandidate(invalid, parsed, effective),
        'concern_trigger_incompatible'
      );
    }
  }
});

test('disabled price and shipping output fields fail at the strict candidate boundary', async () => {
  const additions = [
    { strategy: { ...candidate().strategy, priceReference: '49 EUR' } },
    { strategy: { ...candidate().strategy, shippingReference: 'Germany' } }
  ];
  for (const addition of additions) {
    const operation = createVoluviaContentPlanOperation({
      generatePlan: async () => clientResult({ candidate: {
        ...candidate(), ...addition
      } })
    });
    await assert.rejects(operation(handlerInput(input())), /AI content planning failed/);
  }
});

test('shared safety primitives are pure, Unicode-aware, and detect frozen policy risks', () => {
  assert.equal(containsVoluviaMedicalClaim('Klinisch bewiesenes Haarwachstum'), true);
  assert.equal(containsVoluviaUnsupportedCommercialClaim('Nur heute: 49 EUR Rabatt'), true);
  assert.equal(containsVoluviaProhibitedTone('Du musst dich nicht länger schämen.'), true);
  assert.equal(containsMarkdown('**Fett**'), true);
  assert.equal(countUnicodeCodePoints('😀'.repeat(10)), 10);
  const repeated = { value: 1 };
  assert.equal(isVoluviaJsonSafe({ first: repeated, second: repeated }), true);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(isVoluviaJsonSafe(cyclic), false);
});

test('policy normalization matches repeated whitespace and punctuation identically', () => {
  for (const value of ['nur---heute', 'nur    heute', 'Nur...///heute']) {
    assert.equal(containsVoluviaUnsupportedCommercialClaim(value), true);
  }
  for (const value of ['klinisch---bewiesen', 'medizinisch    bewiesen', 'Hair...regrowth']) {
    assert.equal(containsVoluviaMedicalClaim(value), true);
  }
});

test('OpenAI adapter constructs one constrained parse request and returns safe metadata', async () => {
  let factoryOptions;
  let parseCalls = 0;
  let parseRequest;
  const adapter = new OpenAiResponsesContentPlanningClient(
    Object.freeze({ apiKey: 'not-real', model: 'configured-model', maxRetries: 0,
      timeoutMs: 60000, maxOutputTokens: 800, store: false }),
    new StaticPromptCatalog(),
    { create: (options) => {
      factoryOptions = options;
      return { responses: { parse: async (request) => {
        parseCalls += 1;
        parseRequest = request;
        return {
          id: 'resp_safe', model: 'returned-model', status: 'completed', error: null,
          incomplete_details: null, output_parsed: candidate(), output: [],
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }
        };
      } } };
    } }
  );
  const parsed = validateVoluviaContentPlannerInput(input());
  const operation = createVoluviaContentPlanOperation(adapter);
  const result = await operation(handlerInput(parsed));
  assert.deepEqual(factoryOptions, { apiKey: 'not-real', maxRetries: 0, timeout: 60000 });
  assert.equal(parseCalls, 1);
  assert.equal(parseRequest.model, 'configured-model');
  assert.equal(parseRequest.store, false);
  assert.equal(parseRequest.max_output_tokens, 800);
  assert.deepEqual(parseRequest.reasoning, { effort: 'none' });
  assert.equal('tools' in parseRequest, false);
  assert.equal(result.generation.model, 'returned-model');
});

test('OpenAI adapter rejects incomplete, refused, malformed, and provider failures safely', async () => {
  const request = {
    product: {}, approvedProductFacts: [], approvedSellingPoints: [], forbiddenClaims: [],
    targetCustomer: {}, brand: {}, contentGoal: 'product-awareness', targetPlatform: 'TikTok',
    targetLanguage: 'de-DE', preferredVideoDurationSeconds: 30, plannerControls: {
      excludedRecentlyUsedAngles: [], excludedRecentlyUsedFocuses: [],
      realBeforeAfterEvidenceAvailable: false
    }, prompt: contracts.VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE
  };
  const responses = [
    { status: 'incomplete', error: null, incomplete_details: {}, output_parsed: null, output: [] },
    { status: 'completed', error: null, incomplete_details: null, output_parsed: candidate(),
      output: [{ type: 'message', content: [{ type: 'refusal' }] }] },
    { status: 'completed', error: null, incomplete_details: null, output_parsed: {}, output: [] }
  ];
  for (const response of responses) {
    const adapter = new OpenAiResponsesContentPlanningClient(
      Object.freeze({ apiKey: 'not-real', model: 'configured-model', maxRetries: 0,
        timeoutMs: 60000, maxOutputTokens: 800, store: false }),
      new StaticPromptCatalog(),
      { create: () => ({ responses: { parse: async () => ({
        id: 'resp_safe', model: 'returned-model', usage: {
          input_tokens: 1, output_tokens: 1, total_tokens: 2
        }, ...response
      }) } }) }
    );
    await assert.rejects(adapter.generatePlan(request), OpenAiPlanningDiagnosticFailure);
  }
  const adapter = new OpenAiResponsesContentPlanningClient(
    Object.freeze({ apiKey: 'not-real', model: 'configured-model', maxRetries: 0,
      timeoutMs: 60000, maxOutputTokens: 800, store: false }),
    new StaticPromptCatalog(),
    { create: () => ({ responses: { parse: async () => { throw new Error('secret raw error'); } } }) }
  );
  await assert.rejects(adapter.generatePlan(request), (error) => {
    assert.equal(error.diagnostic.category, 'unknown');
    assert.equal(JSON.stringify(error).includes('secret raw error'), false);
    return true;
  });
});

test('OpenAI planning adapter maps the complete SDK diagnostic table offline', async () => {
  const cases = [
    [syntheticSdkError(OpenAI.AuthenticationError, { status: 401 }), 'authentication'],
    [syntheticSdkError(OpenAI.PermissionDeniedError, { status: 403 }), 'permission_denied'],
    [syntheticSdkError(OpenAI.RateLimitError, { status: 429 }), 'rate_limit'],
    [syntheticSdkError(OpenAI.BadRequestError, { status: 400 }), 'invalid_request'],
    [syntheticSdkError(OpenAI.NotFoundError, { status: 404, message: 'raw model unavailable' }),
      'model_unavailable'],
    [syntheticSdkError(OpenAI.NotFoundError, { status: 404, message: 'raw resource unavailable' }),
      'invalid_request'],
    [syntheticSdkError(OpenAI.UnprocessableEntityError, { status: 422 }), 'invalid_request'],
    [syntheticSdkError(OpenAI.APIConnectionTimeoutError), 'timeout'],
    [syntheticSdkError(OpenAI.APIConnectionError), 'network'],
    [syntheticSdkError(OpenAI.InternalServerError, { status: 500 }), 'provider_server'],
    [syntheticSdkError(OpenAI.APIError, { status: 503 }), 'provider_server'],
    [new Error('raw unknown provider message'), 'unknown']
  ];
  const request = {
    product: {}, approvedProductFacts: [], approvedSellingPoints: [], forbiddenClaims: [],
    targetCustomer: {}, brand: {}, contentGoal: 'product-awareness', targetPlatform: 'TikTok',
    targetLanguage: 'de-DE', preferredVideoDurationSeconds: 30,
    plannerControls: { excludedRecentlyUsedAngles: [], excludedRecentlyUsedFocuses: [],
      realBeforeAfterEvidenceAvailable: false },
    prompt: contracts.VOLUVIA_CONTENT_PLANNER_PROMPT_REFERENCE
  };
  for (const [providerError, expectedCategory] of cases) {
    const adapter = new OpenAiResponsesContentPlanningClient(
      Object.freeze({ apiKey: 'not-real', model: 'configured-model', maxRetries: 0,
        timeoutMs: 60000, maxOutputTokens: 800, store: false }),
      new StaticPromptCatalog(),
      { create: () => ({ responses: { parse: async () => { throw providerError; } } }) }
    );
    const diagnostic = await planningDiagnostic(adapter.generatePlan(request));
    assert.equal(diagnostic.category, expectedCategory);
    if (typeof providerError.status === 'number') assert.equal(diagnostic.status, providerError.status);
    assert.equal(diagnostic.requestAttempted, true);
  }
});

test('every reachable local-validation code is closed, precise, and content-free', async () => {
  const parsed = validateVoluviaContentPlannerInput(input());
  const effective = deriveEffectivePlannerFacts(parsed);
  const withoutPreferencesValue = input();
  delete withoutPreferencesValue.plannerControls.preferredContentAngle;
  delete withoutPreferencesValue.plannerControls.preferredContentFocus;
  const withoutPreferences = validateVoluviaContentPlannerInput(withoutPreferencesValue);
  const naturalCandidate = candidate({
    strategy: { contentFocus: 'natural-appearance' },
    production: {
      recommendedVideoStyle: 'close-up-product-demo',
      suggestedScenes: ['product-close-up', 'finished-natural-look']
    }
  });
  const easyCandidate = candidate({
    strategy: { contentFocus: 'easy-application' },
    production: {
      recommendedVideoStyle: 'hands-on-demo',
      suggestedScenes: ['product-close-up', 'clip-demonstration']
    }
  });
  const beforeAfterInputValue = input({
    plannerControls: {
      preferredContentAngle: 'before-after', preferredContentFocus: 'fuller-looking-crown',
      excludedRecentlyUsedAngles: [], excludedRecentlyUsedFocuses: [],
      priceMayBeFeatured: false, shippingMayBeFeatured: false,
      realBeforeAfterEvidenceAvailable: true
    }
  });
  const beforeAfterInput = validateVoluviaContentPlannerInput(beforeAfterInputValue);
  const beforeAfterFacts = deriveEffectivePlannerFacts(beforeAfterInput);
  const beforeAfterCandidate = candidate({
    audience: { primaryConcern: 'visible-thinning-crown' },
    strategy: {
      primaryProblem: 'visible-thinning-crown',
      purchaseTrigger: 'naturally-fuller-looking-hair', contentFocus: 'fuller-looking-crown',
      contentAngle: 'before-after', desiredAction: 'view-product'
    },
    production: {
      recommendedVideoStyle: 'before-after', recommendedHookStrategy: 'visual-transformation',
      visualProofRequired: true,
      suggestedScenes: ['crown-before-view', 'crown-after-view']
    }
  });

  const cyclic = {};
  cyclic.self = cyclic;
  const candidateCases = [
    ['unsafe_json', () => validateContentPlanningCandidate(cyclic, parsed, effective)],
    ['unknown_field', () => validateContentPlanningCandidate({ ...candidate(), raw: true },
      parsed, effective)],
    ['invalid_candidate_shape', () => validateContentPlanningCandidate(candidate({
      audience: { gender: 'invalid' }
    }), parsed, effective)],
    ['concern_problem_mismatch', () => validateContentPlanningCandidate(candidate({
      audience: { primaryConcern: 'color-selection' }
    }), parsed, effective)],
    ['concern_trigger_incompatible', () => validateContentPlanningCandidate(candidate({
      audience: { primaryConcern: 'color-selection' },
      strategy: { primaryProblem: 'color-selection' }
    }), parsed, effective)],
    ['focus_not_approved', () => {
      const value = input({ approvedSellingPoints: ['what-is-a-hair-topper'] });
      delete value.plannerControls.preferredContentFocus;
      const limited = validateVoluviaContentPlannerInput(value);
      return validateContentPlanningCandidate(naturalCandidate, limited,
        deriveEffectivePlannerFacts(limited));
    }],
    ['focus_missing_required_fact', () => validateContentPlanningCandidate(
      easyCandidate,
      withoutPreferences,
      effective.filter((fact) => fact.factId !== 'clip-count-3')
    )],
    ['focus_style_incompatible', () => validateContentPlanningCandidate(candidate({
      production: { recommendedVideoStyle: 'styling-demo' }
    }), parsed, effective)],
    ['focus_scene_incompatible', () => validateContentPlanningCandidate(candidate({
      production: { suggestedScenes: ['product-close-up', 'color-comparison'] }
    }), parsed, effective)],
    ['angle_hook_incompatible', () => validateContentPlanningCandidate(candidate({
      production: { recommendedHookStrategy: 'visual-transformation' }
    }), parsed, effective)],
    ['desired_action_angle_incompatible', () => validateContentPlanningCandidate(candidate({
      strategy: { desiredAction: 'compare-colors' }
    }), parsed, effective)],
    ['scene_count_invalid', () => validateContentPlanningCandidate(candidate({
      production: { suggestedScenes: ['product-close-up'] }
    }), parsed, effective)],
    ['scene_duplicate', () => validateContentPlanningCandidate(candidate({
      production: { suggestedScenes: ['product-close-up', 'product-close-up'] }
    }), parsed, effective)],
    ['before_after_pair_incomplete', () => validateContentPlanningCandidate(candidate({
      ...beforeAfterCandidate,
      production: {
        ...beforeAfterCandidate.production,
        suggestedScenes: ['crown-before-view', 'finished-natural-look']
      }
    }), beforeAfterInput, beforeAfterFacts)],
    ['before_after_evidence_missing', () => {
      const noEvidence = validateVoluviaContentPlannerInput({
        ...beforeAfterInputValue,
        plannerControls: {
          ...beforeAfterInputValue.plannerControls,
          realBeforeAfterEvidenceAvailable: false
        }
      });
      return validateContentPlanningCandidate(beforeAfterCandidate, noEvidence,
        deriveEffectivePlannerFacts(noEvidence));
    }],
    ['visual_proof_mismatch', () => validateContentPlanningCandidate(candidate({
      production: { visualProofRequired: true }
    }), parsed, effective)],
    ['duration_mismatch', () => validateContentPlanningCandidate(candidate({
      production: { targetDurationSeconds: 31 }
    }), parsed, effective)],
    ['price_reference_disabled', () => validateContentPlanningCandidate(candidate({
      strategy: { ...candidate().strategy, priceReference: 'secret candidate value' }
    }), parsed, effective)],
    ['shipping_reference_disabled', () => validateContentPlanningCandidate(candidate({
      strategy: { ...candidate().strategy, shippingReference: 'secret candidate value' }
    }), parsed, effective)],
    ['delivery_reference_forbidden', () => validateContentPlanningCandidate(candidate({
      strategy: { ...candidate().strategy, deliveryReference: 'secret candidate value' }
    }), parsed, effective)],
    ['preferred_focus_mismatch', () => validateContentPlanningCandidate(
      naturalCandidate, parsed, effective)],
    ['preferred_angle_mismatch', () => validateContentPlanningCandidate(candidate({
      strategy: { contentAngle: 'product-discovery' },
      production: { recommendedHookStrategy: 'product-discovery' }
    }), parsed, effective)],
    ['excluded_focus_selected', () => {
      const value = input();
      delete value.plannerControls.preferredContentFocus;
      value.plannerControls.excludedRecentlyUsedFocuses = ['natural-appearance'];
      const excluded = validateVoluviaContentPlannerInput(value);
      return validateContentPlanningCandidate(naturalCandidate, excluded,
        deriveEffectivePlannerFacts(excluded));
    }],
    ['excluded_angle_selected', () => {
      const value = input();
      delete value.plannerControls.preferredContentAngle;
      value.plannerControls.excludedRecentlyUsedAngles = ['product-discovery'];
      const excluded = validateVoluviaContentPlannerInput(value);
      return validateContentPlanningCandidate(candidate({
        strategy: { contentAngle: 'product-discovery' },
        production: { recommendedHookStrategy: 'product-discovery' }
      }), excluded, deriveEffectivePlannerFacts(excluded));
    }]
  ];
  for (const [expectedCode, action] of candidateCases) {
    expectLocalCode(action, expectedCode);
  }

  const inputCases = [
    ['invalid_input', { ...input(), preferredVideoDurationSeconds: 14 }],
    ['invalid_product_facts', {
      ...input(), approvedProductFacts: [...facts().slice(0, -1), facts()[0]]
    }],
    ['no_feasible_focus', {
      ...input(), approvedSellingPoints: ['easy-application'],
      approvedProductFacts: facts().filter((fact) => fact.factId !== 'clip-count-3'),
      plannerControls: {
        ...input().plannerControls, preferredContentFocus: 'easy-application'
      }
    }]
  ];
  for (const [expectedCode, value] of inputCases) {
    expectLocalCode(() => validateVoluviaContentPlannerInput(value), expectedCode);
  }

  expectLocalCode(() => validateContentPlanningClientResult({
    ...clientResult(), totalTokens: 31
  }, parsed, effective), 'invalid_generation_metadata');
  expectLocalCode(() => validateContentPlanningClientResult({
    ...clientResult(), promptId: 'other.prompt'
  }, parsed, effective), 'prompt_identity_mismatch');
  expectLocalCode(() => validateContentPlanningClientResult({
    ...clientResult(), promptContentHash: 'a'.repeat(64)
  }, parsed, effective), 'prompt_hash_mismatch');

  const successfulOperation = createVoluviaContentPlanOperation({
    generatePlan: async () => clientResult()
  });
  const successfulResult = await successfulOperation(handlerInput(input()));
  expectLocalCode(() => validateVoluviaContentPlanningResult({
    ...successfulResult,
    plan: {
      ...successfulResult.plan,
      brandSafety: {
        ...successfulResult.plan.brandSafety,
        forbiddenClaims: []
      }
    }
  }, parsed, effective), 'other_local_validation');
});

test('operation exposes only a closed diagnostic callback while workflow error stays generic', async () => {
  let diagnostic;
  const operation = createVoluviaContentPlanOperation(
    { generatePlan: async () => clientResult({
      candidate: candidate({
        strategy: { contentFocus: 'german-shipping' },
        production: {
          recommendedVideoStyle: 'product-only',
          suggestedScenes: ['package-and-product', 'product-close-up']
        }
      })
    }) },
    (value) => { diagnostic = value; }
  );
  await assert.rejects(operation(handlerInput(input())), (error) => {
    assert.equal(error.message, 'AI content planning failed.');
    assert.equal('code' in error, false);
    assert.equal(JSON.stringify(error).includes('german-shipping'), false);
    return true;
  });
  assert.deepEqual(diagnostic, { code: 'focus_missing_required_fact' });
});

test('concern-trigger diagnostics expose only validated closed enum IDs', async () => {
  const parsed = validateVoluviaContentPlannerInput(input());
  const effective = deriveEffectivePlannerFacts(parsed);
  let failure;
  try {
    validateContentPlanningCandidate(candidate({
      audience: { primaryConcern: 'color-selection' },
      strategy: {
        primaryProblem: 'color-selection',
        purchaseTrigger: 'alternative-to-full-wig'
      }
    }), parsed, effective);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof VoluviaContentPlanLocalValidationFailure);
  assert.deepEqual(failure.toDiagnostic(), {
    code: 'concern_trigger_incompatible',
    context: {
      selectedConcern: 'color-selection',
      selectedPurchaseTrigger: 'alternative-to-full-wig'
    }
  });

  const forged = new VoluviaContentPlanLocalValidationFailure(
    'concern_trigger_incompatible',
    { selectedConcern: 'raw candidate concern', selectedPurchaseTrigger: 'raw trigger' }
  );
  assert.deepEqual(forged.toDiagnostic(), { code: 'concern_trigger_incompatible' });
  assert.equal(JSON.stringify(forged).includes('raw candidate'), false);

  let compatibleDiagnostic;
  const compatibleOperation = createVoluviaContentPlanOperation(
    { generatePlan: async () => clientResult() },
    (value) => { compatibleDiagnostic = value; }
  );
  await compatibleOperation(handlerInput(input()));
  assert.equal(compatibleDiagnostic, undefined);

  let operationDiagnostic;
  const incompatibleOperation = createVoluviaContentPlanOperation(
    { generatePlan: async () => clientResult({
      candidate: candidate({
        audience: { primaryConcern: 'color-selection' },
        strategy: {
          primaryProblem: 'color-selection',
          purchaseTrigger: 'alternative-to-full-wig'
        }
      })
    }) },
    (value) => { operationDiagnostic = value; }
  );
  await assert.rejects(incompatibleOperation(handlerInput(input())), (error) => {
    assert.equal(error.message, 'AI content planning failed.');
    assert.equal('code' in error, false);
    assert.equal('context' in error, false);
    return true;
  });
  assert.deepEqual(operationDiagnostic, failure.toDiagnostic());
});

test('focus-scene diagnostics expose ordered validated enum IDs only', async () => {
  const parsed = validateVoluviaContentPlannerInput(input());
  const effective = deriveEffectivePlannerFacts(parsed);
  const incompatibleCandidate = candidate({
    production: {
      suggestedScenes: ['product-close-up', 'color-comparison', 'package-and-product']
    }
  });
  let failure;
  try {
    validateContentPlanningCandidate(incompatibleCandidate, parsed, effective);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof VoluviaContentPlanLocalValidationFailure);
  assert.deepEqual(failure.toDiagnostic(), {
    code: 'focus_scene_incompatible',
    context: {
      selectedFocus: 'what-is-a-hair-topper',
      selectedScenes: ['product-close-up', 'color-comparison', 'package-and-product']
    }
  });

  const forged = new VoluviaContentPlanLocalValidationFailure(
    'focus_scene_incompatible',
    {
      selectedFocus: 'raw focus',
      selectedScenes: ['product-close-up', 'raw scene description']
    }
  );
  assert.deepEqual(forged.toDiagnostic(), { code: 'focus_scene_incompatible' });
  assert.equal(JSON.stringify(forged).includes('raw scene'), false);

  assert.deepEqual(
    validateContentPlanningCandidate(candidate(), parsed, effective),
    candidate()
  );

  let operationDiagnostic;
  const operation = createVoluviaContentPlanOperation(
    { generatePlan: async () => clientResult({ candidate: incompatibleCandidate }) },
    (value) => { operationDiagnostic = value; }
  );
  await assert.rejects(operation(handlerInput(input())), (error) => {
    assert.equal(error.message, 'AI content planning failed.');
    assert.equal('code' in error, false);
    assert.equal('context' in error, false);
    assert.equal(JSON.stringify(error).includes('color-comparison'), false);
    return true;
  });
  assert.deepEqual(operationDiagnostic, failure.toDiagnostic());
});

test('live local-validation output contains only allowlisted diagnostic fields', () => {
  const formatted = formatPlannerLiveFailure({
    providerCalls: 1,
    safeDiagnostic: undefined,
    localValidationDiagnostic: { code: 'focus_scene_incompatible' },
    operationId: 'voluvia.content.plan.ai',
    configuredModel: 'configured-model',
    candidate: { secret: 'raw candidate value' },
    prompt: 'raw prompt value',
    apiKey: 'raw key value'
  });
  const diagnostic = JSON.parse(formatted);
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    'configuredModel', 'diagnosticCategory', 'localValidationCode', 'operationId',
    'requestAttempted', 'success'
  ]);
  assert.equal(diagnostic.diagnosticCategory, 'local_validation');
  assert.equal(diagnostic.localValidationCode, 'focus_scene_incompatible');
  assert.equal(diagnostic.requestAttempted, true);
  assert.equal(formatted.includes('raw candidate value'), false);
  assert.equal(formatted.includes('raw prompt value'), false);
  assert.equal(formatted.includes('raw key value'), false);

  const concernTrigger = JSON.parse(formatPlannerLiveFailure({
    providerCalls: 1,
    localValidationDiagnostic: {
      code: 'concern_trigger_incompatible',
      context: {
        selectedConcern: 'hair-topper-unawareness',
        selectedPurchaseTrigger: 'find-suitable-color'
      }
    },
    operationId: 'voluvia.content.plan.ai',
    configuredModel: 'configured-model'
  }));
  assert.deepEqual(Object.keys(concernTrigger).sort(), [
    'configuredModel', 'diagnosticCategory', 'localValidationCode', 'operationId',
    'requestAttempted', 'selectedConcern', 'selectedPurchaseTrigger', 'success'
  ]);
  assert.equal(concernTrigger.selectedConcern, 'hair-topper-unawareness');
  assert.equal(concernTrigger.selectedPurchaseTrigger, 'find-suitable-color');

  const forgedContext = formatPlannerLiveFailure({
    providerCalls: 1,
    localValidationDiagnostic: {
      code: 'concern_trigger_incompatible',
      context: {
        selectedConcern: 'raw provider concern',
        selectedPurchaseTrigger: 'raw provider trigger'
      },
      candidate: { raw: 'candidate' }
    },
    operationId: 'voluvia.content.plan.ai',
    configuredModel: 'configured-model'
  });
  assert.equal(forgedContext.includes('selectedConcern'), false);
  assert.equal(forgedContext.includes('selectedPurchaseTrigger'), false);
  assert.equal(forgedContext.includes('raw provider'), false);

  const unrelatedContext = formatPlannerLiveFailure({
    providerCalls: 1,
    localValidationDiagnostic: {
      code: 'focus_scene_incompatible',
      context: {
        selectedConcern: 'hair-topper-unawareness',
        selectedPurchaseTrigger: 'find-suitable-color'
      }
    },
    operationId: 'voluvia.content.plan.ai',
    configuredModel: 'configured-model'
  });
  assert.equal(unrelatedContext.includes('selectedConcern'), false);
  assert.equal(unrelatedContext.includes('selectedPurchaseTrigger'), false);

  const focusScene = JSON.parse(formatPlannerLiveFailure({
    providerCalls: 1,
    localValidationDiagnostic: {
      code: 'focus_scene_incompatible',
      context: {
        selectedFocus: 'what-is-a-hair-topper',
        selectedScenes: ['package-and-product', 'product-close-up']
      }
    },
    operationId: 'voluvia.content.plan.ai',
    configuredModel: 'configured-model'
  }));
  assert.deepEqual(Object.keys(focusScene).sort(), [
    'configuredModel', 'diagnosticCategory', 'localValidationCode', 'operationId',
    'requestAttempted', 'selectedFocus', 'selectedScenes', 'success'
  ]);
  assert.equal(focusScene.selectedFocus, 'what-is-a-hair-topper');
  assert.deepEqual(focusScene.selectedScenes, ['package-and-product', 'product-close-up']);

  const forgedScenes = formatPlannerLiveFailure({
    providerCalls: 1,
    localValidationDiagnostic: {
      code: 'focus_scene_incompatible',
      context: {
        selectedFocus: 'what-is-a-hair-topper',
        selectedScenes: ['product-close-up', 'raw scene description']
      }
    },
    operationId: 'voluvia.content.plan.ai',
    configuredModel: 'configured-model'
  });
  assert.equal(forgedScenes.includes('selectedFocus'), false);
  assert.equal(forgedScenes.includes('selectedScenes'), false);
  assert.equal(forgedScenes.includes('raw scene'), false);

  const sceneContextOnOtherCode = formatPlannerLiveFailure({
    providerCalls: 1,
    localValidationDiagnostic: {
      code: 'duration_mismatch',
      context: {
        selectedFocus: 'what-is-a-hair-topper',
        selectedScenes: ['product-close-up']
      }
    },
    operationId: 'voluvia.content.plan.ai',
    configuredModel: 'configured-model'
  });
  assert.equal(sceneContextOnOtherCode.includes('selectedFocus'), false);
  assert.equal(sceneContextOnOtherCode.includes('selectedScenes'), false);
});
