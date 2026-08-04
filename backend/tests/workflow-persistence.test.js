const test = require('node:test');
const assert = require('node:assert/strict');

const { InMemoryOperationRegistry } = require('../dist/workflows/runtime/operation-registry');
const { DeclarativeConditionEvaluator } = require('../dist/workflows/runtime/condition-evaluator');
const { InMemoryWorkflowRunner } = require('../dist/workflows/runtime/workflow-runner');
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
const {
  WorkflowPersistenceError
} = require('../dist/workflows/persistence/workflow-persistence-error');

function createClock() {
  let value = 0;
  return { now: () => new Date(value++) };
}

function createSequence(method, ...values) {
  const remaining = [...values];
  return { [method]: () => {
    const value = remaining.shift();
    if (!value) throw new Error(`${method} sequence exhausted`);
    return value;
  } };
}

function linearDefinition(overrides = {}) {
  return {
    id: 'test.persistence.workflow',
    version: 1,
    name: 'Persistence Workflow',
    startStepId: 'start',
    finishStepId: 'finish',
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'action', name: 'Action', kind: 'action', operation: 'test.action' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-action', from: 'start', to: 'action' },
      { id: 'action-finish', from: 'action', to: 'finish' }
    ],
    ...overrides
  };
}

function decisionDefinition() {
  return linearDefinition({
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'decision', name: 'Decision', kind: 'decision' },
      { id: 'action', name: 'Action', kind: 'action', operation: 'test.action' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-decision', from: 'start', to: 'decision' },
      {
        id: 'decision-action',
        from: 'decision',
        to: 'action',
        condition: {
          operator: 'equals',
          left: { kind: 'reference', reference: { source: 'workflow_input', path: ['go'] } },
          right: { kind: 'literal', value: true }
        }
      },
      { id: 'decision-finish', from: 'decision', to: 'finish', default: true },
      { id: 'action-finish', from: 'action', to: 'finish' }
    ]
  });
}

function parallelDefinition() {
  return linearDefinition({
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'fork', name: 'Fork', type: 'fork', joinStepId: 'join' },
      { id: 'alpha', name: 'Alpha', kind: 'action', operation: 'test.alpha' },
      { id: 'beta', name: 'Beta', kind: 'action', operation: 'test.beta' },
      { id: 'join', name: 'Join', type: 'join', forkStepId: 'fork' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-fork', from: 'start', to: 'fork' },
      { id: 'fork-beta', type: 'parallel', sourceStepId: 'fork', targetStepId: 'beta', branchId: 'beta' },
      { id: 'fork-alpha', type: 'parallel', sourceStepId: 'fork', targetStepId: 'alpha', branchId: 'alpha' },
      { id: 'alpha-join', from: 'alpha', to: 'join' },
      { id: 'beta-join', from: 'beta', to: 'join' },
      { id: 'join-finish', from: 'join', to: 'finish' }
    ]
  });
}

function createRuntime(definition, operations = {}) {
  const registry = new InMemoryOperationRegistry();
  for (const [id, handler] of Object.entries(operations)) registry.register(id, handler);
  const runner = new InMemoryWorkflowRunner(
    registry,
    new DeclarativeConditionEvaluator(),
    createClock(),
    createSequence('next', 'execution-1', 'execution-2')
  );
  const definitions = new Map([[`${definition.id}:${definition.version}`, definition]]);
  return {
    runner,
    resolver: { resolve: (id, version) => definitions.get(`${id}:${version}`) }
  };
}

function createCoordinator(definition, operations = {}, repository = new InMemoryWorkflowExecutionRepository()) {
  const runtime = createRuntime(definition, operations);
  return {
    repository,
    runner: runtime.runner,
    coordinator: new DurableWorkflowExecutionCoordinator(
      runtime.runner,
      repository,
      new CanonicalWorkflowExecutionSerializer(),
      new DefaultWorkflowExecutionRecoveryValidator(),
      runtime.resolver,
      new GraphWorkflowValidator(),
      createSequence('generate', ...Array.from({ length: 30 }, (_, index) => `write-${index + 1}`))
    )
  };
}

function execution(value = {}) {
  return {
    executionId: 'execution-1',
    workflowId: 'test.persistence.workflow',
    workflowVersion: 1,
    state: WorkflowState.CREATED,
    currentStepId: 'start',
    workflowInput: value,
    completedSteps: [],
    stepResults: [],
    parallelRegions: []
  };
}

test('canonical serializer sorts keys, preserves arrays, and normalizes negative zero', () => {
  const serializer = new CanonicalWorkflowExecutionSerializer();
  const first = serializer.serialize(execution({ z: -0, a: [{ y: 2, x: 1 }] }));
  const second = serializer.serialize(execution({ a: [{ x: 1, y: 2 }], z: 0 }));

  assert.equal(first.canonicalJson, second.canonicalJson);
  assert.equal(Buffer.from(first.canonicalJson, 'utf8').toString('utf8'), first.canonicalJson);
  assert.match(first.canonicalJson, /"a":\[\{"x":1,"y":2\}\],"z":0/);
  assert.deepEqual(serializer.deserialize(first), execution({ a: [{ x: 1, y: 2 }], z: 0 }));
});

test('canonical serializer rejects every unsupported persistence value category', () => {
  const serializer = new CanonicalWorkflowExecutionSerializer();
  const cyclic = {}; cyclic.self = cyclic;
  const accessor = {}; Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });
  class RuntimeValue { constructor() { this.value = 1; } }
  const symbolKey = { value: 1 }; symbolKey[Symbol('hidden')] = 2;
  const values = [
    undefined, 1n, Symbol('value'), () => 1, Promise.resolve(1), new Map(), new Set(),
    new Date(), new Error('private'), new RuntimeValue(), cyclic, accessor, symbolKey, NaN, Infinity
  ];

  for (const value of values) {
    assert.throws(
      () => serializer.serialize(execution({ value })),
      (error) => error instanceof WorkflowPersistenceError && error.details.code === 'serialization_failed'
    );
  }
});

test('repository creates revision one, finds detached records, and increments revisions', async () => {
  const serializer = new CanonicalWorkflowExecutionSerializer();
  const repository = new InMemoryWorkflowExecutionRepository();
  const created = await repository.create({ writeId: 'create', execution: serializer.serialize(execution()) });
  const saved = await repository.save({
    executionId: created.executionId,
    expectedRevision: 1,
    writeId: 'save-1',
    execution: serializer.serialize({ ...execution(), state: WorkflowState.RUNNING })
  });

  assert.equal(created.revision, 1);
  assert.equal(saved.revision, 2);
  assert.notEqual(await repository.findByExecutionId(created.executionId), saved);
  assert.deepEqual(await repository.findByExecutionId(created.executionId), saved);
  assert.equal(await repository.findByExecutionId('missing'), undefined);
});

test('repository enforces create idempotency and duplicate conflicts', async () => {
  const serializer = new CanonicalWorkflowExecutionSerializer();
  const repository = new InMemoryWorkflowExecutionRepository();
  const serialized = serializer.serialize(execution());
  const created = await repository.create({ writeId: 'create', execution: serialized });

  assert.deepEqual(await repository.create({ writeId: 'create', execution: serialized }), created);
  await assert.rejects(
    repository.create({ writeId: 'create', execution: serializer.serialize(execution({ changed: true })) }),
    (error) => error.details.code === 'duplicate_write_conflict'
  );
  await assert.rejects(
    repository.create({ writeId: 'new-create', execution: serialized }),
    (error) => error.details.code === 'execution_already_exists'
  );
});

test('repository enforces stale revisions and retains all accepted write IDs', async () => {
  const serializer = new CanonicalWorkflowExecutionSerializer();
  const repository = new InMemoryWorkflowExecutionRepository();
  await repository.create({ writeId: 'create', execution: serializer.serialize(execution()) });
  const running = serializer.serialize({ ...execution(), state: WorkflowState.RUNNING });
  const first = await repository.save({ executionId: 'execution-1', expectedRevision: 1, writeId: 'first', execution: running });
  const completed = serializer.serialize({ ...execution(), state: WorkflowState.COMPLETED, workflowOutput: {}, durationMs: 0 });
  await repository.save({ executionId: 'execution-1', expectedRevision: 2, writeId: 'second', execution: completed });

  assert.deepEqual(
    await repository.save({ executionId: 'execution-1', expectedRevision: 1, writeId: 'first', execution: running }),
    first
  );
  await assert.rejects(
    repository.save({ executionId: 'execution-1', expectedRevision: 1, writeId: 'stale', execution: running }),
    (error) => error.details.code === 'stale_revision'
  );
  await assert.rejects(
    repository.save({ executionId: 'execution-1', expectedRevision: 2, writeId: 'first', execution: running }),
    (error) => error.details.code === 'duplicate_write_conflict'
  );
});

test('advance performs one linear step and run remains compatible', async () => {
  const definition = linearDefinition();
  const { runner } = createRuntime(definition, { 'test.action': ({ stepInput }) => ({ ...stepInput, done: true }) });
  const initial = runner.createExecution(definition, { value: 1 });
  const afterStart = await runner.advance(definition, initial);

  assert.deepEqual(afterStart.completedSteps, ['start']);
  assert.equal(afterStart.currentStepId, 'action');
  assert.deepEqual(initial.completedSteps, []);
  const result = await runner.run(definition, runner.createExecution(definition, { value: 1 }));
  assert.equal(result.state, WorkflowState.COMPLETED);
  assert.deepEqual(result.completedSteps, ['start', 'action', 'finish']);
  await assert.rejects(runner.advance(definition, result), /Terminal workflow executions/);
});

test('advance separates fork creation, branch round, final settlement, and join barrier', async () => {
  const definition = parallelDefinition();
  const { runner } = createRuntime(definition, {
    'test.alpha': () => 'A',
    'test.beta': () => 'B'
  });
  let snapshot = runner.createExecution(definition, {});
  snapshot = await runner.advance(definition, snapshot);
  snapshot = await runner.advance(definition, snapshot);
  assert.ok(snapshot.activeParallel);
  assert.deepEqual(snapshot.activeParallel.branches.map((branch) => branch.state), ['pending', 'pending']);
  snapshot = await runner.advance(definition, snapshot);
  assert.deepEqual(snapshot.activeParallel.branches.map((branch) => branch.state), ['running', 'running']);
  snapshot = await runner.advance(definition, snapshot);
  assert.deepEqual(snapshot.activeParallel.branches.map((branch) => branch.state), ['completed', 'completed']);
  assert.equal(snapshot.parallelRegions.length, 0);
  snapshot = await runner.advance(definition, snapshot);
  assert.equal(snapshot.activeParallel, undefined);
  assert.equal(snapshot.parallelRegions.length, 1);
  assert.equal(snapshot.currentStepId, 'finish');
});

test('coordinator saves revision one before handlers and every transition through terminal state', async () => {
  const definition = linearDefinition();
  const repository = new InMemoryWorkflowExecutionRepository();
  let revisionSeenByHandler;
  const setup = createCoordinator(definition, {
    'test.action': async () => {
      revisionSeenByHandler = (await repository.findByExecutionId('execution-1')).revision;
      return { durable: true };
    }
  }, repository);
  const result = await setup.coordinator.start(definition, { value: 1 });

  assert.equal(revisionSeenByHandler, 2);
  assert.equal(result.revision, 4);
  assert.equal(JSON.parse(result.execution.canonicalJson).state, WorkflowState.COMPLETED);
});

test('coordinator persists workflow failure without converting it to infrastructure failure', async () => {
  const definition = linearDefinition();
  const { coordinator } = createCoordinator(definition);
  const result = await coordinator.start(definition, {});
  const execution = JSON.parse(result.execution.canonicalJson);

  assert.equal(execution.state, WorkflowState.FAILED);
  assert.equal(execution.failure.code, 'operation_not_registered');
});

test('coordinator resumes the exact definition and preserves revision continuity', async () => {
  const definition = decisionDefinition();
  const setup = createCoordinator(definition, { 'test.action': () => 'done' });
  const serializer = new CanonicalWorkflowExecutionSerializer();
  let snapshot = setup.runner.createExecution(definition, { go: true });
  const created = await setup.repository.create({ writeId: 'manual-create', execution: serializer.serialize(snapshot) });
  snapshot = await setup.runner.advance(definition, snapshot);
  await setup.repository.save({ executionId: snapshot.executionId, expectedRevision: created.revision, writeId: 'manual-save', execution: serializer.serialize(snapshot) });

  const result = await setup.coordinator.resume(snapshot.executionId);
  assert.equal(JSON.parse(result.execution.canonicalJson).state, WorkflowState.COMPLETED);
  assert.ok(result.revision > 2);
});

test('coordinator rejects missing definitions and terminal resume', async () => {
  const definition = linearDefinition();
  const setup = createCoordinator(definition, { 'test.action': () => 'done' });
  const result = await setup.coordinator.start(definition, {});

  await assert.rejects(
    setup.coordinator.resume(result.executionId),
    (error) => error.details.code === 'terminal_execution_not_resumable'
  );
  const missingRuntime = createRuntime(definition);
  const missingCoordinator = new DurableWorkflowExecutionCoordinator(
    missingRuntime.runner,
    setup.repository,
    new CanonicalWorkflowExecutionSerializer(),
    new DefaultWorkflowExecutionRecoveryValidator(),
    { resolve: () => undefined },
    new GraphWorkflowValidator(),
    createSequence('generate', 'unused')
  );
  await assert.rejects(
    missingCoordinator.resume(result.executionId),
    (error) => error.details.code === 'definition_not_found'
  );
});

test('recovery validator rejects invalid current steps, durations, and branch ordering', () => {
  const definition = parallelDefinition();
  const validator = new DefaultWorkflowExecutionRecoveryValidator();
  const base = {
    ...execution(),
    workflowId: definition.id,
    state: WorkflowState.RUNNING,
    currentStepId: 'fork'
  };
  assert.throws(() => validator.validate(definition, { ...base, currentStepId: 'missing' }));
  assert.throws(() => validator.validate(definition, { ...base, durationMs: -1 }));
  assert.throws(() => validator.validate(definition, { ...base, completedSteps: ['start'] }));
  assert.throws(() => validator.validate(definition, {
    ...base,
    activeParallel: {
      forkStepId: 'fork', joinStepId: 'join', input: {},
      branches: [
        { branchId: 'beta', startStepId: 'beta', currentStepId: 'beta', state: 'pending', input: {}, completedSteps: [], stepResults: [] },
        { branchId: 'alpha', startStepId: 'alpha', currentStepId: 'alpha', state: 'pending', input: {}, completedSteps: [], stepResults: [] }
      ]
    }
  }));
  assert.throws(() => validator.validate(definition, {
    ...base,
    activeParallel: {
      forkStepId: 'fork', joinStepId: 'join', input: {},
      branches: [
        {
          branchId: 'alpha', startStepId: 'alpha', currentStepId: 'beta', state: 'running',
          input: {}, completedSteps: [], stepResults: []
        },
        { branchId: 'beta', startStepId: 'beta', currentStepId: 'beta', state: 'pending', input: {}, completedSteps: [], stepResults: [] }
      ]
    }
  }));
});

test('activeParallel and retained parallelRegions round-trip without mutation', async () => {
  const definition = parallelDefinition();
  const { runner } = createRuntime(definition, { 'test.alpha': () => 'A', 'test.beta': () => 'B' });
  const serializer = new CanonicalWorkflowExecutionSerializer();
  let snapshot = runner.createExecution(definition, {});
  snapshot = await runner.advance(definition, snapshot);
  snapshot = await runner.advance(definition, snapshot);
  const activeRoundTrip = serializer.deserialize(serializer.serialize(snapshot));
  assert.deepEqual(activeRoundTrip, snapshot);
  const completed = await runner.run(definition, runner.createExecution(definition, {}));
  const completedRoundTrip = serializer.deserialize(serializer.serialize(completed));
  assert.deepEqual(completedRoundTrip.parallelRegions, completed.parallelRegions);

  const failedRuntime = createRuntime(definition, { 'test.beta': () => 'B' });
  const failed = await failedRuntime.runner.run(
    definition,
    failedRuntime.runner.createExecution(definition, {})
  );
  const failedRoundTrip = serializer.deserialize(serializer.serialize(failed));
  assert.equal(failedRoundTrip.parallelRegions[0].state, 'failed');
  assert.deepEqual(failedRoundTrip.parallelRegions, failed.parallelRegions);
});

test('deserializer rejects malformed, non-canonical, and unsupported serialized executions', () => {
  const serializer = new CanonicalWorkflowExecutionSerializer();
  assert.throws(
    () => serializer.deserialize({ schemaVersion: 1, canonicalJson: '{' }),
    (error) => error.details.code === 'deserialization_failed'
  );
  assert.throws(
    () => serializer.deserialize({ schemaVersion: 1, canonicalJson: '{"z":1,"a":2}' }),
    (error) => error.details.code === 'deserialization_failed'
  );
  assert.throws(
    () => serializer.deserialize({ schemaVersion: 2, canonicalJson: '{}' }),
    (error) => error.details.code === 'unsupported_schema_version'
  );
});

test('repository save failure stops progression and leaves latest durable snapshot authoritative', async () => {
  const definition = linearDefinition();
  const base = new InMemoryWorkflowExecutionRepository();
  let saves = 0;
  const repository = {
    create: (record) => base.create(record),
    findByExecutionId: (id) => base.findByExecutionId(id),
    save: async (request) => {
      saves += 1;
      if (saves >= 2) {
        throw new WorkflowPersistenceError({ code: 'stale_revision', message: 'simulated stale write' });
      }
      return base.save(request);
    }
  };
  const { coordinator } = createCoordinator(definition, { 'test.action': () => 'side-effect' }, repository);

  await assert.rejects(
    coordinator.start(definition, {}),
    (error) => error.details.code === 'stale_revision'
  );
  const durable = await base.findByExecutionId('execution-1');
  assert.equal(durable.revision, 2);
  assert.equal(JSON.parse(durable.execution.canonicalJson).currentStepId, 'action');
});

test('ambiguous save response reuses the same write id and canonical bytes', async () => {
  const definition = linearDefinition();
  const base = new InMemoryWorkflowExecutionRepository();
  let ambiguous = true;
  const observed = [];
  const repository = {
    create: (record) => base.create(record),
    findByExecutionId: (id) => base.findByExecutionId(id),
    save: async (request) => {
      observed.push([request.writeId, request.execution.canonicalJson]);
      const accepted = await base.save(request);
      if (ambiguous) {
        ambiguous = false;
        throw new WorkflowPersistenceError({ code: 'repository_unavailable', message: 'ambiguous response' });
      }
      return accepted;
    }
  };
  const { coordinator } = createCoordinator(definition, { 'test.action': () => 'done' }, repository);
  await coordinator.start(definition, {});
  assert.deepEqual(observed[0], observed[1]);
});

test('save failure after a workflow failure throws infrastructure error without replacing workflow failure', async () => {
  const definition = linearDefinition();
  const base = new InMemoryWorkflowExecutionRepository();
  let saves = 0;
  const repository = {
    create: (record) => base.create(record),
    findByExecutionId: (id) => base.findByExecutionId(id),
    save: async (request) => {
      saves += 1;
      if (saves === 2) {
        throw new WorkflowPersistenceError({ code: 'stale_revision', message: 'failed terminal save' });
      }
      return base.save(request);
    }
  };
  const { coordinator } = createCoordinator(definition, {}, repository);
  await assert.rejects(
    coordinator.start(definition, {}),
    (error) => error.details.code === 'stale_revision'
  );
  const durable = await base.findByExecutionId('execution-1');
  assert.equal(JSON.parse(durable.execution.canonicalJson).failure, undefined);
});

test('recovery has at-least-once handler semantics after an undurable successful result', async () => {
  const definition = linearDefinition();
  const base = new InMemoryWorkflowExecutionRepository();
  let handlerCalls = 0;
  let failActionSave = true;
  const repository = {
    create: (record) => base.create(record),
    findByExecutionId: (id) => base.findByExecutionId(id),
    save: async (request) => {
      const candidate = JSON.parse(request.execution.canonicalJson);
      if (failActionSave && candidate.completedSteps.includes('action')) {
        failActionSave = false;
        throw new WorkflowPersistenceError({ code: 'stale_revision', message: 'undurable handler result' });
      }
      return base.save(request);
    }
  };
  const setup = createCoordinator(definition, {
    'test.action': () => { handlerCalls += 1; return 'side-effect'; }
  }, repository);

  await assert.rejects(setup.coordinator.start(definition, {}));
  await setup.coordinator.resume('execution-1');
  assert.equal(handlerCalls, 2);
});

test('resume advances only incomplete activeParallel branches and retains completed branches', async () => {
  const definition = parallelDefinition();
  let alphaCalls = 0;
  let betaCalls = 0;
  const setup = createCoordinator(definition, {
    'test.alpha': () => { alphaCalls += 1; return 'unexpected'; },
    'test.beta': () => { betaCalls += 1; return 'B'; }
  });
  const serializer = new CanonicalWorkflowExecutionSerializer();
  let snapshot = setup.runner.createExecution(definition, {});
  snapshot = await setup.runner.advance(definition, snapshot);
  snapshot = await setup.runner.advance(definition, snapshot);
  const alphaResult = {
    stepId: 'alpha', status: 'completed', input: {}, output: 'A', durationMs: 1
  };
  snapshot = {
    ...snapshot,
    activeParallel: {
      ...snapshot.activeParallel,
      branches: [
        {
          branchId: 'alpha', startStepId: 'alpha', state: 'completed', input: {}, output: 'A',
          completedSteps: ['alpha'], stepResults: [alphaResult], durationMs: 1
        },
        snapshot.activeParallel.branches.find((branch) => branch.branchId === 'beta')
      ]
    }
  };
  await setup.repository.create({ writeId: 'active-create', execution: serializer.serialize(snapshot) });
  const result = await setup.coordinator.resume(snapshot.executionId);
  const recovered = serializer.deserialize(result.execution);

  assert.equal(alphaCalls, 0);
  assert.equal(betaCalls, 1);
  assert.deepEqual(recovered.parallelRegions[0].output, [
    { branchId: 'alpha', output: 'A' },
    { branchId: 'beta', output: 'B' }
  ]);
});
