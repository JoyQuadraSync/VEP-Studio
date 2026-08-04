# Sprint 010 Parallel Workflow Architecture Freeze

## Status

Architecture Frozen — Ready for Implementation and Release

## Frozen Model

Sprint 010 uses structured, non-nested fork/join regions within one immutable `WorkflowDefinition` and one immutable `WorkflowExecution` aggregate.

```text
                    ┌── branch A ──┐
sequential → FORK ──┼── branch B ──┼── JOIN → sequential
                    └── branch C ──┘
```

Only one region may be active. Multiple regions may execute sequentially. EventBus remains outside workflow control flow.

## Frozen Public Contracts

```ts
interface WorkflowForkStep {
  readonly id: string;
  readonly type: 'fork';
  readonly name: string;
  readonly joinStepId: string;
}

interface WorkflowJoinStep {
  readonly id: string;
  readonly type: 'join';
  readonly name: string;
  readonly forkStepId: string;
}

interface WorkflowParallelEdge {
  readonly id: string;
  readonly type: 'parallel';
  readonly sourceStepId: string;
  readonly targetStepId: string;
  readonly branchId: string;
}

type WorkflowBranchState = 'pending' | 'running' | 'completed' | 'failed';
type WorkflowParallelRegionState = 'completed' | 'failed';

interface ParallelBranchResult {
  readonly branchId: string;
  readonly output: unknown;
}

interface WorkflowBranchExecution {
  readonly branchId: string;
  readonly startStepId: string;
  readonly currentStepId?: string;
  readonly state: WorkflowBranchState;
  readonly input: unknown;
  readonly output?: unknown;
  readonly completedSteps: readonly string[];
  readonly stepResults: readonly WorkflowStepResult[];
  readonly failure?: WorkflowFailure;
  readonly durationMs?: number;
}

interface WorkflowParallelExecution {
  readonly forkStepId: string;
  readonly joinStepId: string;
  readonly input: unknown;
  readonly branches: readonly WorkflowBranchExecution[];
}

interface WorkflowCompletedParallelRegionResult {
  readonly forkStepId: string;
  readonly joinStepId: string;
  readonly state: 'completed';
  readonly branches: readonly WorkflowBranchExecution[];
  readonly output: readonly ParallelBranchResult[];
  readonly durationMs: number;
}

interface WorkflowFailedParallelRegionResult {
  readonly forkStepId: string;
  readonly joinStepId: string;
  readonly state: 'failed';
  readonly branches: readonly WorkflowBranchExecution[];
  readonly failure: WorkflowFailure;
  readonly durationMs: number;
}

type WorkflowParallelRegionResult =
  | WorkflowCompletedParallelRegionResult
  | WorkflowFailedParallelRegionResult;
```

`WorkflowExecution` is extended additively:

```ts
readonly activeParallel?: WorkflowParallelExecution;
readonly parallelRegions: readonly WorkflowParallelRegionResult[];
```

`parallelRegions` is an enumerable serialization-safe public field.

## Frozen Branch Identity

Branch IDs use:

```text
^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$
```

Canonical order uses ascending UTF-16 code-unit comparison. `localeCompare`, edge order, Promise settlement, duration, and scheduling never determine order.

## Frozen Ownership Algorithm

For every parallel edge, WorkflowValidator traverses from the edge target and stops at the paired join. Every visited non-join step belongs to that branch.

Validator rejects:

- ownership by multiple branches
- outside entry into branch-owned steps
- branch crossing or pre-join merge
- join bypass and dead ends
- finish before join
- wrong join
- loops
- nested or overlapping fork regions
- start steps inside branches
- outside entry into the paired join

Decision reconvergence is allowed only within the same branch when every path reaches the paired join.

## Frozen Condition Visibility

Conditions inside a branch may read workflow input, restricted execution metadata, pre-fork completed results, the fork result, same-branch completed results, and current decision input/output.

They cannot read sibling state or results before the join. No new condition source or operator is introduced.

## Frozen Execution Lifecycle

```text
complete fork
    ↓
create ordered pending branches
    ↓
transition to running
    ↓
execute concurrently
    ↓
wait for all branches to settle
    ↓
merge histories canonically
    ↓
retain completed/failed region
    ↓
clear activeParallel
    ↓
complete join or fail parent at join
```

Intermediate active snapshots remain internal. No callback, observer, async iterator, EventBus event, or public stepping API is introduced.

## Frozen History and Aggregation

Branch-local history remains in each region result. Parent history is flattened only at the barrier, grouped by branch ID and local step order.

Successful join input and output are the ordered readonly array of `{ branchId, output }`. Custom join aggregation is deferred to a normal post-join action.

## Frozen Failure Semantics

All branches settle. Any branch failure prevents join completion and fails the parent with:

```text
parallel_branch_failed at joinStepId
```

Individual structured branch failures remain intact. Defensive paired-join inconsistency uses `parallel_join_mismatch`. Raw causes are never retained.

## Frozen Duration Semantics

- no absolute timestamps
- branch duration measures activation to terminal state
- region duration measures activation to all-settled barrier
- region duration is not a sum
- duration does not affect ordering
- negative or non-finite elapsed values normalize to zero

## Frozen Compatibility

- existing linear and decision definitions require no migration
- existing condition language remains unchanged
- OperationRegistry remains unchanged
- EventBus and HTTP remain unchanged
- ExecutionContext remains event-publication-specific
- nonparallel executions retain empty `parallelRegions`

## Explicitly Deferred

- persistence and recovery
- retry, timeout, cancellation, and scheduling
- distributed execution
- nested parallelism and loops
- dynamic branches and compensation
- worker pools and resource limits
- custom join aggregation
- human tasks and AI agents
- metrics, tracing, HTTP endpoints, and visual editor

## Freeze Result

**Ready for Implementation and Release**
