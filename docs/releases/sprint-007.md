# Sprint 007 – Workflow Definition System

## Goal

Introduce the declarative workflow definition layer that future workflow runtimes, agents, human tasks, scheduling, and visual tooling can build upon without changing current runtime behavior.

## Added

- `WorkflowDefinition` for workflow identity, version, graph boundaries, steps, and transitions
- `WorkflowStep` with `start`, `action`, and `finish` variants
- `WorkflowEdge` for directed graph transitions
- independent `WorkflowValidator` for identity, version, and graph integrity
- `WorkflowRegistry` for registration and versioned lookup
- `CustomerCommentWorkflow` example
- declarative operation identifiers such as `comment.process`
- dotted workflow IDs such as `customer.comment.workflow`
- positive integer workflow versions with duplicate-version protection

## Architecture

Workflow Definition is separate from Workflow Runtime. Definitions describe immutable process structure; they do not contain execution state or executable callbacks.

Graph validation is separate from registration and lookup. `WorkflowValidator` checks definition integrity, while `WorkflowRegistry` stores and retrieves definitions by ID and version.

## Preserved

- existing HTTP behavior
- existing EventBus behavior
- concurrent subscriber execution
- all Sprint 006 runtime contracts
- existing dependencies

## Explicitly Not Implemented

- `WorkflowRuntime`
- `OperationRegistry`
- execution state
- retries
- timeout
- persistence
- scheduling
- AI agents
- HTTP endpoints

The future `decision`, `parallel`, `human`, and `agent` step kinds are not implemented.

## Verification

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm test` — passed, 10/10 tests
- EventBus tests — passed, 4/4
- Workflow tests — passed, 6/6

## Acceptance

All Sprint 007 definition-layer acceptance criteria passed. The implementation adds no workflow execution behavior and does not connect definitions to HTTP or EventBus infrastructure.

## Known Limitations

- TypeScript `readonly` provides compile-time immutability; definitions are not deep-frozen at runtime.
- The registry and validator are not yet composed into an application service.
- The future runtime must resolve operation identifiers through a separate `OperationRegistry`.
- Conditions, branching decisions, parallel execution, human tasks, and agents remain future work.
