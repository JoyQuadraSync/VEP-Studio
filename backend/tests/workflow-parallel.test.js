const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  DeclarativeConditionEvaluator
} = require('../dist/workflows/runtime/condition-evaluator');
const {
  InMemoryOperationRegistry
} = require('../dist/workflows/runtime/operation-registry');
const {
  InMemoryWorkflowRunner
} = require('../dist/workflows/runtime/workflow-runner');
const { WorkflowState } = require('../dist/workflows/runtime/workflow-state');
const { GraphWorkflowValidator } = require('../dist/workflows/workflow-validator');

function createClock(incrementMs = 1) {
  let currentMs = 0;

  return {
    now() {
      const timestamp = new Date(currentMs);
      currentMs += incrementMs;
      return timestamp;
    }
  };
}

function createRunner(clock = createClock()) {
  const registry = new InMemoryOperationRegistry();
  const runner = new InMemoryWorkflowRunner(
    registry,
    new DeclarativeConditionEvaluator(),
    clock,
    { next: () => 'parallel-execution-1' }
  );

  return { registry, runner };
}

function createParallelDefinition(overrides = {}) {
  return {
    id: 'test.parallel.workflow',
    version: 1,
    name: 'Test Parallel Workflow',
    startStepId: 'start',
    finishStepId: 'finish',
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'fork', name: 'Fork', type: 'fork', joinStepId: 'join' },
      { id: 'alpha', name: 'Alpha', kind: 'action', operation: 'test.alpha' },
      { id: 'zeta', name: 'Zeta', kind: 'action', operation: 'test.zeta' },
      { id: 'join', name: 'Join', type: 'join', forkStepId: 'fork' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-to-fork', from: 'start', to: 'fork' },
      {
        id: 'fork-to-zeta',
        type: 'parallel',
        sourceStepId: 'fork',
        targetStepId: 'zeta',
        branchId: 'zeta'
      },
      {
        id: 'fork-to-alpha',
        type: 'parallel',
        sourceStepId: 'fork',
        targetStepId: 'alpha',
        branchId: 'alpha'
      },
      { id: 'alpha-to-join', from: 'alpha', to: 'join' },
      { id: 'zeta-to-join', from: 'zeta', to: 'join' },
      { id: 'join-to-finish', from: 'join', to: 'finish' }
    ],
    ...overrides
  };
}

test('WorkflowValidator accepts a frozen structured parallel region', () => {
  const result = new GraphWorkflowValidator().validate(createParallelDefinition());

  assert.deepEqual(result, { valid: true, issues: [] });
});

test('WorkflowExecution exposes enumerable parallel regions and survives immutable spread cloning', async () => {
  const definition = createParallelDefinition();
  const { registry, runner } = createRunner();
  registry.register('test.alpha', () => 'alpha');
  registry.register('test.zeta', () => 'zeta');
  const execution = runner.createExecution(definition, {});
  const clonedExecution = {
    ...execution,
    completedSteps: [...execution.completedSteps],
    stepResults: [...execution.stepResults],
    parallelRegions: [...execution.parallelRegions]
  };

  assert.equal(Object.prototype.propertyIsEnumerable.call(execution, 'parallelRegions'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(execution)).parallelRegions, []);

  const result = await runner.run(definition, clonedExecution);

  assert.equal(result.state, WorkflowState.COMPLETED);
  assert.equal(result.parallelRegions.length, 1);
  assert.deepEqual(execution.parallelRegions, []);
});

test('WorkflowValidator enforces parallel branch identity and fork edge contracts', () => {
  const definition = createParallelDefinition();
  const result = new GraphWorkflowValidator().validate({
    ...definition,
    edges: definition.edges.map((edge) => {
      if (edge.id === 'fork-to-zeta') {
        return { ...edge, branchId: 'Alpha Branch' };
      }

      if (edge.id === 'fork-to-alpha') {
        return { id: edge.id, from: 'fork', to: 'alpha' };
      }

      return edge;
    })
  });
  const codes = result.issues.map((issue) => issue.code);

  assert.ok(codes.includes('INVALID_PARALLEL_BRANCH_ID'));
  assert.ok(codes.includes('FORK_REQUIRES_PARALLEL_EDGE'));
});

test('WorkflowValidator rejects mismatched pairs, nested forks, and branch ownership conflicts', () => {
  const definition = createParallelDefinition({
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'fork', name: 'Fork', type: 'fork', joinStepId: 'join' },
      { id: 'nested', name: 'Nested', type: 'fork', joinStepId: 'join' },
      { id: 'shared', name: 'Shared', kind: 'action', operation: 'test.shared' },
      { id: 'join', name: 'Join', type: 'join', forkStepId: 'wrong-fork' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-to-fork', from: 'start', to: 'fork' },
      {
        id: 'fork-to-nested',
        type: 'parallel',
        sourceStepId: 'fork',
        targetStepId: 'nested',
        branchId: 'alpha'
      },
      {
        id: 'fork-to-shared',
        type: 'parallel',
        sourceStepId: 'fork',
        targetStepId: 'shared',
        branchId: 'zeta'
      },
      {
        id: 'nested-to-shared',
        type: 'parallel',
        sourceStepId: 'nested',
        targetStepId: 'shared',
        branchId: 'nested-a'
      },
      {
        id: 'nested-to-join',
        type: 'parallel',
        sourceStepId: 'nested',
        targetStepId: 'join',
        branchId: 'nested-b'
      },
      { id: 'shared-to-join', from: 'shared', to: 'join' },
      { id: 'join-to-finish', from: 'join', to: 'finish' }
    ]
  });
  const result = new GraphWorkflowValidator().validate(definition);
  const codes = result.issues.map((issue) => issue.code);

  assert.ok(codes.includes('PARALLEL_PAIR_MISMATCH'));
  assert.ok(codes.includes('INVALID_JOIN_FORK_REFERENCE'));
});

test('WorkflowValidator rejects nested parallel regions and shared branch steps', () => {
  const definition = {
    id: 'test.invalid.parallel.workflow',
    version: 1,
    name: 'Invalid Parallel Workflow',
    startStepId: 'start',
    finishStepId: 'finish',
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'outer-fork', name: 'Outer fork', type: 'fork', joinStepId: 'outer-join' },
      { id: 'inner-fork', name: 'Inner fork', type: 'fork', joinStepId: 'inner-join' },
      { id: 'inner-a', name: 'Inner A', kind: 'action', operation: 'test.inner-a' },
      { id: 'inner-b', name: 'Inner B', kind: 'action', operation: 'test.inner-b' },
      { id: 'inner-join', name: 'Inner join', type: 'join', forkStepId: 'inner-fork' },
      { id: 'shared', name: 'Shared', kind: 'action', operation: 'test.shared' },
      { id: 'outer-join', name: 'Outer join', type: 'join', forkStepId: 'outer-fork' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-outer', from: 'start', to: 'outer-fork' },
      { id: 'outer-alpha', type: 'parallel', sourceStepId: 'outer-fork', targetStepId: 'inner-fork', branchId: 'alpha' },
      { id: 'outer-zeta', type: 'parallel', sourceStepId: 'outer-fork', targetStepId: 'shared', branchId: 'zeta' },
      { id: 'inner-a-edge', type: 'parallel', sourceStepId: 'inner-fork', targetStepId: 'inner-a', branchId: 'a' },
      { id: 'inner-b-edge', type: 'parallel', sourceStepId: 'inner-fork', targetStepId: 'inner-b', branchId: 'b' },
      { id: 'inner-a-join', from: 'inner-a', to: 'inner-join' },
      { id: 'inner-b-join', from: 'inner-b', to: 'inner-join' },
      { id: 'inner-join-shared', from: 'inner-join', to: 'shared' },
      { id: 'shared-outer-join', from: 'shared', to: 'outer-join' },
      { id: 'outer-join-finish', from: 'outer-join', to: 'finish' }
    ]
  };
  const result = new GraphWorkflowValidator().validate(definition);
  const codes = result.issues.map((issue) => issue.code);

  assert.ok(codes.includes('NESTED_PARALLEL_REGION'));
  assert.ok(codes.includes('PARALLEL_BRANCH_OUTSIDE_ENTRY'));
});

test('WorkflowValidator rejects loops and outside join entries in parallel regions', () => {
  const definition = createParallelDefinition({
    steps: [
      ...createParallelDefinition().steps,
      { id: 'outsider', name: 'Outsider', kind: 'action', operation: 'test.outsider' }
    ],
    edges: [
      ...createParallelDefinition().edges,
      { id: 'alpha-loop', from: 'alpha', to: 'alpha' },
      { id: 'outsider-join', from: 'outsider', to: 'join' },
      { id: 'start-outsider', from: 'start', to: 'outsider' }
    ]
  });
  const result = new GraphWorkflowValidator().validate(definition);
  const codes = result.issues.map((issue) => issue.code);

  assert.ok(codes.includes('PARALLEL_BRANCH_LOOP'));
  assert.ok(codes.includes('PARALLEL_JOIN_OUTSIDE_ENTRY'));
});

test('Validator and runner reject start steps inside parallel branches', async () => {
  const baseDefinition = createParallelDefinition();
  const definition = createParallelDefinition({
    steps: baseDefinition.steps.map((step) =>
      step.id === 'alpha'
        ? { id: 'alpha', name: 'Invalid branch start', kind: 'start' }
        : step
    )
  });
  const validation = new GraphWorkflowValidator().validate(definition);

  assert.ok(
    validation.issues.some(
      (issue) => issue.code === 'PARALLEL_BRANCH_INVALID_STEP_KIND'
    )
  );

  const { registry, runner } = createRunner();
  registry.register('test.zeta', () => 'zeta');
  const result = await runner.run(definition, runner.createExecution(definition, {}));
  const alphaBranch = result.parallelRegions[0].branches[0];

  assert.equal(result.state, WorkflowState.FAILED);
  assert.equal(result.failure.code, 'parallel_branch_failed');
  assert.equal(alphaBranch.state, 'failed');
  assert.equal(alphaBranch.failure.code, 'parallel_join_mismatch');
  assert.deepEqual(alphaBranch.completedSteps, []);
});

test('WorkflowValidator rejects sibling completed-result visibility from a branch decision', () => {
  const definition = createParallelDefinition({
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'fork', name: 'Fork', type: 'fork', joinStepId: 'join' },
      { id: 'alpha-decision', name: 'Alpha decision', kind: 'decision' },
      { id: 'alpha-action', name: 'Alpha action', kind: 'action', operation: 'test.alpha' },
      { id: 'zeta', name: 'Zeta', kind: 'action', operation: 'test.zeta' },
      { id: 'join', name: 'Join', type: 'join', forkStepId: 'fork' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-to-fork', from: 'start', to: 'fork' },
      {
        id: 'fork-to-alpha',
        type: 'parallel',
        sourceStepId: 'fork',
        targetStepId: 'alpha-decision',
        branchId: 'alpha'
      },
      {
        id: 'fork-to-zeta',
        type: 'parallel',
        sourceStepId: 'fork',
        targetStepId: 'zeta',
        branchId: 'zeta'
      },
      {
        id: 'alpha-conditional',
        from: 'alpha-decision',
        to: 'alpha-action',
        condition: {
          operator: 'exists',
          operand: {
            kind: 'reference',
            reference: {
              source: 'completed_step_result',
              stepId: 'zeta',
              field: 'output',
              path: []
            }
          }
        }
      },
      { id: 'alpha-default', from: 'alpha-decision', to: 'join', default: true },
      { id: 'alpha-to-join', from: 'alpha-action', to: 'join' },
      { id: 'zeta-to-join', from: 'zeta', to: 'join' },
      { id: 'join-to-finish', from: 'join', to: 'finish' }
    ]
  });
  const result = new GraphWorkflowValidator().validate(definition);

  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'PARALLEL_CONDITION_REFERENCE_OUTSIDE_BRANCH'
    )
  );
});

test('WorkflowRunner executes branches concurrently and orders histories by branch id', async () => {
  const definition = createParallelDefinition();
  const { registry, runner } = createRunner();
  const resolvers = new Map();
  const started = [];

  registry.register('test.alpha', () => new Promise((resolve) => {
    started.push('alpha');
    resolvers.set('alpha', resolve);
  }));
  registry.register('test.zeta', () => new Promise((resolve) => {
    started.push('zeta');
    resolvers.set('zeta', resolve);
  }));

  const initial = runner.createExecution(definition, { value: 3 });
  Object.freeze(initial.completedSteps);
  Object.freeze(initial.stepResults);
  Object.freeze(initial.parallelRegions);
  Object.freeze(initial);
  const running = runner.run(definition, initial);

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started.sort(), ['alpha', 'zeta']);
  resolvers.get('zeta')({ branch: 'zeta' });
  await Promise.resolve();
  resolvers.get('alpha')({ branch: 'alpha' });

  const result = await running;

  assert.equal(result.state, WorkflowState.COMPLETED);
  assert.equal(result.activeParallel, undefined);
  assert.equal('activeParallel' in result, false);
  assert.deepEqual(result.completedSteps, [
    'start',
    'fork',
    'alpha',
    'zeta',
    'join',
    'finish'
  ]);
  assert.deepEqual(
    result.stepResults.map((stepResult) => stepResult.stepId),
    result.completedSteps
  );
  assert.deepEqual(
    result.parallelRegions[0].branches.map((branch) => branch.branchId),
    ['alpha', 'zeta']
  );
  assert.deepEqual(result.parallelRegions[0].output, [
    { branchId: 'alpha', output: { branch: 'alpha' } },
    { branchId: 'zeta', output: { branch: 'zeta' } }
  ]);
  assert.deepEqual(result.workflowOutput, result.parallelRegions[0].output);
  assert.deepEqual(initial.completedSteps, []);
  assert.deepEqual(initial.parallelRegions, []);
  assert.notEqual(result.parallelRegions, initial.parallelRegions);
  assert.equal('currentStepId' in result.parallelRegions[0].branches[0], false);
});

test('WorkflowRunner may invoke the same operation handler concurrently without sharing execution state', async () => {
  const definition = createParallelDefinition({
    steps: createParallelDefinition().steps.map((step) =>
      step.id === 'alpha' || step.id === 'zeta'
        ? { ...step, operation: 'test.shared' }
        : step
    )
  });
  const { registry, runner } = createRunner();
  let activeCalls = 0;
  let maximumActiveCalls = 0;
  const pending = [];

  registry.register('test.shared', (input) => new Promise((resolve) => {
    activeCalls += 1;
    maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
    pending.push(() => {
      activeCalls -= 1;
      resolve(input.stepId);
    });
  }));

  const running = runner.run(definition, runner.createExecution(definition, {}));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(maximumActiveCalls, 2);
  pending.reverse().forEach((resolve) => resolve());

  const result = await running;

  assert.deepEqual(result.parallelRegions[0].output, [
    { branchId: 'alpha', output: 'alpha' },
    { branchId: 'zeta', output: 'zeta' }
  ]);
});

test('WorkflowRunner records all-settled failure details at the paired join', async () => {
  const definition = createParallelDefinition();
  const { registry, runner } = createRunner();
  let successfulBranchCompleted = false;

  registry.register('test.alpha', () => {
    throw new Error('private alpha failure');
  });
  registry.register('test.zeta', async () => {
    await Promise.resolve();
    successfulBranchCompleted = true;
    return 'zeta-output';
  });

  const result = await runner.run(
    definition,
    runner.createExecution(definition, 'input')
  );

  assert.equal(successfulBranchCompleted, true);
  assert.equal(result.state, WorkflowState.FAILED);
  assert.deepEqual(result.failure, {
    code: 'parallel_branch_failed',
    message: 'One or more parallel branches failed.',
    stepId: 'join'
  });
  assert.equal(result.activeParallel, undefined);
  assert.equal(result.parallelRegions[0].state, 'failed');
  assert.deepEqual(
    result.parallelRegions[0].branches.map((branch) => branch.state),
    ['failed', 'completed']
  );
  assert.deepEqual(result.completedSteps, ['start', 'fork', 'zeta']);
  assert.deepEqual(
    result.stepResults.map((stepResult) => stepResult.stepId),
    ['start', 'fork', 'alpha', 'zeta']
  );
  assert.equal(result.completedSteps.includes('join'), false);
  assert.equal(result.stepResults.some((stepResult) => stepResult.stepId === 'join'), false);
  assert.equal(JSON.stringify(result).includes('private alpha failure'), false);
});

test('WorkflowRunner supports a zero-action branch with pass-through output', async () => {
  const definition = createParallelDefinition({
    steps: createParallelDefinition().steps.filter((step) => step.id !== 'alpha'),
    edges: createParallelDefinition().edges
      .filter((edge) => edge.id !== 'alpha-to-join')
      .map((edge) => edge.id === 'fork-to-alpha'
        ? { ...edge, targetStepId: 'join' }
        : edge)
  });
  const { registry, runner } = createRunner();
  registry.register('test.zeta', () => 'zeta-output');

  const input = { passThrough: true };
  const result = await runner.run(definition, runner.createExecution(definition, input));
  const alphaBranch = result.parallelRegions[0].branches[0];

  assert.equal(alphaBranch.branchId, 'alpha');
  assert.equal(alphaBranch.state, 'completed');
  assert.deepEqual(alphaBranch.completedSteps, []);
  assert.deepEqual(alphaBranch.stepResults, []);
  assert.equal(alphaBranch.output, input);
  assert.ok(alphaBranch.durationMs >= 0);
});

test('WorkflowRunner supports branch-local decisions without exposing sibling timing', async () => {
  const definition = createParallelDefinition({
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'before', name: 'Before', kind: 'action', operation: 'test.before' },
      { id: 'fork', name: 'Fork', type: 'fork', joinStepId: 'join' },
      { id: 'alpha', name: 'Alpha', kind: 'action', operation: 'test.alpha' },
      { id: 'choose', name: 'Choose', kind: 'decision' },
      { id: 'chosen', name: 'Chosen', kind: 'action', operation: 'test.chosen' },
      { id: 'zeta', name: 'Zeta', kind: 'action', operation: 'test.zeta' },
      { id: 'join', name: 'Join', type: 'join', forkStepId: 'fork' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-to-before', from: 'start', to: 'before' },
      { id: 'before-to-fork', from: 'before', to: 'fork' },
      { id: 'fork-alpha', type: 'parallel', sourceStepId: 'fork', targetStepId: 'alpha', branchId: 'alpha' },
      { id: 'fork-zeta', type: 'parallel', sourceStepId: 'fork', targetStepId: 'zeta', branchId: 'zeta' },
      { id: 'alpha-to-choose', from: 'alpha', to: 'choose' },
      {
        id: 'choose-chosen',
        from: 'choose',
        to: 'chosen',
        condition: {
          operator: 'equals',
          left: {
            kind: 'reference',
            reference: {
              source: 'completed_step_result',
              stepId: 'alpha',
              field: 'output',
              path: ['value']
            }
          },
          right: { kind: 'literal', value: 2 }
        }
      },
      { id: 'choose-default', from: 'choose', to: 'join', default: true },
      { id: 'chosen-to-join', from: 'chosen', to: 'join' },
      { id: 'zeta-to-join', from: 'zeta', to: 'join' },
      { id: 'join-to-finish', from: 'join', to: 'finish' }
    ]
  });
  assert.deepEqual(new GraphWorkflowValidator().validate(definition), { valid: true, issues: [] });
  const { registry, runner } = createRunner();
  registry.register('test.before', () => ({ value: 1 }));
  registry.register('test.alpha', () => ({ value: 2 }));
  registry.register('test.chosen', () => 'selected');
  registry.register('test.zeta', () => 'zeta');

  const result = await runner.run(definition, runner.createExecution(definition, {}));

  assert.equal(result.state, WorkflowState.COMPLETED);
  assert.deepEqual(
    result.parallelRegions[0].branches[0].completedSteps,
    ['alpha', 'choose', 'chosen']
  );
});

test('WorkflowRunner retains sequential parallel regions in encounter order', async () => {
  const definition = {
    id: 'test.sequential.parallel.workflow',
    version: 1,
    name: 'Sequential Parallel Workflow',
    startStepId: 'start',
    finishStepId: 'finish',
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'fork-one', name: 'Fork one', type: 'fork', joinStepId: 'join-one' },
      { id: 'one-a', name: 'One A', kind: 'action', operation: 'test.one-a' },
      { id: 'one-b', name: 'One B', kind: 'action', operation: 'test.one-b' },
      { id: 'join-one', name: 'Join one', type: 'join', forkStepId: 'fork-one' },
      { id: 'fork-two', name: 'Fork two', type: 'fork', joinStepId: 'join-two' },
      { id: 'two-a', name: 'Two A', kind: 'action', operation: 'test.two-a' },
      { id: 'two-b', name: 'Two B', kind: 'action', operation: 'test.two-b' },
      { id: 'join-two', name: 'Join two', type: 'join', forkStepId: 'fork-two' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-fork-one', from: 'start', to: 'fork-one' },
      { id: 'fork-one-a', type: 'parallel', sourceStepId: 'fork-one', targetStepId: 'one-a', branchId: 'a' },
      { id: 'fork-one-b', type: 'parallel', sourceStepId: 'fork-one', targetStepId: 'one-b', branchId: 'b' },
      { id: 'one-a-join', from: 'one-a', to: 'join-one' },
      { id: 'one-b-join', from: 'one-b', to: 'join-one' },
      { id: 'join-one-fork-two', from: 'join-one', to: 'fork-two' },
      { id: 'fork-two-a', type: 'parallel', sourceStepId: 'fork-two', targetStepId: 'two-a', branchId: 'a' },
      { id: 'fork-two-b', type: 'parallel', sourceStepId: 'fork-two', targetStepId: 'two-b', branchId: 'b' },
      { id: 'two-a-join', from: 'two-a', to: 'join-two' },
      { id: 'two-b-join', from: 'two-b', to: 'join-two' },
      { id: 'join-two-finish', from: 'join-two', to: 'finish' }
    ]
  };
  assert.deepEqual(new GraphWorkflowValidator().validate(definition), { valid: true, issues: [] });
  const { registry, runner } = createRunner();

  for (const operation of ['one-a', 'one-b', 'two-a', 'two-b']) {
    registry.register(`test.${operation}`, () => operation);
  }

  const result = await runner.run(definition, runner.createExecution(definition, {}));

  assert.equal(result.state, WorkflowState.COMPLETED);
  assert.equal(result.activeParallel, undefined);
  assert.deepEqual(
    result.parallelRegions.map((region) => region.forkStepId),
    ['fork-one', 'fork-two']
  );
  assert.deepEqual(result.completedSteps, [
    'start', 'fork-one', 'one-a', 'one-b', 'join-one',
    'fork-two', 'two-a', 'two-b', 'join-two', 'finish'
  ]);
});

test('WorkflowRunner rejects supplied active parallel state before execution', async () => {
  const definition = createParallelDefinition();
  const { runner } = createRunner();
  const execution = runner.createExecution(definition, {});

  await assert.rejects(
    runner.run(definition, {
      ...execution,
      activeParallel: {
        forkStepId: 'fork',
        joinStepId: 'join',
        input: {},
        branches: []
      }
    }),
    /must not contain active parallel state/
  );
});

test('Parallel durations are elapsed values and do not determine branch ordering', async () => {
  const definition = createParallelDefinition();
  const { registry, runner } = createRunner(createClock(2));
  registry.register('test.alpha', async () => 'alpha');
  registry.register('test.zeta', async () => 'zeta');

  const result = await runner.run(definition, runner.createExecution(definition, {}));
  const region = result.parallelRegions[0];
  const branchDurationSum = region.branches.reduce(
    (sum, branch) => sum + branch.durationMs,
    0
  );

  assert.ok(region.durationMs >= 0);
  assert.notEqual(region.durationMs, branchDurationSum);
  assert.deepEqual(region.branches.map((branch) => branch.branchId), ['alpha', 'zeta']);
});

test('WorkflowRunner normalizes every duration to a finite non-negative value', async () => {
  const timestamps = [100, 90, Number.NaN];
  let callIndex = 0;
  const unstableClock = {
    now() {
      const timestamp = timestamps[callIndex % timestamps.length];
      callIndex += 1;
      return new Date(timestamp);
    }
  };
  const definition = createParallelDefinition();
  const { registry, runner } = createRunner(unstableClock);
  registry.register('test.alpha', () => 'alpha');
  registry.register('test.zeta', () => 'zeta');

  const result = await runner.run(definition, runner.createExecution(definition, {}));
  const durations = [
    result.durationMs,
    ...result.stepResults.map((stepResult) => stepResult.durationMs),
    ...result.parallelRegions.map((region) => region.durationMs),
    ...result.parallelRegions.flatMap((region) =>
      region.branches.map((branch) => branch.durationMs)
    )
  ];

  for (const duration of durations) {
    assert.equal(Number.isFinite(duration), true);
    assert.ok(duration >= 0);
  }
});

test('Parallel runtime keeps EventBus, ExecutionContext, OperationRegistry, and condition language unchanged', () => {
  const runnerSource = readFileSync(
    join(__dirname, '../src/workflows/runtime/workflow-runner.ts'),
    'utf8'
  );
  const executionContextSource = readFileSync(
    join(__dirname, '../src/runtime/execution-context.ts'),
    'utf8'
  );
  const registrySource = readFileSync(
    join(__dirname, '../src/workflows/runtime/operation-registry.ts'),
    'utf8'
  );
  const conditionSource = readFileSync(
    join(__dirname, '../src/workflows/workflow-condition.ts'),
    'utf8'
  );

  assert.equal(runnerSource.includes('EventBus'), false);
  assert.equal(executionContextSource.includes('parallel'), false);
  assert.equal(registrySource.includes('branch'), false);
  assert.equal(conditionSource.includes('parallel'), false);
});
