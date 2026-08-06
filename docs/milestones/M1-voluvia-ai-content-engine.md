# Milestone M1 — Voluvia AI Content Engine

**Status:** Completed
**Date:** 2026-08-06
**Implementation commit:** `df9851a`

## Objective

Establish the first governed AI content-planning pipeline for Voluvia short-form content. The milestone converts verified product facts into structured planning output while enforcing deterministic compatibility rules, brand-safety controls, and mandatory manual review.

## Scope

M1 covers two provider-neutral AI capabilities:

- structured TikTok script generation;
- structured content planning.

It also establishes the OpenAI Responses API adapter, immutable prompt history, prompt hash pinning, strict local validation, and explicit manual-review status. It does not publish content or integrate with TikTok.

## Completed Capabilities

- Provider-neutral AI client boundaries with an OpenAI Responses API implementation.
- AI Script Generator and AI Content Planner operations.
- Versioned Prompt Catalog with canonical hashing and pinned prompt identities.
- Structured Outputs followed by strict local validation.
- Shared, immutable Planner compatibility policy and prompt-parity checks.
- Semantic product-fact validation and disabled-commerce controls.
- Medical, commercial, brand-tone, and prompt-injection safeguards.
- Sanitized live diagnostics that remain outside workflow state.
- Mandatory `pending_manual_review` outcome for generated plans.

## Architecture Overview

```text
Verified Product Facts
        ↓
Prompt Catalog and Versioning
        ↓
Provider-neutral AI Boundary
        ↓
OpenAI Responses Adapter
        ↓
Structured Output
        ↓
Strict Local Validation
        ↓
Brand Safety
        ↓
Pending Manual Review
```

The workflow runtime remains independent from provider behavior. Provider output is not accepted as workflow output until it passes the locally owned validation and safety boundaries.

## Validation Summary

- Offline type checking and build passed at implementation review.
- Offline automated tests passed: **127/127**.
- One authorized live Planner validation passed through the complete operation boundary.
- The live plan retained `pending_manual_review` and required manual review.
- Disabled price and shipping facts, delivery claims, and before/after scenes remained absent in the approved live scenario.
- Candidate-file secret scanning found no credentials or live response artifacts.

## Current Limitations

- Generated content always requires manual semantic review.
- No TikTok data ingestion, analytics, or publishing integration exists.
- No automated content-performance feedback loop exists.
- No automatic provider retry, repair request, or fallback model is used.
- Provider operations retain at-least-once execution semantics around persistence ambiguity. If a provider request succeeds but its resulting workflow snapshot is not durably saved, recovery may invoke the provider operation again, so duplicate billing is possible. Provider-backed operations should be designed with idempotency and duplicate-cost awareness; exactly-once provider execution is not claimed.
- Human review is an external manual process, not a workflow Human Task.
- Live AI verification remains explicitly enabled, billable, and separate from offline tests.

## Next Milestone

**M2 — TikTok Data Layer** will design governed ingestion of TikTok analytics, comments, and product-performance signals. M2 begins with an RFC before implementation.
