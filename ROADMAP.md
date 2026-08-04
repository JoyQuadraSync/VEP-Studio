# VEP Studio Roadmap

## Vision

VEP Studio is evolving into an event-driven workflow platform for connecting business events, people, AI agents, APIs, and external systems. Development proceeds through small, runnable, and testable milestones with explicit architecture reviews.

## Current Version

**v0.2.0**

The current release includes the event platform foundation, declarative workflow definitions, graph validation, versioned registries, and the first linear workflow runtime.

## Completed Sprints

| Sprint | Milestone | Status |
|---|---|---|
| Sprint 001 | Project Setup and Documentation Standards | Completed |
| Sprint 002 | EventBus Foundation | Completed |
| Sprint 003 | Multi-Subscriber Event Routing | Completed |
| Sprint 004 | Concurrent and Async Subscriber Execution | Completed |
| Sprint 005 | Strongly Typed Events | Completed |
| Sprint 006 | Runtime Foundation Stabilization | Completed |
| Sprint 007 | Workflow Definition System | Completed |
| Sprint 008 | Workflow Runtime | Completed |

## Current Sprint

### Sprint 009 — Decision & Conditional Workflow

Expand workflow expressiveness beyond linear step progression through explicit decisions and conditional transitions.

## Planned Sprints

### Sprint 010 — Parallel Workflow

Support workflows with coordinated parallel branches.

### Sprint 011 — Persistence & Recovery

Establish durable workflow state and execution recovery capabilities.

### Sprint 012 — Retry / Timeout / Dead Letter

Introduce runtime reliability policies after durable execution boundaries exist.

### Sprint 013 — Human Tasks

Support workflows that wait for human input, review, or approval.

### Sprint 014 — AI Agent Runtime

Enable governed AI-agent participation through workflow runtime boundaries.

### Sprint 015 — Visual Workflow Designer

Provide visual authoring and inspection for workflow definitions.

## Later Platform Milestones

- scheduling
- observability and operational monitoring
- authentication and authorization
- production deployment
- governance and cost control
- external integration management

## Architecture Principles

- Deliver small, runnable increments.
- Preserve existing behavior while extending capabilities.
- Keep workflow definitions immutable and declarative.
- Keep workflow execution state in immutable snapshots.
- Keep EventBus outside workflow control flow.
- Separate validation, registration, execution, and operation resolution.
- Prefer explicit contracts over implicit framework behavior.
- Make runtime behavior deterministic and testable.
- Require RFC and architecture review before expanding runtime semantics.
