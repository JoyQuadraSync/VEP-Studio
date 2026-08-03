# Phase 2 Runtime Foundation Review

## Decision

The runtime foundation is accepted as a stabilization layer around concurrent subscriber execution. This phase adds explicit publish, subscriber, status, execution-context, and clock contracts without adding reliability policies.

All Sprint 006 acceptance checks passed. The implementation is suitable for release as the foundation for later reliability work.

## Runtime Flow

HTTP validation → event factory → event bus → named subscribers → router → worker

The event bus remains responsible for concurrent dispatch, failure isolation, and aggregate execution results. The HTTP layer selects the router result by subscriber name rather than registration position.

## Contracts

- `ExecutionContext` records publish start and finish timestamps.
- `Clock` supplies time and can be replaced for deterministic tests.
- `PublishResult` records the event ID, execution context, total duration, success/failure counts, and ordered subscriber results.
- `SubscriberResult` records subscriber identity, status, duration, and its existing bus result.
- `SubscriberStatus` is limited to `success` and `failed` because those are the only implemented states.

## Preserved Behavior

- subscribers start concurrently
- results preserve registration order
- one subscriber failure does not reject the entire publication
- HTTP status and response bodies remain unchanged

## Deferred

Timeout, retry, dead-letter queues, persistence, and broader observability remain future work. `ARCHITECTURE.md` is intentionally unchanged in this sprint.

## Review Findings

- No release-blocking code or architecture issues remain.
- Subscriber identity removes the HTTP layer's dependency on registration position.
- Clock injection makes execution metadata deterministic in tests.
- The event bus retains its infrastructure role and does not absorb HTTP policy.
- Reliability policies remain separate from the runtime result contracts.

## Remaining Risks

- `Date` is a wall clock rather than a monotonic duration source.
- HTTP publication currently waits for all subscribers to settle.
- Subscriber failure details remain intentionally generic.
- The runtime currently supports one domain event type.
