const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DeclarativeConditionEvaluator
} = require('../dist/workflows/runtime/condition-evaluator');
const { InMemoryOperationRegistry } = require('../dist/workflows/runtime/operation-registry');
const { InMemoryWorkflowRunner } = require('../dist/workflows/runtime/workflow-runner');
const {
  WorkflowState,
  WorkflowStepResultStatus
} = require('../dist/workflows/runtime/workflow-state');
const { GraphWorkflowValidator } = require('../dist/workflows/workflow-validator');

function reference(source, path = []) {
  return { kind: 'reference', reference: { source, path } };
}

function literal(value) {
  return { kind: 'literal', value };
}

function createEvaluationInput() {
  return {
    workflowInput: {
      customer: { priority: 'urgent', riskScore: 85 },
      items: [{ amount: 10 }]
    },
    currentStepInput: { category: 'callback', score: 5 },
    currentStepOutput: { category: 'callback', score: 6 },
    completedStepResults: [
      {
        stepId: 'classify',
        status: WorkflowStepResultStatus.COMPLETED,
        input: { raw: true },
        output: { priority: 'urgent' },
        durationMs: 1
      },
      {
        stepId: 'failed-step',
        status: WorkflowStepResultStatus.FAILED,
        input: {},
        failure: {
          code: 'operation_failed',
          message: 'Workflow operation failed.',
          stepId: 'failed-step',
          operationId: 'test.fail'
        },
        durationMs: 1
      }
    ],
    executionMetadata: {
      executionId: 'execution-1',
      workflowId: 'test.decision.workflow',
      workflowVersion: 2,
      state: WorkflowState.RUNNING
    }
  };
}

function evaluate(condition, input = createEvaluationInput()) {
  return new DeclarativeConditionEvaluator().evaluate(condition, input);
}

function createDecisionDefinition(overrides = {}) {
  return {
    id: 'test.decision.workflow',
    version: 1,
    name: 'Test Decision Workflow',
    startStepId: 'start',
    finishStepId: 'finish',
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'route', name: 'Route', kind: 'decision' },
      { id: 'urgent', name: 'Urgent', kind: 'action', operation: 'test.urgent' },
      { id: 'standard', name: 'Standard', kind: 'action', operation: 'test.standard' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-to-route', from: 'start', to: 'route' },
      {
        id: 'urgent-branch',
        from: 'route',
        to: 'urgent',
        condition: {
          operator: 'equals',
          left: reference('current_step_output', ['priority']),
          right: literal('urgent')
        }
      },
      { id: 'default-branch', from: 'route', to: 'standard', default: true },
      { id: 'urgent-to-finish', from: 'urgent', to: 'finish' },
      { id: 'standard-to-finish', from: 'standard', to: 'finish' }
    ],
    ...overrides
  };
}

function createRunner(executionIds = ['execution-1']) {
  const registry = new InMemoryOperationRegistry();
  const ids = [...executionIds];
  let time = 0;
  const clock = {
    now() {
      const value = new Date(time);
      time += 5;
      return value;
    }
  };
  const idGenerator = {
    next() {
      const id = ids.shift();

      if (!id) {
        throw new Error('Test id generator exhausted.');
      }

      return id;
    }
  };

  return {
    registry,
    runner: new InMemoryWorkflowRunner(
      registry,
      new DeclarativeConditionEvaluator(),
      clock,
      idGenerator
    )
  };
}

test('ConditionEvaluator supports the frozen comparison and existence operators', () => {
  const cases = [
    ['equals', literal('urgent'), reference('workflow_input', ['customer', 'priority']), true],
    ['not_equals', literal('normal'), reference('current_step_input', ['category']), true],
    ['greater_than', reference('workflow_input', ['customer', 'riskScore']), literal(80), true],
    ['greater_than_or_equal', reference('current_step_output', ['score']), literal(6), true],
    ['less_than', reference('current_step_input', ['score']), literal(6), true],
    ['less_than_or_equal', reference('workflow_input', ['items', 0, 'amount']), literal(10), true]
  ];

  for (const [operator, left, right, expected] of cases) {
    assert.deepEqual(evaluate({ operator, left, right }), { success: true, value: expected });
  }

  assert.deepEqual(
    evaluate({ operator: 'exists', operand: reference('workflow_input', ['customer']) }),
    { success: true, value: true }
  );
  assert.deepEqual(
    evaluate({ operator: 'not_exists', operand: reference('workflow_input', ['missing']) }),
    { success: true, value: true }
  );
});

test('ConditionEvaluator supports and, or, and not without hiding malformed children', () => {
  const falseCondition = { operator: 'equals', left: literal(1), right: literal(2) };
  const trueCondition = { operator: 'equals', left: literal(1), right: literal(1) };
  const malformedCondition = { operator: 'equals', left: literal(1), right: literal('1') };

  assert.deepEqual(
    evaluate({ operator: 'and', conditions: [trueCondition, trueCondition] }),
    { success: true, value: true }
  );
  assert.deepEqual(
    evaluate({ operator: 'or', conditions: [falseCondition, trueCondition] }),
    { success: true, value: true }
  );
  assert.deepEqual(evaluate({ operator: 'not', condition: falseCondition }), {
    success: true,
    value: true
  });
  assert.equal(
    evaluate({ operator: 'and', conditions: [falseCondition, malformedCondition] }).success,
    false
  );
  assert.equal(
    evaluate({ operator: 'or', conditions: [trueCondition, malformedCondition] }).success,
    false
  );
});

test('ConditionEvaluator reads only approved completed results and execution metadata', () => {
  const completedOutputReference = {
    kind: 'reference',
    reference: {
      source: 'completed_step_result',
      stepId: 'classify',
      field: 'output',
      path: ['priority']
    }
  };
  const failureCodeReference = {
    kind: 'reference',
    reference: {
      source: 'completed_step_result',
      stepId: 'failed-step',
      field: 'failure.code'
    }
  };
  const metadataFields = [
    ['executionId', 'execution-1'],
    ['workflowId', 'test.decision.workflow'],
    ['workflowVersion', 2],
    ['state', WorkflowState.RUNNING]
  ];

  assert.deepEqual(
    evaluate({ operator: 'equals', left: completedOutputReference, right: literal('urgent') }),
    { success: true, value: true }
  );
  assert.deepEqual(
    evaluate({ operator: 'equals', left: failureCodeReference, right: literal('operation_failed') }),
    { success: true, value: true }
  );

  for (const [field, expected] of metadataFields) {
    assert.deepEqual(
      evaluate({
        operator: 'equals',
        left: {
          kind: 'reference',
          reference: { source: 'execution_metadata', field }
        },
        right: literal(expected)
      }),
      { success: true, value: true }
    );
  }
});

test('ConditionEvaluator fails explicitly for missing comparison data and type mismatch', () => {
  const missing = evaluate({
    operator: 'equals',
    left: reference('workflow_input', ['missing']),
    right: literal('value')
  });
  const mismatch = evaluate({
    operator: 'greater_than',
    left: literal('high'),
    right: literal('low')
  });
  const invalidTraversal = evaluate({
    operator: 'exists',
    operand: reference('workflow_input', ['customer', 'priority', 'nested'])
  });

  assert.equal(missing.success, false);
  assert.equal(missing.failure.code, 'condition_evaluation_failed');
  assert.equal(mismatch.success, false);
  assert.equal(mismatch.failure.code, 'condition_evaluation_failed');
  assert.equal(invalidTraversal.success, false);
  assert.equal(invalidTraversal.failure.code, 'condition_evaluation_failed');
});

test('WorkflowValidator accepts decision branches and enforces frozen edge rules', () => {
  const validator = new GraphWorkflowValidator();
  const valid = validator.validate(createDecisionDefinition());
  const multipleDefaults = validator.validate(
    createDecisionDefinition({
      edges: [
        { id: 'start-to-route', from: 'start', to: 'route' },
        { id: 'default-one', from: 'route', to: 'urgent', default: true },
        { id: 'default-two', from: 'route', to: 'standard', default: true },
        { id: 'urgent-to-finish', from: 'urgent', to: 'finish' },
        { id: 'standard-to-finish', from: 'standard', to: 'finish' }
      ]
    })
  );
  const conditionalStart = validator.validate(
    createDecisionDefinition({
      edges: [
        {
          id: 'start-to-route',
          from: 'start',
          to: 'route',
          condition: { operator: 'equals', left: literal(true), right: literal(true) }
        },
        { id: 'default-branch', from: 'route', to: 'standard', default: true },
        { id: 'urgent-to-finish', from: 'urgent', to: 'finish' },
        { id: 'standard-to-finish', from: 'standard', to: 'finish' }
      ]
    })
  );

  assert.deepEqual(valid, { valid: true, issues: [] });
  assert.ok(multipleDefaults.issues.some((issue) => issue.code === 'MULTIPLE_DEFAULT_EDGES'));
  assert.ok(
    conditionalStart.issues.some(
      (issue) => issue.code === 'LINEAR_STEP_REQUIRES_UNCONDITIONAL_EDGE'
    )
  );
});

test('WorkflowValidator enforces serializable conditions and implementation-defined depth', () => {
  const shallowValidator = new GraphWorkflowValidator(2);
  const nestedCondition = {
    operator: 'not',
    condition: {
      operator: 'not',
      condition: { operator: 'equals', left: literal(1), right: literal(1) }
    }
  };
  const depthResult = shallowValidator.validate(
    createDecisionDefinition({
      edges: [
        { id: 'start-to-route', from: 'start', to: 'route' },
        { id: 'nested', from: 'route', to: 'urgent', condition: nestedCondition },
        { id: 'default', from: 'route', to: 'standard', default: true },
        { id: 'urgent-to-finish', from: 'urgent', to: 'finish' },
        { id: 'standard-to-finish', from: 'standard', to: 'finish' }
      ]
    })
  );
  const callbackResult = shallowValidator.validate(
    createDecisionDefinition({
      edges: [
        { id: 'start-to-route', from: 'start', to: 'route' },
        { id: 'callback', from: 'route', to: 'urgent', condition: () => true },
        { id: 'default', from: 'route', to: 'standard', default: true },
        { id: 'urgent-to-finish', from: 'urgent', to: 'finish' },
        { id: 'standard-to-finish', from: 'standard', to: 'finish' }
      ]
    })
  );

  assert.ok(depthResult.issues.some((issue) => issue.code === 'CONDITION_DEPTH_EXCEEDED'));
  assert.ok(
    callbackResult.issues.some((issue) => issue.code === 'NON_SERIALIZABLE_CONDITION')
  );
});

test('WorkflowRunner selects one decision branch and records pass-through decision result', async () => {
  const definition = createDecisionDefinition();
  const { registry, runner } = createRunner();
  registry.register('test.urgent', (input) => ({ ...input.stepInput, routed: 'urgent' }));
  registry.register('test.standard', (input) => ({ ...input.stepInput, routed: 'standard' }));
  const initial = runner.createExecution(definition, { priority: 'urgent' });
  Object.freeze(initial.completedSteps);
  Object.freeze(initial.stepResults);
  Object.freeze(initial);

  const result = await runner.run(definition, initial);
  const decisionResult = result.stepResults.find((stepResult) => stepResult.stepId === 'route');

  assert.equal(result.state, WorkflowState.COMPLETED);
  assert.deepEqual(result.completedSteps, ['start', 'route', 'urgent', 'finish']);
  assert.deepEqual(result.workflowOutput, { priority: 'urgent', routed: 'urgent' });
  assert.deepEqual(decisionResult.input, { priority: 'urgent' });
  assert.deepEqual(decisionResult.output, { priority: 'urgent' });
  assert.deepEqual(initial.completedSteps, []);
  assert.deepEqual(initial.stepResults, []);
});

test('WorkflowRunner uses default only when no conditional edge matches', async () => {
  const definition = createDecisionDefinition();
  const { registry, runner } = createRunner();
  registry.register('test.urgent', () => 'urgent');
  registry.register('test.standard', () => 'standard');

  const result = await runner.run(
    definition,
    runner.createExecution(definition, { priority: 'normal' })
  );

  assert.deepEqual(result.completedSteps, ['start', 'route', 'standard', 'finish']);
  assert.equal(result.workflowOutput, 'standard');
});

test('WorkflowRunner fails explicitly for multiple matching branches independent of edge order', async () => {
  const matchingCondition = {
    operator: 'equals',
    left: reference('workflow_input', ['priority']),
    right: literal('urgent')
  };
  const branchEdges = [
    { id: 'first-match', from: 'route', to: 'urgent', condition: matchingCondition },
    { id: 'second-match', from: 'route', to: 'standard', condition: matchingCondition }
  ];
  const baseEdges = [
    { id: 'start-to-route', from: 'start', to: 'route' },
    { id: 'urgent-to-finish', from: 'urgent', to: 'finish' },
    { id: 'standard-to-finish', from: 'standard', to: 'finish' }
  ];
  const firstDefinition = createDecisionDefinition({ edges: [baseEdges[0], ...branchEdges, ...baseEdges.slice(1)] });
  const secondDefinition = createDecisionDefinition({ edges: [baseEdges[0], ...branchEdges.toReversed(), ...baseEdges.slice(1)] });

  for (const definition of [firstDefinition, secondDefinition]) {
    const { runner } = createRunner();
    const result = await runner.run(
      definition,
      runner.createExecution(definition, { priority: 'urgent' })
    );

    assert.equal(result.failure.code, 'multiple_matching_branches');
    assert.deepEqual(result.completedSteps, ['start', 'route']);
  }
});

test('WorkflowRunner reports no_matching_branch and condition_evaluation_failed', async () => {
  const noDefaultDefinition = createDecisionDefinition({
    edges: createDecisionDefinition().edges.filter((edge) => edge.id !== 'default-branch')
  });
  const invalidConditionDefinition = createDecisionDefinition({
    edges: createDecisionDefinition().edges.map((edge) =>
      edge.id === 'urgent-branch'
        ? {
            ...edge,
            condition: {
              operator: 'greater_than',
              left: reference('workflow_input', ['priority']),
              right: literal(10)
            }
          }
        : edge
    )
  });

  const noMatchRuntime = createRunner();
  const noMatch = await noMatchRuntime.runner.run(
    noDefaultDefinition,
    noMatchRuntime.runner.createExecution(noDefaultDefinition, { priority: 'normal' })
  );
  const evaluationRuntime = createRunner();
  const evaluationFailure = await evaluationRuntime.runner.run(
    invalidConditionDefinition,
    evaluationRuntime.runner.createExecution(invalidConditionDefinition, { priority: 'urgent' })
  );

  assert.equal(noMatch.failure.code, 'no_matching_branch');
  assert.deepEqual(noMatch.completedSteps, ['start', 'route']);
  assert.equal(evaluationFailure.failure.code, 'condition_evaluation_failed');
  assert.deepEqual(evaluationFailure.completedSteps, ['start', 'route']);
});
