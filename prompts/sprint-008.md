# Sprint 008 – Workflow Runtime

## Goal

Introduce the first in-memory runtime for executing validated linear workflow definitions while preserving the frozen Workflow Definition, EventBus, and ExecutionContext boundaries.

---

## Scope

- `WorkflowExecution`
- `WorkflowState`
- `WorkflowFailure`
- `WorkflowStepResult`
- `WorkflowExecutionIdGenerator`
- `OperationHandler`
- `OperationRegistry`
- `InMemoryOperationRegistry`
- `WorkflowRunner`
- `InMemoryWorkflowRunner`
- immutable execution snapshots
- duration-based runtime metadata
- structured failures

---

## Architecture

```text
WorkflowDefinition
        │
        ▼
WorkflowRunner ◄── OperationRegistry
        │
        ▼
WorkflowExecution
```

`WorkflowRunner` owns step progression directly. EventBus is not used for workflow control flow or mutable workflow state.

```text
EventBus                 WorkflowRunner
└── ExecutionContext     └── WorkflowExecution
```

`ExecutionContext` remains event-publication-specific and is not generalized or extended with workflow state.

---

## Contract Decisions

- Use one `WorkflowExecution` aggregate; do not introduce `WorkflowInstance`.
- Fix workflow ID, integer version, and input when an execution is created.
- Return immutable execution snapshots rather than mutating supplied state or arrays.
- Resolve declarative operation IDs through `OperationRegistry`.
- Normalize synchronous and asynchronous handlers through a Promise boundary.
- Store `durationMs` instead of absolute timestamps.
- Store structured failures without raw errors, causes, stacks, or rejection values.
- Support linear workflows only.
- Require exactly one outgoing edge from start and action steps and zero from finish.
- Keep Workflow Runtime independent from HTTP and EventBus control flow.

---

## Input and Output Rules

- start output equals workflow input
- action input equals the preceding completed step output
- action output equals the handler return value
- finish input equals the preceding completed step output
- workflow output equals finish input

---

## Failure Rules

- missing operation → `operation_not_registered`
- handler throw or rejected Promise → `operation_failed`
- missing outgoing edge → `no_next_step`
- multiple outgoing edges → `unsupported_multiple_outgoing_edges`
- missing target step → `invalid_step`
- outgoing edge from finish → `invalid_finish_step`

Failed steps are excluded from `completedSteps`. Earlier completed steps and results remain available.

Definition ID/version mismatch and illegal initial state are caller contract violations and throw before execution begins.

---

## Explicit Non-Goals

- conditions
- decision steps
- parallel execution
- retry
- timeout
- cancellation
- persistence
- recovery
- scheduling
- human tasks
- AI agents
- compensation
- metrics aggregation
- tracing
- HTTP endpoints
- visual editor
- EventBus workflow control flow

---

## Verification

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm test` — passed, 22/22 tests
- EventBus tests — passed, 4/4
- Workflow Definition tests — passed, 6/6
- Workflow Runtime tests — passed, 12/12
- `git diff --check` — passed

---

## Acceptance Criteria

- One WorkflowExecution aggregate exists.
- Runner returns immutable snapshots.
- Sync and async handlers are supported.
- Linear start/action/finish progression is deterministic.
- All required failure codes are represented.
- Raw handler errors are not retained.
- Step and aggregate durations are deterministic in tests.
- EventBus and HTTP behavior remain unchanged.
- Existing ExecutionContext remains event-publication-specific.
- All existing and new tests pass.

---

## Lessons Learned

- Runtime state and immutable workflow definitions require different ownership boundaries.
- Immutable snapshots make transitions observable and safer for future persistence.
- Declarative operations keep definitions serializable while allowing runtime handler resolution.
- Explicitly rejecting unsupported graph shapes is safer than selecting edges by registration order.
- Structured failures preserve execution history without leaking handler implementation details.
