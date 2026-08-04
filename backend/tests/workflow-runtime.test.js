const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { InMemoryOperationRegistry } = require('../dist/workflows/runtime/operation-registry');
const {
  DeclarativeConditionEvaluator
} = require('../dist/workflows/runtime/condition-evaluator');
const { InMemoryWorkflowRunner } = require('../dist/workflows/runtime/workflow-runner');
const {
  WorkflowState,
  WorkflowStepResultStatus
} = require('../dist/workflows/runtime/workflow-state');

function createClock(incrementMs = 5) {
  let currentMs = 0;
  let calls = 0;

  return {
    now() {
      const timestamp = new Date(currentMs);
      currentMs += incrementMs;
      calls += 1;
      return timestamp;
    },
    get callCount() {
      return calls;
    }
  };
}

function createIdGenerator(...ids) {
  const pendingIds = [...ids];

  return {
    next() {
      const id = pendingIds.shift();

      if (!id) {
        throw new Error('Test execution id generator exhausted.');
      }

      return id;
    }
  };
}

function createDefinition(overrides = {}) {
  return {
    id: 'test.runtime.workflow',
    version: 1,
    name: 'Test Runtime Workflow',
    startStepId: 'start',
    finishStepId: 'finish',
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'first', name: 'First', kind: 'action', operation: 'test.first' },
      { id: 'second', name: 'Second', kind: 'action', operation: 'test.second' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-to-first', from: 'start', to: 'first' },
      { id: 'first-to-second', from: 'first', to: 'second' },
      { id: 'second-to-finish', from: 'second', to: 'finish' }
    ],
    ...overrides
  };
}

function createRunner({ registry = new InMemoryOperationRegistry(), clock = createClock() } = {}) {
  return {
    registry,
    clock,
    runner: new InMemoryWorkflowRunner(
      registry,
      new DeclarativeConditionEvaluator(),
      clock,
      createIdGenerator('workflow-execution-1')
    )
  };
}

test('WorkflowRunner creates one execution aggregate with fixed identity and input', () => {
  const definition = createDefinition();
  const { runner, clock } = createRunner();
  const workflowInput = { value: 1 };

  const execution = runner.createExecution(definition, workflowInput);

  assert.deepEqual(execution, {
    executionId: 'workflow-execution-1',
    workflowId: 'test.runtime.workflow',
    workflowVersion: 1,
    state: WorkflowState.CREATED,
    currentStepId: 'start',
    workflowInput,
    completedSteps: [],
    stepResults: []
  });
  assert.equal(clock.callCount, 0);
});

test('WorkflowRunner executes sync and async actions with immutable snapshots and chained data', async () => {
  const definition = createDefinition();
  const { registry, runner } = createRunner();
  const handlerInputs = [];

  registry.register('test.first', (input) => {
    handlerInputs.push(input);
    return { value: input.stepInput.value + 1 };
  });
  registry.register('test.second', async (input) => {
    handlerInputs.push(input);
    await Promise.resolve();
    return { value: input.stepInput.value * 2 };
  });

  const workflowInput = Object.freeze({ value: 2 });
  const execution = runner.createExecution(definition, workflowInput);
  Object.freeze(execution.completedSteps);
  Object.freeze(execution.stepResults);
  Object.freeze(execution);

  const result = await runner.run(definition, execution);

  assert.equal(result.state, WorkflowState.COMPLETED);
  assert.equal(result.currentStepId, 'finish');
  assert.deepEqual(result.completedSteps, ['start', 'first', 'second', 'finish']);
  assert.deepEqual(result.workflowOutput, { value: 6 });
  assert.equal(result.durationMs, 45);
  assert.deepEqual(
    result.stepResults.map((stepResult) => stepResult.durationMs),
    [5, 5, 5, 5]
  );
  assert.deepEqual(
    result.stepResults.map((stepResult) => stepResult.input),
    [{ value: 2 }, { value: 2 }, { value: 3 }, { value: 6 }]
  );
  assert.deepEqual(
    result.stepResults.map((stepResult) => stepResult.output),
    [{ value: 2 }, { value: 3 }, { value: 6 }, { value: 6 }]
  );
  assert.deepEqual(
    handlerInputs.map((input) => ({
      executionId: input.executionId,
      workflowId: input.workflowId,
      workflowVersion: input.workflowVersion,
      stepId: input.stepId,
      workflowInput: input.workflowInput,
      stepInput: input.stepInput
    })),
    [
      {
        executionId: 'workflow-execution-1',
        workflowId: 'test.runtime.workflow',
        workflowVersion: 1,
        stepId: 'first',
        workflowInput: { value: 2 },
        stepInput: { value: 2 }
      },
      {
        executionId: 'workflow-execution-1',
        workflowId: 'test.runtime.workflow',
        workflowVersion: 1,
        stepId: 'second',
        workflowInput: { value: 2 },
        stepInput: { value: 3 }
      }
    ]
  );
  assert.equal(execution.state, WorkflowState.CREATED);
  assert.deepEqual(execution.completedSteps, []);
  assert.deepEqual(execution.stepResults, []);
  assert.notEqual(result.completedSteps, execution.completedSteps);
  assert.notEqual(result.stepResults, execution.stepResults);
});

test('WorkflowRunner passes workflow input through a zero-action workflow', async () => {
  const definition = createDefinition({
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [{ id: 'start-to-finish', from: 'start', to: 'finish' }]
  });
  const { runner } = createRunner();
  const input = { direct: true };

  const result = await runner.run(definition, runner.createExecution(definition, input));

  assert.equal(result.state, WorkflowState.COMPLETED);
  assert.deepEqual(result.completedSteps, ['start', 'finish']);
  assert.deepEqual(result.workflowOutput, input);
  assert.equal(result.durationMs, 25);
});

test('WorkflowRunner fails when an operation is not registered and preserves prior results', async () => {
  const definition = createDefinition();
  const { runner } = createRunner();

  const result = await runner.run(
    definition,
    runner.createExecution(definition, { value: 1 })
  );

  assert.equal(result.state, WorkflowState.FAILED);
  assert.deepEqual(result.completedSteps, ['start']);
  assert.equal(result.stepResults.length, 2);
  assert.equal(result.stepResults[0].status, WorkflowStepResultStatus.COMPLETED);
  assert.equal(result.stepResults[1].status, WorkflowStepResultStatus.FAILED);
  assert.deepEqual(result.failure, {
    code: 'operation_not_registered',
    message: 'Workflow operation is not registered.',
    stepId: 'first',
    operationId: 'test.first'
  });
  assert.equal(result.stepResults[1].failure, result.failure);
  assert.equal(result.durationMs, 25);
  assert.equal('workflowOutput' in result, false);
});

test('WorkflowRunner normalizes a synchronous handler throw without retaining its error', async () => {
  const definition = createDefinition();
  const { registry, runner } = createRunner();
  const rawError = new Error('sensitive handler details');

  registry.register('test.first', () => {
    throw rawError;
  });

  const result = await runner.run(definition, runner.createExecution(definition, {}));

  assert.deepEqual(result.failure, {
    code: 'operation_failed',
    message: 'Workflow operation failed.',
    stepId: 'first',
    operationId: 'test.first'
  });
  assert.equal(result.completedSteps.includes('first'), false);
  assert.equal(JSON.stringify(result).includes('sensitive handler details'), false);
  assert.equal(JSON.stringify(result).includes('stack'), false);
});

test('WorkflowRunner normalizes a rejected Promise without retaining its rejection value', async () => {
  const definition = createDefinition();
  const { registry, runner } = createRunner();

  registry.register('test.first', () =>
    Promise.reject({ privateDetail: 'must not be retained' })
  );

  const result = await runner.run(definition, runner.createExecution(definition, {}));

  assert.equal(result.failure.code, 'operation_failed');
  assert.equal(result.stepResults.at(-1).status, WorkflowStepResultStatus.FAILED);
  assert.equal(JSON.stringify(result).includes('privateDetail'), false);
});

test('WorkflowRunner reports no_next_step after preserving the completed current step', async () => {
  const definition = createDefinition({
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: []
  });
  const { runner } = createRunner();

  const result = await runner.run(definition, runner.createExecution(definition, 'input'));

  assert.equal(result.failure.code, 'no_next_step');
  assert.deepEqual(result.completedSteps, ['start']);
  assert.equal(result.stepResults.length, 1);
});

test('WorkflowRunner rejects multiple outgoing edges without selecting by edge order', async () => {
  const definition = createDefinition({
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'left', name: 'Left', kind: 'action', operation: 'test.left' },
      { id: 'right', name: 'Right', kind: 'action', operation: 'test.right' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-to-right', from: 'start', to: 'right' },
      { id: 'start-to-left', from: 'start', to: 'left' },
      { id: 'left-to-finish', from: 'left', to: 'finish' },
      { id: 'right-to-finish', from: 'right', to: 'finish' }
    ]
  });
  const { registry, runner } = createRunner();
  let handlerCalls = 0;
  registry.register('test.left', () => {
    handlerCalls += 1;
  });
  registry.register('test.right', () => {
    handlerCalls += 1;
  });

  const result = await runner.run(definition, runner.createExecution(definition, {}));

  assert.equal(result.failure.code, 'unsupported_multiple_outgoing_edges');
  assert.deepEqual(result.completedSteps, ['start']);
  assert.equal(handlerCalls, 0);
});

test('WorkflowRunner reports invalid_step for a missing edge target', async () => {
  const definition = createDefinition({
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [{ id: 'start-to-missing', from: 'start', to: 'missing' }]
  });
  const { runner } = createRunner();

  const result = await runner.run(definition, runner.createExecution(definition, {}));

  assert.deepEqual(result.failure, {
    code: 'invalid_step',
    message: 'Workflow edge references a step that does not exist.',
    stepId: 'missing'
  });
  assert.deepEqual(result.completedSteps, ['start']);
});

test('WorkflowRunner throws on definition mismatch and illegal initial state before execution', async () => {
  const definition = createDefinition();
  const { runner, clock } = createRunner();
  const execution = runner.createExecution(definition, {});

  await assert.rejects(
    runner.run({ ...definition, version: 2 }, execution),
    /does not match the execution identity/
  );
  await assert.rejects(
    runner.run(definition, { ...execution, state: WorkflowState.RUNNING }),
    /must be in the created state/
  );
  assert.equal(clock.callCount, 0);
  assert.deepEqual(execution.completedSteps, []);
});

test('InMemoryOperationRegistry resolves handlers and rejects duplicate stable IDs', () => {
  const registry = new InMemoryOperationRegistry();
  const handler = () => 'result';

  registry.register('test.operation', handler);

  assert.equal(registry.resolve('test.operation'), handler);
  assert.equal(registry.resolve('test.missing'), undefined);
  assert.throws(
    () => registry.register('test.operation', () => 'replacement'),
    /already registered/
  );
  assert.throws(() => registry.register(' ', handler), /must not be empty/);
});

test('Workflow runtime remains independent from EventBus and preserves ExecutionContext', () => {
  const runnerSource = readFileSync(
    join(__dirname, '../src/workflows/runtime/workflow-runner.ts'),
    'utf8'
  );
  const executionContextSource = readFileSync(
    join(__dirname, '../src/runtime/execution-context.ts'),
    'utf8'
  );

  assert.equal(runnerSource.includes('EventBus'), false);
  assert.equal(executionContextSource.includes('workflow'), false);
  assert.equal(executionContextSource.includes('currentStep'), false);
  assert.match(executionContextSource, /startedAt: Date/);
  assert.match(executionContextSource, /finishedAt: Date/);
});
