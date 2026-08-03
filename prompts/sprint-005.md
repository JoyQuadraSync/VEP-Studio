# Sprint 005 – Strongly Typed Events

## Goal

Introduce compile-time type safety across the event pipeline.

---

## Scope

- BaseEvent<TPayload>
- EventMap
- Event Factory
- Generic EventBus
- Typed Subscribers

---

## Architecture

HTTP
↓
Validation
↓
Event Factory
↓
Strongly Typed Event
↓
Event Bus
↓
Subscribers
↓
Router
↓
Workers

---

## Project Rules

- No runtime behavior changes
- No new dependencies
- Strong typing only
- Preserve concurrent dispatch

---

## Steps

Step 1
Types directory

Step 2
BaseEvent

Step 3
Payloads

Step 4
EventMap

Step 5
Typed EventBus

Step 5.1
Remove any / as

Step 6
Typed Subscribers

Step 6.5
Event Factory

---

## Acceptance Criteria

- Typecheck passes
- Build passes
- Tests pass
- Runtime behavior unchanged

---

## Lessons Learned

- Runtime validation is not enough.
- Compile-time safety matters.
- Event construction belongs in the Event Factory.