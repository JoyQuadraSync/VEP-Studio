# Release — Voluvia AI Content Engine v1

**Status:** Completed
**Date:** 2026-08-06
**Implementation commit:** `df9851a`

## Highlights

- AI Content Planner for structured Voluvia short-form content strategy.
- Provider-neutral AI Script Generator and content-planning boundaries.
- OpenAI Responses API integration with Structured Outputs.
- Versioned and hash-pinned prompt resources.
- Deterministic compatibility validation and mandatory manual review.

## New Capabilities

- Prompt Catalog resolution by immutable prompt ID and integer version.
- Canonical prompt hashing and prompt-drift detection.
- Strict input, provider-result, and final-result validation.
- Shared concern, focus, style, scene, hook, action, and required-fact compatibility policy.
- Brand-safety validation for medical, commercial, and unsupported claims.
- Prompt-injection safeguards and sanitized diagnostic categories.
- Explicit `pending_manual_review` planning results.

## Validation

- Offline automated tests: **127/127 passed**.
- Type checking and build passed during implementation verification.
- Authorized live Planner validation passed with exactly one provider request.
- Complete operation-boundary validation passed.
- Manual review remained required.
- Secret and live-artifact scans passed.

## Compatibility

- No breaking changes to WorkflowRunner, WorkflowExecution, persistence, EventBus, ExecutionContext, OperationRegistry, or ConditionEvaluator.
- The deterministic Voluvia Showcase v1 remains unchanged.
- Existing Script Pilot contracts remain compatible.
- Prompt v1 remains immutable and independently resolvable; the Planner uses prompt v2.

## Breaking Changes

None.

## Known Limitations

- Manual semantic review is required for every generated plan.
- No TikTok API, analytics ingestion, or publishing capability is included.
- No production media generation is included.
- No automated retry, repair, or fallback provider behavior is included.
- No Human Task workflow integration is included.
- Live AI execution is opt-in and may incur provider cost.

## Next Milestone

**M2 — TikTok Data Layer**, beginning with an architecture RFC.
