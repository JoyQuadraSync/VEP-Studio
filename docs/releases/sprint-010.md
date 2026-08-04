# Sprint 010 – Parallel Workflow

## Goal

Add deterministic structured parallel execution to VEP Studio while preserving immutable workflow contracts, existing linear and decision behavior, and explicit runtime boundaries.

## Architecture Before

Sprint 009 supported linear progression and deterministic selection of one decision branch:

```text
start → action → decision → selected path → finish
```

WorkflowRunner could choose one path but could not coordinate multiple paths as one workflow region.

## Architecture After

```text
                    ┌── branch A ──┐
start → action → FORK
                    ├── branch B ──┼── JOIN → action → finish
                    └── branch C ──┘
```

```text
WorkflowDefinition
├── fork / join steps
└── dedicated parallel edges
             │
             ▼
       WorkflowRunner ◄── OperationRegistry
             │        ◄── ConditionEvaluator
             ▼
 immutable WorkflowExecution
 ├── activeParallel
 └── parallelRegions
```

EventBus remains outside branch coordination and workflow control flow.

## Components Added

- `WorkflowForkStep`
- `WorkflowJoinStep`
- `WorkflowParallelEdge`
- `WorkflowBranchState`
- `WorkflowParallelRegionState`
- `ParallelBranchResult`
- `WorkflowBranchExecution`
- `WorkflowParallelExecution`
- completed and failed parallel-region result contracts
- `WorkflowParallelRegionResult`
- structured parallel topology validation
- comprehensive parallel workflow test suite

## Components Updated

- `WorkflowStep` supports fork and join variants
- `WorkflowEdge` supports dedicated parallel edges
- `WorkflowExecution` exposes `activeParallel` and enumerable `parallelRegions`
- `WorkflowFailureCode` adds `parallel_branch_failed` and `parallel_join_mismatch`
- `WorkflowValidator` validates pairing, branch ownership, topology, identity, condition visibility, and deferred nested regions
- `WorkflowRunner` coordinates immutable concurrent branch execution and deterministic history aggregation
- legacy execution tests include the additive `parallelRegions` contract

## Fork and Join Semantics

A fork has at least two dedicated parallel outgoing edges and references exactly one paired join. Each edge declares one stable branch ID.

The fork input passes through as fork output and becomes the input of every branch. The join executes exactly once only after all branches complete successfully. Join input and output equal the ordered branch-result array.

Fork and join references are reciprocal. Nested and overlapping parallel regions are invalid in Sprint 010.

## Branch Lifecycle

```text
pending → running → completed | failed
```

Branches retain immutable local completed steps, step results, output or structured failure, and elapsed duration. A zero-action branch transitions directly from fork to join with empty local history and pass-through output.

Only one `activeParallel` region may exist. Settled regions are moved into the append-only `parallelRegions` history. Multiple non-overlapping parallel regions may execute sequentially.

## Deterministic Ordering

Branch IDs follow:

```text
^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$
```

Branch arrays, outputs, histories, and failure evidence use ascending UTF-16 code-unit ordering.

Ordering does not use:

- edge declaration order
- `localeCompare`
- Promise settlement order
- handler duration
- JavaScript scheduling

## Result Aggregation

Each successful branch contributes:

```text
branchId + output
```

The join receives a readonly result array in canonical branch order. Custom join aggregation is deferred; a later ordinary action may transform the aggregate through the existing OperationRegistry.

Parent history is flattened atomically only after every branch settles. Branch histories are grouped by branch ID and retain local step order. Structured branch-local history is also retained in the parallel-region result.

## Failure Semantics

All branches settle even when one fails. Successful sibling evidence remains available.

If any branch fails:

- the region is retained with state `failed`
- every terminal branch snapshot is retained
- parent history is flattened deterministically
- the join is not completed
- the parent fails with `parallel_branch_failed`
- the parent failure `stepId` is the paired join ID

Defensive join inconsistencies use `parallel_join_mismatch`. Raw errors, causes, rejection values, and stacks are not retained.

## Duration Semantics

The existing Clock contract is reused only for elapsed durations. No absolute timestamps are stored.

- branch duration measures branch activation to terminal state
- region duration measures activation to all-settled barrier
- region duration is not the sum of branch durations
- workflow and step durations retain their existing meaning
- negative and non-finite clock differences normalize to zero
- duration never influences control flow or ordering

## Backward Compatibility

- existing linear definitions require no migration
- existing decision definitions require no migration
- condition operators and sources remain unchanged
- OperationRegistry and handler signatures remain unchanged
- EventBus and HTTP behavior remain unchanged
- ExecutionContext remains event-publication-specific
- nonparallel executions use no active region and retain an empty `parallelRegions` collection

## Verification

Run from `backend`:

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm test` — passed, 50/50
- `git diff --check` — passed

## Test Results

- existing pre-Sprint-010 tests — passed
- parallel topology tests — passed
- concurrent branch execution tests — passed
- deterministic ordering tests — passed
- all-settled failure tests — passed
- condition isolation tests — passed
- zero-action and sequential-region tests — passed
- serialization and spread-clone correction tests — passed
- finite non-negative duration correction tests — passed
- total — 50/50 passed

## Code Review Corrections

The initial review result was **Approved with required changes**. Before release preparation:

- `parallelRegions` became an enumerable public property so serialization and spread cloning preserve the contract
- validator and runner now reject `start` steps inside branches
- durations are normalized to finite non-negative values consistently
- the frozen `WorkflowParallelRegionState` type is exported

The corrected implementation passed typecheck, build, all 50 tests, and whitespace verification.

## Known Limitations

- execution remains in memory
- nested and overlapping parallel regions are not supported
- branches cannot be cancelled or timed out
- branch concurrency has no worker-pool or resource-limit policy
- operation handlers remain responsible for concurrency-safe side effects
- custom join aggregation is not supported
- retry, dead-letter, persistence, recovery, and scheduling are unavailable
- human tasks and AI agents are unavailable
- workflow execution is not exposed through HTTP
- no visual workflow designer exists

## Next Sprint

Sprint 011 — Persistence & Recovery.

The next milestone will design durable immutable execution storage and recovery boundaries without weakening Workflow Definition, WorkflowRunner, or EventBus separation.
