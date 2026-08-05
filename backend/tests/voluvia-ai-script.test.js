const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const OpenAI = require('openai').default;

const { loadOpenAiConfig } = require('../dist/config/openai.config');
const {
  canonicalizePromptContent,
  hashPromptContent,
  StaticPromptCatalog
} = require('../dist/prompts/prompt-catalog');
const promptModule = require('../dist/prompts/voluvia/de/script-v1.prompt');
const {
  OpenAiDiagnosticFailure,
  OpenAiResponsesScriptGenerationClient
} = require('../dist/integrations/openai/openai-responses-script-generation-client');
const {
  formatSmokeDiagnostic,
  sanitizeSmokeFailure,
  validateSmokeResult
} = require('../dist/scripts/openai-script-smoke');
const {
  VOLUVIA_AI_SCRIPT_OPERATION_ID,
  VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE
} = require('../dist/workflows/examples/voluvia/ai/voluvia-ai-script-contracts');
const {
  createVoluviaAiScriptOperation
} = require('../dist/workflows/examples/voluvia/ai/voluvia-ai-script.operation');
const {
  validateVoluviaAiClientResult,
  validateVoluviaAiWorkflowInput
} = require('../dist/workflows/examples/voluvia/ai/voluvia-ai-script-validator');

function input(overrides = {}) {
  return {
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
    targetAudience: 'Erwachsene Kundinnen',
    brandVoice: 'Elegant und klar',
    contentGoal: 'Das Kleid vorstellen',
    videoLengthTargetSeconds: 30,
    prohibitedClaims: ['garantierter Erfolg'],
    requiredProductFacts: ['Satin-Abendkleid', 'Farbe Smaragdgrün', 'Maxi-Länge'],
    ...overrides
  };
}

function clientResult(overrides = {}) {
  return {
    hook: 'Ein eleganter Auftritt in Smaragdgrün.',
    body: 'Dieses Satin-Abendkleid verbindet eine fließende Silhouette mit Maxi-Länge.',
    callToAction: 'Entdecke den Look.',
    caption: 'Satin-Abendkleid in Smaragdgrün mit Maxi-Länge.',
    hashtagSuggestions: ['#Voluvia', '#Abendkleid', '#Smaragdgrün'],
    language: 'de-DE',
    claimsUsed: ['Satin-Abendkleid', 'Farbe Smaragdgrün', 'Maxi-Länge'],
    provider: 'openai',
    model: 'configured-model',
    responseId: 'resp_safe',
    usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
    promptSha256: promptModule.VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT_SHA256,
    ...overrides
  };
}

function structuredOutput() {
  const result = clientResult();
  return {
    hook: result.hook,
    body: result.body,
    callToAction: result.callToAction,
    caption: result.caption,
    hashtagSuggestions: result.hashtagSuggestions,
    language: result.language,
    claimsUsed: result.claimsUsed
  };
}

function handlerInput(stepInput) {
  return {
    executionId: 'execution-1', workflowId: 'voluvia.tiktok.content.ai.workflow',
    workflowVersion: 1, stepId: 'generate-ai-script', workflowInput: stepInput, stepInput
  };
}

function config() {
  return Object.freeze({
    apiKey: 'not-a-real-key', model: 'configured-model', maxRetries: 0,
    timeoutMs: 60000, maxOutputTokens: 800, store: false
  });
}

function parsedResponse(overrides = {}) {
  return {
    id: 'resp_safe', model: 'actual-provider-model', status: 'completed',
    error: null, incomplete_details: null, output_parsed: structuredOutput(), output: [],
    usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 },
    ...overrides
  };
}

function sdkFactory(parse, observedOptions = []) {
  return {
    create: (options) => {
      observedOptions.push(options);
      return { responses: { parse } };
    }
  };
}

function syntheticSdkError(ErrorType, { status, message = 'raw provider message', requestID = 'req_safe_123' } = {}) {
  const error = Object.create(ErrorType.prototype);
  Object.defineProperties(error, {
    status: { value: status, enumerable: true },
    requestID: { value: requestID, enumerable: true },
    message: { value: message, enumerable: true },
    headers: { value: { authorization: 'raw-secret-header' }, enumerable: true }
  });
  return error;
}

async function captureDiagnostic(promise) {
  let failure;
  try {
    await promise;
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof OpenAiDiagnosticFailure);
  assert.equal('message' in failure, false);
  assert.equal('stack' in failure, false);
  assert.equal('cause' in failure, false);
  assert.equal('headers' in failure, false);
  assert.equal(JSON.stringify(failure).includes('raw provider message'), false);
  assert.equal(JSON.stringify(failure).includes('raw-secret-header'), false);
  return failure.diagnostic;
}

test('OpenAI configuration requires explicit trimmed key and model without defaults', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;
  try {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    assert.throws(() => loadOpenAiConfig(), /OPENAI_API_KEY/);
    process.env.OPENAI_API_KEY = '   ';
    assert.throws(() => loadOpenAiConfig(), /OPENAI_API_KEY/);
    process.env.OPENAI_API_KEY = 'super-secret-test-value';
    assert.throws(() => loadOpenAiConfig(), (error) => {
      assert.match(error.message, /OPENAI_MODEL/);
      assert.equal(error.message.includes('super-secret-test-value'), false);
      return true;
    });
    process.env.OPENAI_MODEL = '   ';
    assert.throws(() => loadOpenAiConfig(), /OPENAI_MODEL/);
    process.env.OPENAI_MODEL = '  explicitly-configured-model  ';
    const result = loadOpenAiConfig();
    assert.equal(result.model, 'explicitly-configured-model');
    assert.equal(result.maxRetries, 0);
    assert.equal(result.timeoutMs, 60000);
    assert.equal(result.maxOutputTokens, 800);
    assert.equal(result.store, false);
    assert.equal(Object.isFrozen(result), true);
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
  }
});

test('PromptCatalog resolves only the exact pinned prompt identity and version', () => {
  const catalog = new StaticPromptCatalog();
  const resolved = catalog.resolve(VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE);
  assert.equal(resolved.promptId, 'voluvia.tiktok.script.de');
  assert.equal(resolved.promptVersion, 1);
  assert.equal(resolved.sha256, promptModule.VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT_SHA256);
  assert.equal(catalog.resolve({ promptId: 'voluvia.tiktok.script.de', promptVersion: 2 }), undefined);
  assert.equal(catalog.resolve({ promptId: '../arbitrary', promptVersion: 1 }), undefined);
});

test('prompt hashing canonicalizes one BOM and CR variants while preserving final newline', () => {
  assert.equal(canonicalizePromptContent('\uFEFFä\r\nb\rc\n'), 'ä\nb\nc\n');
  assert.equal(canonicalizePromptContent('x\n').endsWith('\n'), true);
  assert.notEqual(hashPromptContent('x\n'), hashPromptContent('x'));
  assert.equal(hashPromptContent('\uFEFFä\r\nb\r'), hashPromptContent('ä\nb\n'));
  const expected = crypto.createHash('sha256')
    .update(Buffer.from(canonicalizePromptContent(promptModule.VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT), 'utf8'))
    .digest('hex');
  assert.equal(expected, promptModule.VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT_SHA256);
  assert.match(expected, /^[a-f0-9]{64}$/);
});

test('AI input validation is strict, JSON-safe, immutable, and uses Unicode code points', () => {
  const valid = input({ targetAudience: '😀'.repeat(200) });
  const before = structuredClone(valid);
  assert.deepEqual(validateVoluviaAiWorkflowInput(valid), valid);
  assert.deepEqual(valid, before);
  const invalidValues = [
    input({ targetLanguage: 'en-US' }), input({ targetAudience: '' }),
    input({ targetAudience: '😀'.repeat(201) }), input({ brandVoice: 'x'.repeat(201) }),
    input({ contentGoal: '' }), input({ videoLengthTargetSeconds: 9 }),
    input({ videoLengthTargetSeconds: 60.5 }), input({ prohibitedClaims: Array(21).fill('x') }),
    input({ requiredProductFacts: [] }), { ...input(), unknown: true },
    input({ product: { ...input().product, extra: true } }),
    input({ product: { ...input().product, title: '' } }),
    input({ prohibitedClaims: ['x'.repeat(301)] }),
    input({ requiredProductFacts: ['x'.repeat(301)] }),
    input({ product: { ...input().product, price: { amount: Infinity, currency: 'EUR' } } })
  ];
  for (const value of invalidValues) assert.throws(() => validateVoluviaAiWorkflowInput(value));
  const circular = input(); circular.self = circular;
  assert.throws(() => validateVoluviaAiWorkflowInput(circular), /JSON-safe/);
});

test('client-result validation enforces content, claims, hashtags, usage and safe metadata', () => {
  assert.deepEqual(validateVoluviaAiClientResult(clientResult(), input()), clientResult());
  const invalidValues = [
    clientResult({ hook: '' }), clientResult({ hook: '😀'.repeat(101) }),
    clientResult({ body: 'x'.repeat(501) }),
    clientResult({ callToAction: '😀'.repeat(121) }),
    clientResult({ caption: '😀'.repeat(801) }),
    clientResult({ hashtagSuggestions: ['#One', '#One', '#Three'] }),
    clientResult({ hashtagSuggestions: ['#One', '#Two words', '#Three'] }),
    clientResult({ caption: '**Markdown**' }), clientResult({ body: '`inline code`' }),
    clientResult({ caption: '1. Ordered item' }),
    clientResult({ claimsUsed: ['invented fact'] }),
    clientResult({ body: 'Dieses Produkt heilt garantiert.' }),
    clientResult({ caption: 'Jetzt 50% günstiger.' }),
    clientResult({ usage: { inputTokens: 1, outputTokens: 2, totalTokens: 4 } }),
    clientResult({ usage: { inputTokens: -1, outputTokens: 2, totalTokens: 1 } }),
    clientResult({ provider: '' }), clientResult({ promptSha256: 'BAD' }),
    clientResult({ language: 'en-US' }),
    clientResult({ hashtagSuggestions: ['#One', '#Two'] }),
    clientResult({ hashtagSuggestions: Array.from({ length: 9 }, (_, index) => `#Tag${index}`) }),
    clientResult({ claimsUsed: Array(21).fill('Satin-Abendkleid') })
  ];
  for (const value of invalidValues) assert.throws(() => validateVoluviaAiClientResult(value, input()));

  assert.doesNotThrow(() => validateVoluviaAiClientResult(clientResult({
    hook: '😀'.repeat(100),
    callToAction: '😀'.repeat(120),
    caption: '😀'.repeat(800)
  }), input()));
  assert.doesNotThrow(() => validateVoluviaAiClientResult(
    clientResult({ caption: 'Preis: 89 €.' }), input()
  ));
  assert.doesNotThrow(() => validateVoluviaAiClientResult(
    clientResult({ caption: 'Preis: €89.00.', claimsUsed: ['Preis 89,00 EUR'] }),
    input({ product: { ...input().product, price: { amount: 89, currency: 'EUR' } },
      requiredProductFacts: ['Preis 89,00 EUR'] })
  ));
  assert.throws(() => validateVoluviaAiClientResult(
    clientResult({ caption: 'Preis: 99 €.' }), input()
  ), /numeric/);
  assert.throws(() => validateVoluviaAiClientResult(
    clientResult({ caption: 'Der Anteil beträgt 20%.' }), input()
  ), /numeric/);
  assert.throws(() => validateVoluviaAiClientResult(
    clientResult({ hashtagSuggestions: ['#Voluvia', '#garantierterErfolg', '#Mode'] }), input()
  ), /prohibited/);
  assert.throws(() => validateVoluviaAiClientResult(
    clientResult({ claimsUsed: ['heilt'] }), input({ requiredProductFacts: ['heilt'] })
  ), /medical/);
  const rejectedCommercialClaims = [
    '89 EUR Rabatt',
    'Nur heute für 89 EUR',
    'Garantierter Wert von 89 EUR',
    'Zertifizierter Wert: 89 EUR',
    '89 EUR discount',
    'Limited stock: 89 EUR'
  ];
  for (const caption of rejectedCommercialClaims) {
    assert.throws(
      () => validateVoluviaAiClientResult(clientResult({ caption }), input()),
      /unsupported commercial claim/
    );
  }
  const acceptedPriceFacts = [
    'Preis: 89 EUR',
    'Erhältlich für 89 €',
    '89,00 EUR',
    '€89'
  ];
  for (const caption of acceptedPriceFacts) {
    assert.doesNotThrow(
      () => validateVoluviaAiClientResult(clientResult({ caption }), input())
    );
  }
  const sharedTextArray = ['#One', '#Two', '#Three'];
  assert.doesNotThrow(() => validateVoluviaAiClientResult(
    clientResult({ hashtagSuggestions: sharedTextArray, claimsUsed: sharedTextArray }),
    input({ requiredProductFacts: sharedTextArray })
  ));
});

test('operation injects the frozen prompt, calls once, preserves input, and returns safe metadata', async () => {
  let calls = 0;
  let captured;
  const fakeClient = { generate: async (request) => { calls += 1; captured = request; return clientResult(); } };
  const operation = createVoluviaAiScriptOperation(fakeClient);
  const supplied = input();
  const before = structuredClone(supplied);
  const result = await operation(handlerInput(supplied));
  assert.equal(calls, 1);
  assert.deepEqual(captured.prompt, VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE);
  assert.equal('prompt' in supplied, false);
  assert.deepEqual(supplied, before);
  assert.equal(result.generation.operationId, VOLUVIA_AI_SCRIPT_OPERATION_ID);
  assert.equal(result.generation.schemaVersion, 1);
  assert.equal('rawResponse' in result, false);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('operation sanitizes provider failures and never exposes raw values', async () => {
  const secret = 'provider-secret-body';
  const operation = createVoluviaAiScriptOperation({ generate: async () => { throw new Error(secret); } });
  await assert.rejects(operation(handlerInput(input())), (error) => {
    assert.equal(error.message, 'AI script generation failed.');
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test('operation rejects a different valid prompt hash before producing workflow output', async () => {
  const differentHash = 'a'.repeat(64);
  const operation = createVoluviaAiScriptOperation({
    generate: async () => clientResult({ promptSha256: differentHash })
  });
  await assert.rejects(operation(handlerInput(input())), /AI script generation failed/);
});

test('OpenAI adapter makes one constrained Responses parse request and returns safe fields', async () => {
  const requests = [];
  const options = [];
  const factory = sdkFactory(async (request) => {
    requests.push(request);
    if (requests.length > 1) throw new Error('A second provider request is forbidden.');
    return parsedResponse();
  }, options);
  const client = new OpenAiResponsesScriptGenerationClient(config(), new StaticPromptCatalog(), factory);
  const result = await client.generate({ ...input(), prompt: VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE });
  assert.deepEqual(options, [{ apiKey: 'not-a-real-key', maxRetries: 0, timeout: 60000 }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'configured-model');
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].max_output_tokens, 800);
  assert.deepEqual(requests[0].reasoning, { effort: 'none' });
  assert.equal('tools' in requests[0], false);
  assert.equal('previous_response_id' in requests[0], false);
  assert.equal(requests[0].text.format.type, 'json_schema');
  assert.equal(result.model, 'actual-provider-model');
  assert.equal(result.provider, 'openai');
  assert.equal('output' in result, false);
  assert.equal(JSON.stringify(result).includes('not-a-real-key'), false);
});

test('OpenAI adapter accepts only completed responses and rejects all other statuses', async () => {
  const cases = [
    [parsedResponse({ output: [{ type: 'message', content: [{ type: 'refusal' }] }] }), 'response_refused'],
    [parsedResponse({ status: 'failed' }), 'response_incomplete'],
    [parsedResponse({ status: 'cancelled' }), 'response_incomplete'],
    [parsedResponse({ status: 'queued' }), 'response_incomplete'],
    [parsedResponse({ status: 'in_progress' }), 'response_incomplete'],
    [parsedResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), 'response_incomplete'],
    [parsedResponse({ status: undefined }), 'response_incomplete'],
    [parsedResponse({ status: 'unknown' }), 'response_incomplete'],
    [parsedResponse({ error: { message: 'raw provider error' } }), 'response_incomplete'],
    [parsedResponse({ output_parsed: null }), 'response_invalid'],
    [parsedResponse({ usage: undefined }), 'response_invalid']
  ];
  for (const [response, category] of cases) {
    const client = new OpenAiResponsesScriptGenerationClient(
      config(), new StaticPromptCatalog(), sdkFactory(async () => response)
    );
    const diagnostic = await captureDiagnostic(
      client.generate({ ...input(), prompt: VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE })
    );
    assert.equal(diagnostic.category, category);
    assert.equal(diagnostic.requestAttempted, true);
  }
});

test('OpenAI adapter maps every SDK failure category to closed safe diagnostics', async () => {
  const cases = [
    [syntheticSdkError(OpenAI.AuthenticationError, { status: 401 }), 'authentication', 'AuthenticationError'],
    [syntheticSdkError(OpenAI.PermissionDeniedError, { status: 403 }), 'permission_denied', 'PermissionDeniedError'],
    [syntheticSdkError(OpenAI.RateLimitError, { status: 429 }), 'rate_limit', 'RateLimitError'],
    [syntheticSdkError(OpenAI.BadRequestError, { status: 400 }), 'invalid_request', 'BadRequestError'],
    [syntheticSdkError(OpenAI.NotFoundError, { status: 404, message: 'raw model unavailable' }), 'model_unavailable', 'NotFoundError'],
    [syntheticSdkError(OpenAI.NotFoundError, { status: 404, message: 'raw resource unavailable' }), 'invalid_request', 'NotFoundError'],
    [syntheticSdkError(OpenAI.UnprocessableEntityError, { status: 422 }), 'invalid_request', 'UnprocessableEntityError'],
    [syntheticSdkError(OpenAI.APIConnectionTimeoutError), 'timeout', 'APIConnectionTimeoutError'],
    [syntheticSdkError(OpenAI.APIConnectionError), 'network', 'APIConnectionError'],
    [syntheticSdkError(OpenAI.InternalServerError, { status: 500 }), 'provider_server', 'InternalServerError'],
    [syntheticSdkError(OpenAI.APIError, { status: 503 }), 'provider_server', 'APIError'],
    [new Error('raw unknown provider value'), 'unknown', undefined]
  ];
  for (const [providerError, category, sdkErrorName] of cases) {
    const client = new OpenAiResponsesScriptGenerationClient(
      config(), new StaticPromptCatalog(), sdkFactory(async () => { throw providerError; })
    );
    const diagnostic = await captureDiagnostic(
      client.generate({ ...input(), prompt: VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE })
    );
    assert.equal(diagnostic.category, category);
    assert.equal(diagnostic.sdkErrorName, sdkErrorName);
    if (typeof providerError.status === 'number') assert.equal(diagnostic.status, providerError.status);
    if (sdkErrorName) assert.equal(diagnostic.requestId, 'req_safe_123');
  }
  const unsafeRequestIdClient = new OpenAiResponsesScriptGenerationClient(
    config(),
    new StaticPromptCatalog(),
    sdkFactory(async () => {
      throw syntheticSdkError(OpenAI.AuthenticationError, {
        status: 401,
        requestID: 'unsafe request/id'
      });
    })
  );
  const unsafeRequestIdDiagnostic = await captureDiagnostic(
    unsafeRequestIdClient.generate({ ...input(), prompt: VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE })
  );
  assert.equal(unsafeRequestIdDiagnostic.requestId, undefined);
});

test('configuration and local validation use safe smoke diagnostic categories', async () => {
  let calls = 0;
  const missingPromptClient = new OpenAiResponsesScriptGenerationClient(
    config(), { resolve: () => undefined }, sdkFactory(async () => { calls += 1; return parsedResponse(); })
  );
  const configuration = await captureDiagnostic(
    missingPromptClient.generate({ ...input(), prompt: VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE })
  );
  assert.equal(configuration.category, 'configuration');
  assert.equal(configuration.requestAttempted, false);
  assert.equal(calls, 0);

  let localFailure;
  try {
    validateSmokeResult(clientResult({ caption: '89 EUR Rabatt' }), 'configured-model');
  } catch (error) {
    localFailure = error;
  }
  assert.ok(localFailure instanceof OpenAiDiagnosticFailure);
  assert.equal(localFailure.diagnostic.category, 'local_validation');
  assert.equal(localFailure.diagnostic.requestAttempted, true);
});

test('smoke diagnostic output contains only allowlisted safe metadata', () => {
  const diagnostic = {
    category: 'authentication', status: 401, sdkErrorName: 'AuthenticationError',
    requestId: 'req_safe_123', model: 'configured-model',
    operationId: VOLUVIA_AI_SCRIPT_OPERATION_ID, requestAttempted: true
  };
  const output = formatSmokeDiagnostic(diagnostic);
  assert.deepEqual(JSON.parse(output), diagnostic);
  for (const forbidden of ['apiKey', 'authorization', 'headers', 'message', 'stack', 'cause', 'prompt']) {
    assert.equal(output.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
  assert.equal(sanitizeSmokeFailure(new Error('raw config error'), undefined, false).category, 'configuration');
  assert.equal(sanitizeSmokeFailure(new Error('raw unknown error'), 'configured-model', true).category, 'unknown');
});
