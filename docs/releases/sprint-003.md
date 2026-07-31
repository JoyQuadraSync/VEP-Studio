# Sprint 003 – Multiple Event Subscribers

## Goal

Extend the in-memory Event Bus to support multiple independent subscribers while preserving all existing behavior from Sprint 001 and Sprint 002.

---

## Architecture Changes

The Event Bus now supports publishing a single Event to multiple registered subscribers.

Previous architecture:

```text
HTTP
    │
    ▼
Schema Validation
    │
    ▼
Event Bus
    │
    ▼
Event Router
    │
    ▼
Comment Worker
```

Current architecture:

```text
HTTP
    │
    ▼
Schema Validation
    │
    ▼
Event Bus
    ├──────────────► Event Router
    │                    │
    │                    ▼
    │              Comment Worker
    │
    └──────────────► Audit Subscriber
```

The Event Bus remains generic and is not aware of any concrete subscribers.

---

## New Components

### Audit Subscriber

Added:

```text
backend/src/subscribers/audit.subscriber.ts
```

Responsibilities:

- Receives every validated Event
- Logs:

```text
Audit event received
```

- Returns a small structured result identifying itself as the audit subscriber

The Audit Subscriber does not:

- Route Events
- Call Workers
- Modify Events
- Access databases
- Depend on Express

---

## Event Bus Improvements

The Event Bus now:

- Supports multiple subscribers
- Preserves subscriber registration order
- Dispatches every published Event to every subscriber
- Continues dispatching even if one subscriber throws an exception
- Collects subscriber results
- Remains independent of concrete subscriber implementations

---

## Verification

### Type Checking

✅ Passed

```bash
npm run typecheck
```

---

### Build

✅ Passed

```bash
npm run build
```

---

### Health Check

✅ Passed

```http
GET /health
```

Response:

```json
{
  "status": "ok"
}
```

---

### Valid Event

✅ Passed

```http
POST /events
```

Result:

- Validation succeeded
- Event published once
- Event Router executed
- Comment Worker executed
- Audit Subscriber executed
- HTTP 200 returned

Observed logs:

```text
Comment event received
Audit event received
```

---

### Invalid Event

✅ Passed

Validation failed before reaching the Event Bus.

HTTP Response:

```
400 Bad Request
```

No subscribers executed.

---

### Unsupported Event

✅ Passed

Validation succeeded.

Audit Subscriber received the Event.

Event Router returned:

```
422 Unprocessable Entity
```

Comment Worker was not executed.

---

## Design Decisions

This Sprint introduces the Publish–Subscribe pattern.

The Event Bus is responsible only for:

- registering subscribers
- publishing Events

Subscribers are responsible for their own business logic.

The Event Bus has no knowledge of:

- Event Router
- Comment Worker
- Audit Subscriber
- specific Event types

This follows the Open–Closed Principle by allowing new subscribers to be added without modifying the Event Bus.

---

## Known Technical Debt

Current HTTP response selection depends on the first registered subscriber (the Event Router).

Future Sprints should remove this implicit coupling by introducing explicit response handling.

The Event Bus currently uses a minimal result model and synchronous dispatching.

Future improvements may include:

- asynchronous subscribers
- stronger typing
- richer result models
- timeout handling
- event retries

---

## Lessons Learned

Key architectural principles introduced in this Sprint:

- Publish–Subscribe pattern
- One Event → Multiple Subscribers
- Loose coupling
- Separation of responsibilities
- Fault isolation between subscribers
- Open–Closed Principle

This Sprint establishes the foundation for future AI Workers, Metrics, Notifications, and Workflow orchestration.

---

## Next Sprint

Sprint 004 will evolve the Event Bus toward asynchronous event processing, preparing the architecture for concurrent AI Agents and enterprise-scale workflows.