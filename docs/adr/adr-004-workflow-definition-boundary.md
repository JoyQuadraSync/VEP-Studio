# ADR-004 – Workflow Definition Boundary

## Status

Accepted

## Context

Sprint 006 established strongly typed events, concurrent event publication, stable subscriber identities, and runtime result contracts. The platform now needs a workflow model that can support future execution, agents, human tasks, retry policies, timeout policies, scheduling, and visual design.

Introducing execution behavior at the same time as the definition model would mix immutable process structure with mutable runtime state. It would also risk coupling workflow definitions to HTTP, in-memory callbacks, and the first execution mechanism.

Sprint 007 therefore establishes only the Workflow Definition System.

## Decision

### Separate Workflow Definition from Workflow Runtime

Workflow Definition describes what a workflow is:

- workflow identity and version
- start and finish steps
- steps and their declarative operations
- directed transitions between steps

Workflow Runtime will later describe what happens during one execution:

- current execution state
- completed and pending steps
- inputs and outputs
- failures and attempts
- waiting and resumption
- runtime policies

Definitions remain transport-independent, serializable, and reusable across multiple future executions. Sprint 007 does not implement `WorkflowRuntime` or execution state.

### Separate WorkflowValidator from WorkflowRegistry

`WorkflowValidator` owns definition and graph integrity rules, including:

- dotted workflow IDs
- positive integer versions
- unique step and edge IDs
- valid start and finish references
- valid edge endpoints
- reachability from start to finish
- detection of unreachable and dead-end steps

`WorkflowRegistry` owns only:

- registration
- duplicate ID/version protection
- exact-version lookup
- latest-version lookup
- listing registered definitions

This separation keeps storage and lookup independent from graph policy. Validation can be reused by tests, future authoring tools, imports, APIs, and visual designers without turning the registry into a general workflow service.

### Use Declarative Operation Identifiers Instead of Callbacks

Action steps reference operations using stable strings such as:

```text
comment.process
comment.audit
```

Definitions do not contain executable callbacks. This keeps workflow graphs serializable and prevents them from depending on process memory, dependency injection, transport frameworks, or a particular runtime implementation.

A future `OperationRegistry` will resolve these identifiers to executable runtime handlers. It is explicitly outside Sprint 007.

## Version and Identity Convention

Workflow IDs use dotted namespaces such as `customer.comment.workflow`. Each workflow definition uses a positive integer version. The pair `(workflowId, version)` uniquely identifies an immutable definition revision, and the registry rejects replacement under an existing pair.

## Consequences

### Positive

- workflow definitions can be validated without execution
- definitions remain independent from HTTP and EventBus infrastructure
- graph data can support future persistence and visual tooling
- operation handlers can evolve without rewriting workflow definitions
- multiple executions can reference one immutable definition version
- validation and registry behavior can evolve independently

### Trade-offs

- callers must explicitly validate definitions before registration
- operation availability cannot be checked until an Operation Registry exists
- compile-time `readonly` does not deep-freeze objects at runtime
- additional contracts exist before workflow execution is available

## Alternatives Considered

### Combine Definition and Runtime

Rejected because it would mix reusable graph structure with mutable execution state and prematurely choose execution semantics.

### Put Validation Inside WorkflowRegistry

Rejected because registration and lookup should not own graph rules. A dedicated validator is reusable by more than one storage or authoring boundary.

### Store Executable Callbacks in Steps

Rejected because callbacks are not serializable, couple definitions to a process and runtime, and cannot be safely consumed by future visual or persistence systems.

## Explicit Non-Goals

This decision does not introduce:

- `WorkflowRuntime`
- `OperationRegistry`
- execution state
- retries
- timeout
- persistence
- scheduling
- AI agents
- HTTP endpoints

Future `decision`, `parallel`, `human`, and `agent` step kinds are acknowledged but not implemented.

## Future Impact

The Workflow Definition System provides stable input for later RFCs covering Workflow Runtime and Operation Registry. Those RFCs must preserve the definition/runtime boundary established here.
