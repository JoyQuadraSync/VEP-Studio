# ADR-008 – Workflow Execution Coordinator

## Status

Accepted

## Context

WorkflowRunner already owned deterministic control flow. Sprint 011 required durable save points, optimistic concurrency, exact definition recovery, and infrastructure-error handling without coupling runtime semantics to storage.

## Decision

### Introduce WorkflowExecutionCoordinator

Coordinator is the sole application-layer component that composes Runner, Repository, Serializer, RecoveryValidator, DefinitionResolver, and write-ID generation.

It owns durable start, durable resume, save-point timing, revision continuity, and infrastructure-error propagation. This prevents alternate orchestration owners from emerging across runtime components.

### Keep WorkflowRunner Focused on Control Flow

Runner decides how one immutable execution advances. It knows steps, edges, operations, conditions, fork rounds, and join barriers. It does not know JSON, revisions, write IDs, repositories, or databases.

`advance()` is the sole incremental progression API. `run()` remains an in-memory wrapper over the same semantics.

### Give Coordinator Save-Point Ownership

Only Coordinator decides when a Runner-produced snapshot becomes durable. It persists the initial snapshot before handler execution and saves every transition before requesting another.

Repository cannot choose or combine save points, and Runner cannot save implicitly.

### Restrict Repository to Create, Find, and Save

Repository owns atomic storage, lookup, revision comparison, duplicate-write recognition, and detached values. It exposes only `create`, `findByExecutionId`, and `save`.

It does not advance, resume, retry, repair, resolve definitions, validate workflows, execute handlers, evaluate conditions, or publish events.

### Require Deterministic Serialization

Serializer validates the JSON-safe boundary and emits canonical JSON whose UTF-8 bytes are stable for the same supported value. Determinism enables reliable duplicate-write comparison and future hashing without relying on insertion order or locale.

### Separate Persistence Failure from WorkflowFailure

Workflow failures describe workflow execution outcomes and remain inside `WorkflowExecution`. Storage, serialization, recovery, and definition-resolution failures are infrastructure exceptions.

An infrastructure failure never replaces an existing workflow failure or becomes a persisted workflow failure code.

### Keep EventBus Outside Persistence

EventBus is not persistence transport, revision coordination, snapshot reconstruction, or recovery control flow. Durable execution works without EventBus. Optional lifecycle notifications may be considered separately.

### Require Exact Definition Version

Recovery resolves the exact immutable `workflowId` and integer `workflowVersion`. It never substitutes the latest version because that could change topology, operations, conditions, or branch ownership during recovery.

### Accept At-Least-Once Handler Execution

A handler may complete before its resulting snapshot is durably saved. Recovery then resumes from the latest accepted snapshot and may invoke the handler again.

Sprint 011 therefore provides at-least-once handler semantics. Handlers should be idempotent. Exactly-once execution, transactional outbox, deduplication keys, compensation, and distributed transactions remain deferred.

## Consequences

### Positive

- control flow remains storage-independent
- persistence adapters remain workflow-independent
- save points are explicit and testable
- stale and duplicate writes are protected
- exact recovery is deterministic
- in-memory execution remains compatible

### Trade-offs

- Coordinator introduces an application-layer composition boundary
- operation side effects cannot be atomically coupled to repository writes
- persistent workflows must use JSON-safe values
- deployments must retain recoverable definition versions

## Alternatives Rejected

- Repository calls inside Runner
- EventBus-based persistence transport
- Repository-owned workflow progression
- Saving noncanonical object graphs
- Latest-definition fallback during recovery
- Converting storage failures into `WorkflowFailure`
- Claiming exactly-once handler execution
