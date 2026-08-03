# Sprint 008 – Workflow Runtime

## Goal

Introduce an in-memory runtime that executes validated linear workflow definitions through deterministic, immutable execution snapshots without changing HTTP or EventBus behavior.

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

`WorkflowRunner` owns start/action/finish progression directly. `OperationRegistry` resolves declarative operation identifiers to synchronous or asynchronous handlers. The runtime does not use EventBus as a control-flow engine.

The existing boundary remains unchanged:

```text
EventBus                 WorkflowRunner
└── ExecutionContext     └── WorkflowExecution
```

`ExecutionContext` remains event-publication-specific, with no workflow state or shared mutable data.

## Components Added

- `WorkflowState`
- `WorkflowStepResultStatus`
- `WorkflowFailure`
- `WorkflowStepResult`
- `WorkflowExecution`
- `WorkflowExecutionIdGenerator`
- `OperationHandler`
- `OperationRegistry`
- `InMemoryOperationRegistry`
- `WorkflowRunner`
- `InMemoryWorkflowRunner`

## Components Updated

No existing component was modified. Workflow Runtime was added as an isolated module under `backend/src/workflows/runtime/`.

Existing Workflow Definition contracts, EventBus, HTTP behavior, `ExecutionContext`, and dependencies remain unchanged.

## Runtime Contracts

- one `WorkflowExecution` aggregate; no `WorkflowInstance`
- immutable execution snapshots
- fixed workflow ID, integer version, and workflow input
- ordered completed steps and step results
- chained start/action/finish input and output
- duration-based step and execution metadata
- structured failures without raw runtime causes
- explicit failure for unsupported multiple outgoing edges

## Verification

Run from `backend`:

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm test` — passed
- `git diff --check` — passed
- forbidden-pattern scan — passed
- architecture-boundary scan — passed
- trailing-whitespace scan — passed

## Test Results

- total tests — 22/22 passed
- EventBus tests — 4/4 passed
- Workflow Definition tests — 6/6 passed
- Workflow Runtime tests — 12/12 passed

Runtime tests cover execution creation, immutable snapshots, synchronous and asynchronous handlers, zero-action workflows, input/output chaining, duration calculation, structured failures, operation registration, linear edge rules, caller contract violations, prior-result preservation, and EventBus/ExecutionContext boundaries.

## Lessons Learned

- Workflow Runtime should consume definitions without adding mutable state to them.
- A single execution aggregate avoids overlapping WorkflowExecution and WorkflowInstance concepts.
- Immutable snapshots make each runtime transition explicit and testable.
- Duration-only metadata is sufficient before persistence, scheduling, and observability exist.
- Raw handler errors should not become part of serializable workflow state.
- EventBus can remain available for future triggers and notifications without owning workflow progression.

## Known Limitations

- only linear workflows are supported
- definitions must be validated before entering the runner
- input and output values use generic `unknown` contracts
- snapshots do not deep-freeze nested input or output objects
- duration calculation uses the existing wall-clock-based `Clock`
- executions cannot be persisted, paused, recovered, cancelled, or resumed
- conditions, decisions, parallel execution, retry, and timeout are not implemented
- HTTP, scheduling, human-task, AI-agent, metrics, and tracing integrations are not implemented

## Next Sprint

Sprint 009 — Subscriber Timeout.

Sprint 009 should remain outside Workflow Runtime control-flow semantics and must preserve immutable workflow execution snapshots and the existing EventBus/WorkflowRunner boundary.
