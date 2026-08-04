# Sprint 011 Persistence & Recovery Architecture Review

## Review Scope

The review evaluated snapshot persistence, Runner progression, save-point ownership, canonical serialization, optimistic concurrency, duplicate-write protection, exact definition recovery, parallel recovery, failure separation, and backward compatibility.

## RFC Review Result

**Approved with 6 Required Freezes**

The RFC correctly selected immutable snapshot persistence rather than event sourcing and kept persistence outside WorkflowRunner. Six contracts required explicit freezing before implementation.

## Required Freeze Decisions

1. `WorkflowRunner.advance()` became the only incremental progression API; `run()` became its compatibility wrapper.
2. Coordinator exclusively owns save-point timing; Runner produces snapshots and Repository stores them.
3. Serializer guarantees JSON-safe deterministic canonical JSON and stable UTF-8 bytes.
4. Repository is limited to `create`, `findByExecutionId`, and `save`.
5. Coordinator is the sole application layer allowed to compose Runner, Repository, Serializer, RecoveryValidator, DefinitionResolver, and write-ID generation.
6. Handler execution is explicitly at least once and handlers should be idempotent.

## Additional Frozen Decisions

- every architectural transition is represented by a durable save point
- one parallel advancement round produces one snapshot and revision
- final branch settlement and join barrier remain separate transitions
- revision is storage metadata rather than workflow state
- all accepted write IDs remain tracked for the execution lifetime
- exact definition versions are mandatory
- terminal executions are loadable but not resumable
- persistence errors never become workflow failure codes

## Implementation Verification

The implementation was reviewed against the frozen contracts:

| Area | Result |
|---|---|
| Incremental Runner API | Passed |
| Backward-compatible run wrapper | Passed |
| Coordinator ownership | Passed |
| Repository API restriction | Passed |
| Canonical serialization | Passed |
| Revision/writeId state machine | Passed |
| Exact definition recovery | Passed |
| Active parallel recovery | Passed |
| Retained parallel-region round-trip | Passed |
| Failure separation | Passed |
| At-least-once behavior | Passed |
| EventBus and runtime boundaries | Passed |

Verification:

- `npm run typecheck` — passed
- `npm run build` — passed
- `npm test` — passed, 69/69
- existing Sprint 007–010 tests — passed, 50/50
- Sprint 011 tests — passed, 19/19
- `git diff --check` — passed

Forbidden-scope scans found no persistence coupling in EventBus, OperationRegistry, or ConditionEvaluator and no implementation of deferred retry, timeout, cancellation, event sourcing, AI agents, or HTTP workflow management.

## Final Approval

**Approved for Release**

No release-blocking architecture, implementation, compatibility, or verification issue remains.
