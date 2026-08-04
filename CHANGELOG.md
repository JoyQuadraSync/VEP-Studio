# Changelog

All notable changes to VEP Studio will be documented in this file.

## v0.3.0 — 2026-08-04

### Added

- decision workflow step
- declarative `WorkflowCondition`
- conditional workflow edges
- explicit default edges
- pure deterministic `ConditionEvaluator`
- deterministic branch selection

### Changed

- `WorkflowRunner` now supports decision-step progression
- `WorkflowValidator` now validates conditional definitions, references, edge roles, serialization, and configured nesting depth

### Failure Semantics

- `condition_evaluation_failed`
- `multiple_matching_branches`
- `no_matching_branch`
- `invalid_default_branch`

### Verification

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm test` — passed, 32/32

## Sprint 009 — 2026-08-04

### Added

- `decision` workflow step
- declarative `WorkflowCondition` and restricted condition references
- conditional and default workflow edges
- pure deterministic `ConditionEvaluator`
- restricted workflow, step-result, and execution metadata condition sources
- structured conditional failure codes

### Architecture

- conditions live on edges rather than decision steps
- definitions remain serializable and contain no executable callbacks
- ConditionEvaluator remains separate from WorkflowRunner
- all conditional edges are evaluated before selection
- multiple matching branches fail instead of using edge order or priority
- EventBus remains outside condition evaluation and branch selection
- `ExecutionContext` remains event-publication-specific

### Branch Semantics

- one matching edge is selected
- zero matches use the unique default edge when present
- zero matches without default produce `no_matching_branch`
- multiple matches produce `multiple_matching_branches`
- evaluation errors produce `condition_evaluation_failed`
- malformed defaults produce `invalid_default_branch`

### Verification

- Typecheck and build passed
- Full test suite passed, 32/32
- EventBus tests passed, 4/4
- Workflow Conditions tests passed, 10/10
- Workflow Runtime tests passed, 12/12
- Workflow Definition tests passed, 6/6

### Deferred

- parallel execution and loops
- persistence and recovery
- retry, timeout, cancellation, and scheduling
- human tasks and AI agents
- metrics, tracing, HTTP endpoints, and visual workflow design

## Sprint 008 — 2026-08-03

### Added

- `WorkflowExecution` as the single workflow execution-state aggregate
- `WorkflowRunner` and in-memory linear runtime implementation
- `WorkflowState`, `WorkflowFailure`, and `WorkflowStepResult` contracts
- `OperationRegistry`, `OperationHandler`, and duplicate operation protection
- immutable execution snapshots and deterministic execution ID generation
- duration-based step and aggregate runtime metadata
- structured workflow failures without raw runtime causes

### Architecture

- Workflow Runtime remains separate from Workflow Definition
- `WorkflowExecution` replaces the overlapping `WorkflowInstance` concept
- WorkflowRunner owns step progression directly
- EventBus remains outside workflow control flow
- `ExecutionContext` remains event-publication-specific
- existing `Clock` is reused only for duration calculation

### Verification

- Typecheck and build passed
- Full test suite passed, 22/22
- EventBus tests passed, 4/4
- Workflow Definition tests passed, 6/6
- Workflow Runtime tests passed, 12/12

### Deferred

- conditions, decisions, and parallel execution
- retry, timeout, and cancellation
- persistence, recovery, and scheduling
- human tasks and AI agents
- metrics aggregation, tracing, HTTP endpoints, and visual editor

## Sprint 007 — 2026-08-03

### Added

- `WorkflowDefinition`, `WorkflowStep`, and `WorkflowEdge` graph contracts
- independent `WorkflowValidator` for definition and graph integrity
- versioned `WorkflowRegistry` for registration and lookup
- `CustomerCommentWorkflow` example
- declarative operation identifiers
- dotted workflow IDs and immutable integer version keys

### Architecture

- Workflow Definition is separated from Workflow Runtime
- WorkflowValidator is separated from WorkflowRegistry
- workflow operations are identifiers rather than executable callbacks
- workflow definitions remain independent from HTTP and EventBus infrastructure

### Verification

- Typecheck and build passed
- Full test suite passed, 10/10
- EventBus tests passed, 4/4
- Workflow tests passed, 6/6

### Deferred

- WorkflowRuntime and OperationRegistry
- execution state
- retries and timeout
- persistence and scheduling
- AI agents
- HTTP endpoints

## Sprint 006 — 2026-08-03

### Added

- Runtime contracts for publish results, subscriber results, execution context, and subscriber status
- Injectable clock contract for deterministic runtime metadata
- Publish and per-subscriber execution durations
- Publish success and failure counts
- Stable subscriber names

### Improved

- HTTP router result selection no longer depends on subscriber registration order
- Runtime tests cover named results and deterministic execution metadata
- Backend tests are available through `npm test`

### Preserved

- Concurrent subscriber execution
- Registration-order result preservation
- Subscriber failure isolation
- Existing health and event HTTP behavior

### Deferred

- Subscriber timeout
- Retry policy
- Dead-letter queue
- Persistence
- Broader observability

## v0.1.0 — 2026-07-31

### Added

- Event Pipeline
- Validation
- Event Bus
- Multiple Subscribers
- Concurrent Event Dispatch
- Strongly Typed Events
- EventMap
- Event Factory

### Improved

- Generic EventBus
- Generic EventHandler
- Subscriber typing
- Architecture documentation

### Fixed

- Sequential subscriber execution replaced by true concurrency
- Removed any from EventBus
- Removed unnecessary type assertions

### Documentation

- Release Notes
- ADR-001
- ADR-002
- Architecture Review

### Next

- Timeout
- Retry
- Dead Letter Queue
