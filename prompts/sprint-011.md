# Sprint 011 – Persistence & Recovery

## Goal

Give immutable workflow executions a durable lifecycle through deterministic snapshot persistence, optimistic concurrency, exact definition-version recovery, and resumable progression without moving storage into WorkflowRunner.

## Scope

- `WorkflowRunner.advance()` as the only incremental progression API
- backward-compatible `run()` wrapper
- `WorkflowExecutionCoordinator`
- `WorkflowExecutionRepository`
- `InMemoryWorkflowExecutionRepository`
- `WorkflowExecutionSerializer`
- canonical JSON serialization
- `WorkflowExecutionRecoveryValidator`
- `WorkflowDefinitionResolver`
- `WorkflowExecutionWriteIdGenerator`
- typed `WorkflowPersistenceError`
- optimistic revision control and per-execution `writeId` tracking
- durable save points and resume
- `activeParallel` and retained `parallelRegions` persistence
- exact workflow definition ID/version recovery
- at-least-once operation-handler semantics

## Frozen Architecture

```text
WorkflowExecutionCoordinator
├── WorkflowRunner
├── WorkflowExecutionRepository
├── WorkflowExecutionSerializer
├── WorkflowExecutionRecoveryValidator
├── WorkflowDefinitionResolver
└── WorkflowExecutionWriteIdGenerator
```

WorkflowRunner owns control flow and produces immutable next snapshots. Coordinator owns save-point timing. Repository exposes only `create`, `findByExecutionId`, and `save`. Serializer validates and canonicalizes without executing workflows.

EventBus is not persistence transport. ExecutionContext, OperationRegistry, and ConditionEvaluator remain unchanged.

## Incremental Runtime

`advance()` performs one architectural transition: one linear or decision step, fork creation, one parallel advancement round, or one join barrier. Final branch settlement and join completion occur in separate calls.

`run()` repeatedly applies the same `advance()` semantics until completion or failure and remains available for workflows that do not use persistence.

## Persistence and Recovery

The initial created execution is saved at revision 1 before handler execution. Every returned transition snapshot is saved before further progression. Completed and failed terminal snapshots are durable.

Resume loads the latest record, validates its envelope and canonical data, resolves the exact immutable workflow definition version, validates recovered state, preserves revision continuity, and advances only incomplete work.

Completed steps and branches are never re-executed. Incomplete `activeParallel` branches resume through deterministic all-settled rounds; completed and failed `parallelRegions` remain retained.

## Canonical Serialization

Persistence accepts recursively JSON-safe values only. Object keys use direct UTF-16 code-unit ordering, array order is preserved, finite numbers are required, and negative zero normalizes to zero. The same supported value produces the same canonical JSON and UTF-8 bytes.

Runtime objects, callbacks, accessors, symbol keys, cycles, `undefined`, `bigint`, non-finite numbers, Promise, Map, Set, Date, Error, and behavioral class instances are rejected.

## Concurrency and Failure Semantics

Repository revision numbers prevent stale overwrite. Stable write IDs make repeated ambiguous writes idempotent when revision and canonical content match. Conflicting reuse fails explicitly.

Workflow failures remain inside `WorkflowExecution`. Persistence and recovery failures are typed infrastructure exceptions and never replace `WorkflowFailure`.

Operation handlers have at-least-once semantics: a handler may complete before its resulting snapshot is saved and may execute again after recovery. Handlers should therefore be idempotent.

## Verification

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm test` — passed, 69/69
- existing Sprint 007–010 tests — passed, 50/50
- Sprint 011 tests — passed, 19/19
- `git diff --check` — passed

## Explicit Non-Goals

- database adapter or vendor selection
- event sourcing or historical revision queries
- retry, timeout, cancellation, scheduling, or queues
- distributed workers or exactly-once execution
- transactional outbox, compensation, or distributed transactions
- schema migration, encryption, or multi-tenancy
- human tasks, AI agents, tracing, metrics, or HTTP management endpoints

## Acceptance Criteria

- Immutable snapshots persist at deterministic save points.
- Exact immutable definitions are recovered by ID and integer version.
- Stale and duplicate writes cannot silently overwrite state.
- Active and retained parallel regions round-trip and resume deterministically.
- Persistence failures remain separate from workflow failures.
- Existing in-memory linear, decision, and parallel workflows remain compatible.
