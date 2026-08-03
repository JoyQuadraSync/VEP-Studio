# Changelog

All notable changes to VEP Studio will be documented in this file.

## Sprint 006 — 2026-08-03

### Added

- Runtime contracts for publish results, subscriber results, execution context, and subscriber status
- Injectable clock contract for deterministic runtime metadata
- Publish and per-subscriber execution durations
- Publish success and failure counts
- Stable subscriber names

### Improved

- HTTP router result selection no longer depends on subscriber registration order
- Runtime tests cover named results and deterministic execution metadata
- Backend tests are available through `npm test`

### Preserved

- Concurrent subscriber execution
- Registration-order result preservation
- Subscriber failure isolation
- Existing health and event HTTP behavior

### Deferred

- Subscriber timeout
- Retry policy
- Dead-letter queue
- Persistence
- Broader observability

## v0.1.0 — 2026-07-31

### Added

- Event Pipeline
- Validation
- Event Bus
- Multiple Subscribers
- Concurrent Event Dispatch
- Strongly Typed Events
- EventMap
- Event Factory

### Improved

- Generic EventBus
- Generic EventHandler
- Subscriber typing
- Architecture documentation

### Fixed

- Sequential subscriber execution replaced by true concurrency
- Removed any from EventBus
- Removed unnecessary type assertions

### Documentation

- Release Notes
- ADR-001
- ADR-002
- Architecture Review

### Next

- Timeout
- Retry
- Dead Letter Queue
