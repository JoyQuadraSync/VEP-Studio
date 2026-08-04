# Sprint 011 Persistence & Recovery Architecture Freeze

## Status

Architecture Frozen — Ready for Implementation and Release

## WorkflowRunner.advance Contract

`advance()` is the sole incremental runtime API. One call performs one linear or decision step, creates one active parallel region, performs one parallel advancement round, or completes one join barrier. It rejects terminal and invalid supplied snapshots.

`run()` repeatedly invokes the same semantics until terminal completion and remains the backward-compatible in-memory API. No step, tick, callback, iterator, or alternate progression API is introduced.

## Save-Point Ownership

- Runner produces immutable next snapshots.
- Coordinator decides when snapshots become durable.
- Repository stores but never chooses save points.
- Serializer validates and serializes but never advances.
- EventBus does not participate.

Save points include initial creation, every step transition, workflow failure, finish, active-parallel creation, each parallel round, and atomic join completion or failure.

## Parallel Advancement Rounds

Each incomplete branch advances at most once per round. Eligible branches may run concurrently and use all-settled semantics. Completed and failed branches remain unchanged after recovery.

One round produces one canonically ordered immutable snapshot and one repository revision. Promise settlement order never creates revisions. Final branch settlement is persisted before a separate join-barrier call flattens history, appends `parallelRegions`, and clears `activeParallel`.

## Canonical Serialization

Persistable values are null, booleans, strings, finite numbers, arrays, and plain recursively JSON-safe objects. Negative zero becomes zero. Object keys use direct UTF-16 code-unit ordering; array order is preserved.

The canonical representation is UTF-8 bytes of canonical JSON. Identical supported values produce identical bytes. Unsupported values, accessors, symbol keys, cycles, non-finite numbers, and behavioral objects are rejected.

## Revision and writeId State Machine

- create assigns revision 1
- accepted saves increment revision once
- expected revision must equal current revision
- new write ID with stale revision fails
- repeated accepted write ID with identical expected revision and bytes returns its original result
- reuse with changed revision or content fails
- write-ID tracking is scoped per execution
- all accepted write IDs remain retained for the record lifetime
- no stale write silently overwrites newer state

## Repository Contract

The public API is exactly:

```text
create
findByExecutionId
save
```

Repository owns atomic storage, revision comparison, duplicate-write recognition, and detached values only. It does not run, resume, retry, repair, validate, resolve definitions, invoke handlers, evaluate conditions, or publish events.

## Coordinator Boundary

Coordinator is the only application-layer component allowed to depend directly on Runner, Repository, Serializer, RecoveryValidator, DefinitionResolver, and write-ID generation.

`start()` saves revision 1 before handler execution and durably progresses to a terminal snapshot. `resume()` loads, resolves, validates, preserves revision continuity, and continues from the latest durable snapshot.

## Recovery Validation

Recovery validates in order: repository record, envelope, schema, canonical deserialization, identity consistency, exact definition resolution, existing definition validation, execution recovery validation, and Runner preconditions.

It validates current step, history, duration, `activeParallel`, `parallelRegions`, branch ordering, ownership, and fork/join consistency. Recovery never repairs, reconstructs, reorders, mutates, or silently selects a later definition.

## Persistence Versus Workflow Failure

Workflow failures remain structured inside `WorkflowExecution` and are produced by Runner. Persistence and recovery failures are typed infrastructure exceptions.

If saving a failed or successful snapshot fails, Coordinator throws the infrastructure exception, stops progression, and does not replace the workflow result. The latest accepted repository snapshot remains authoritative.

## At-Least-Once Semantics

A handler may finish before its returned snapshot is durably saved. Recovery can therefore invoke it again. Handlers should be idempotent.

Sprint 011 does not provide exactly-once execution, transactional outbox, operation deduplication keys, compensation, or distributed transactions. Snapshot validation, transition semantics, branch ordering, revision handling, and recovery position remain deterministic.

## Backward Compatibility

- definitions and existing step/edge contracts require no migration
- in-memory `run()` remains supported
- persistence is opt-in
- JSON safety is mandatory only at the persistence boundary
- EventBus, ExecutionContext, OperationRegistry, and ConditionEvaluator remain unchanged
- all Sprint 007–010 tests remain valid

## Freeze Result

**Ready for Implementation and Release**
