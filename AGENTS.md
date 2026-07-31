# VEP Studio – Development Instructions

## Project Purpose

VEP Studio is an event-driven platform for connecting business events,
AI agents, workers, workflows, APIs, and external systems.

The system must be developed incrementally.
Each sprint should deliver one small, runnable, and testable feature.

---

## General Rules

1. Preserve all existing files and documentation.
2. Do not delete, rename, or reorganize existing files unless explicitly requested.
3. Do not modify files inside `docs/` unless the task specifically requires it.
4. Do not commit or push changes automatically.
5. Do not add unnecessary technologies or dependencies.
6. Keep implementations small, readable, and testable.
7. Before making changes, inspect the existing repository structure.
8. After making changes, report every created or modified file.
9. Run the required checks and report their results.
10. Stop and report clearly if a command or test fails.
11. Only execute commands that are directly required to complete the current Sprint.
12. Avoid unrelated environment checks or optional tooling unless they are necessary to complete the task.
13. If an additional command is required but was not described in the Sprint, explain why before executing it.
14. Prefer the simplest implementation that satisfies the Sprint requirements.
15. Do not expand the scope of the Sprint without explicit approval.
---

## Repository Structure

Existing architecture and documentation remain at the repository root.

Application code should initially be created inside:

```text
backend/