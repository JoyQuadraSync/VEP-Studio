# Sprint 002 – In-Memory Event Bus

## Goal

Introduce an in-memory Event Bus between the HTTP event intake layer and the Event Router.

The current direct flow:

```text
POST /events
    ↓
Schema Validation
    ↓
Event Router
    ↓
Worker
```

must become:

```text
POST /events
    ↓
Schema Validation
    ↓
Event Bus
    ↓
Event Router Subscriber
    ↓
Worker
```

## Project Rules

Before making any changes, read and follow:

```text
AGENTS.md
```

Preserve all existing behavior from Sprint 001.

Do not commit or push any changes.

## Scope

Implement only an in-memory, synchronous Event Bus.

Do not add:

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
- new npm dependencies

## Required Structure

Add:

```text
backend/src/event-bus/
├── event-bus.ts
└── event-handler.type.ts
```

Keep the existing structure:

```text
backend/src/
├── index.ts
├── event-bus/
├── router/
├── schemas/
└── workers/
```

Do not reorganize unrelated files.

## Event Bus Responsibilities

The Event Bus must:

1. Register event handlers.
2. Publish a validated event.
3. Dispatch the event to registered handlers.
4. Return the handler result to the caller.

The Event Bus must not:

- contain Express code
- perform Zod validation
- inspect specific event types
- call specific workers directly
- contain business logic

## Event Handler Type

Create a reusable event handler type.

Conceptually:

```text
(event) => handler result
```

Use the existing validated event type from the event schema where appropriate.

## Router Integration

The Event Router must become a subscriber to the Event Bus.

The Router remains responsible for:

```text
event_type
    ↓
selecting the correct Worker
```

Supported event type remains:

```text
customer.comment.created
```

Unsupported event types must still result in HTTP 422.

## index.ts Changes

Update `index.ts` so that:

1. The request body is validated with the existing Zod schema.
2. Validated events are passed to:

```text
eventBus.publish(event)
```

3. `index.ts` does not directly call the Event Router.
4. Existing HTTP response behavior is preserved.

## Existing Behavior to Preserve

### GET /health

Must still return HTTP 200:

```json
{
  "status": "ok"
}
```

### Valid Event

A valid:

```text
customer.comment.created
```

event must:

- pass schema validation
- be published through the Event Bus
- reach the Event Router
- reach the Comment Worker
- log:

```text
Comment event received
```

- return HTTP 200 with the existing response structure

### Invalid Event

Invalid schema data must return HTTP 400.

### Unsupported Event

Unsupported `event_type` must return HTTP 422.

## npm Commands

All npm commands must be executed from:

```text
backend/
```

Before running an npm command:

1. verify the current working directory
2. verify `package.json` exists
3. then run the command

## Verification

After implementation:

1. Run:

```text
npm run typecheck
```

2. Run:

```text
npm run build
```

3. Start the server.
4. Test:

```text
GET /health
```

5. Test a valid:

```text
POST /events
```

6. Test an invalid:

```text
POST /events
```

7. Test an unsupported `event_type`.

8. Confirm that:

```text
Comment event received
```

is still logged.

## Acceptance Criteria

Sprint 002 is complete only if:

- `index.ts` no longer directly calls the Event Router
- events enter the system through `eventBus.publish()`
- the Router is registered as an Event Bus handler
- no new npm dependencies are added
- all Sprint 001 behavior still works
- typecheck passes
- build passes
- all endpoint tests pass

## Final Report

At the end, report:

- files created
- files modified
- whether any dependencies changed
- typecheck result
- build result
- health endpoint result
- valid event result
- invalid event result
- unsupported event result
- confirmation that the Comment Worker was reached
- warnings or failures

Do not commit or push.