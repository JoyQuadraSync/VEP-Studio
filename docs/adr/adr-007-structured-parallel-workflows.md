# ADR-007 – Structured Parallel Workflows

## Status

Accepted

## Context

Sprint 009 introduced deterministic decision branching, but WorkflowRunner could still advance through only one selected path. Parallel execution requires coordinated branches without introducing shared mutable state, timing-dependent results, arbitrary graph execution, or EventBus-owned workflow control flow.

Sprint 010 adds structured fork/join regions to the immutable definition and execution models.

## Decision

### Use Structured Fork/Join Regions

Parallel execution is represented by one fork, two or more isolated branches, and one paired join.

```text
         ┌── branch A ──┐
FORK ────┼── branch B ──┼── JOIN
         └── branch C ──┘
```

Arbitrary parallel graph execution is rejected because it would require ambiguous ownership, partial merges, overlapping regions, recursive coordination, and more complex recovery semantics. Structured regions provide one clear entry, one barrier, and one exit.

Nested and overlapping regions remain deferred.

### Store Branch Identity in Workflow Definition

Every fork uses dedicated parallel edges with stable branch IDs. Identity belongs to the immutable definition because it describes process structure, not one execution attempt.

Definition-owned identities make branch results inspectable, serializable, testable, and stable across executions. Generated runtime branch UUIDs are unnecessary in Sprint 010.

Branch IDs use restricted ASCII grammar:

```text
^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$
```

### Make Ordering Independent from Runtime Timing

Branch ordering uses ascending UTF-16 code-unit comparison of branch IDs.

Ordering cannot use:

- edge order, because arrays are representation details rather than priority
- `localeCompare`, because locale behavior may vary by environment
- Promise settlement, because runtime scheduling is nondeterministic
- duration, because observed elapsed time is metadata rather than control flow

All branch snapshots, outputs, flattened histories, and failure evidence use the same canonical order.

### Wait for Every Branch to Settle

WorkflowRunner uses all-settled semantics. A failed branch does not cancel siblings. Every branch reaches a terminal completed or failed state before the region resolves.

This preserves deterministic final evidence and avoids introducing cancellation semantics. The parent completes the join only when every branch succeeds. Any failed branch produces one join-located `parallel_branch_failed` parent failure.

### Retain Completed and Failed Regions

`WorkflowExecution` contains one optional `activeParallel` and an append-only `parallelRegions` collection. Settled successful and failed regions remain available after the barrier.

Retention preserves branch identity, output, history, failure evidence, and duration. It also supports multiple sequential regions and creates a future persistence boundary without implementing persistence now.

`parallelRegions` is an enumerable public property so JSON serialization and immutable spread cloning preserve the execution contract.

### Flatten Parent History Only at the Barrier

Branch steps are not appended to parent history as they finish. After all branches settle, WorkflowRunner merges histories atomically in canonical branch order and branch-local step order.

This preserves the established meaning of parent `completedSteps` and `stepResults` without exposing timing-dependent interleaving.

### Retain Branch-Local History Too

The parent retains a deterministic flattened execution record, while every parallel-region result retains branch-local histories.

The structured record answers which branch owned a step and preserves successful sibling evidence after failure. This deliberate duplication serves aggregate and branch-aware inspection contracts.

### Isolate Conditions Within Branches

A branch condition may read pre-fork completed history and completed results from its own branch. It cannot read pending, running, completed, or failed sibling state before the join.

Sibling visibility would make behavior depend on settlement timing. Downstream steps may inspect the deterministic join aggregate after the barrier.

ConditionEvaluator remains pure and its language does not change.

### Keep EventBus Outside Coordination

WorkflowRunner directly creates branches, advances steps, waits at the barrier, aggregates results, and completes the join.

EventBus does not start each branch, communicate branch completion, select ordering, or store execution state. It may later publish optional lifecycle notifications without becoming required control flow.

ExecutionContext remains event-publication-specific.

### Keep OperationRegistry and ConditionEvaluator Unchanged

OperationRegistry continues to map declarative operation IDs to handlers. It does not know branch IDs, coordinate handlers, or retain state.

ConditionEvaluator continues to evaluate the frozen Sprint 009 declarative language against a restricted snapshot projection. WorkflowRunner supplies branch-isolated inputs.

Handlers may execute concurrently and remain responsible for concurrency-safe external side effects.

### Defer Additional Concurrency Policies

Nested parallelism, cancellation, worker pools, dynamic branches, and custom join aggregation require separate contracts.

Custom aggregation can currently be represented by a normal action after the join. Cancellation would require lifecycle and partial-result rules. Worker pools require resource policy. Nested regions require recursive ownership and execution frames.

## Failure Model

- branch operation and condition failures retain existing structured codes
- `parallel_branch_failed` represents one or more failed branches at the paired join
- `parallel_join_mismatch` represents a defensive runtime topology inconsistency
- failed join steps are not recorded as completed
- raw causes, stacks, and rejection values are not retained

## Duration Model

Clock supplies elapsed boundaries only. No absolute parallel timestamps are stored. Branch and region durations are observed elapsed values, and region duration is not the sum of branch durations. Negative or non-finite differences normalize to zero.

## Consequences

### Positive

- deterministic branch and history ordering
- explicit serializable topology
- immutable branch and region evidence
- all sibling outcomes preserved after failure
- existing linear and decision workflows remain compatible
- future persistence receives a clear execution-region boundary

### Trade-offs

- branch histories appear in both structured and flattened representations
- every branch settles even after a failure
- handler side effects remain outside orchestration determinism
- nested and arbitrary parallel graphs are rejected
- validator topology analysis is more complex

## Alternatives Considered

### Arbitrary Parallel Graph Execution

Rejected because ownership, merging, overlapping barriers, and failure behavior would be ambiguous.

### Result Order by Edge Declaration

Rejected because declaration order must not act as hidden priority.

### Result Order by Completion

Rejected because Promise timing is nondeterministic.

### Fail Fast

Rejected because cancellation is deferred and final evidence would depend on failure timing.

### EventBus Branch Coordination

Rejected because event subscribers are not workflow control-flow constructs.

### Custom Join Callback

Rejected because it would add executable behavior to the coordination contract. An ordinary post-join action is sufficient.

## Explicit Non-Goals

- persistence and recovery
- retry, timeout, and cancellation
- scheduling and distributed execution
- nested parallelism and loops
- dynamic branches and compensation
- worker pools and resource policies
- custom join aggregation
- human tasks and AI agents
- metrics and tracing
- HTTP endpoints and visual editor
