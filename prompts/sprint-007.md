# Sprint 007 – Workflow Definition System

## Goal

Introduce a transport-independent, declarative workflow definition model without executing workflows or changing existing HTTP and EventBus behavior.

---

## Scope

- `WorkflowDefinition`
- `WorkflowStep`
- `WorkflowEdge`
- `WorkflowValidator`
- `WorkflowRegistry`
- `CustomerCommentWorkflow`
- declarative operation identifiers
- dotted workflow IDs
- immutable integer workflow versions

---

## Architecture

```text
WorkflowDefinition → describes
WorkflowValidator  → validates
WorkflowRegistry   → registers and finds
WorkflowRuntime    → deferred
OperationRegistry  → deferred
```

Workflow definitions are graph-based data and remain independent from HTTP and runtime execution.

---

## Project Rules

- Keep Workflow Definition separate from Workflow Runtime.
- Keep graph validation separate from registration and lookup.
- Use declarative operation identifiers instead of executable callbacks.
- Use dotted workflow IDs such as `customer.comment.workflow`.
- Use positive integer versions that cannot be replaced under the same workflow ID.
- Preserve existing HTTP and EventBus behavior.
- Do not add dependencies or type-system escape hatches.

---

## Steps

Step 1
Define `WorkflowStep`, `WorkflowEdge`, and `WorkflowDefinition` contracts.

Step 2
Implement the independent `WorkflowValidator` and graph integrity rules.

Step 3
Implement `WorkflowRegistry` registration and versioned lookup.

Step 4
Define `CustomerCommentWorkflow` using declarative operation identifiers.

Step 5
Test definitions, graph validation, registry behavior, versioning, and architectural boundaries.

Step 6
Run typecheck, build, and the complete test suite.

---

## Explicit Non-Goals

Sprint 007 does not implement:

- `WorkflowRuntime`
- `OperationRegistry`
- execution state
- retries
- timeout
- persistence
- scheduling
- AI agents
- HTTP endpoints

Future step kinds `decision`, `parallel`, `human`, and `agent` are reserved for later design and are not implemented.

---

## Acceptance Criteria

- All six workflow definition components exist.
- Definitions use a graph of steps and edges.
- Workflow validation is independent from the registry.
- Registry responsibilities are limited to registration and lookup.
- Operations are declarative identifiers rather than callbacks.
- Workflow IDs use dotted namespaces.
- Versions are positive integers and duplicate versions cannot replace existing registrations.
- Existing HTTP and EventBus behavior remains unchanged.
- Typecheck, build, and all tests pass.
- No non-goal capability is introduced.

---

## Verification

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm test` — passed, 10/10 tests
- EventBus tests — passed, 4/4
- Workflow tests — passed, 6/6

---

## Lessons Learned

- Workflow graphs can be defined and validated without introducing execution semantics.
- Separating validation from storage keeps registry responsibilities small and reusable.
- Declarative operation identifiers preserve serialization and future runtime flexibility.
- Immutable version keys make workflow definitions safe to reference from future executions.
