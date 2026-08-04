# VEP Studio Project Status

## Current Version

**v0.3.0**

Version 0.3.0 establishes VEP Studio as a Decision Workflow Platform with a typed event foundation, declarative workflow definitions, immutable runtime snapshots, and deterministic conditional branching.

## Current Stage

**Decision Workflow Platform**

## Release Dashboard

| Area | Status |
|---|---|
| Event Platform | Stable foundation |
| Strongly Typed Events | Complete |
| Runtime Contracts | Complete |
| Workflow Definition | Complete |
| Workflow Validation | Complete |
| Workflow Registry | Complete |
| Linear Workflow Runtime | Complete |
| Operation Registry | Complete |
| Decision & Conditional Workflow | Complete |
| Parallel Workflow | Next milestone |
| Persistence and Recovery | Planned |
| Human Tasks | Planned |
| AI Agent Runtime | Planned |
| Visual Workflow Designer | Planned |

## Completed Sprints

| Sprint | Name | Result |
|---|---|---|
| Sprint 001 | Project Setup and Documentation Standards | Completed |
| Sprint 002 | EventBus Foundation | Completed |
| Sprint 003 | Multi-Subscriber Event Routing | Completed |
| Sprint 004 | Concurrent and Async Subscriber Execution | Completed |
| Sprint 005 | Strongly Typed Events | Completed |
| Sprint 006 | Runtime Foundation Stabilization | Completed |
| Sprint 007 | Workflow Definition System | Completed |
| Sprint 008 | Workflow Runtime | Completed |
| Sprint 009 | Decision & Conditional Workflow | Completed |

## Current Capabilities

- accept and validate event envelopes over HTTP
- create strongly typed domain events
- publish to multiple subscribers concurrently
- isolate subscriber failures
- expose deterministic publish and subscriber results
- define immutable, versioned workflow graphs
- validate workflow identity and graph integrity
- register and retrieve workflow definitions by version
- resolve declarative operation identifiers
- execute linear workflows in memory
- execute deterministic decision and conditional workflows
- define declarative conditional and default edges
- evaluate restricted snapshot conditions through a pure ConditionEvaluator
- fail ambiguous, unmatched, invalid-default, and evaluation branches explicitly
- support synchronous and asynchronous operation handlers
- preserve immutable workflow execution snapshots
- chain step input and output
- expose structured failures and duration metadata

## Completed Components

### Event Platform

- event schema
- event factory
- generic EventBus
- named subscriptions
- event router
- audit subscribers
- worker boundary

### Runtime Foundation

- `ExecutionContext`
- `PublishResult`
- `SubscriberResult`
- `SubscriberStatus`
- injectable `Clock`

### Workflow Definition

- `WorkflowDefinition`
- `WorkflowStep`
- `WorkflowEdge`
- `WorkflowValidator`
- `WorkflowRegistry`
- `CustomerCommentWorkflow`

### Workflow Runtime

- `WorkflowExecution`
- `WorkflowState`
- `WorkflowFailure`
- `WorkflowStepResult`
- `WorkflowExecutionIdGenerator`
- `OperationHandler`
- `OperationRegistry`
- `WorkflowRunner`

### Decision & Conditional Workflow

- `WorkflowDecisionStep`
- `WorkflowCondition`
- `ConditionReference`
- conditional workflow edges
- default workflow edges
- `ConditionEvaluationInput`
- `ConditionEvaluator`
- deterministic branch selection
- structured conditional failure codes

## Architecture Health

| Principle | Health | Evidence |
|---|---|---|
| Type safety | Healthy | Strict TypeScript contracts without runtime type escape hatches |
| Separation of concerns | Healthy | Definition, validation, registry, runtime, operations, events, and HTTP have distinct boundaries |
| Determinism | Healthy | Injected clock and execution ID generation support controlled tests |
| Immutability | Healthy | Definitions and execution transitions use readonly contracts and immutable snapshots |
| Failure isolation | Healthy | Event subscribers and workflow operations produce isolated structured results |
| Test coverage | Healthy | 32 tests cover events, definitions, validation, runtime, and conditional branching |
| Runtime coupling | Healthy | EventBus is outside workflow control flow; ExecutionContext remains event-specific |
| Production readiness | Developing | Persistence, recovery, security, observability, and deployment remain future work |

## Technical Debt

- workflow input and output use generic `unknown` runtime contracts
- immutable snapshots do not deep-freeze nested input or output values
- duration calculation uses a wall-clock time source rather than a monotonic clock
- definition validation and execution are not yet composed into one application service
- some early release and architecture-review documents remain sparse
- project licensing and contributor governance are not yet defined

## Known Limitations

- workflow execution is in memory only
- parallel workflows are not supported
- executions cannot be persisted, paused, recovered, cancelled, or resumed
- retry, timeout, and dead-letter policies are not implemented
- human tasks and AI agents are not implemented
- no visual workflow designer exists
- workflow execution is not exposed through HTTP
- EventBus does not yet trigger or receive workflow lifecycle notifications
- authentication, authorization, observability, and production deployment are not complete

## Next Milestone

**Sprint 010 — Parallel Workflow**

The next milestone will expand workflow execution to coordinated parallel branches while preserving immutable definitions, immutable execution snapshots, deterministic runtime behavior, and the existing EventBus boundary.

See [ROADMAP.md](ROADMAP.md) for subsequent milestones.
