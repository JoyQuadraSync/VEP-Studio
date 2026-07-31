# ADR-002 – Strongly Typed Events

## Status

Accepted

## Context

The event pipeline initially relied on loosely typed event payloads. EventBus accepted generic event objects without compile-time guarantees about the payload shape, and event construction was handled directly in the HTTP layer. As a result, type safety depended heavily on runtime validation and manual discipline rather than the TypeScript type system.

This made the system harder to evolve safely. Refactoring event payloads or changing event contracts risked introducing subtle issues that were not caught until runtime. The design also mixed transport concerns with domain event creation, which made the application boundary less clear.

## Decision

The Sprint 005 implementation introduced a strongly typed event contract to improve safety and clarity across the event pipeline.

The architectural decisions are:

- Introduce BaseEvent<TPayload> as the shared contract for domain events
- Introduce EventMap to connect event names to their payload types
- Introduce strongly typed payload interfaces for business events
- Make EventBus generic over EventMap keys so event types are known at compile time
- Remove any from the event typing path
- Remove unnecessary type assertions that weakened the type system
- Introduce an Event Factory to separate HTTP handling from event construction
- Keep EventBus independent from business logic so it remains a generic infrastructure component

## Rationale

This decision improves the system for several reasons:

- compile-time safety: invalid payload shapes can be detected before runtime
- IDE autocompletion: developers receive better editor support when working with event payloads
- easier maintenance: event contracts are explicit and easier to evolve
- scalable architecture: typed events support additional event types without losing structure
- cleaner separation of responsibilities: HTTP handling is separated from domain event construction and bus infrastructure

## Consequences

### Positive

- better developer experience
- safer refactoring
- easier onboarding for new contributors
- clearer contracts between producers and consumers

### Trade-offs

- more types to maintain
- additional generic complexity
- EventMap must be updated for every new business event

## Alternatives Considered

### payload: unknown

Using unknown as the payload type would avoid unsafe assumptions but would still force downstream code to perform repeated narrowing and runtime checks. It would improve safety only partially and would not provide the same developer experience as a typed event map.

### payload: any

Using any would make the system flexible but would remove most compile-time protection. It would allow invalid payload shapes to pass silently and would undermine the purpose of introducing stronger contracts.

### runtime-only validation

Relying only on runtime validation would preserve the current behavior but would not catch issues during development or refactoring. It would keep the system less predictable and would not improve the static type safety that motivated this change.

## Future Impact

This decision creates a foundation for more strongly typed workflows and integrations. It enables:

- typed workflows
- typed AI agents
- typed tools
- compile-time safe event routing

As more business events are introduced, the event model will become easier to reason about and safer to extend.
