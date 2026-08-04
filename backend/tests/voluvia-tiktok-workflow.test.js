const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  voluviaTikTokContentWorkflow
} = require('../dist/workflows/definitions/voluvia-tiktok-content.workflow');
const {
  VOLUVIA_OPERATION_IDS
} = require('../dist/workflows/examples/voluvia/voluvia-operation-contracts');
const operations = require('../dist/workflows/examples/voluvia/voluvia-mock-operations');
const {
  registerVoluviaShowcaseOperations
} = require('../dist/workflows/examples/voluvia/register-voluvia-showcase-operations');
const {
  InMemoryOperationRegistry
} = require('../dist/workflows/runtime/operation-registry');
const {
  DeclarativeConditionEvaluator
} = require('../dist/workflows/runtime/condition-evaluator');
const {
  InMemoryWorkflowRunner
} = require('../dist/workflows/runtime/workflow-runner');
const { WorkflowState } = require('../dist/workflows/runtime/workflow-state');
const { GraphWorkflowValidator } = require('../dist/workflows/workflow-validator');
const {
  CanonicalWorkflowExecutionSerializer
} = require('../dist/workflows/persistence/workflow-execution-serializer');
const {
  InMemoryWorkflowExecutionRepository
} = require('../dist/workflows/persistence/in-memory-workflow-execution-repository');
const {
  DefaultWorkflowExecutionRecoveryValidator
} = require('../dist/workflows/persistence/workflow-execution-recovery-validator');
const {
  DurableWorkflowExecutionCoordinator
} = require('../dist/workflows/persistence/workflow-execution-coordinator');

const samplesDirectory = path.resolve(__dirname, '../../examples/voluvia-tiktok-workflow');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(samplesDirectory, relativePath), 'utf8'));
}

function sampleInput(overrides = {}) {
  const sample = readJson('sample-product.json');
  return {
    ...sample,
    showcaseControls: { ...sample.showcaseControls, ...overrides }
  };
}

function createClock() {
  let value = 0;
  return { now: () => new Date(value++) };
}

function createIdGenerator(method, prefix) {
  let value = 0;
  return { [method]: () => `${prefix}-${++value}` };
}

function createRuntime(registry = new InMemoryOperationRegistry()) {
  if (!registry.resolve(VOLUVIA_OPERATION_IDS.normalizeProduct)) {
    registerVoluviaShowcaseOperations(registry);
  }

  return new InMemoryWorkflowRunner(
    registry,
    new DeclarativeConditionEvaluator(),
    createClock(),
    createIdGenerator('next', 'voluvia-execution')
  );
}

function handlerInput(stepInput) {
  return {
    executionId: 'operation-test',
    workflowId: voluviaTikTokContentWorkflow.id,
    workflowVersion: voluviaTikTokContentWorkflow.version,
    stepId: 'operation-test-step',
    workflowInput: sampleInput(),
    stepInput
  };
}

async function invokeWithoutMutation(handler, stepInput) {
  const before = structuredClone(stepInput);
  const output = await handler(handlerInput(stepInput));
  assert.deepEqual(stepInput, before);
  return output;
}

async function buildApprovedOperationOutputs() {
  const initial = sampleInput();
  const normalized = await operations.normalizeProductOperation(handlerInput(initial));
  const script = await operations.generateScriptOperation(handlerInput(normalized));
  const editorial = await operations.mockEditorialReviewOperation(handlerInput(script));
  const branchOutputs = {
    cover: await operations.generateCoverMetadataOperation(handlerInput(editorial)),
    hashtags: await operations.generateHashtagsOperation(handlerInput(editorial)),
    subtitles: await operations.generateMockSubtitlesOperation(handlerInput(editorial)),
    video: await operations.generateMockVideoOperation(handlerInput(editorial))
  };
  const joinOutput = Object.entries(branchOutputs).map(([branchId, output]) => ({
    branchId,
    output
  }));
  const packageEnvelope = await operations.buildPublishingPackageOperation(
    handlerInput(joinOutput)
  );

  return { initial, normalized, script, editorial, branchOutputs, packageEnvelope };
}

test('definition validates with one shared finish and exact frozen topology', () => {
  const result = new GraphWorkflowValidator().validate(voluviaTikTokContentWorkflow);
  const finishSteps = voluviaTikTokContentWorkflow.steps.filter((step) => step.kind === 'finish');
  const operationsInDefinition = voluviaTikTokContentWorkflow.steps
    .filter((step) => step.kind === 'action')
    .map((step) => step.operation);
  const parallelEdges = voluviaTikTokContentWorkflow.edges.filter(
    (edge) => edge.type === 'parallel'
  );

  assert.deepEqual(result, { valid: true, issues: [] });
  assert.equal(voluviaTikTokContentWorkflow.id, 'voluvia.tiktok.content.workflow');
  assert.equal(voluviaTikTokContentWorkflow.version, 1);
  assert.equal(voluviaTikTokContentWorkflow.startStepId, 'start');
  assert.equal(voluviaTikTokContentWorkflow.finishStepId, 'finish');
  assert.deepEqual(finishSteps.map((step) => step.id), ['finish']);
  assert.deepEqual(
    [...operationsInDefinition].sort(),
    [...Object.values(VOLUVIA_OPERATION_IDS)].sort()
  );
  assert.deepEqual(parallelEdges.map((edge) => edge.branchId), [
    'video',
    'cover',
    'subtitles',
    'hashtags'
  ]);
  assert.deepEqual(
    voluviaTikTokContentWorkflow.steps.find((step) => step.id === 'content-fork'),
    {
      id: 'content-fork',
      name: 'Generate Content Assets',
      type: 'fork',
      joinStepId: 'content-join'
    }
  );
  assert.equal(
    voluviaTikTokContentWorkflow.steps.find((step) => step.id === 'content-join').forkStepId,
    'content-fork'
  );
});

test('decision references and defaults exactly match the frozen contracts', () => {
  const editorial = voluviaTikTokContentWorkflow.edges.find(
    (edge) => edge.id === 'review-approved'
  );
  const final = voluviaTikTokContentWorkflow.edges.find(
    (edge) => edge.id === 'final-approved'
  );

  assert.deepEqual(editorial.condition.left.reference, {
    source: 'current_step_input',
    path: ['editorialReview', 'approved']
  });
  assert.deepEqual(final.condition.left.reference, {
    source: 'current_step_input',
    path: ['finalReview', 'approved']
  });
  assert.deepEqual(
    voluviaTikTokContentWorkflow.edges.find((edge) => edge.id === 'review-rejected'),
    { id: 'review-rejected', from: 'review-decision', to: 'finish', default: true }
  );
  assert.deepEqual(
    voluviaTikTokContentWorkflow.edges.find((edge) => edge.id === 'final-rejected'),
    { id: 'final-rejected', from: 'final-decision', to: 'finish', default: true }
  );
});

test('documentation JSON is a semantic mirror of the executable TypeScript definition', () => {
  assert.deepEqual(readJson('workflow-definition.json'), voluviaTikTokContentWorkflow);
});

test('normalization and script operations are deterministic, immutable, and match samples', async () => {
  const initial = sampleInput();
  const original = structuredClone(initial);
  const firstNormalized = await operations.normalizeProductOperation(handlerInput(initial));
  const secondNormalized = await operations.normalizeProductOperation(handlerInput(initial));
  const firstScript = await operations.generateScriptOperation(handlerInput(firstNormalized));
  const secondScript = await operations.generateScriptOperation(handlerInput(firstNormalized));

  assert.deepEqual(initial, original);
  assert.deepEqual(firstNormalized, secondNormalized);
  assert.deepEqual(firstScript, secondScript);
  assert.deepEqual(firstNormalized, readJson('sample-output/normalized-product.json'));
  assert.deepEqual(firstScript, readJson('sample-output/script.json'));
  assert.equal(firstNormalized.product.productKey, 'voluvia-satin-evening-dress');
  assert.equal(firstScript.script.source, 'deterministic_showcase_template');
  assert.doesNotThrow(() => JSON.stringify(firstScript));
});

test('every operation rejects malformed input through the existing handler failure boundary', () => {
  const handlers = [
    operations.normalizeProductOperation,
    operations.generateScriptOperation,
    operations.mockEditorialReviewOperation,
    operations.generateMockVideoOperation,
    operations.generateMockSubtitlesOperation,
    operations.generateHashtagsOperation,
    operations.generateCoverMetadataOperation,
    operations.buildPublishingPackageOperation,
    operations.mockFinalReviewOperation
  ];

  for (const handler of handlers) {
    assert.throws(() => handler(handlerInput({})));
  }
  assert.throws(() => operations.normalizeProductOperation(handlerInput({
    product: {
      title: '---', description: 'description', color: 'color', length: 'length',
      price: { amount: 1, currency: 'EUR' }, audience: 'audience'
    },
    showcaseControls: { editorialApproved: true, finalApproved: true }
  })));
  assert.throws(() => operations.normalizeProductOperation(handlerInput({
    ...sampleInput(),
    product: { ...sampleInput().product, price: { amount: Infinity, currency: 'EUR' } }
  })));
});

test('mock reviews use only explicit controls and produce all frozen business outcomes', async () => {
  const approved = await buildApprovedOperationOutputs();
  const ready = await operations.mockFinalReviewOperation(handlerInput(approved.packageEnvelope));
  const editorialInput = sampleInput({ editorialApproved: false });
  const normalized = await operations.normalizeProductOperation(handlerInput(editorialInput));
  const script = await operations.generateScriptOperation(handlerInput(normalized));
  const editorialRejected = await operations.mockEditorialReviewOperation(handlerInput(script));
  const finalRejectedPackage = {
    ...approved.packageEnvelope,
    showcaseControls: { editorialApproved: true, finalApproved: false }
  };
  const finalRejected = await operations.mockFinalReviewOperation(
    handlerInput(finalRejectedPackage)
  );

  assert.deepEqual(ready.finalReview, {
    approved: true,
    reviewNote: 'Mock final approval for showcase',
    reviewType: 'final_mock'
  });
  assert.equal(ready.disposition, 'ready');
  assert.equal(editorialRejected.disposition, 'rejected');
  assert.equal(editorialRejected.rejectionStage, 'editorial');
  assert.equal(finalRejected.disposition, 'rejected');
  assert.equal(finalRejected.rejectionStage, 'final');
});

test('asset operations use stable IDs, fixed subtitles, and immutable continuation contexts', async () => {
  const output = await buildApprovedOperationOutputs();
  const { branchOutputs } = output;
  // Runtime subtitle state uses canonical LF. Normalize checkout CRLF before sample comparison.
  const srt = fs
    .readFileSync(path.join(samplesDirectory, 'sample-output/subtitles.srt'), 'utf8')
    .replace(/\r\n/g, '\n');

  assert.equal(branchOutputs.cover.asset.assetId, 'voluvia-satin-evening-dress.cover.v1');
  assert.equal(branchOutputs.hashtags.asset.assetId, 'voluvia-satin-evening-dress.hashtags.v1');
  assert.equal(
    branchOutputs.subtitles.asset.assetId,
    'voluvia-satin-evening-dress.subtitles.en.v1'
  );
  assert.equal(branchOutputs.video.asset.assetId, 'voluvia-satin-evening-dress.video.v1');
  assert.equal(branchOutputs.video.asset.uri, 'mock://voluvia/video/voluvia-satin-evening-dress');
  assert.equal(branchOutputs.video.asset.rendered, false);
  assert.deepEqual(branchOutputs.hashtags.asset.hashtags, [
    '#Voluvia', '#EmeraldGreen', '#Maxi', '#VoluviaSatinEveningDress'
  ]);
  assert.equal(branchOutputs.subtitles.asset.content.includes('\r'), false);
  assert.equal(branchOutputs.subtitles.asset.content, srt);
  assert.deepEqual(branchOutputs.cover.context, branchOutputs.video.context);
  assert.notEqual(branchOutputs.cover.context, branchOutputs.video.context);
  assert.doesNotThrow(() => JSON.stringify(branchOutputs));
});

test('package aggregation resolves identities, matches the sample, and rejects inconsistent inputs', async () => {
  const output = await buildApprovedOperationOutputs();
  assert.deepEqual(
    output.packageEnvelope.publishingPackage,
    readJson('sample-output/publishing-package.json')
  );

  const entries = Object.entries(output.branchOutputs).map(([branchId, branchOutput]) => ({
    branchId,
    output: branchOutput
  }));
  const inconsistent = structuredClone(entries);
  inconsistent.find(
    (entry) => entry.branchId === 'video'
  ).output.context.showcaseControls.finalApproved = false;
  const duplicate = [...entries, entries[0]];
  const missing = entries.slice(1);
  const unknown = [...entries.slice(1), { branchId: 'unknown', output: entries[0].output }];
  const wrongKind = structuredClone(entries);
  wrongKind.find((entry) => entry.branchId === 'video').output.asset.assetKind = 'hashtags';
  const wrongAssetId = structuredClone(entries);
  wrongAssetId.find((entry) => entry.branchId === 'video').output.asset.assetId = 'wrong.video.v1';
  const wrongCoverProduct = structuredClone(entries);
  wrongCoverProduct.find(
    (entry) => entry.branchId === 'cover'
  ).output.asset.productKey = 'different-product';

  for (const invalid of [
    inconsistent,
    duplicate,
    missing,
    unknown,
    wrongKind,
    wrongAssetId,
    wrongCoverProduct
  ]) {
    assert.throws(() => operations.buildPublishingPackageOperation(handlerInput(invalid)));
  }
});

test('every deterministic showcase handler preserves its supplied input', async () => {
  const initial = sampleInput();
  const normalized = await invokeWithoutMutation(operations.normalizeProductOperation, initial);
  const script = await invokeWithoutMutation(operations.generateScriptOperation, normalized);
  const editorial = await invokeWithoutMutation(
    operations.mockEditorialReviewOperation,
    script
  );
  const cover = await invokeWithoutMutation(
    operations.generateCoverMetadataOperation,
    editorial
  );
  const hashtags = await invokeWithoutMutation(operations.generateHashtagsOperation, editorial);
  const subtitles = await invokeWithoutMutation(
    operations.generateMockSubtitlesOperation,
    editorial
  );
  const video = await invokeWithoutMutation(operations.generateMockVideoOperation, editorial);
  const joinOutput = [
    { branchId: 'cover', output: cover },
    { branchId: 'hashtags', output: hashtags },
    { branchId: 'subtitles', output: subtitles },
    { branchId: 'video', output: video }
  ];
  const packageEnvelope = await invokeWithoutMutation(
    operations.buildPublishingPackageOperation,
    joinOutput
  );
  await invokeWithoutMutation(operations.mockFinalReviewOperation, packageEnvelope);
});

test('approved workflow completes with canonical branch order and flattened histories', async () => {
  const runner = createRuntime();
  const initial = runner.createExecution(voluviaTikTokContentWorkflow, sampleInput());
  const result = await runner.run(voluviaTikTokContentWorkflow, initial);
  const region = result.parallelRegions[0];

  assert.equal(result.state, WorkflowState.COMPLETED);
  assert.equal(result.failure, undefined);
  assert.equal(result.workflowOutput.disposition, 'ready');
  assert.deepEqual(
    result.workflowOutput.publishingPackage,
    readJson('sample-output/publishing-package.json')
  );
  assert.equal(result.parallelRegions.length, 1);
  assert.deepEqual(region.branches.map((branch) => branch.branchId), [
    'cover', 'hashtags', 'subtitles', 'video'
  ]);
  assert.deepEqual(region.output.map((entry) => entry.branchId), [
    'cover', 'hashtags', 'subtitles', 'video'
  ]);
  assert.deepEqual(region.branches.map((branch) => branch.completedSteps), [
    ['generate-cover-metadata'],
    ['generate-hashtags'],
    ['generate-mock-subtitles'],
    ['generate-mock-video']
  ]);
  assert.deepEqual(
    result.completedSteps.slice(6, 11),
    [
      'generate-cover-metadata',
      'generate-hashtags',
      'generate-mock-subtitles',
      'generate-mock-video',
      'content-join'
    ]
  );
  assert.deepEqual(initial.completedSteps, []);
  assert.doesNotThrow(() => new CanonicalWorkflowExecutionSerializer().serialize(result));
});

test('editorial and final rejection are completed outcomes with the frozen finish semantics', async () => {
  const baseRegistry = new InMemoryOperationRegistry();
  registerVoluviaShowcaseOperations(baseRegistry);
  const calls = new Map();
  const countingRegistry = {
    register: () => { throw new Error('Counting registry is read-only.'); },
    resolve: (operationId) => {
      const handler = baseRegistry.resolve(operationId);
      if (!handler) return undefined;
      return (input) => {
        calls.set(operationId, (calls.get(operationId) ?? 0) + 1);
        return handler(input);
      };
    }
  };
  const runner = createRuntime(countingRegistry);
  const editorialRejected = await runner.run(
    voluviaTikTokContentWorkflow,
    runner.createExecution(
      voluviaTikTokContentWorkflow,
      sampleInput({ editorialApproved: false })
    )
  );

  assert.equal(editorialRejected.state, WorkflowState.COMPLETED);
  assert.equal(editorialRejected.failure, undefined);
  assert.equal(editorialRejected.workflowOutput.disposition, 'rejected');
  assert.equal(editorialRejected.workflowOutput.rejectionStage, 'editorial');
  assert.equal(editorialRejected.parallelRegions.length, 0);
  for (const operationId of [
    VOLUVIA_OPERATION_IDS.generateCoverMetadata,
    VOLUVIA_OPERATION_IDS.generateHashtags,
    VOLUVIA_OPERATION_IDS.generateSubtitles,
    VOLUVIA_OPERATION_IDS.generateVideo
  ]) {
    assert.equal(calls.get(operationId), undefined);
  }

  const finalRejected = await runner.run(
    voluviaTikTokContentWorkflow,
    runner.createExecution(
      voluviaTikTokContentWorkflow,
      sampleInput({ finalApproved: false })
    )
  );
  assert.equal(finalRejected.state, WorkflowState.COMPLETED);
  assert.equal(finalRejected.failure, undefined);
  assert.equal(finalRejected.workflowOutput.disposition, 'rejected');
  assert.equal(finalRejected.workflowOutput.rejectionStage, 'final');
  assert.equal(finalRejected.parallelRegions.length, 1);
});

test('parallel results remain canonical when edges and promise settlements are noncanonical', async () => {
  const baseRegistry = new InMemoryOperationRegistry();
  registerVoluviaShowcaseOperations(baseRegistry);
  const branchIdsByOperation = new Map([
    [VOLUVIA_OPERATION_IDS.generateCoverMetadata, 'cover'],
    [VOLUVIA_OPERATION_IDS.generateHashtags, 'hashtags'],
    [VOLUVIA_OPERATION_IDS.generateSubtitles, 'subtitles'],
    [VOLUVIA_OPERATION_IDS.generateVideo, 'video']
  ]);
  const pending = [];
  const settlementOrder = [];
  const registry = {
    register: () => { throw new Error('Controlled registry is read-only.'); },
    resolve: (operationId) => {
      const handler = baseRegistry.resolve(operationId);
      if (!handler) return undefined;
      const branchId = branchIdsByOperation.get(operationId);
      if (!branchId) return handler;
      return (input) => {
        const output = handler(input);
        return new Promise((resolve) => {
          pending.push({ branchId, output, resolve });
          if (pending.length === 4) {
            queueMicrotask(() => {
              for (const item of [...pending].reverse()) {
                settlementOrder.push(item.branchId);
                item.resolve(item.output);
              }
            });
          }
        });
      };
    }
  };
  const runner = createRuntime(registry);
  const result = await runner.run(
    voluviaTikTokContentWorkflow,
    runner.createExecution(voluviaTikTokContentWorkflow, sampleInput())
  );

  assert.deepEqual(settlementOrder, ['video', 'subtitles', 'hashtags', 'cover']);
  assert.deepEqual(result.parallelRegions[0].output.map((entry) => entry.branchId), [
    'cover', 'hashtags', 'subtitles', 'video'
  ]);
});

test('coordinator resumes in-process without repeating persisted completed work', async () => {
  const baseRegistry = new InMemoryOperationRegistry();
  registerVoluviaShowcaseOperations(baseRegistry);
  const calls = new Map();
  const countingRegistry = {
    register: () => { throw new Error('Counting registry is read-only.'); },
    resolve: (operationId) => {
      const handler = baseRegistry.resolve(operationId);
      if (!handler) return undefined;
      return (input) => {
        calls.set(operationId, (calls.get(operationId) ?? 0) + 1);
        return handler(input);
      };
    }
  };
  const normalRunner = createRuntime(countingRegistry);
  let advanceCalls = 0;
  const interruptBeforeCall = 5;
  const interruptingRunner = {
    createExecution: (definition, input) => normalRunner.createExecution(definition, input),
    advance: (definition, execution) => {
      advanceCalls += 1;
      if (advanceCalls === interruptBeforeCall) {
        throw new Error('test-only controlled interruption');
      }
      return normalRunner.advance(definition, execution);
    },
    run: (definition, execution) => normalRunner.run(definition, execution)
  };
  const repository = new InMemoryWorkflowExecutionRepository();
  const serializer = new CanonicalWorkflowExecutionSerializer();
  const resolverCalls = [];
  const resolver = {
    resolve: (workflowId, workflowVersion) => {
      resolverCalls.push([workflowId, workflowVersion]);
      return workflowId === voluviaTikTokContentWorkflow.id && workflowVersion === 1
        ? voluviaTikTokContentWorkflow
        : undefined;
    }
  };
  const writeIds = createIdGenerator('generate', 'voluvia-write');
  const dependencies = [
    repository,
    serializer,
    new DefaultWorkflowExecutionRecoveryValidator(),
    resolver,
    new GraphWorkflowValidator(),
    writeIds
  ];
  const interruptedCoordinator = new DurableWorkflowExecutionCoordinator(
    interruptingRunner,
    ...dependencies
  );

  await assert.rejects(
    interruptedCoordinator.start(voluviaTikTokContentWorkflow, sampleInput()),
    /test-only controlled interruption/
  );
  const persisted = await repository.findByExecutionId('voluvia-execution-1');
  const persistedExecution = serializer.deserialize(persisted.execution);
  const persistedRevision = persisted.revision;

  assert.deepEqual(persistedExecution.completedSteps, [
    'start', 'normalize-product', 'generate-script', 'mock-editorial-review'
  ]);
  assert.equal(calls.get(VOLUVIA_OPERATION_IDS.normalizeProduct), 1);
  assert.equal(calls.get(VOLUVIA_OPERATION_IDS.generateScript), 1);
  assert.equal(calls.get(VOLUVIA_OPERATION_IDS.editorialReview), 1);

  const resumeCoordinator = new DurableWorkflowExecutionCoordinator(normalRunner, ...dependencies);
  const completedRecord = await resumeCoordinator.resume(persisted.executionId);
  const completed = serializer.deserialize(completedRecord.execution);

  assert.equal(completed.state, WorkflowState.COMPLETED);
  assert.equal(completed.workflowOutput.disposition, 'ready');
  assert.ok(completedRecord.revision > persistedRevision);
  assert.equal(calls.get(VOLUVIA_OPERATION_IDS.normalizeProduct), 1);
  assert.equal(calls.get(VOLUVIA_OPERATION_IDS.generateScript), 1);
  assert.equal(calls.get(VOLUVIA_OPERATION_IDS.editorialReview), 1);
  assert.equal(calls.get(VOLUVIA_OPERATION_IDS.generateCoverMetadata), 1);
  assert.equal(calls.get(VOLUVIA_OPERATION_IDS.generateHashtags), 1);
  assert.equal(calls.get(VOLUVIA_OPERATION_IDS.generateSubtitles), 1);
  assert.equal(calls.get(VOLUVIA_OPERATION_IDS.generateVideo), 1);
  assert.deepEqual(resolverCalls, [['voluvia.tiktok.content.workflow', 1]]);
  assert.equal((await repository.findByExecutionId(persisted.executionId)).revision, completedRecord.revision);
});
