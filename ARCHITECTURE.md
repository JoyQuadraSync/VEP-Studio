# VEP Studio Architecture

## 1. High-Level Architecture

VEP Studio is organized around two foundations: an event platform and a workflow platform. Each component owns a narrow responsibility and communicates through explicit contracts.

```text
External Systems / HTTP
           ↓
       Validation
           ↓
      Event Platform
           ↓
   Workflow Definition
           ↓
    Workflow Runtime
           ↓
   Operation Registry
           ↓
   Operation Handlers
```

At version 0.2.0, Event Platform and Workflow Platform are implemented but intentionally not coupled into one production request path. EventBus is not a workflow control-flow engine, and HTTP does not yet start workflow executions.

```text
Event Platform                         Workflow Platform
──────────────                         ─────────────────
HTTP validation                        WorkflowDefinition
Event factory                          WorkflowValidator
EventBus                               WorkflowRegistry
Named subscribers                      WorkflowRunner
Publication runtime contracts          WorkflowExecution
                                       OperationRegistry
                                       OperationHandler
```

## 2. Event Platform

The Event Platform accepts, validates, creates, publishes, and routes strongly typed events.

```text
HTTP POST /events
        ↓
   Event Schema
        ↓
   Event Factory
        ↓
     EventBus
        ↓
Named Subscribers
```

Primary responsibilities:

- validate the external event envelope
- construct typed domain events
- publish events to registered subscribers concurrently
- preserve subscriber registration order in results
- isolate subscriber failures
- expose publish and subscriber execution metadata
- select HTTP routing results by stable subscriber identity

EventBus is generic infrastructure. It does not own workflow state, determine workflow transitions, or encode workflow ordering through subscriber registration.

## 3. Workflow Definition

Workflow Definition describes an immutable, versioned process graph.

```text
WorkflowDefinition
├── workflow ID
├── integer version
├── start step
├── finish step
├── WorkflowStep[]
└── WorkflowEdge[]
```

Current step kinds:

- `start`
- `action`
- `finish`

Action steps contain declarative operation identifiers such as `comment.process`. Definitions do not contain executable callbacks or mutable execution state.

Workflow IDs use dotted namespaces, for example:

```text
customer.comment.workflow
```

The pair of workflow ID and integer version identifies one immutable definition revision.

### WorkflowValidator

`WorkflowValidator` owns identity and graph integrity checks:

- dotted workflow ID format
- positive integer version
- unique step and edge IDs
- valid start and finish references
- valid edge endpoints
- reachability from start to finish
- unreachable and dead-end step detection

### WorkflowRegistry

`WorkflowRegistry` owns registration and lookup:

- duplicate ID/version protection
- exact-version lookup
- latest-version lookup
- definition listing

Graph validation remains outside the registry so authoring tools, imports, and future APIs can reuse validation independently.

## 4. Workflow Runtime

Workflow Runtime executes one validated workflow definition through one `WorkflowExecution` aggregate.

```text
WorkflowDefinition
        │
        ▼
WorkflowRunner ◄── OperationRegistry
        │
        ▼
WorkflowExecution
```

`WorkflowRunner` owns:

- execution creation
- allowed state transitions
- start, action, and finish behavior
- operation resolution
- synchronous and asynchronous handler normalization
- step input/output chaining
- completed-step ordering
- structured failure recording
- final workflow output selection

The first runtime supports linear workflows. Start and action steps require one outgoing edge; finish requires none. Multiple outgoing edges fail explicitly rather than relying on edge order.

## 5. Runtime Contracts

### Event publication contracts

`ExecutionContext` remains event-publication-specific and records publication timing boundaries.

`PublishResult` contains:

- event identity
- publication duration
- success and failure counts
- ordered subscriber results

`SubscriberResult` contains:

- stable subscriber identity
- success or failure status
- duration
- subscriber result

### Workflow execution contracts

`WorkflowExecution` contains:

- execution ID
- fixed workflow ID and version
- workflow state
- current step ID
- immutable workflow input reference
- optional workflow output
- ordered completed steps
- ordered step results
- optional structured failure
- optional aggregate duration

`WorkflowStepResult` contains:

- step ID
- completion or failure status
- step input
- optional output
- optional structured failure
- duration

Workflow failures retain stable codes and messages, not raw exceptions, causes, stacks, or handler-specific rejection values.

## 6. Operation Registry

Workflow definitions reference operations by declarative ID. `OperationRegistry` resolves those IDs to runtime handlers.

```text
action step
operation: comment.process
          ↓
   OperationRegistry
          ↓
   OperationHandler
```

The registry:

- registers stable operation IDs
- rejects duplicate IDs
- resolves handlers

It does not:

- execute workflows
- advance steps
- store workflow state
- apply runtime policies

Handlers may return values directly or asynchronously. `WorkflowRunner` normalizes both forms through a Promise boundary.

## 7. Current Execution Lifecycle

### Event publication

```text
receive request
      ↓
validate event
      ↓
create typed event
      ↓
publish concurrently
      ↓
collect subscriber results
      ↓
return router result
```

### Workflow execution

```text
create WorkflowExecution
          ↓
       created
          ↓
       running
          ↓
        start
          ↓
      action(s)
          ↓
        finish
          ↓
      completed
```

Failure path:

```text
running
   ↓
structured runtime failure
   ↓
failed
```

Input and output flow:

```text
workflow input
      ↓
 start output
      ↓
 action input → handler → action output
      ↓
 finish input
      ↓
workflow output
```

Every workflow transition returns a new immutable execution snapshot. Earlier snapshots and arrays are not mutated.

## 8. Design Principles

### Immutable definitions

Workflow definitions are reusable process descriptions. Execution state never lives inside a definition.

### Immutable execution snapshots

WorkflowRunner returns new execution objects and arrays for every transition, producing explicit and testable state changes.

### Separation of concerns

- WorkflowValidator validates graphs.
- WorkflowRegistry stores definitions.
- OperationRegistry resolves handlers.
- WorkflowRunner controls execution.
- EventBus publishes events.
- HTTP handles transport concerns.

### Explicit runtime boundaries

Event publication and workflow execution use separate state models:

```text
EventBus                 WorkflowRunner
└── ExecutionContext     └── WorkflowExecution
```

There is no inheritance or shared mutable state between them.

### Deterministic execution

Runtime dependencies such as time and execution ID generation are injected. Tests use controlled clocks, identifiers, and handlers to verify durations, transitions, outputs, and failures without external services.

### Declarative over executable definitions

Workflow definitions contain stable operation identifiers rather than callbacks. Runtime behavior remains replaceable and independently testable.

## 9. Future Architecture

Future milestones will extend platform capabilities while preserving current boundaries.

### Decision workflows

Workflow graphs will support explicit decisions and conditional transitions.

### Parallel execution

Workflows will support multiple coordinated branches and defined join behavior.

### Persistence

Definitions and execution snapshots will be stored beyond process memory.

### Recovery

Interrupted executions will be restored and continued from durable state.

### Human tasks

Workflows will support steps that wait for human input, review, or approval.

### AI agents

AI agents will participate through governed workflow operations and explicit runtime contracts.

These sections describe direction only. Their implementation contracts and policies require separate RFCs and architecture reviews.
