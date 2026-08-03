# VEP Studio Roadmap

## Vision

VEP Studio is an event-driven platform for connecting business events, AI agents, workers, workflows, APIs, and external systems. The roadmap is organized around small, runnable increments that build a reliable platform foundation before adding intelligence and production capabilities.

## Phase 1 — Foundation and Event Ingestion

### Completed Sprints

- Sprint 001 — Project Setup and Documentation Standards (Completed)
- Sprint 002 — Event Bus Foundation (Completed)
- Sprint 003 — Multi-Subscriber Event Routing (Completed)
- Sprint 004 — Concurrent and Async Subscriber Execution (Completed)

### Scope

- GitHub repository
- VS Code development environment
- n8n runtime
- Knowledge platform structure
- Documentation standards
- Event intake
- Event validation
- Event logging
- Event router
- Worker dispatcher
- Error handling

---

## Phase 2 — Strongly Typed Events

### Completed Sprints

- Sprint 005 — Strongly Typed Events (Completed)

### Scope

- strongly typed event contracts
- typed payloads
- event factory abstraction
- compile-time-safe event flow

---

## Phase 3 — Reliability and Workflow Foundations

### Completed Sprints

- Sprint 006 — Runtime Foundation Stabilization (Completed)

### Planned Sprints

- Sprint 007 — Subscriber Timeout
- Sprint 008 — Retry Policy
- Sprint 009 — Dead Letter Queue
- Sprint 010 — Workflow Definition
- Sprint 011 — Workflow Runtime
- Sprint 012 — Agent Runtime

---

## Phase 4 — Intelligence and Platform Operations

### Planned Sprints

- Sprint 013 — Memory
- Sprint 014 — Tool Calling
- Sprint 015 — Scheduler
- Sprint 016 — Observability
- Sprint 017 — Authentication
- Sprint 018 — Production Deployment

---

## Phase 5 — AI Workforce

### Planned Focus Areas

- Customer Voice Agent
- Research Agent
- Creative Agent
- Sales Agent
- Platform Engineer Agent

---

## Phase 6 — Enterprise Platform

### Planned Focus Areas

- Monitoring
- Dashboard
- Governance
- Learning system
- Cost control
- Release management

---

## Architecture Principles

- Deliver small, runnable increments.
- Preserve runtime behavior while improving architecture.
- Keep the event bus generic and infrastructure-focused.
- Separate transport concerns from domain event creation.
- Prefer compile-time safety over runtime-only validation.
- Design for extension with typed contracts and clear responsibilities.
