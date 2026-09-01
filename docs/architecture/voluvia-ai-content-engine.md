# Voluvia AI Content Engine Architecture

## Purpose

The Voluvia AI Content Engine turns verified product facts into constrained short-form content plans and scripts. Provider-generated data crosses explicit local validation and safety boundaries before it can become an output awaiting manual review.

## Architecture Flow

```mermaid
flowchart TD
    facts["Verified Product Facts"] --> catalog["Prompt Catalog"]
    catalog --> boundary["Provider-neutral AI Client Boundary"]
    boundary --> adapter["OpenAI Responses Adapter"]
    adapter --> structured["Structured Output"]
    structured --> validation["Local Validation"]
    validation --> safety["Brand Safety"]
    safety --> pending["Pending Manual Review"]
    pending --> review["External Human Review"]
```

```text
Product Facts
      ↓
Prompt Catalog
      ↓
Provider-neutral AI Client Boundary
      ↓
OpenAI Responses Adapter
      ↓
Structured Output
      ↓
Local Validation
      ↓
Brand Safety
      ↓
Pending Manual Review
      ↓
Human Review
```

## Architectural Boundaries

### Product facts

Only validated semantic facts and explicitly enabled commerce facts are eligible for AI planning. Disabled facts are removed before the provider request and remain prohibited in validated output.

### Prompt Catalog

Prompts are resolved by stable ID and immutable integer version. Canonical hashes pin provider-visible content and preserve prompt history.

### Provider adapter

The provider-neutral AI client is an abstraction boundary between the Planner and Script operations and the concrete OpenAI adapter. It does not own prompt selection, business validation, brand safety, workflow progression, or persistence. The OpenAI adapter owns provider communication and returns only structured candidate data plus sanitized generation metadata.

### Structured output

The provider is constrained to the Planner's closed schema. Structured output limits shape and enum values, while local validation owns cross-field semantics.

### Local validation

Local validation enforces product facts, preferred and excluded selections, compatibility tables, scene rules, prompt identity, and JSON-safe output. Provider output that fails these rules does not become workflow output.

### Brand safety

Brand-safety rules prohibit unsupported medical, clinical, commercial, urgency, scarcity, guarantee, certification, and demographic claims. Prompt-injection instructions are ignored and must not be repeated or exposed.

### Manual review

Successful technical execution produces `pending_manual_review`; it does not constitute publication approval. Human review is currently an external manual responsibility. It is not yet implemented as a workflow Human Task.

### Trusted-local process-failure evidence

M4B Process-Failure Evidence Seam V1 retains only closed-derived diagnostic fields for trusted-local controlled-render process failures. Raw and redacted stderr persistence are prohibited. Private stderr retention is bounded to 65,536 bytes, while durable size information is coarsened; exactly 65,536 observed bytes means `truncated: false`, and 65,537 means `truncated: true`. Closed marker identities are ordered and deduplicated.

The trusted-local runtime owns an opaque, one-use attempt capability. Its `attemptId` is generated internally from exactly 16 cryptographically random bytes and encoded as 32 lowercase hexadecimal characters; the identifier alone is not trust authority. Authority remains bound to the exact runtime, trusted composition, resolved execution, and process-failure lineage. Exact-pair validation occurs before consumption, and a failure cannot mint a replacement attempt.

`observationFingerprint` identifies the canonical closed diagnostic observation independently of attempt identity. `evidenceFingerprint` identifies the complete attempt-specific evidence identity, including its render, manifest, environment, trust, eligibility, and observation bindings. Neither fingerprint hashes raw or redacted stderr.

The production evidence destination is internally resolved through a zero-input boundary. Callers, cwd, `HOME`, `PATH`, argv, and environment state cannot select or redirect it. Persistence is no-clobber and preserves existing evidence bytes. Evidence finalization and persistence are attempted before workspace cleanup and render-slot release. A persistence failure preserves the original rendering failure, does not claim retention, and does not trigger retry, repair, fallback, or publishing.

This boundary retains `executionTrust: trusted_local_reference` and `productionEligibility: prohibited`.

## Runtime Boundary

WorkflowRunner continues to own workflow control flow. The AI adapter, Prompt Catalog, compatibility policy, and validators do not alter EventBus, ExecutionContext, persistence, or workflow-runtime contracts.

## Current Limits

The architecture currently has no TikTok data connector, publishing path, automatic repair, provider retry, Human Task, or closed-loop performance optimization. The sixth controlled render failed without retry at `process_failed` / `nonzero_exit` / `unknown_nonzero_exit` / `unknown_nonzero_exit_signal`. The FFmpeg failure remains unresolved, no deterministic MP4 has been verified, and a seventh controlled render has not been authorized or executed.
