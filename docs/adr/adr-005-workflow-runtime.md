# ADR-005 – Workflow Runtime

## Status

Accepted

## Context

Sprint 007 introduced immutable, declarative workflow definitions, graph validation, and versioned definition lookup. Those contracts describe what a workflow is, but they intentionally do not represent or execute one run of a workflow.

Sprint 008 requires an in-memory runtime that can resolve declarative operations, execute linear start/action/finish workflows, retain results and failures, and expose deterministic duration metadata. The design must not turn Workflow Definition or EventBus into mutable workflow state or control-flow infrastructure.

## Decision

### Keep Workflow Runtime Independent from Workflow Definition

`WorkflowDefinition` remains immutable process structure:

- workflow ID and version
- start and finish identities
- steps
- edges
- declarative operation identifiers

`WorkflowExecution` represents one run:

- execution ID
- fixed definition identity
- current workflow state and step
- workflow input and output
- completed steps
- step results
- structured failure
- duration

The runner reads a definition but never stores execution state inside it. One definition can therefore support multiple independent executions, future persistence, and visual tooling without mutation.

### Use WorkflowExecution Instead of WorkflowInstance

`WorkflowExecution` is the single execution-state aggregate. `WorkflowInstance` was rejected because it would overlap with the same execution identity, lifecycle, current step, results, and failure state.

A second concept would add ambiguity without a distinct lifecycle or persistence boundary. Future architecture may reconsider a separate entity only if a concrete non-overlapping responsibility emerges.

### Use Immutable Execution Snapshots

`WorkflowRunner` never mutates the supplied `WorkflowExecution` or its arrays. Each transition returns a new snapshot.

This decision provides:

- explicit state transitions
- deterministic before/after comparisons
- isolation from shared mutable state
- safer future persistence and recovery boundaries
- preservation of earlier execution history
- easier testing of terminal and intermediate state

The snapshots provide structural and compile-time immutability. Nested `unknown` input and output objects are not deep-frozen in Sprint 008.

### Keep EventBus Outside Workflow Control Flow

`WorkflowRunner` owns progression directly through:

- `WorkflowDefinition`
- `WorkflowExecution`
- `OperationRegistry`

EventBus is not required to execute or advance a workflow. It does not store current steps, completed steps, outputs, failures, or other mutable execution state.

EventBus may later support triggers, notifications, audit consumers, or external integrations, but those capabilities must remain optional around runner behavior. Subscriber order must never represent workflow order.

### Keep ExecutionContext Event-Publication-Specific

The existing `ExecutionContext` remains owned by EventBus publication. It is not extended with workflow ID, workflow state, current step, operation output, or mutable workflow data.

Workflow Runtime owns `WorkflowExecution`. There is no inheritance and no shared mutable state between the two models.

The existing stateless `Clock` contract is reused only to calculate durations. Absolute timestamps are not stored in workflow execution or step results.

### Resolve Declarative Operations Through OperationRegistry

Workflow action steps retain declarative operation identifiers. `OperationRegistry` maps stable IDs to runtime handlers and rejects duplicate registrations.

`WorkflowRunner` resolves and invokes handlers. `OperationRegistry` does not execute workflows, progress steps, or store workflow state.

## Failure Model

Workflow failures contain only:

- stable code
- stable message
- step ID
- optional operation ID

Raw errors, causes, stacks, rejection values, and handler-specific objects are not retained in execution state.

Required runtime failures include:

- `operation_not_registered`
- `operation_failed`
- `no_next_step`
- `unsupported_multiple_outgoing_edges`
- `invalid_step`

Definition identity mismatch and illegal initial state are caller contract violations and throw before execution begins.

## Consequences

### Positive

- definitions remain reusable and serialization-friendly
- runtime transitions are deterministic and inspectable
- handlers can be synchronous or asynchronous
- failures preserve prior successful results without exposing raw errors
- workflow execution works without EventBus
- future persistence can store immutable execution revisions

### Trade-offs

- snapshot creation allocates new objects and arrays
- nested input and output objects are not deeply immutable
- linear runtime rejects valid definition graphs with multiple outgoing edges
- callers must validate definitions before execution
- missing operations are discovered at execution time

## Alternatives Considered

### Store Runtime State in WorkflowDefinition

Rejected because it would make definitions mutable, prevent safe reuse, and mix process design with individual execution state.

### Introduce WorkflowInstance and WorkflowExecution

Rejected because no distinct lifecycle or persistence boundary justified two overlapping aggregates.

### Mutate WorkflowExecution In Place

Rejected because shared mutation makes transitions harder to reason about, test, persist, and recover.

### Advance Steps Through EventBus

Rejected because EventBus subscriber relationships are not workflow control flow. Requiring publication for every transition would obscure ordering and couple workflow progress to unrelated infrastructure.

### Retain Raw Handler Errors

Rejected because runtime errors may contain sensitive, non-serializable, or handler-specific details. Structured failures are sufficient for Sprint 008.

## Explicit Non-Goals

- conditions and decision steps
- parallel execution
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

Later runtime capabilities must preserve the single `WorkflowExecution` aggregate, immutable snapshot transitions, declarative operation boundary, EventBus independence, and event-publication-specific `ExecutionContext` unless a future ADR explicitly supersedes this decision.
