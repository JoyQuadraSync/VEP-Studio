# Sprint 010 – Parallel Workflow

## Goal

Extend the deterministic in-memory Workflow Runtime with structured parallel fork/join regions while preserving immutable definitions, immutable execution snapshots, existing linear and decision behavior, and the established EventBus boundary.

## Scope

- `WorkflowForkStep`
- `WorkflowJoinStep`
- dedicated `WorkflowParallelEdge`
- stable definition-owned branch identities
- restricted ASCII branch-ID grammar
- deterministic UTF-16 code-unit ordering
- immutable `WorkflowBranchExecution` snapshots
- one `activeParallel` region at a time
- completed and failed `parallelRegions` retention
- concurrent all-settled branch execution
- atomic parent-history flattening at the join barrier
- branch-local history retention
- branch condition isolation
- zero-action branches
- multiple sequential parallel regions
- join-located aggregate failure
- finite non-negative duration normalization

## Frozen Architecture

```text
                    ┌── branch A ──┐
sequential → FORK ──┼── branch B ──┼── JOIN → sequential
                    └── branch C ──┘
```

Parallel execution uses one `WorkflowExecution` aggregate. Branches are nested immutable snapshots rather than independent workflow instances.

`WorkflowRunner` owns fork creation, concurrent branch progression, all-settled coordination, deterministic aggregation, and join completion. `WorkflowValidator` owns structured-region topology. `OperationRegistry` and `ConditionEvaluator` retain their existing responsibilities.

EventBus does not coordinate branches, advance branch steps, select joins, or store parallel execution state. `ExecutionContext` remains event-publication-specific.

## Branch Identity and Ordering

Branch IDs use:

```text
^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$
```

All branch collections use ascending UTF-16 code-unit comparison. Ordering never depends on edge declaration order, `localeCompare`, Promise settlement, handler duration, or runtime scheduling.

## Branch Lifecycle

```text
pending → running → completed | failed
```

Every branch receives the fork output as its input. Action and decision semantics remain unchanged within a branch. A branch completes when it reaches its paired join without executing that join independently.

A zero-action fork-to-join branch completes with empty local history and passes through the fork output.

## Barrier and History Semantics

All branches settle before the parent completes or fails. Branch-local histories are retained in `parallelRegions`. Parent `completedSteps` and `stepResults` are flattened atomically at the barrier in canonical branch order.

Successful regions complete the join exactly once. If any branch fails, the join is not completed and the parent fails at the join with `parallel_branch_failed`.

## Condition Isolation

Conditions inside a branch may inspect pre-fork completed history and completed results from the same branch. They cannot inspect pending, running, completed, or failed sibling state before the join.

The Sprint 009 condition language and `ConditionEvaluator` contract remain unchanged.

## Code Review Corrections

- made `parallelRegions` an enumerable serialization-safe public field
- rejected `start` steps inside parallel branches in validator and runner
- normalized every step, branch, region, and workflow duration to a finite non-negative value
- exported `WorkflowParallelRegionState`

## Explicit Non-Goals

- persistence and recovery
- retry and timeout
- cancellation and scheduling
- distributed execution
- loops and nested parallelism
- dynamic branches
- compensation
- worker pools
- custom join aggregation
- human tasks and AI agents
- metrics and tracing
- HTTP endpoints
- visual workflow design

## Verification

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm test` — passed, 50/50
- existing pre-Sprint-010 tests — passed
- parallel and correction tests — passed
- `git diff --check` — passed

## Acceptance Criteria

- Fork and join regions are declarative, structured, and validated.
- Branch identity and result ordering are deterministic.
- Branches execute concurrently and settle before region resolution.
- Successful and failed region histories are retained immutably.
- Parent history is merged only at the barrier.
- Conditions cannot observe sibling timing or state.
- Aggregate branch failure is located at the paired join.
- Zero-action and sequential parallel regions are supported.
- Durations are finite and non-negative.
- Existing linear and decision workflows remain compatible.
- EventBus, ExecutionContext, OperationRegistry, and ConditionEvaluator remain unchanged.
