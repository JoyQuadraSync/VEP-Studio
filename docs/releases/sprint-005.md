# Sprint 005 – Strongly Typed Events

## Goal

Sprint 005 introduced compile-time type safety across the event pipeline without changing runtime behavior. The work focused on moving the system from loosely typed event handling toward a strongly typed domain event contract while preserving the existing request flow, event bus behavior, and HTTP semantics.

## Architecture Before

HTTP
→ Validation
→ Event Bus
→ Subscribers
→ Router
→ Workers

Before this sprint, the event pipeline was functional, but event payload typing was loose. The application boundary and downstream consumers relied on less explicit event shapes, which made it harder to verify that the correct payload structure was being used.

## Architecture After

HTTP
→ Validation
→ Event Factory
→ Strongly Typed Event
→ Concurrent Event Bus
→ Subscribers
→ Router
→ Workers

The pipeline now creates a strongly typed domain event before publication, which improves compile-time validation while preserving the existing execution flow.

## Components Added

- BaseEvent<TPayload>
- CustomerCommentCreatedPayload
- EventMap
- Event Factory

## Components Updated

- EventBus
- EventHandler
- application boundary in index.ts
- subscriber/router typing

## Type Safety Improvements

The sprint introduced several important type-system improvements:

- event payloads now have explicit types
- EventMap connects event names to payloads
- EventBus is generic over EventMap keys
- any was removed
- unnecessary type assertions were removed
- TypeScript can detect invalid payload shapes at compile time

These improvements make the event contract easier to evolve and less likely to break silently when new event types are introduced.

## Event Factory

Event construction was moved out of index.ts so the HTTP layer no longer directly builds domain events. This keeps the application boundary focused on request handling and makes event creation reusable, clearer, and easier to evolve independently from the transport layer.

## Runtime Behavior

The following runtime behavior remains unchanged:

- concurrent subscriber execution
- Promise.all coordination
- registration-order result preservation
- subscriber error isolation
- HTTP response behavior

## Architecture Correction

The first EventBus typing attempt introduced:

- | any
- an unnecessary as EventHandler assertion

That approach was rejected during review because it weakened type safety. Step 5.1 removed both patterns so the implementation could remain strongly typed without relying on escape hatches.

## Verification

The implementation was verified with:

- npm run typecheck — passed
- npm run build — passed
- node --test ./tests/event-bus.test.js — passed, 2/2 tests

## Lessons Learned

- compiling successfully does not guarantee strong typing
- A | any effectively becomes any
- type assertions can hide design problems
- HTTP layers should not construct domain events directly
- runtime behavior and type-system improvements should be reviewed separately

## Known Limitations

- only one business event currently exists in EventMap
- compile-time negative type tests are not yet implemented
- retry, timeout, and DLQ are not yet implemented
- Router result selection may still depend on subscriber registration order, if this remains true in the current codebase

## Next Sprint

Sprint 006 will introduce timeout and retry foundations for subscriber execution.
