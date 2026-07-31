# Sprint 003 – Multiple Event Subscribers

## Goal

Extend the in-memory Event Bus so that one published event can be delivered to multiple independent subscribers.

The target flow is:

```text
POST /events
    ↓
Schema Validation
    ↓
Event Bus
    ├── Event Router
    │       ↓
    │   Comment Worker
    │
    └── Audit Subscriber
```

## Project Rules

Before making changes, read and follow:

```text
AGENTS.md
```

Preserve all Sprint 001 and Sprint 002 behavior.

Do not commit or push.

## Scope

Implement synchronous in-memory publish-subscribe behavior.

Do not add:

- new npm dependencies
- databases
- file persistence
- Redis
- Kafka
- RabbitMQ
- queues
- retry logic
- dead-letter queues
- OpenAI
- n8n
- authentication

## Required Behavior

The Event Bus must support multiple handlers subscribed to the same published event.

When one validated event is published:

1. Every registered subscriber must receive the event.
2. Subscribers must execute independently in registration order.
3. The Event Bus must collect the result from every subscriber.
4. One subscriber must not directly call another subscriber.
5. Subscribers must not know about each other.

## Existing Router Subscriber

Keep the Event Router as a subscriber.

It must continue to:

- inspect `event_type`
- route `customer.comment.created` to the Comment Worker
- preserve the existing HTTP 200 response
- preserve HTTP 422 for unsupported event types

## New Audit Subscriber

Add:

```text
backend/src/subscribers/audit.subscriber.ts
```

The Audit Subscriber must:

- receive every validated event published through the Event Bus
- log:

```text
Audit event received
```

- return a small structured result identifying itself as:

```text
audit-subscriber
```

It must not:

- inspect or route specific event types
- call Workers
- use Express
- modify the Event
- write files or use a database

## Event Bus Changes

Update the Event Bus so that:

- more than one handler can be registered
- every registered handler is executed when an Event is published
- all handler results are collected
- registration order is preserved

Keep the Event Bus generic.

It must not know about:

- Router
- Comment Worker
- Audit Subscriber
- specific event types

## Application Wiring

Update the application startup so that both subscribers are registered:

1. Event Router
2. Audit Subscriber

The Event Bus must remain unaware of their concrete identities.

## HTTP Response

Preserve the existing successful HTTP response structure from Sprint 002.

Do not expose all subscriber results through the HTTP API in this Sprint.

The existing Router result remains the primary HTTP result.

## Existing Behavior to Preserve

### GET /health

Returns HTTP 200:

```json
{
  "status": "ok"
}
```

### Valid Event

A valid `customer.comment.created` event must:

- pass validation
- be published once
- reach the Event Router
- reach the Comment Worker
- reach the Audit Subscriber
- log:

```text
Comment event received
Audit event received
```

- return the existing HTTP 200 response

### Invalid Event

Invalid schema data must return HTTP 400.

It must not reach either subscriber.

### Unsupported Event

An unsupported but valid event type must still return HTTP 422.

The Audit Subscriber may receive the validated event, but the Router remains responsible for reporting the unsupported event.

## npm Commands

Run all npm commands from:

```text
backend/
```

Use PowerShell syntax only.

Do not use:

```text
cd /d
```

Use:

```powershell
Set-Location
```

or the correct backend working directory.

## Verification

After implementation:

1. Run `npm run typecheck`.
2. Run `npm run build`.
3. Start the application with `npm start`.
4. Test `GET /health`.
5. Test a valid `POST /events`.
6. Confirm both logs appear:
   - `Comment event received`
   - `Audit event received`
7. Test an invalid `POST /events`.
8. Confirm neither subscriber receives the invalid Event.
9. Test an unsupported `event_type`.
10. Confirm HTTP 422 is preserved.

## Acceptance Criteria

Sprint 003 is complete only if:

- one Event is dispatched to multiple subscribers
- the Event Bus remains generic
- subscribers do not know about each other
- registration order is deterministic
- no new dependency is added
- Sprint 001 and Sprint 002 behavior remains intact
- typecheck passes
- build passes
- all endpoint tests pass

## Final Report

Report:

- files created
- files modified
- whether dependencies changed
- subscriber registration order
- typecheck result
- build result
- health result
- valid event result
- invalid event result
- unsupported event result
- confirmation that both subscriber logs appeared
- warnings or failures

Do not commit or push.