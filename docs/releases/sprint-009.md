# Sprint 009 – Decision & Conditional Workflow

## Goal

Add deterministic decision and conditional branching to VEP Studio while preserving serializable workflow definitions, immutable execution snapshots, existing linear workflow behavior, and explicit EventBus/runtime boundaries.

## Architecture Before

```text
start
  ↓
action
  ↓
action
  ↓
finish
```

Sprint 008 supported linear workflows only. Start and action steps required one outgoing edge, finish required none, and multiple outgoing edges failed with `unsupported_multiple_outgoing_edges`.

## Architecture After

```text
                  conditional edge
                 ┌─────────────────→ action
start → action → decision
                 └─────────────────→ action
                       default edge
```

```text
WorkflowCondition
        │
        ▼
ConditionEvaluator
        │
        ▼
WorkflowRunner
        │
        ▼
immutable WorkflowExecution snapshot
```

Conditions live on decision-step edges. The pure evaluator calculates Boolean results from restricted snapshot data. WorkflowRunner evaluates every conditional edge and selects a unique match or default without relying on edge order.

## Components Added

- `WorkflowDecisionStep`
- `WorkflowCondition`
- `ConditionReference`
- comparison, existence, and logical condition contracts
- conditional workflow edge
- default workflow edge
- `ConditionEvaluationInput`
- restricted execution metadata view
- `ConditionEvaluationResult`
- `ConditionEvaluator`
- `DeclarativeConditionEvaluator`

## Components Updated

- `WorkflowStep` adds the `decision` variant
- `WorkflowEdge` becomes an unconditional/conditional/default union
- `WorkflowValidator` validates decision cardinality, edge roles, condition structure, serialization, references, and configured nesting depth
- `WorkflowRunner` records decision results and performs deterministic branch selection
- `WorkflowFailureCode` adds conditional failure states
- existing runtime and definition tests preserve compatibility with the explicit evaluator dependency

EventBus, HTTP, `ExecutionContext`, operation handlers, workflow execution shape, and dependencies remain unchanged.

## Condition Language

Supported operations:

- `equals`
- `not_equals`
- `greater_than`
- `greater_than_or_equal`
- `less_than`
- `less_than_or_equal`
- `exists`
- `not_exists`
- `and`
- `or`
- `not`

Definitions remain declarative and JSON-compatible. JavaScript callbacks, scripts, dynamic evaluation, regex, arithmetic, templates, functions, user-defined operators, and implicit coercion are not supported.

Conditions may inspect workflow input, current decision input/output, completed-step input/output/status/failure code, and restricted execution identity/state metadata. They cannot inspect external or mutable runtime state.

## Branch Selection Rules

- only decision steps may use multiple outgoing edges
- conditional edges are all evaluated before selection
- edge order provides no priority
- one match selects that edge
- more than one match fails
- a decision may have zero or one default edge
- a default edge has no condition
- default is selected only when zero conditions match
- no match without default fails
- decision input passes through unchanged as decision output
- decision result is completed before branch selection

## Failure Semantics

- `condition_evaluation_failed` — malformed or incompatible runtime condition data
- `multiple_matching_branches` — more than one conditional edge matched
- `no_matching_branch` — no condition matched and no default exists
- `invalid_default_branch` — malformed default or unconditional decision edge configuration
- `invalid_step` — selected target step does not exist

Conditional failures retain only structured workflow failure data. They do not retain raw evaluator errors, callbacks, causes, stack traces, or arbitrary service results.

## Verification

Run from `backend`:

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm test` — passed, 32/32
- `git diff --check` — passed
- architecture and forbidden-pattern scan — passed
- trailing-whitespace scan — passed

## Test Results

- EventBus — 4/4 passed
- Workflow Conditions — 10/10 passed
- Workflow Runtime — 12/12 passed
- Workflow Definition — 6/6 passed
- Total — 32/32 passed

Tests cover every supported operator, deterministic references, restricted metadata, completed failure codes, no-short-circuit evaluation, serialization validation, implementation-defined depth, unique and default branch selection, ambiguous/no-match/evaluation failures, edge-order invariance, immutable snapshots, and linear compatibility.

## Lessons Learned

- Declarative conditions preserve definition serialization and runtime auditability.
- Branch ambiguity should be explicit rather than resolved through hidden priority.
- Pure evaluation requires a deliberately restricted snapshot input boundary.
- Evaluating every condition exposes malformed data that short-circuit behavior could hide.
- Decision steps can select control flow without transforming business data.
- EventBus remains useful infrastructure without becoming workflow control flow.

## Known Limitations

- condition operators are intentionally limited
- ordered comparisons support finite numbers only
- conditions cannot perform arithmetic, regex, functions, or type coercion
- only decision branching is supported; parallel execution and loops are not
- condition depth is bounded by an implementation-defined limit with a recommended default of 20
- nested workflow input/output values are not deep-frozen
- persistence, recovery, retry, timeout, scheduling, human tasks, and AI agents remain unavailable
- no HTTP or visual-authoring integration exists

## Next Sprint

Sprint 010 — Parallel Workflow.

Parallel workflow design must preserve declarative definitions, immutable execution snapshots, deterministic control-flow semantics, and the existing EventBus boundary.
