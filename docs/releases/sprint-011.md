# Sprint 011 – Persistence & Recovery

## 1. Goal

Add durable lifecycle management for immutable workflow executions through canonical snapshot persistence, optimistic concurrency, deterministic recovery, and resumable progression.

## 2. Architecture Before

Sprint 010 supported deterministic linear, decision, and parallel execution, but execution state existed only in process memory. A process restart lost the latest `WorkflowExecution` and could not resume an active parallel region.

## 3. Architecture After

```text
Caller
  ↓
WorkflowExecutionCoordinator
  ├── WorkflowRunner.advance()
  ├── WorkflowExecutionSerializer
  ├── WorkflowExecutionRecoveryValidator
  ├── WorkflowDefinitionResolver
  └── WorkflowExecutionRepository
             ↓
      immutable persisted snapshot
```

Runner remains unaware of storage. EventBus remains outside workflow control flow and persistence transport.

## 4. New Components

- `WorkflowJsonValue`
- `SerializedWorkflowExecution`
- persisted record and save request contracts
- `WorkflowExecutionRepository`
- `InMemoryWorkflowExecutionRepository`
- `WorkflowExecutionSerializer`
- deterministic canonical serializer
- `WorkflowExecutionRecoveryValidator`
- `WorkflowDefinitionResolver`
- `WorkflowExecutionCoordinator`
- `WorkflowExecutionWriteIdGenerator`
- `WorkflowPersistenceErrorCode`, details, and typed exception

## 5. Updated Components

- `WorkflowRunner` exposes `advance()` as its only incremental progression API.
- `run()` remains a backward-compatible convenience wrapper over repeated `advance()` calls.
- Parallel progression now exposes fork creation, advancement rounds, final settlement, and join barrier as deterministic immutable boundaries.

## 6. Persistence Lifecycle

1. Validate the immutable definition.
2. Create an immutable execution.
3. Canonically serialize it.
4. Save revision 1 before handler execution.
5. Call `advance()` once.
6. Save the returned snapshot with the expected revision and stable write ID.
7. Continue only after the save succeeds.
8. Return only after the completed or failed terminal snapshot is durable.

## 7. Recovery Lifecycle

1. Load by execution ID.
2. Validate envelope and schema.
3. Deserialize canonical JSON.
4. Resolve exact workflow ID and integer version.
5. Validate the definition and recovered execution.
6. Reject terminal resume.
7. Preserve execution identity and repository revision continuity.
8. Resume only the next incomplete transition.

Completed steps and branches are not re-executed. Incomplete active branches participate in the next all-settled round. Completed and failed retained regions remain immutable.

## 8. Coordinator Responsibilities

Coordinator is the sole application layer allowed to know Runner, Repository, Serializer, RecoveryValidator, DefinitionResolver, and write-ID generation together. It owns durable start, resume, save-point sequencing, optimistic saves, and infrastructure-error propagation.

## 9. Save-Point Semantics

Durable save points exist for initial creation, each linear or decision transition, workflow failure, finish completion, active parallel creation, every parallel advancement round, and the atomic join barrier.

One parallel round produces one deterministic immutable snapshot and one repository revision. Promise settlement order never creates revisions. Parent history is flattened only at the join barrier.

## 10. Canonical Serialization

The canonical representation is UTF-8 bytes of canonical JSON. Keys use direct UTF-16 code-unit ordering, arrays retain order, numbers are finite, and negative zero becomes zero. Unsupported runtime values, accessors, symbols, cycles, and behavioral objects fail explicitly.

## 11. Optimistic Concurrency

- creation produces revision 1
- accepted saves increment revision once
- stale expected revisions throw
- accepted write IDs are retained per execution
- identical repeated writes return the originally accepted result
- changed content or expected revision under the same write ID conflicts
- stale writes never replace newer state

## 12. Failure Semantics

Workflow operation, condition, routing, and parallel failures remain structured `WorkflowFailure` values inside the execution. Repository, serialization, definition-resolution, and recovery failures are typed exceptions and never become workflow failure codes.

Handlers use at-least-once semantics. If a handler succeeds but its snapshot is not saved, recovery may call it again. Operation handlers should be idempotent.

## 13. Backward Compatibility

- existing definitions require no migration
- in-memory `run()` remains supported
- persistence is opt-in
- JSON-safe values are required only at the persistence boundary
- EventBus, ExecutionContext, OperationRegistry, and ConditionEvaluator remain unchanged
- existing linear, decision, and parallel tests remain valid

## 14. Verification

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm test` — passed, 69/69
- `git diff --check` — passed

## 15. Test Results

- existing Sprint 007–010 tests — 50/50 passed
- Sprint 011 persistence and recovery tests — 19/19 passed
- total — 69/69 passed

Coverage includes canonical serialization, rejected values, repository revisions, duplicate writes, incremental transitions, durable save points, exact definition resolution, active-parallel recovery, retained regions, terminal rejection, infrastructure failures, ambiguous responses, and at-least-once execution.

## 16. Known Limitations

- the reference repository is in-memory and is not durable across process restart
- no database adapter or vendor is selected
- operation execution is at least once, not exactly once
- no transactional coupling exists between handler effects and snapshot saves
- schema migration and historical revision queries are unavailable
- retry, timeout, cancellation, scheduling, queues, and distributed workers remain deferred
- human tasks, AI agents, observability, and HTTP management remain deferred

## 17. Next Sprint

Sprint 012 — Retry / Timeout / Dead Letter.

The next milestone will design failure-handling policies on top of the durable execution and recovery boundary.
