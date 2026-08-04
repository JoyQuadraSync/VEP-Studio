# ADR-006 – Declarative Conditional Workflows

## Status

Accepted

## Context

Sprint 008 introduced a deterministic runtime for linear workflows. Supporting business decisions requires multiple possible transitions from a decision point, but conditional behavior must not compromise immutable definitions, serialization, deterministic execution, or the established separation between WorkflowRunner and EventBus.

Sprint 009 introduces declarative decision and conditional workflow semantics.

## Decision

### Conditions Live on Edges

A condition describes when one transition is eligible. It therefore belongs to the edge representing that transition rather than to the decision step itself.

This keeps the model direct:

```text
decision step
├── conditional edge → target A
├── conditional edge → target B
└── default edge     → target C
```

Placing conditions on the decision step would require a separate mapping between expressions and target edges, adding indirection and additional consistency rules.

Decision steps contain no operation or condition code. Their output equals their input, and they produce a normal completed step result before branch selection.

### Conditions Are Declarative and Serializable

Workflow definitions must remain data that can be validated, versioned, stored, inspected, and eventually authored visually.

Conditions therefore use a small expression model containing stable operator names, scalar literals, explicit references, and property paths. The supported language is limited to equality, numeric ordering, existence, and logical composition.

Serializable conditions support:

- deterministic validation
- definition versioning
- future persistence
- visual inspection and authoring
- safe interchange between processes
- repeatable evaluation from execution snapshots

### Callbacks, Scripts, and Dynamic Evaluation Are Prohibited

JavaScript callbacks, scripting, dynamic evaluation, regex, templates, functions, and user-defined operators are not allowed in Workflow Definition.

Executable conditions would:

- make definitions process-specific and non-serializable
- allow hidden I/O and mutable dependencies
- bypass condition validation
- introduce security and governance risks
- make behavior difficult to inspect or reproduce
- couple definitions to JavaScript runtime details

The condition language is intentionally smaller than a general expression engine.

### ConditionEvaluator Is Separate from WorkflowRunner

`ConditionEvaluator` owns expression semantics:

- reference resolution
- scalar validation
- comparisons
- existence checks
- logical composition
- structured evaluation failures

`WorkflowRunner` owns workflow semantics:

- decision-step completion
- collection of outgoing edges
- evaluation orchestration
- branch selection
- execution-state transitions
- structured workflow failures

This boundary makes the evaluator pure, independently testable, and reusable without turning WorkflowRunner into an expression interpreter.

### All Matching Conditions Are Evaluated Before Selection

Every conditional edge is evaluated before branch selection. Likewise, every child of `and` and `or` is evaluated without short-circuiting in Sprint 009.

This ensures:

- multiple matches can be detected
- malformed runtime data is not hidden
- results do not depend on edge or child order
- evaluator failures remain explicit

Short-circuit behavior may only be reconsidered through a future RFC.

### Multiple Matching Branches Fail Explicitly

When multiple conditions match, the workflow fails with:

```text
multiple_matching_branches
```

The runtime does not select the first edge, use edge order as priority, infer priority from IDs, or introduce implicit priorities.

Multiple matches indicate an ambiguous definition or runtime state. Explicit failure is safer than silently choosing behavior the definition did not uniquely specify.

### Default Branches Are Explicit

A decision may have zero or one default edge. A default edge contains no condition and is selected only when every conditional edge evaluates successfully and none match.

No match without a default produces:

```text
no_matching_branch
```

Malformed default configuration produces:

```text
invalid_default_branch
```

### Condition Inputs Are Restricted Snapshot Data

Conditions may read only:

- workflow input
- current decision input and output
- completed-step input, output, status, and structured failure code
- restricted execution metadata: execution ID, workflow ID, workflow version, and state

They cannot read time, randomness, environment variables, EventBus state, databases, networks, mutable globals, arbitrary services, raw errors, stacks, causes, or handler-specific failure information.

Branch selection is a pure function of Workflow Definition, the immutable WorkflowExecution snapshot, and ConditionEvaluator results.

### EventBus Remains Outside Branch Selection

WorkflowRunner continues to own control flow directly. EventBus does not evaluate conditions, select edges, store decision state, or advance workflows.

EventBus may later support triggers or notifications, but those integrations must remain optional around workflow progression.

### ExecutionContext Remains Unchanged

The existing `ExecutionContext` remains specific to EventBus publication. It does not gain workflow conditions, decision state, execution identity, branch results, or mutable workflow data.

Workflow conditional state remains part of immutable `WorkflowExecution` snapshots and existing step results.

## Failure Model

Sprint 009 adds:

- `condition_evaluation_failed`
- `multiple_matching_branches`
- `no_matching_branch`
- `invalid_default_branch`

Failures retain stable structured information only. Raw evaluation or handler causes are not retained.

## Consequences

### Positive

- definitions remain serializable and inspectable
- branch selection is deterministic
- edge order has no semantic meaning
- ambiguous matches cannot silently choose behavior
- expression semantics are independently testable
- existing linear workflows remain compatible
- EventBus and ExecutionContext boundaries remain stable

### Trade-offs

- the condition language is intentionally less expressive than JavaScript
- all conditional edges and logical children are evaluated
- definitions must make branch exclusivity explicit
- runtime data type mismatches fail instead of coercing values
- default branches must be modeled explicitly

## Alternatives Considered

### Store Conditions on Decision Steps

Rejected because it introduces an indirect mapping between conditions and target edges.

### Store JavaScript Callbacks in Definitions

Rejected because callbacks are executable, non-serializable, difficult to validate, and able to access nondeterministic state.

### Let WorkflowRunner Evaluate Expressions Directly

Rejected because it mixes expression-language semantics with workflow state transitions.

### Select the First Matching Edge

Rejected because behavior would depend on array order and hide ambiguous conditions.

### Introduce Edge Priorities

Rejected because Sprint 009 requires unambiguous conditions and does not define priority semantics.

### Use EventBus to Select Branches

Rejected because subscribers and event order are not workflow control-flow constructs.

## Explicit Non-Goals

- parallel execution and joins
- loops
- retry and timeout
- cancellation
- persistence and recovery
- scheduling
- human tasks
- AI agents
- compensation
- metrics aggregation and tracing
- HTTP endpoints
- visual editor

## Future Impact

Future workflow capabilities must preserve declarative conditions, pure deterministic evaluation, immutable execution snapshots, edge-order independence, EventBus exclusion from control flow, and the event-publication-specific ExecutionContext boundary unless a later ADR explicitly supersedes this decision.
