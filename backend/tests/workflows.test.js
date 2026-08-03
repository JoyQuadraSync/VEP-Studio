const test = require('node:test');
const assert = require('node:assert/strict');

const {
  customerCommentWorkflow
} = require('../dist/workflows/definitions/customer-comment.workflow');
const { InMemoryWorkflowRegistry } = require('../dist/workflows/workflow-registry');
const { GraphWorkflowValidator } = require('../dist/workflows/workflow-validator');

function createLinearWorkflow(overrides = {}) {
  return {
    id: 'test.linear.workflow',
    version: 1,
    name: 'Test Linear Workflow',
    startStepId: 'start',
    finishStepId: 'finish',
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'action', name: 'Action', kind: 'action', operation: 'test.action' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-to-action', from: 'start', to: 'action' },
      { id: 'action-to-finish', from: 'action', to: 'finish' }
    ],
    ...overrides
  };
}

test('CustomerCommentWorkflow is a valid namespaced declarative graph', () => {
  const validator = new GraphWorkflowValidator();
  const result = validator.validate(customerCommentWorkflow);

  assert.deepEqual(result, { valid: true, issues: [] });
  assert.equal(customerCommentWorkflow.id, 'customer.comment.workflow');
  assert.equal(customerCommentWorkflow.version, 1);
  assert.equal(customerCommentWorkflow.startStepId, 'start');
  assert.equal(customerCommentWorkflow.finishStepId, 'finish');
  assert.deepEqual(
    customerCommentWorkflow.steps
      .filter((step) => step.kind === 'action')
      .map((step) => step.operation),
    ['comment.process', 'comment.audit']
  );
});

test('WorkflowValidator reports identity, version, and graph integrity issues', () => {
  const validator = new GraphWorkflowValidator();
  const definition = createLinearWorkflow({
    id: 'invalid-id',
    version: 0,
    name: ' ',
    startStepId: 'action',
    finishStepId: 'missing',
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'action', name: 'Action', kind: 'action', operation: 'test.action' },
      { id: 'action', name: 'Duplicate', kind: 'action', operation: 'test.duplicate' }
    ],
    edges: [
      { id: 'broken', from: 'unknown', to: 'action' },
      { id: 'broken', from: 'action', to: 'missing' }
    ]
  });

  const result = validator.validate(definition);
  const codes = result.issues.map((issue) => issue.code);

  assert.equal(result.valid, false);
  assert.ok(codes.includes('INVALID_WORKFLOW_ID'));
  assert.ok(codes.includes('INVALID_WORKFLOW_NAME'));
  assert.ok(codes.includes('INVALID_WORKFLOW_VERSION'));
  assert.ok(codes.includes('DUPLICATE_STEP_ID'));
  assert.ok(codes.includes('INVALID_START_STEP'));
  assert.ok(codes.includes('INVALID_FINISH_STEP'));
  assert.ok(codes.includes('DUPLICATE_EDGE_ID'));
  assert.ok(codes.includes('UNKNOWN_EDGE_SOURCE'));
  assert.ok(codes.includes('UNKNOWN_EDGE_TARGET'));
});

test('WorkflowValidator rejects unreachable and dead-end steps', () => {
  const validator = new GraphWorkflowValidator();
  const definition = createLinearWorkflow({
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'action', name: 'Action', kind: 'action', operation: 'test.action' },
      { id: 'orphan', name: 'Orphan', kind: 'action', operation: 'test.orphan' },
      { id: 'dead-end', name: 'Dead End', kind: 'action', operation: 'test.dead-end' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-to-action', from: 'start', to: 'action' },
      { id: 'action-to-finish', from: 'action', to: 'finish' },
      { id: 'start-to-dead-end', from: 'start', to: 'dead-end' }
    ]
  });

  const result = validator.validate(definition);

  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'UNREACHABLE_STEP' && issue.message.includes('orphan')
    )
  );
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'STEP_CANNOT_REACH_FINISH' && issue.message.includes('dead-end')
    )
  );
});

test('WorkflowValidator permits graph branching when every branch reaches finish', () => {
  const validator = new GraphWorkflowValidator();
  const definition = createLinearWorkflow({
    steps: [
      { id: 'start', name: 'Start', kind: 'start' },
      { id: 'left', name: 'Left', kind: 'action', operation: 'test.left' },
      { id: 'right', name: 'Right', kind: 'action', operation: 'test.right' },
      { id: 'finish', name: 'Finish', kind: 'finish' }
    ],
    edges: [
      { id: 'start-to-left', from: 'start', to: 'left' },
      { id: 'start-to-right', from: 'start', to: 'right' },
      { id: 'left-to-finish', from: 'left', to: 'finish' },
      { id: 'right-to-finish', from: 'right', to: 'finish' }
    ]
  });

  assert.deepEqual(validator.validate(definition), { valid: true, issues: [] });
});

test('WorkflowRegistry registers and looks up immutable workflow versions', () => {
  const registry = new InMemoryWorkflowRegistry();
  const versionOne = createLinearWorkflow();
  const versionTwo = createLinearWorkflow({ version: 2, name: 'Test Linear Workflow v2' });

  registry.register(versionOne);
  registry.register(versionTwo);

  assert.equal(registry.get('test.linear.workflow', 1), versionOne);
  assert.equal(registry.getLatest('test.linear.workflow'), versionTwo);
  assert.deepEqual(registry.list(), [versionOne, versionTwo]);
  assert.throws(
    () => registry.register(createLinearWorkflow()),
    /version 1 is already registered/
  );
});

test('WorkflowRegistry does not absorb graph validation responsibilities', () => {
  const registry = new InMemoryWorkflowRegistry();
  const structurallyInvalidDefinition = createLinearWorkflow({
    startStepId: 'missing',
    edges: []
  });

  registry.register(structurallyInvalidDefinition);

  assert.equal(registry.get('test.linear.workflow', 1), structurallyInvalidDefinition);
});
