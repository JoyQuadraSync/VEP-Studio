# Sprint 009 – Decision & Conditional Workflow

## Goal

Extend the workflow definition and runtime models with deterministic decision steps and declarative conditional edges while preserving immutable definitions, immutable execution snapshots, EventBus independence, and linear-workflow compatibility.

---

## Scope

- `decision` workflow step
- declarative `WorkflowCondition`
- restricted `ConditionReference`
- conditional workflow edges
- unique default edges
- pure `ConditionEvaluator`
- deterministic branch selection
- WorkflowValidator conditional rules
- WorkflowRunner decision progression
- structured conditional failures

---

## Architecture

```text
WorkflowDefinition
├── decision step
└── conditional/default edges
            │
            ▼
    ConditionEvaluator
            │
            ▼
      WorkflowRunner
            │
            ▼
  WorkflowExecution snapshot
```

Conditions live on edges. `ConditionEvaluator` evaluates declarative data, while `WorkflowRunner` owns branch selection and step progression.

EventBus does not participate in condition evaluation or branch selection. `ExecutionContext` remains event-publication-specific.

---

## Condition Language

Sprint 009 supports only:

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

Callbacks, scripts, dynamic evaluation, regex, arithmetic, templates, functions, and user-defined operators are prohibited.

---

## Condition Sources

Conditions may read only deterministic snapshot data:

- workflow input
- current decision-step input
- current decision-step output
- completed-step input, output, status, and structured `failure.code`
- restricted execution metadata:
  - execution ID
  - workflow ID
  - workflow version
  - workflow state

Conditions cannot access time, randomness, environment variables, EventBus state, network or database state, mutable globals, arbitrary services, raw errors, stacks, causes, or handler-specific failure data.

---

## Branch Selection Rules

- start and action steps require one unconditional outgoing edge
- finish steps require zero outgoing edges
- decision steps may have multiple conditional outgoing edges
- a decision may have zero or one default edge
- a default edge contains no condition
- every conditional edge is evaluated
- `and` and `or` evaluate all children without short-circuiting
- one match selects that edge
- multiple matches fail explicitly
- zero matches use the unique default when present
- zero matches without default fail explicitly
- edge declaration order never affects selection

Decision output equals decision input. Decision steps produce completed step results and enter `completedSteps` before branch selection.

---

## Failure Semantics

- evaluation error → `condition_evaluation_failed`
- multiple matching edges → `multiple_matching_branches`
- zero matches without default → `no_matching_branch`
- malformed default configuration → `invalid_default_branch`
- missing selected target → existing `invalid_step`

Failures preserve immutable execution snapshots, the completed decision result, and all earlier step results.

---

## Explicit Non-Goals

- parallel execution
- loops
- retry
- timeout
- cancellation
- persistence
- recovery
- scheduling
- human tasks
- AI agents
- compensation
- metrics aggregation
- tracing
- HTTP endpoints
- visual editor

---

## Verification

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm test` — passed, 32/32
- EventBus — passed, 4/4
- Workflow Conditions — passed, 10/10
- Workflow Runtime — passed, 12/12
- Workflow Definition — passed, 6/6
- `git diff --check` — passed

---

## Acceptance Criteria

- Decision steps and conditional/default edges are declarative and immutable.
- The condition language contains only the frozen operators.
- Condition references expose only approved deterministic snapshot data.
- ConditionEvaluator is pure and performs no I/O.
- Branch selection is independent from edge order and external state.
- All matching conditions are evaluated.
- Structured failures cover evaluation, ambiguity, no match, and invalid defaults.
- Existing linear workflows remain fully compatible.
- EventBus and ExecutionContext boundaries remain unchanged.
- All existing and new tests pass.

---

## Lessons Learned

- Conditional control flow can remain deterministic when definitions contain data rather than executable code.
- Multiple matching branches are configuration ambiguity and should fail rather than hide behind ordering.
- Restricted snapshot inputs prevent conditions from becoming invisible service dependencies.
- A separate evaluator keeps expression semantics independent from workflow progression.
- Default branches should be explicit and used only after every conditional edge is evaluated.
