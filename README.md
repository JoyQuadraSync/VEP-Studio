# VEP Studio

VEP Studio is an open-source, event-driven workflow platform under active development. It provides strongly typed event infrastructure, declarative workflow definitions, and a deterministic in-memory workflow runtime with explicit architectural boundaries.

The project is developed incrementally: each sprint delivers a small, runnable, and testable capability while preserving the contracts established by earlier releases.

Current version: **v0.2.0**

## Vision

VEP Studio aims to become a platform for connecting business events, workflows, people, AI agents, APIs, and external systems through explicit, inspectable execution models.

The long-term platform direction includes:

- a workflow engine for coordinating business processes
- human tasks and approval steps
- AI agents as governed workflow participants
- a visual workflow designer for authoring and inspecting processes

These capabilities will be introduced through future milestones. Version 0.2.0 focuses on the typed event and workflow foundations required to support them safely.

## Current Capabilities

VEP Studio currently provides:

- an Express-based event intake boundary with schema validation
- strongly typed domain events and an event factory
- a generic, concurrent EventBus
- named subscribers with failure isolation
- publish and subscriber results with deterministic runtime metadata
- declarative, versioned workflow definitions
- graph validation separated from definition registration
- dotted workflow identifiers and immutable integer version keys
- a linear in-memory workflow runtime
- immutable workflow execution snapshots
- declarative operation identifiers resolved through an operation registry
- synchronous and asynchronous operation handlers
- structured workflow failures without raw runtime causes
- deterministic duration-based runtime testing

### Sprint History

| Sprint | Capability | Status |
|---|---|---|
| 001 | Project setup and documentation standards | Completed |
| 002 | EventBus foundation | Completed |
| 003 | Multi-subscriber event routing | Completed |
| 004 | Concurrent and asynchronous subscriber execution | Completed |
| 005 | Strongly typed events | Completed |
| 006 | Runtime foundation stabilization | Completed |
| 007 | Workflow Definition System | Completed |
| 008 | Workflow Runtime | Completed |

## Architecture Overview

The long-term platform is organized as a set of explicit layers:

```text
HTTP / External Inputs
          ↓
      Validation
          ↓
    Event Platform
          ↓
 Workflow Definition
          ↓
  Workflow Runtime
          ↓
 Operation Registry
          ↓
 Operation Handlers
```

At v0.2.0, the event and workflow layers are intentionally decoupled:

```text
Event Platform                     Workflow Platform
──────────────                     ─────────────────
Event Factory                      WorkflowDefinition
EventBus                           WorkflowValidator
ExecutionContext                   WorkflowRegistry
PublishResult                      WorkflowRunner
SubscriberResult                   WorkflowExecution
                                   OperationRegistry
```

EventBus does not control workflow progression. `WorkflowRunner` advances workflows directly through `WorkflowDefinition`, `WorkflowExecution`, and `OperationRegistry`. The existing `ExecutionContext` remains specific to event publication.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the complete architecture description.

## Project Structure

```text
VEP-Studio/
├── backend/                  TypeScript application and automated tests
│   ├── src/
│   │   ├── event-bus/       Concurrent event publication
│   │   ├── events/          Domain event creation
│   │   ├── router/          Event routing
│   │   ├── runtime/         Event publication runtime contracts
│   │   ├── schemas/         HTTP event validation
│   │   ├── subscribers/     Event subscribers
│   │   ├── types/           Typed event contracts
│   │   ├── workers/         Business operation workers
│   │   └── workflows/       Workflow definitions, validation, registry, and runtime
│   └── tests/               Node test suites
├── docs/
│   ├── adr/                 Architecture Decision Records
│   ├── architecture-review/ Architecture review records
│   ├── releases/            Sprint release notes
│   └── standards/           Shared data and event standards
├── prompts/                 Approved sprint implementation plans
├── ARCHITECTURE.md          Current system architecture
├── CHANGELOG.md             Release history
├── PROJECT_STATUS.md        Current project health and capability dashboard
└── ROADMAP.md               Completed, current, and planned milestones
```

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm

### Install

```bash
cd backend
npm install
```

### Typecheck and build

```bash
npm run typecheck
npm run build
```

### Run

For development:

```bash
npm run dev
```

To run a compiled build:

```bash
npm run build
npm start
```

The default HTTP server listens on port `3000` unless `PORT` is set.

### Test

```bash
npm test
```

The test suite covers EventBus behavior, Workflow Definition contracts, graph validation, operation registration, and Workflow Runtime execution.

## Documentation

- [Architecture](ARCHITECTURE.md) describes the current component boundaries and execution lifecycle.
- [Project Status](PROJECT_STATUS.md) provides a v0.2.0 capability and health dashboard.
- [Roadmap](ROADMAP.md) tracks completed, current, and future milestones.
- [Changelog](CHANGELOG.md) records delivered capabilities by release.
- [Architecture Decision Records](docs/adr/) explain important design choices and their consequences.
- [Release Notes](docs/releases/) provide sprint-level goals, verification, and known limitations.
- [Sprint Prompts](prompts/) preserve the approved scope and acceptance criteria used for incremental development.

## Version

The current project version is **v0.2.0**.

Version 0.2.0 represents the completion of the foundational event platform, workflow definition model, and first linear workflow runtime.

## Next Milestones

The next milestones focus on expanding workflow expressiveness and platform capability:

- decision and conditional workflows
- parallel workflows
- persistence and recovery
- runtime reliability policies
- human tasks
- AI agent participation
- visual workflow design

See the [Roadmap](ROADMAP.md) for milestone ordering and current status.

## License

A project license has not yet been published. Until a license is added, repository contents remain subject to the repository owner's rights.
