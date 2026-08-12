const test = require('node:test');
const assert = require('node:assert/strict');
const { input, clientResult } = require('./helpers/voluvia-video-package-fixture');
const { createVoluviaVideoPackageOperation } = require('../dist/workflows/examples/voluvia/video-package/voluvia-video-package.operation');
const { validateStandaloneM3Package } = require('../dist/rendering/integrity/m3-package-integrity-validator');
const { selectRenderer } = require('../dist/rendering/policy/renderer-selection-policy');
const { compileRenderManifest } = require('../dist/rendering/manifest/render-manifest');
const { calculateCanonicalRenderIdentity } = require('../dist/rendering/identity/canonical-render-identity');
const { runDeterministicRenderDryRun } = require('../dist/rendering/dry-run/deterministic-render-dry-run');
const { RenderingPhaseOneFailure } = require('../dist/rendering/failures/rendering-phase-one-failure');

async function packageFixture() {
  return createVoluviaVideoPackageOperation({ generatePackageCandidate: async () => clientResult() },
    { now: () => new Date('2026-08-06T12:00:00.000Z') })({ stepInput: input() });
}
const selection = (assetIds = ['product-front', 'lace-base-close-up']) => ({
  productionPurpose: 'internal_fixture', exactSubtitlesRequired: true,
  exactSceneTimingRequired: true, approvedAssetIds: assetIds
});
const mutate = (value, fn) => { const copy = structuredClone(value); fn(copy); return copy; };
const fails = (fn, code) => assert.throws(fn, (error) => error && error.code === code);
const evidencePackage = (pkg, family) => mutate(pkg, value => {
  const before = `${family}-before-view`; const after = `${family}-after-view`;
  value.summary.visualProofRequired = true;
  value.scenes[0].sourceSuggestedScene = before;
  value.scenes[0].requiredAssetIds = [before];
  value.scenes[0].visualProofRole = 'before-evidence';
  value.voiceover.segments[0].sourceScene = before;
  value.narrationPackage.sceneNarrationSegments[0].sourceScene = before;
  value.scenes[1].sourceSuggestedScene = after;
  value.scenes[1].requiredAssetIds = [after];
  value.scenes[1].visualProofRole = 'after-evidence';
  value.voiceover.segments[1].sourceScene = after;
  value.narrationPackage.sceneNarrationSegments[1].sourceScene = after;
  value.assetChecklist = [
    { assetId: before, required: true, usedBySceneIds: ['scene-01'], productionInstruction: 'before', missingAssetBehavior: 'reject-package' },
    { assetId: after, required: true, usedBySceneIds: ['scene-02'], productionInstruction: 'after', missingAssetBehavior: 'reject-package' }
  ];
});

test('standalone integrity validates, detaches, freezes, and hashes a released M3 package', async () => {
  const pkg = await packageFixture(); const result = validateStandaloneM3Package(pkg);
  assert.equal(result.packageId, pkg.packageId);
  assert.match(result.packageRevisionHash, /^[a-f0-9]{64}$/);
  assert.notEqual(result.package, pkg); assert.ok(Object.isFrozen(result.package.scenes));
  assert.equal(validateStandaloneM3Package(structuredClone(pkg)).packageRevisionHash, result.packageRevisionHash);
});

test('standalone integrity rejects unsafe descriptors and strict-shape drift', async (t) => {
  const pkg = await packageFixture();
  await t.test('unknown root', () => fails(() => validateStandaloneM3Package({ ...pkg, extra: true }), 'unknown_field'));
  await t.test('unknown nested', () => fails(() => validateStandaloneM3Package(mutate(pkg, p => { p.scenes[0].extra = true; })), 'unknown_field'));
  await t.test('symbol', () => { const copy = structuredClone(pkg); copy[Symbol('x')] = true; fails(() => validateStandaloneM3Package(copy), 'unsafe_json'); });
  await t.test('accessor without invocation', () => { const copy = structuredClone(pkg); let invoked = false; Object.defineProperty(copy, 'packageId', { enumerable: true, get() { invoked = true; return pkg.packageId; } }); fails(() => validateStandaloneM3Package(copy), 'unsafe_json'); assert.equal(invoked, false); });
  await t.test('non-enumerable', () => { const copy = structuredClone(pkg); Object.defineProperty(copy, 'hidden', { value: true }); fails(() => validateStandaloneM3Package(copy), 'unsafe_json'); });
  await t.test('custom prototype', () => { const copy = structuredClone(pkg); Object.setPrototypeOf(copy.scenes[0], { custom: true }); fails(() => validateStandaloneM3Package(copy), 'unsafe_json'); });
  await t.test('cycle', () => { const copy = structuredClone(pkg); copy.scenes[0].requiredAssetIds.push(copy.scenes); fails(() => validateStandaloneM3Package(copy), 'unsafe_json'); });
});

test('standalone integrity detects identity, projection, timing, and asset mismatches', async (t) => {
  const pkg = await packageFixture();
  const cases = [
    ['source operation identity', p => { p.operationId = 'wrong'; }, 'invalid_source_identity'],
    ['prompt lineage', p => { p.provenance.promptContentHash = '0'.repeat(64); }, 'invalid_source_identity'],
    ['narration projection', p => { p.narrationPackage.narrationText += 'x'; }, 'package_validation_failed'],
    ['subtitle projection', p => { p.narrationPackage.subtitleLines[0].lines[0] += 'x'; }, 'package_validation_failed'],
    ['scene duration', p => { p.scenes[1].durationSeconds -= 1; }, 'package_validation_failed'],
    ['asset reference', p => { p.assetChecklist[0].usedBySceneIds = []; }, 'package_validation_failed']
  ];
  for (const [name, change, code] of cases) await t.test(name, () => fails(() => validateStandaloneM3Package(mutate(pkg, change)), code));
});

test('renderer policy is closed, deterministic, asset-gated, and versioned', async () => {
  const pkg = await packageFixture();
  assert.deepEqual(selectRenderer(pkg, selection()), selectRenderer(pkg, selection()));
  assert.deepEqual(selectRenderer(pkg, { ...selection(), productionPurpose: 'final_candidate' }), {
    policyVersion: 1, rendererClassification: 'm4b_deterministic', productionPurpose: 'final_candidate'
  });
  fails(() => selectRenderer(pkg, selection(['product-front'])), 'renderer_selection_failed');
  fails(() => selectRenderer(pkg, { ...selection(), productionPurpose: 'ai-choice' }), 'renderer_selection_failed');
  fails(() => selectRenderer(pkg, selection(['product-front', 'lace-base-close-up', 'unknown'])), 'renderer_selection_failed');
  fails(() => selectRenderer(pkg, selection(['product-front', 'product-front', 'lace-base-close-up'])), 'renderer_selection_failed');
});

test('renderer policy derives visual-proof and before-after evidence from the package', async () => {
  const pkg = await packageFixture();
  const proof = mutate(pkg, value => { value.summary.visualProofRequired = true; });
  assert.equal(selectRenderer(proof, selection()).rendererClassification, 'm4b_deterministic');
  fails(() => selectRenderer(proof, selection(['lace-base-close-up'])), 'renderer_selection_failed');
  const beforeAfter = mutate(pkg, value => {
    value.scenes[0].sourceSuggestedScene = 'crown-before-view';
    value.scenes[0].requiredAssetIds = ['crown-before-view'];
    value.scenes[1].sourceSuggestedScene = 'crown-after-view';
    value.scenes[1].requiredAssetIds = ['crown-after-view'];
    value.summary.visualProofRequired = true;
    value.assetChecklist = [
      { assetId: 'crown-before-view', required: true, usedBySceneIds: ['scene-01'], productionInstruction: 'before', missingAssetBehavior: 'reject-package' },
      { assetId: 'crown-after-view', required: true, usedBySceneIds: ['scene-02'], productionInstruction: 'after', missingAssetBehavior: 'reject-package' }
    ];
  });
  assert.equal(selectRenderer(beforeAfter, selection(['crown-after-view', 'crown-before-view'])).rendererClassification,
    'm4b_deterministic');
  fails(() => selectRenderer(beforeAfter, selection(['crown-before-view'])), 'renderer_selection_failed');
});

test('package integrity enforces reciprocal frozen before-after evidence pairs', async (t) => {
  const pkg = await packageFixture();
  for (const family of ['crown', 'parting']) {
    const complete = evidencePackage(pkg, family);
    await t.test(`complete ${family} pair`, () => {
      assert.equal(validateStandaloneM3Package(complete).packageId, pkg.packageId);
    });
    await t.test(`${family} before without after`, () => {
      const incomplete = mutate(complete, value => {
        value.scenes[1].sourceSuggestedScene = 'product-close-up';
        value.scenes[1].requiredAssetIds = ['product-front'];
        value.scenes[1].visualProofRole = 'product-detail';
        value.voiceover.segments[1].sourceScene = 'product-close-up';
        value.narrationPackage.sceneNarrationSegments[1].sourceScene = 'product-close-up';
        value.assetChecklist[1] = { assetId: 'product-front', required: true, usedBySceneIds: ['scene-02'], productionInstruction: 'product', missingAssetBehavior: 'reject-package' };
      });
      fails(() => validateStandaloneM3Package(incomplete), 'package_validation_failed');
    });
    await t.test(`${family} after without before`, () => {
      const incomplete = mutate(complete, value => {
        value.scenes[0].sourceSuggestedScene = 'product-close-up';
        value.scenes[0].requiredAssetIds = ['product-front'];
        value.scenes[0].visualProofRole = 'product-detail';
        value.voiceover.segments[0].sourceScene = 'product-close-up';
        value.narrationPackage.sceneNarrationSegments[0].sourceScene = 'product-close-up';
        value.assetChecklist[0] = { assetId: 'product-front', required: true, usedBySceneIds: ['scene-01'], productionInstruction: 'product', missingAssetBehavior: 'reject-package' };
      });
      fails(() => validateStandaloneM3Package(incomplete), 'package_validation_failed');
    });
  }
});

test('manifest freezes timeline, subtitles, unresolved audio slots, and excludes runtime values', async () => {
  const pkg = await packageFixture(); const validated = validateStandaloneM3Package(pkg);
  const manifest = compileRenderManifest(validated.package, validated.packageRevisionHash);
  assert.equal(manifest.timeline.originSecond, 0); assert.equal(manifest.timeline.transition, 'cut');
  assert.equal(manifest.timeline.scenes.at(-1).endSecond, 30);
  assert.deepEqual(manifest.subtitles.canonicalCues, pkg.narrationPackage.subtitleLines);
  assert.ok(manifest.audio.slots.every(slot => slot.audioArtifactStatus === 'unresolved'));
  assert.deepEqual(manifest.audio.slots[0].allocationWindow, { sceneStartSecond: 0, sceneEndSecond: 15 });
  assert.equal(manifest.audio.slots[0].estimatedSpokenSeconds, pkg.voiceover.segments[0].estimatedSeconds);
  assert.equal('startSecond' in manifest.audio.slots[0], false); assert.equal('endSecond' in manifest.audio.slots[0], false);
  const serialized = JSON.stringify(manifest);
  for (const forbidden of ['ffmpeg', 'workspace', 'signedUrl', 'storageKey', 'credential', 'diagnostic', 'timestamp']) assert.equal(serialized.includes(forbidden), false);
});

test('canonical render identity responds only to canonical rendering intent', async () => {
  const pkg = await packageFixture(); const validated = validateStandaloneM3Package(pkg);
  const manifest = compileRenderManifest(validated.package, validated.packageRevisionHash);
  const selected = selectRenderer(validated.package, selection());
  const identity = calculateCanonicalRenderIdentity(manifest, selected);
  assert.equal(identity, calculateCanonicalRenderIdentity(structuredClone(manifest), selected));
  assert.notEqual(identity, calculateCanonicalRenderIdentity({ ...manifest, sourcePackageRevisionHash: '0'.repeat(64) }, selected));
  assert.notEqual(identity, calculateCanonicalRenderIdentity(manifest, { ...selected, policyVersion: 2 }));
  const sceneTiming = structuredClone(manifest); sceneTiming.timeline.scenes[0].endSecond -= 1;
  const subtitleTiming = structuredClone(manifest); subtitleTiming.subtitles.canonicalCues[0].endSecond -= 0.001;
  const narration = structuredClone(manifest); narration.audio.slots[0].estimatedSpokenSeconds += 1;
  assert.notEqual(identity, calculateCanonicalRenderIdentity(sceneTiming, selected));
  assert.notEqual(identity, calculateCanonicalRenderIdentity(subtitleTiming, selected));
  assert.notEqual(identity, calculateCanonicalRenderIdentity(narration, selected));
  assert.match(identity, /^[a-f0-9]{64}$/);
});

test('dry run is deterministic, immutable, non-production, and side-effect free', async () => {
  const pkg = await packageFixture(); const before = structuredClone(pkg);
  const first = runDeterministicRenderDryRun(pkg, selection());
  const second = runDeterministicRenderDryRun(pkg, selection());
  assert.deepEqual(first, second); assert.deepEqual(pkg, before);
  assert.equal(first.resultKind, 'deterministic_render_dry_run');
  assert.equal(first.productionEligibility, 'prohibited'); assert.equal(first.validationResult, 'valid');
  assert.equal('artifactSha256' in first, false); assert.equal('finalRenderReviewStatus' in first, false);
  fails(() => runDeterministicRenderDryRun({ invalid: true }, selection()), 'unknown_field');
});

test('identity boundary separates source lineage from trusted final-package revision integrity', async () => {
  const pkg = await packageFixture(); const original = validateStandaloneM3Package(pkg);
  const alternative = mutate(pkg, value => { value.packageId = '0'.repeat(64); });
  const changed = validateStandaloneM3Package(alternative);
  assert.equal(changed.packageId, '0'.repeat(64));
  assert.notEqual(changed.packageRevisionHash, original.packageRevisionHash);
  assert.equal(validateStandaloneM3Package(pkg, { expectedPackageRevisionHash: original.packageRevisionHash }).packageRevisionHash,
    original.packageRevisionHash);
  fails(() => validateStandaloneM3Package(pkg, { expectedPackageRevisionHash: '0'.repeat(64) }), 'package_revision_mismatch');
  fails(() => validateStandaloneM3Package(mutate(pkg, value => { value.packageId = 'not-a-hash'; })), 'invalid_source_identity');
  const first = runDeterministicRenderDryRun(pkg, selection());
  const second = runDeterministicRenderDryRun(alternative, selection());
  assert.notEqual(first.canonicalRenderIdentity, second.canonicalRenderIdentity);
});

test('complete runtime package validation never leaks native exceptions', async (t) => {
  const pkg = await packageFixture();
  const cases = [
    ['scenes', p => { p.scenes = 5; }], ['segments', p => { p.voiceover.segments = {}; }],
    ['subtitles', p => { p.narrationPackage.subtitleLines = 'bad'; }], ['assets', p => { p.assetChecklist = null; }],
    ['facts', p => { p.safety.approvedFacts = [5]; }], ['safety', p => { p.safety = false; }],
    ['summary', p => { p.summary = []; }], ['provenance', p => { p.provenance = 'bad'; }],
    ['invalid enum', p => { p.summary.presenterMode = 'other'; }],
    ['unsafe integer', p => { p.scenes[0].durationSeconds = Number.MAX_SAFE_INTEGER + 1; }],
    ['negative duration', p => { p.scenes[0].durationSeconds = -1; }],
    ['bad timestamp', p => { p.provenance.generatedAt = 'yesterday'; }],
    ['bad optional', p => { p.cover.coverSubtitle = 5; }],
    ['wrong array member', p => { p.scenes[0].requiredAssetIds = [5]; }],
    ['duplicate scene', p => { p.scenes[1].sceneId = p.scenes[0].sceneId; }]
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    assert.throws(() => validateStandaloneM3Package(mutate(pkg, change)), error =>
      error instanceof RenderingPhaseOneFailure && error.code === 'package_validation_failed');
  });
});

test('remaining package families have isolated closed runtime-type validation', async (t) => {
  const pkg = await packageFixture();
  const cases = [
    ['sourcePlan', p => { p.sourcePlan = []; }],
    ['hook', p => { p.hook = 'bad'; }],
    ['narrationPackage', p => { p.narrationPackage = 5; }],
    ['onScreenText', p => { p.onScreenText = {}; }],
    ['cover', p => { p.cover = false; }],
    ['caption', p => { p.caption = []; }],
    ['hashtags', p => { p.hashtags = 'bad'; }],
    ['commerceControlsApplied', p => { p.safety.commerceControlsApplied = null; }],
    ['packageReviewStatus type', p => { p.packageReviewStatus = 5; }],
    ['packageReviewStatus value', p => { p.packageReviewStatus = 'approved'; }]
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    assert.throws(() => validateStandaloneM3Package(mutate(pkg, change)), error => {
      assert.ok(error instanceof RenderingPhaseOneFailure);
      assert.equal(error.code, 'package_validation_failed');
      assert.deepEqual(Object.keys(error).sort(), ['code', 'name']);
      return true;
    });
  });
});

test('validated package, manifest, and dry-run state remain deeply detached and immutable', async () => {
  const pkg = await packageFixture();
  const originalAction = pkg.scenes[0].visualAction;
  const validated = validateStandaloneM3Package(pkg);
  const manifest = compileRenderManifest(validated.package, validated.packageRevisionHash);
  const dryRun = runDeterministicRenderDryRun(pkg, selection());

  assert.equal(Reflect.set(validated.package.scenes[0], 'visualAction', 'mutated'), false);
  assert.throws(() => validated.package.scenes[0].requiredAssetIds.push('crown-before-view'), TypeError);
  assert.throws(() => validated.package.narrationPackage.subtitleLines[0].lines.push('mutated'), TypeError);
  assert.equal(validated.package.scenes[0].visualAction, originalAction);

  assert.equal(Reflect.set(manifest.audio.slots[0].allocationWindow, 'sceneEndSecond', 999), false);
  assert.equal(Reflect.set(manifest.subtitles.sidecarIntent, 'format', 'vtt'), false);
  assert.throws(() => manifest.subtitles.canonicalCues[0].lines.push('mutated'), TypeError);
  assert.equal(manifest.audio.slots[0].allocationWindow.sceneEndSecond, 15);
  assert.equal(manifest.subtitles.sidecarIntent.format, 'srt');

  assert.equal(Reflect.set(dryRun.manifest.timeline.scenes[0], 'endSecond', 999), false);
  assert.throws(() => dryRun.manifest.timeline.scenes[0].assetOccurrences.push({}), TypeError);
  assert.equal(dryRun.manifest.timeline.scenes[0].endSecond, 15);

  pkg.scenes[0].visualAction = 'caller mutation';
  pkg.narrationPackage.subtitleLines[0].lines[0] = 'caller mutation';
  assert.equal(validated.package.scenes[0].visualAction, originalAction);
  assert.notEqual(validated.package.narrationPackage.subtitleLines[0].lines[0], 'caller mutation');
  assert.notEqual(dryRun.manifest.subtitles.canonicalCues[0].lines[0], 'caller mutation');
});

test('Phase 1 failures are closed, frozen, serializable, and content-free', () => {
  const failure = new RenderingPhaseOneFailure('manifest_validation_failed');
  assert.ok(Object.isFrozen(failure)); assert.deepEqual(JSON.parse(JSON.stringify(failure)), {
    name: 'RenderingPhaseOneFailure', code: 'manifest_validation_failed'
  });
  assert.equal('message' in failure, false); assert.equal('stack' in failure, false); assert.equal('cause' in failure, false);
  assert.throws(() => new RenderingPhaseOneFailure('forged'), TypeError);
});

test('dry run proves fail-fast boundary ordering with narrow injected services', async () => {
  const pkg = await packageFixture(); const validated = validateStandaloneM3Package(pkg);
  const selected = selectRenderer(validated.package, selection()); const manifest = compileRenderManifest(validated.package, validated.packageRevisionHash);
  const base = { validate: validateStandaloneM3Package, select: selectRenderer,
    compile: compileRenderManifest, identify: calculateCanonicalRenderIdentity };
  let calls = [];
  assert.throws(() => runDeterministicRenderDryRun(pkg, selection(), { services: {
    ...base, validate: () => { calls.push('validate'); throw new RenderingPhaseOneFailure('package_validation_failed'); },
    select: () => { calls.push('select'); return selected; }, compile: () => { calls.push('compile'); return manifest; },
    identify: () => { calls.push('identify'); return '0'.repeat(64); }
  } })); assert.deepEqual(calls, ['validate']);
  calls = [];
  assert.throws(() => runDeterministicRenderDryRun(pkg, selection(), { services: {
    ...base, validate: () => { calls.push('validate'); return validated; },
    select: () => { calls.push('select'); throw new RenderingPhaseOneFailure('renderer_selection_failed'); },
    compile: () => { calls.push('compile'); return manifest; }, identify: () => { calls.push('identify'); return '0'.repeat(64); }
  } })); assert.deepEqual(calls, ['validate', 'select']);
  calls = [];
  assert.throws(() => runDeterministicRenderDryRun(pkg, selection(), { services: {
    ...base, validate: () => { calls.push('validate'); return validated; }, select: () => { calls.push('select'); return selected; },
    compile: () => { calls.push('compile'); throw new RenderingPhaseOneFailure('manifest_validation_failed'); },
    identify: () => { calls.push('identify'); return '0'.repeat(64); }
  } })); assert.deepEqual(calls, ['validate', 'select', 'compile']);

  calls = [];
  assert.throws(() => runDeterministicRenderDryRun(pkg, selection(), {
    expectedPackageRevisionHash: '0'.repeat(64), services: {
      ...base,
      validate: (value, options) => { calls.push('validate'); return validateStandaloneM3Package(value, options); },
      select: () => { calls.push('select'); return selected; },
      compile: () => { calls.push('compile'); return manifest; },
      identify: () => { calls.push('identify'); return '0'.repeat(64); }
    }
  }), error => error instanceof RenderingPhaseOneFailure && error.code === 'package_revision_mismatch');
  assert.deepEqual(calls, ['validate']);
});
