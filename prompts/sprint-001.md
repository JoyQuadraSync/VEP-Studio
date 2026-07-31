# Sprint 001 – First Runnable Event Pipeline

## Goal

Create the first runnable backend for VEP Studio.

The backend must receive an event through HTTP, validate it, route it to the correct worker, and return a structured response.

## Project Rules

Before making any changes, read the repository root file:

```text
AGENTS.md
```

Follow all rules in that file.

Do not modify or delete existing documentation or architecture files.

## Scope

Create a new directory:

```text
backend/
```

Use only:

- Node.js
- TypeScript
- Express
- Zod
- npm

Do not add:

- Docker
- databases
- Redis
- Kafka
- RabbitMQ
- OpenAI
- n8n
- authentication
- frontend frameworks

## Required Structure

Create:

```text
backend/
├── package.json
├── tsconfig.json
├── .gitignore
└── src/
    ├── index.ts
    ├── schemas/
    │   └── event.schema.ts
    ├── router/
    │   └── event.router.ts
    └── workers/
        └── comment.worker.ts
```

## API Requirements

### Health Endpoint

Create:

```text
GET /health
```

Response:

```json
{
  "status": "ok"
}
```

### Event Endpoint

Create:

```text
POST /events
```

Validate the request body with Zod.

The event must contain:

```text
event_id
event_type
event_version
source
occurred_at
correlation_id
causation_id
payload
```

Rules:

- `event_id` must be a non-empty string.
- `event_type` must be a non-empty string.
- `event_version` must be a non-empty string.
- `source` must be a non-empty string.
- `occurred_at` must be a valid ISO datetime string.
- `correlation_id` must be a non-empty string.
- `causation_id` may be a string or null.
- `payload` must be an object.

## Supported Event Type

Support only:

```text
customer.comment.created
```

Route this event to:

```text
Comment Worker
```

The Comment Worker must log:

```text
Comment event received
```

## Responses

### Successful Event

Return HTTP 200:

```json
{
  "success": true,
  "event_id": "the received event_id",
  "worker": "comment-worker",
  "message": "Event processed successfully"
}
```

### Invalid Event

Return HTTP 400 with structured Zod validation details.

### Unsupported Event Type

Return HTTP 422 with a clear error message.

## npm Scripts

Add:

```json
{
  "dev": "...",
  "build": "...",
  "start": "...",
  "typecheck": "..."
}
```

The exact commands may use appropriate TypeScript tooling, but keep dependencies minimal.

## Verification

After implementation:

1. Install dependencies.
2. Run:

```text
npm run typecheck
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

## Final Report

At the end, report:

- all files created
- all files modified
- dependency installation result
- typecheck result
- health endpoint result
- valid event result
- invalid event result
- unsupported event result
- any warnings or failures

Do not commit or push changes.