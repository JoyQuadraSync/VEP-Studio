# Voluvia TikTok Content Workflow v1

This is VEP Studio's first deterministic business showcase. It models product normalization, template-based script generation, mock editorial review, declarative decisions, structured parallel asset preparation, publishing-package aggregation, and mock final review.

The executable definition is the TypeScript `voluviaTikTokContentWorkflow`. `workflow-definition.json` is a documentation mirror and is not loaded by the runtime.

## Run model

```text
Product input
→ normalize
→ deterministic script
→ mock editorial review
→ decision
→ parallel mock assets
→ publishing package
→ mock final review
→ shared finish
```

Editorial and final approval values are explicit deterministic controls in the sample input. They are not Human Tasks or interactive approvals. Rejection is a completed business outcome and does not loop back to an earlier step.

The asset branches create JSON metadata only. The video URI uses `mock://`, subtitles are derived from the script, and `publishable` is always `false`.

## Persistence demonstration

Automated tests exercise the persistence-ready orchestration boundary with the in-memory reference repository. A test-only runner decorator interrupts before an advancement, after earlier save points have succeeded. A normal coordinator then resumes from the latest persisted snapshot in the same process and repository instance.

This demonstrates revision continuity, exact definition-version recovery, and skipping work already recorded as completed. It does not demonstrate process-restart recovery, database durability, or exactly-once handler execution.

## Samples

- `sample-product.json` is the approved deterministic input.
- `workflow-definition.json` mirrors the executable TypeScript definition.
- `sample-output/normalized-product.json` is the normalization result.
- `sample-output/script.json` is the deterministic template result.
- `sample-output/subtitles.srt` is extracted from the runtime JSON subtitle string.
- `sample-output/publishing-package.json` is the non-publishable aggregate.

## Not implemented

This showcase does not provide Human Tasks, interactive approval, OpenAI, HeyGen, Whisper, TikTok publishing, loops, database durability, process-restart recovery, real media, executable JSON loading, or production social automation. No external service is required.
