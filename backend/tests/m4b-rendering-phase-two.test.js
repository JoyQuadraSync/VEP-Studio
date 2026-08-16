const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { mkdtemp, rm, writeFile, readFile, symlink, rename, truncate } = require('node:fs/promises');
const { input, clientResult } = require('./helpers/voluvia-video-package-fixture');
const { createVoluviaVideoPackageOperation } = require('../dist/workflows/examples/voluvia/video-package/voluvia-video-package.operation');
const { runDeterministicRenderDryRun } = require('../dist/rendering/dry-run/deterministic-render-dry-run');
const { RenderingPhaseTwoFailure, RENDERING_PHASE_TWO_FAILURE_CODES } = require('../dist/rendering/phase-two/failures/rendering-phase-two-failure');
const toolchainModule = require('../dist/rendering/phase-two/toolchain/toolchain-profile');
const { PHASE_TWO_BUILD_CONFIGURATION, PHASE_TWO_HARFBUZZ_PROFILE, PHASE_TWO_TOOLCHAIN_PROFILE, TrustedPhaseTwoEnvironment,
  referenceEnvironmentIdForEvidenceTestOnly,
  verifyTrustedToolchain } = toolchainModule;
const { PHASE_TWO_RESOURCE_LIMITS, validateResourcePreflight } = require('../dist/rendering/phase-two/resources/resource-limits');
const { buildCanonicalSrt, PHASE_TWO_SUBTITLE_STYLE, TrustedFontCoverage,
  TrustedSubtitleLayoutCapability, validateSubtitleGlyphCoverage } = require('../dist/rendering/phase-two/subtitles/subtitle-boundary');
const { FixtureWorkspaceResolver } = require('../dist/rendering/phase-two/workspace/fixture-workspace');
const { buildLogicalCommandManifest, resolveExecutionManifest } = require('../dist/rendering/phase-two/command/ffmpeg-command-manifest');
const { renderDeterministicFixture, TrustedPhaseTwoFixtureComposition } = require('../dist/rendering/phase-two/fixture/deterministic-render-fixture');
const mediaInspectionModule = require('../dist/rendering/phase-two/inspection/media-inspector');
const { getTrustedInputVideoDuration, getTrustedMediaInspector, TrustedInputVideoInspection,
  TrustedMediaInspector } = mediaInspectionModule;
const processRunnerModule = require('../dist/rendering/phase-two/process/ffmpeg-process-runner');
const { NodeFfmpegProcessRunner, simulateWindowsTerminationTestOnly, unixProcessGroupTargetTestOnly,
  windowsTaskkillArgsTestOnly } = processRunnerModule;

const hash = character => character.repeat(64);
const fails = (fn, code) => assert.throws(fn, error => error instanceof RenderingPhaseTwoFailure && error.code === code);
const rejects = (promise, code) => assert.rejects(promise, error => error instanceof RenderingPhaseTwoFailure && error.code === code);
async function phaseOneFixture() {
  const pkg = await createVoluviaVideoPackageOperation({ generatePackageCandidate: async () => clientResult() },
    { now: () => new Date('2026-08-06T12:00:00.000Z') })({ stepInput: input() });
  return runDeterministicRenderDryRun(pkg, { productionPurpose: 'internal_fixture', exactSubtitlesRequired: true,
    exactSceneTimingRequired: true, approvedAssetIds: ['product-front', 'lace-base-close-up'] });
}
const metadata = overrides => ({ operatingSystemIdentity: 'windows-x64-10.0.26100', ffmpegVersion: '8.1.2',
  openH264Version: '2.6.0', freeTypeVersion: '2.14.3', harfBuzzVersion: '14.2.1',
  harfBuzzBuildIdentity: PHASE_TWO_HARFBUZZ_PROFILE, buildConfiguration: [...PHASE_TWO_BUILD_CONFIGURATION],
  ffmpegBinarySha256: hash('a'), openH264BinarySha256: hash('b'), freeTypeBinarySha256: hash('c'),
  harfBuzzBinarySha256: hash('e'), fontSha256: hash('d'), ...overrides });
const expectations = overrides => ({ ...metadata(), executionReady: true, ...overrides });

test('toolchain profile and reference identity bind every frozen environment input', () => {
  assert.equal(PHASE_TWO_TOOLCHAIN_PROFILE.video.width, 1080); assert.equal(PHASE_TWO_TOOLCHAIN_PROFILE.video.height, 1920);
  assert.equal(PHASE_TWO_TOOLCHAIN_PROFILE.video.frameRate, 30); assert.equal(PHASE_TWO_TOOLCHAIN_PROFILE.video.pixelFormat, 'yuv420p');
  const verified = verifyTrustedToolchain(metadata(), expectations()); assert.match(verified.referenceEnvironmentId, /^[a-f0-9]{64}$/);
  for (const [field, value, code] of [['operatingSystemIdentity', 'linux-x64', 'toolchain_invalid'],
    ['ffmpegBinarySha256', hash('e'), 'toolchain_invalid'], ['openH264BinarySha256', hash('e'), 'toolchain_invalid'],
    ['freeTypeBinarySha256', hash('f'), 'toolchain_invalid'], ['harfBuzzBinarySha256', hash('f'), 'toolchain_invalid'],
    ['fontSha256', hash('f'), 'font_invalid']]) {
    fails(() => verifyTrustedToolchain(metadata({ [field]: value }), expectations(),), code);
  }
  assert.notEqual(verified.referenceEnvironmentId,
    verifyTrustedToolchain(metadata({ operatingSystemIdentity: 'linux-x64' }), expectations({ operatingSystemIdentity: 'linux-x64' })).referenceEnvironmentId);
  const environment = TrustedPhaseTwoEnvironment.createTestOnly(metadata(), expectations());
  assert.equal(environment.verified.executionTrust, 'test_only'); assert.equal('createTrustedLocalReference' in TrustedPhaseTwoEnvironment, false);
  for (const field of ['operatingSystemIdentity', 'openH264BinarySha256', 'freeTypeBinarySha256', 'harfBuzzBinarySha256', 'fontSha256']) {
    fails(() => TrustedPhaseTwoEnvironment.createTestOnly(metadata({ [field]: undefined }), expectations()),
      field === 'fontSha256' ? 'font_invalid' : 'toolchain_invalid');
  }
});

test('HarfBuzz frozen identity is exact, fail-closed, and bound into the reference environment', () => {
  const baseline = verifyTrustedToolchain(metadata(), expectations());
  assert.equal(PHASE_TWO_TOOLCHAIN_PROFILE.harfBuzzVersion, '14.2.1');
  assert.equal(PHASE_TWO_HARFBUZZ_PROFILE.linkage, 'static');
  assert.equal(PHASE_TWO_HARFBUZZ_PROFILE.freeType, true);
  assert.doesNotThrow(() => verifyTrustedToolchain(metadata(), expectations()));
  fails(() => verifyTrustedToolchain(metadata({ harfBuzzVersion: undefined }), expectations()), 'toolchain_invalid');
  fails(() => verifyTrustedToolchain(metadata({ harfBuzzVersion: '14.2.0' }), expectations()), 'toolchain_invalid');
  fails(() => verifyTrustedToolchain(metadata({ harfBuzzBinarySha256: undefined }), expectations()), 'toolchain_invalid');
  fails(() => verifyTrustedToolchain(metadata({ harfBuzzBuildIdentity: { ...PHASE_TWO_HARFBUZZ_PROFILE, linkage: 'shared' } }), expectations()), 'toolchain_invalid');
  fails(() => verifyTrustedToolchain(metadata({ harfBuzzBuildIdentity: { ...PHASE_TWO_HARFBUZZ_PROFILE, freeType: false } }), expectations()), 'toolchain_invalid');
  fails(() => verifyTrustedToolchain(metadata({ harfBuzzBuildIdentity: { ...PHASE_TWO_HARFBUZZ_PROFILE, icu: true } }), expectations()), 'toolchain_invalid');
  assert.notEqual(baseline.referenceEnvironmentId,
    verifyTrustedToolchain(metadata({ harfBuzzBinarySha256: hash('f') }), expectations({ harfBuzzBinarySha256: hash('f') })).referenceEnvironmentId);
  const changedFeatures = { ...PHASE_TWO_HARFBUZZ_PROFILE, cairo: true };
  assert.notEqual(JSON.stringify(PHASE_TWO_HARFBUZZ_PROFILE), JSON.stringify(changedFeatures));
  fails(() => verifyTrustedToolchain(metadata({ harfBuzzBuildIdentity: changedFeatures }),
    expectations({ harfBuzzBuildIdentity: changedFeatures })), 'toolchain_invalid');
});

test('every remaining prohibited HarfBuzz feature fails its isolated exact-profile boundary', () => {
  for (const field of ['glib', 'gobject', 'graphite2', 'harfRust', 'gpu', 'raster', 'vector', 'subset',
    'bundledDependencyDownload']) {
    const changed = { ...PHASE_TWO_HARFBUZZ_PROFILE, [field]: true };
    fails(() => verifyTrustedToolchain(metadata({ harfBuzzBuildIdentity: changed }), expectations()), 'toolchain_invalid');
  }
});

test('HarfBuzz version, linkage, and features independently bind canonical reference identity', () => {
  const baseline = referenceEnvironmentIdForEvidenceTestOnly(metadata());
  assert.equal(referenceEnvironmentIdForEvidenceTestOnly(metadata()), baseline);
  for (const changed of [
    metadata({ harfBuzzVersion: '14.2.0' }),
    metadata({ harfBuzzBuildIdentity: { ...PHASE_TWO_HARFBUZZ_PROFILE, linkage: 'shared' } }),
    metadata({ harfBuzzBuildIdentity: { ...PHASE_TWO_HARFBUZZ_PROFILE, icu: true } })
  ]) assert.notEqual(referenceEnvironmentIdForEvidenceTestOnly(changed), baseline);
});

test('FFmpeg frozen build configuration requires HarfBuzz without loosening exclusions', () => {
  for (const flag of ['--enable-libfreetype', '--enable-libharfbuzz', '--enable-libopenh264', '--disable-gpl',
    '--disable-nonfree', '--disable-libx264', '--disable-libx265', '--disable-libfdk-aac', '--disable-hwaccels',
    '--disable-network', '--disable-devices']) assert.equal(PHASE_TWO_BUILD_CONFIGURATION.includes(flag), true);
  const missing = PHASE_TWO_BUILD_CONFIGURATION.filter(flag => flag !== '--enable-libharfbuzz');
  fails(() => verifyTrustedToolchain(metadata({ buildConfiguration: missing }), expectations({ buildConfiguration: missing })), 'toolchain_invalid');
});

test('test-only HarfBuzz evidence cannot mint trusted-local execution authority', () => {
  const environment = TrustedPhaseTwoEnvironment.createTestOnly(metadata(), expectations());
  assert.equal(environment.verified.executionTrust, 'test_only');
  assert.equal('createTrustedLocalReference' in TrustedPhaseTwoEnvironment, false);
  assert.equal('executionTrust' in metadata(), false);
});

test('toolchain runtime exports expose no trusted-local or path-injection verification seam', () => {
  assert.equal('verifyObservedToolchain' in toolchainModule, false);
  assert.equal('createTrustedLocalReference' in TrustedPhaseTwoEnvironment, false);
  assert.equal(TrustedPhaseTwoEnvironment.createTestOnly.length, 2);
  assert.equal(verifyTrustedToolchain.length, 2);
  assert.equal(referenceEnvironmentIdForEvidenceTestOnly.length, 1);
  const environment = TrustedPhaseTwoEnvironment.createTestOnly(metadata(), expectations(),
    'C:\\caller\\ffmpeg.exe', 'C:\\caller\\font.ttf', 'trusted_local_reference');
  assert.equal(environment.verified.executionTrust, 'test_only');
  assert.notEqual(environment.verified.executablePath, 'C:\\caller\\ffmpeg.exe');
  assert.notEqual(environment.verified.fontPath, 'C:\\caller\\font.ttf');
});

test('toolchain metadata validation is descriptor-first and never invokes accessors or toJSON', () => {
  for (const field of ['ffmpegVersion', 'buildConfiguration', 'ffmpegBinarySha256', 'openH264BinarySha256',
    'freeTypeBinarySha256', 'harfBuzzVersion', 'harfBuzzBinarySha256', 'harfBuzzBuildIdentity', 'fontSha256']) {
    let invoked = false; const hostile = metadata(); Object.defineProperty(hostile, field, { enumerable: true,
      get() { invoked = true; throw new Error('must not execute'); } });
    fails(() => verifyTrustedToolchain(hostile, expectations()), 'toolchain_invalid'); assert.equal(invoked, false);
  }
  let rootToJsonInvoked = false; const hostileRoot = metadata(); Object.defineProperty(hostileRoot, 'toJSON', { enumerable: true,
    value() { rootToJsonInvoked = true; throw new Error('must not execute'); } });
  fails(() => verifyTrustedToolchain(hostileRoot, expectations()), 'toolchain_invalid'); assert.equal(rootToJsonInvoked, false);
  let nestedToJsonInvoked = false; const hostileBuild = { ...PHASE_TWO_HARFBUZZ_PROFILE };
  Object.defineProperty(hostileBuild, 'toJSON', { enumerable: true, value() { nestedToJsonInvoked = true; throw new Error('must not execute'); } });
  fails(() => verifyTrustedToolchain(metadata({ harfBuzzBuildIdentity: hostileBuild }), expectations()), 'toolchain_invalid');
  assert.equal(nestedToJsonInvoked, false);
  let nestedGetterInvoked = false; const getterBuild = { ...PHASE_TWO_HARFBUZZ_PROFILE };
  Object.defineProperty(getterBuild, 'glib', { enumerable: true, get() { nestedGetterInvoked = true; throw new Error('must not execute'); } });
  fails(() => verifyTrustedToolchain(metadata({ harfBuzzBuildIdentity: getterBuild }), expectations()), 'toolchain_invalid');
  assert.equal(nestedGetterInvoked, false);
  let arrayGetterInvoked = false; const hostileArray = [...PHASE_TWO_BUILD_CONFIGURATION];
  Object.defineProperty(hostileArray, '0', { enumerable: true, get() { arrayGetterInvoked = true; throw new Error('must not execute'); } });
  fails(() => verifyTrustedToolchain(metadata({ buildConfiguration: hostileArray }), expectations()), 'toolchain_invalid');
  assert.equal(arrayGetterInvoked, false);
});

test('toolchain metadata cycles and proxy reflection failures remain closed', () => {
  const rootCycle = metadata(); rootCycle.self = rootCycle;
  fails(() => verifyTrustedToolchain(rootCycle, expectations()), 'toolchain_invalid');
  const nestedCycle = { ...PHASE_TWO_HARFBUZZ_PROFILE }; nestedCycle.glib = nestedCycle;
  fails(() => verifyTrustedToolchain(metadata({ harfBuzzBuildIdentity: nestedCycle }), expectations()), 'toolchain_invalid');
  const arrayCycle = [...PHASE_TWO_BUILD_CONFIGURATION]; arrayCycle[0] = arrayCycle;
  fails(() => verifyTrustedToolchain(metadata({ buildConfiguration: arrayCycle }), expectations()), 'toolchain_invalid');
  let reflectionTraps = 0; let semanticReads = 0; const proxy = new Proxy({}, {
    getPrototypeOf() { reflectionTraps += 1; throw new Error('reflection'); },
    get() { semanticReads += 1; throw new Error('semantic'); }
  });
  fails(() => verifyTrustedToolchain(proxy, expectations()), 'toolchain_invalid');
  assert.equal(reflectionTraps, 1); assert.equal(semanticReads, 0);
});

test('production trust cannot be fabricated with a plain structural object', async () => {
  const harness = await orchestrationHarness();
  try { const forged = { services: harness.composition.services };
    await rejects(renderDeterministicFixture(harness.request, forged), 'toolchain_invalid');
  } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('media inspection capabilities reject direct construction and structural impersonation at JavaScript runtime', async () => {
  const fakeProbe = { async inspect() { return { durationSeconds: 30 }; } };
  assert.throws(() => new TrustedMediaInspector(fakeProbe), error => error instanceof RenderingPhaseTwoFailure && error.code === 'output_invalid');
  assert.throws(() => new TrustedInputVideoInspection('C:\\issued\\video.mp4', 30),
    error => error instanceof RenderingPhaseTwoFailure && error.code === 'asset_invalid');
  const structural = { inspectInputVideo() { return { durationSeconds: 30 }; } };
  fails(() => getTrustedMediaInspector(structural), 'output_invalid');
  const legitimate = TrustedMediaInspector.createTestOnly(fakeProbe); const copiedPrototype = Object.create(Object.getPrototypeOf(legitimate));
  fails(() => getTrustedMediaInspector(copiedPrototype), 'output_invalid');
  assert.equal(legitimate.executionTrust, 'test_only'); assert.equal('createTrustedLocalReference' in TrustedMediaInspector, false);
  const evidence = await TrustedInputVideoInspection.inspect(legitimate, 'C:\\issued\\video.mp4');
  assert.equal(evidence.executionTrust, 'test_only'); assert.equal(getTrustedInputVideoDuration(evidence, 'C:\\issued\\video.mp4'), 30);
  fails(() => getTrustedInputVideoDuration(evidence, 'C:\\issued\\other.mp4'), 'asset_invalid');
  fails(() => getTrustedInputVideoDuration({ ...evidence }, 'C:\\issued\\video.mp4'), 'asset_invalid');
});

test('resource validation is exact, integer-safe, and overflow-safe', async t => {
  const phaseOne = await phaseOneFixture(); const limits = PHASE_TWO_RESOURCE_LIMITS;
  const base = { manifest: phaseOne.manifest, assets: [], freeWorkspaceBytes: limits.minimumFreeWorkspaceBytes,
    activeWorkspaceBytes: limits.maximumWorkspaceBytes, activeRenderCount: 1, width: 1080, height: 1920, frameRate: 30 };
  assert.doesNotThrow(() => validateResourcePreflight(base));
  const asset = (kind, byteLength, index = 0) => ({ logicalId: `asset-${index}`, kind, byteLength,
    ...(kind === 'video' ? { durationSeconds: 45 } : {}) });
  for (const [name, value] of [['NaN', NaN], ['Infinity', Infinity], ['fraction', 1.5], ['negative', -1],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1]]) await t.test(name, () => fails(() => validateResourcePreflight({ ...base, freeWorkspaceBytes: value }), 'resource_limit_exceeded'));
  for (const [kind, maximum] of [['image', limits.maximumImageBytes], ['video', limits.maximumVideoBytes], ['audio', limits.maximumAudioBytes]]) {
    assert.doesNotThrow(() => validateResourcePreflight({ ...base, activeWorkspaceBytes: 0, assets: [asset(kind, maximum)] }));
    fails(() => validateResourcePreflight({ ...base, activeWorkspaceBytes: 0, assets: [asset(kind, maximum + 1)] }), 'resource_limit_exceeded');
  }
  fails(() => validateResourcePreflight({ ...base, activeWorkspaceBytes: limits.maximumWorkspaceBytes + 1 }), 'resource_limit_exceeded');
  fails(() => validateResourcePreflight({ ...base, width: 720 }), 'resource_limit_exceeded');
  fails(() => validateResourcePreflight({ ...base, frameRate: 29 }), 'resource_limit_exceeded');
});

test('canonical SRT is immutable, rejects malformed Unicode, and enforces scene containment', async () => {
  const phaseOne = await phaseOneFixture(); const result = buildCanonicalSrt(phaseOne.manifest.subtitles.canonicalCues, phaseOne.manifest);
  const first = result.bytes(); first.fill(0); assert.notDeepEqual(first, result.bytes());
  assert.equal(result.sha256, buildCanonicalSrt(phaseOne.manifest.subtitles.canonicalCues, phaseOne.manifest).sha256);
  assert.equal(result.text.includes('\r'), false); assert.doesNotThrow(() => buildCanonicalSrt([
    { cueId: 'cue', sceneId: phaseOne.manifest.timeline.scenes[0].sceneId, lines: ['😀'], startSecond: 0, endSecond: 1 }
  ], phaseOne.manifest));
  for (const text of ['\ud800', '\udc00']) fails(() => buildCanonicalSrt([
    { cueId: 'cue', sceneId: phaseOne.manifest.timeline.scenes[0].sceneId, lines: [text], startSecond: 0, endSecond: 1 }
  ], phaseOne.manifest), 'subtitle_invalid');
  const scene = phaseOne.manifest.timeline.scenes[0];
  fails(() => buildCanonicalSrt([{ cueId: 'cue', sceneId: scene.sceneId, lines: ['x'],
    startSecond: scene.startSecond, endSecond: scene.endSecond + 1 }], phaseOne.manifest), 'subtitle_invalid');
});

test('glyph and layout capabilities are tied to the pinned font hash', async () => {
  const phaseOne = await phaseOneFixture(); const trusted = TrustedFontCoverage.createTestOnly(hash('d'), { supports: () => true });
  assert.doesNotThrow(() => validateSubtitleGlyphCoverage(phaseOne.manifest.subtitles.canonicalCues, trusted, hash('d')));
  fails(() => validateSubtitleGlyphCoverage(phaseOne.manifest.subtitles.canonicalCues, trusted, hash('e')), 'font_invalid');
  fails(() => validateSubtitleGlyphCoverage(phaseOne.manifest.subtitles.canonicalCues, { supports: () => true }, hash('d')), 'font_invalid');
});

test('trusted test layout metrics enforce exact width, vertical fit, spacing, and padding', () => {
  const capability = (width, height) => TrustedSubtitleLayoutCapability.createTestOnly(hash('d'), {
    measureLine: () => ({ widthPx: width, heightPx: height }) });
  assert.doesNotThrow(() => capability(852, 130).verify(['line one', 'line two'], hash('d')));
  fails(() => capability(853, 64).verify(['line'], hash('d')), 'subtitle_invalid');
  fails(() => capability(852, 131).verify(['one', 'two'], hash('d')), 'subtitle_invalid');
  fails(() => capability(100, 64).verify(['one', 'two', 'three'], hash('d')), 'subtitle_invalid');
});

test('workspace rejects lexical and substituted-link paths and maps native errors', async t => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), 'vep-phase2-'));
  try {
    const resolver = FixtureWorkspaceResolver.createTestOnly(appRoot, () => ({ freeWorkspaceBytes: PHASE_TWO_RESOURCE_LIMITS.minimumFreeWorkspaceBytes })); const workspace = await resolver.create();
    const written = await resolver.writeTrustedFile(workspace, 'inputs', 'asset.bin', Buffer.from('x'));
    await resolver.validateIssuedFile(workspace, written);
    fails(() => resolver.assertIssued(workspace, path.resolve(workspace.root, '..', 'escape')), 'workspace_invalid');
    await t.test('directory replacement is rejected before write', async () => {
      const moved = `${workspace.inputsDirectory}-moved`; await rename(workspace.inputsDirectory, moved);
      try { await symlink(moved, workspace.inputsDirectory, 'junction');
        await rejects(resolver.writeTrustedFile(workspace, 'inputs', 'second.bin', Buffer.from('x')), 'workspace_invalid');
      } finally { await rm(workspace.inputsDirectory, { recursive: true, force: true }); await rename(moved, workspace.inputsDirectory); }
    });
    await resolver.cleanup(workspace);
  } finally { await rm(appRoot, { recursive: true, force: true }); }
});

test('developer retention is bounded and forbidden in CI/deployment', async () => {
  fails(() => FixtureWorkspaceResolver.createTestOnly(path.resolve(os.tmpdir(), 'x'), () => ({ freeWorkspaceBytes: 3e9 }), {
    enabled: true, deploymentMode: 'ci', maximumRetainedWorkspaces: 1, maximumAgeMs: 900000 }), 'workspace_invalid');
  fails(() => FixtureWorkspaceResolver.createTestOnly(path.resolve(os.tmpdir(), 'x'), () => ({ freeWorkspaceBytes: 3e9 }), {
    enabled: true, deploymentMode: 'developer', maximumRetainedWorkspaces: 2, maximumAgeMs: 900000 }), 'workspace_invalid');
});

test('workspace concurrency is globally enforced per application root and released', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vep-slot-')); const measure = () => ({ freeWorkspaceBytes: 3 * 1024 ** 3 });
  const first = FixtureWorkspaceResolver.createTestOnly(root, measure); const second = FixtureWorkspaceResolver.createTestOnly(root, measure);
  try { assert.equal(first.acquireRenderSlot().activeRenderCount, 1);
    fails(() => second.acquireRenderSlot(), 'resource_limit_exceeded'); first.releaseRenderSlot();
    assert.equal(second.acquireRenderSlot().activeRenderCount, 1); second.releaseRenderSlot();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('developer retention expires automatically through the fixed fifteen-minute scheduler', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vep-retain-')); let callback; let delay;
  const resolver = FixtureWorkspaceResolver.createTestOnly(root, () => ({ freeWorkspaceBytes: 3 * 1024 ** 3 }),
    { enabled: true, deploymentMode: 'developer', maximumRetainedWorkspaces: 1, maximumAgeMs: 900000 },
    { schedule(fn, ms) { callback = fn; delay = ms; return { cancel() {} }; } });
  try { const workspace = await resolver.create(); await resolver.cleanup(workspace); assert.equal(delay, 900000);
    assert.equal(fs.existsSync(workspace.root), true); callback();
    for (let index = 0; index < 20 && fs.existsSync(workspace.root); index += 1) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(fs.existsSync(workspace.root), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('retention permits only one workspace across resolver instances for the same root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vep-retain-global-')); const scheduler = { schedule() { return { cancel() {} }; } };
  const retention = { enabled: true, deploymentMode: 'developer', maximumRetainedWorkspaces: 1, maximumAgeMs: 900000 };
  const first = FixtureWorkspaceResolver.createTestOnly(root, () => ({ freeWorkspaceBytes: 3 * 1024 ** 3 }), retention, scheduler);
  const second = FixtureWorkspaceResolver.createTestOnly(root, () => ({ freeWorkspaceBytes: 3 * 1024 ** 3 }), retention, scheduler);
  try { const one = await first.create(); await first.cleanup(one); const two = await second.create(); await second.cleanup(two);
    assert.equal(fs.existsSync(one.root), false); assert.equal(fs.existsSync(two.root), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('logical and resolved manifests include every asset occurrence and exact duration semantics', async () => {
  const phaseOne = await phaseOneFixture(); const changed = structuredClone(phaseOne.manifest);
  changed.timeline.scenes[0].assetOccurrences.push({ ...changed.timeline.scenes[0].assetOccurrences[0], assetId: 'detail' });
  const assets = [{ logicalId: 'product-front', kind: 'image' }, { logicalId: 'detail', kind: 'image' },
    { logicalId: 'lace-base-close-up', kind: 'image' }, { logicalId: 'approved-audio', kind: 'audio' }];
  const logical = buildLogicalCommandManifest(changed, assets).logicalManifest;
  const resolved = resolveExecutionManifest(logical, { executablePath: 'C:\\trusted path\\ffmpeg.exe',
    fontPath: "C:\\trusted path\\font'%,;[]=.ttf", assetPaths: { 'product-front': 'C:\\work\\one.bin',
      detail: 'C:\\work\\two.bin', 'lace-base-close-up': 'C:\\work\\three.bin', 'approved-audio': 'C:\\work\\audio.wav' },
    subtitleTextFilePaths: changed.subtitles.canonicalCues.map((_, i) => `C:\\work\\cue-${i}.txt`),
    outputMp4Path: 'C:\\work\\fixture.mp4', outputSrtPath: 'C:\\work\\subtitles.srt', videoInspections: {} }, () => {});
  const graph = resolved.args[resolved.args.indexOf('-filter_complex') + 1];
  assert.match(graph, /s0a0/); assert.match(graph, /s0a1/); assert.match(graph, /hstack=inputs=2:shortest=0/);
  assert.match(graph, /atrim=duration=30/); assert.match(graph, /apad=whole_dur=30/);
  assert.equal(resolved.args[resolved.args.indexOf('-t') + 1], '30'); assert.equal(resolved.args.includes('-shortest'), false);
  for (const token of ['fontsize=64', 'line_spacing=12', 'boxborderw=24', 'text_align=C', 'max(90', '1500-text_h']) assert.ok(graph.includes(token));
  assert.deepEqual(logical.subtitles.style, PHASE_TWO_SUBTITLE_STYLE);
});

test('video duration rule rejects short input, trims long input, and split layout supports at most two assets', async () => {
  const phaseOne = await phaseOneFixture(); const manifest = structuredClone(phaseOne.manifest);
  const sceneDuration = manifest.timeline.scenes[0].endSecond - manifest.timeline.scenes[0].startSecond;
  const baseAssets = [{ logicalId: 'product-front', kind: 'video', durationSeconds: sceneDuration - 1 },
    { logicalId: 'lace-base-close-up', kind: 'image' }, { logicalId: 'approved-audio', kind: 'audio' }];
  const paths = { executablePath: 'C:\\trusted\\ffmpeg.exe', fontPath: 'C:\\trusted\\font.ttf',
    assetPaths: { 'product-front': 'C:\\work\\video.mp4', 'lace-base-close-up': 'C:\\work\\image.png', 'approved-audio': 'C:\\work\\audio.wav' },
    subtitleTextFilePaths: manifest.subtitles.canonicalCues.map((_, i) => `C:\\work\\cue-${i}.txt`),
    outputMp4Path: 'C:\\work\\fixture.mp4', outputSrtPath: 'C:\\work\\subtitles.srt', videoInspections: {} };
  const evidence = async duration => TrustedInputVideoInspection.inspect(TrustedMediaInspector.createTestOnly({ async inspect() {
    return { durationSeconds: duration }; } }), paths.assetPaths['product-front']);
  paths.videoInspections = { 'product-front': await evidence(sceneDuration - 1) };
  fails(() => resolveExecutionManifest(buildLogicalCommandManifest(manifest, baseAssets).logicalManifest, paths, () => {}), 'asset_invalid');
  const long = baseAssets.map(asset => asset.logicalId === 'product-front' ? { ...asset, durationSeconds: sceneDuration + 5 } : asset);
  const longEvidence = await evidence(sceneDuration + 5);
  assert.doesNotThrow(() => resolveExecutionManifest(buildLogicalCommandManifest(manifest, long).logicalManifest,
    { ...paths, videoInspections: { 'product-front': longEvidence } }, () => {}));
  const crowded = structuredClone(phaseOne.manifest);
  crowded.timeline.scenes[0].assetOccurrences.push({ ...crowded.timeline.scenes[0].assetOccurrences[0], assetId: 'second' },
    { ...crowded.timeline.scenes[0].assetOccurrences[0], assetId: 'third' });
  const tooMany = [...long, { logicalId: 'second', kind: 'image' }, { logicalId: 'third', kind: 'image' }];
  fails(() => resolveExecutionManifest(buildLogicalCommandManifest(crowded, tooMany).logicalManifest, {
    ...paths, assetPaths: { ...paths.assetPaths, second: 'C:\\work\\second.png', third: 'C:\\work\\third.png' } }, () => {}), 'command_manifest_invalid');
});

test('hostile subtitle copy remains only inert text-file content', async () => {
  const phaseOne = await phaseOneFixture(); const hostile = `single' double" colon: semicolon; [] \\ % comma, equals= C:\\path %{filter}`;
  const changed = structuredClone(phaseOne.manifest); changed.subtitles.canonicalCues[0].lines = [hostile, 'Unicode Ümlaut'];
  const srt = buildCanonicalSrt(changed.subtitles.canonicalCues, changed); assert.ok(srt.text.includes(`${hostile}\nUnicode Ümlaut`));
  const logical = buildLogicalCommandManifest(changed, [{ logicalId: 'product-front', kind: 'image' },
    { logicalId: 'lace-base-close-up', kind: 'image' }, { logicalId: 'approved-audio', kind: 'audio' }]).logicalManifest;
  const root = await mkdtemp(path.join(os.tmpdir(), 'vep-injection-'));
  const workspaceResolver = FixtureWorkspaceResolver.createTestOnly(root, () => ({ freeWorkspaceBytes: 3 * 1024 ** 3 }));
  try { const workspace = await workspaceResolver.create(); const textPaths = [];
    await workspaceResolver.writeTrustedFile(workspace, 'text', 'subtitles.srt', srt.bytes());
    for (const [index, cue] of changed.subtitles.canonicalCues.entries()) textPaths.push(await workspaceResolver.writeTrustedFile(workspace,
      'text', `cue-${index}.txt`, Buffer.from(cue.lines.join('\n'), 'utf8')));
    const paths = { executablePath: 'C:\\trusted\\ffmpeg.exe', fontPath: 'C:\\trusted\\font.ttf',
      assetPaths: { 'product-front': 'C:\\work\\a.bin', 'lace-base-close-up': 'C:\\work\\b.bin', 'approved-audio': 'C:\\work\\c.wav' },
      subtitleTextFilePaths: textPaths, outputMp4Path: workspace.outputMp4Path, outputSrtPath: workspace.outputSrtPath,
      videoInspections: {} };
    const resolved = resolveExecutionManifest(logical, paths, () => {});
    const clean = resolveExecutionManifest(buildLogicalCommandManifest(phaseOne.manifest, logical.assets).logicalManifest, paths, () => {});
    assert.equal(resolved.args.length, clean.args.length); assert.equal(resolved.args.filter(v => v === '-i').length, clean.args.filter(v => v === '-i').length);
    assert.equal(resolved.outputPaths.length, clean.outputPaths.length); assert.equal(resolved.args.join(' ').includes(hostile), false);
    assert.equal(resolved.args[resolved.args.indexOf('-filter_complex') + 1], clean.args[clean.args.indexOf('-filter_complex') + 1]);
    assert.equal((await readFile(textPaths[0], 'utf8')).includes(hostile), true); await workspaceResolver.cleanup(workspace);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real process runner rejects structural execution before invoking its adapter', async () => {
  const command = Object.freeze({ executablePath: 'trusted', args: [], shell: false, inputPaths: [], outputPaths: [],
    measuredVideoDurations: {}, executionTrust: 'trusted_local_reference' });
  let calls = 0; const runner = new NodeFfmpegProcessRunner({ async execute() { calls += 1; throw new Error('must not execute'); } });
  await rejects(runner.run(command), 'process_failed'); assert.equal(calls, 0);
});

test('test-only resolved executions and every copied or rehydrated form cannot reach the real process adapter', async () => {
  const phaseOne = await phaseOneFixture(); const manifest = structuredClone(phaseOne.manifest);
  const sceneDuration = manifest.timeline.scenes[0].endSecond - manifest.timeline.scenes[0].startSecond;
  const assets = [{ logicalId: 'product-front', kind: 'video', durationSeconds: sceneDuration },
    { logicalId: 'lace-base-close-up', kind: 'image' }, { logicalId: 'approved-audio', kind: 'audio' }];
  const videoPath = 'C:\\work\\video.mp4'; const inspector = TrustedMediaInspector.createTestOnly({ async inspect() { return { durationSeconds: sceneDuration }; } });
  const evidence = await TrustedInputVideoInspection.inspect(inspector, videoPath);
  const resolved = resolveExecutionManifest(buildLogicalCommandManifest(manifest, assets).logicalManifest, {
    executablePath: 'C:\\trusted\\ffmpeg.exe', fontPath: 'C:\\trusted\\font.ttf',
    assetPaths: { 'product-front': videoPath, 'lace-base-close-up': 'C:\\work\\image.png', 'approved-audio': 'C:\\work\\audio.wav' },
    subtitleTextFilePaths: manifest.subtitles.canonicalCues.map((_, index) => `C:\\work\\cue-${index}.txt`),
    outputMp4Path: 'C:\\work\\fixture.mp4', outputSrtPath: 'C:\\work\\subtitles.srt',
    videoInspections: { 'product-front': evidence }
  }, () => {});
  assert.equal(resolved.executionTrust, 'test_only');
  const runner = new NodeFfmpegProcessRunner();
  const { executionTrust: _omitted, ...missingTrust } = resolved;
  const copiedPrototype = Object.assign(Object.create(Object.getPrototypeOf(resolved)), resolved);
  const cases = [resolved, { ...resolved }, JSON.parse(JSON.stringify(resolved)), copiedPrototype, missingTrust,
    { ...resolved, executionTrust: 'trusted_local_reference' }];
  for (const candidate of cases) await rejects(runner.run(candidate), 'process_failed');
});

test('runner constructor ignores executable structural injection without side effects', async t => {
  const command = Object.freeze({ executablePath: 'trusted', args: [], shell: false, inputPaths: [], outputPaths: [],
    measuredVideoDurations: {}, executionTrust: 'trusted_local_reference' });
  let sideEffects = 0;
  const executeLike = { execute() { sideEffects += 1; } };
  const spawnLike = { spawn() { sideEffects += 1; } };
  const functionLike = () => { sideEffects += 1; };
  const copiedPrototype = Object.assign(Object.create(Object.getPrototypeOf(executeLike)), executeLike);
  for (const [name, candidate] of [['execute object', executeLike], ['spawn object', spawnLike],
    ['function', functionLike], ['copied adapter prototype', copiedPrototype]]) await t.test(name, async () => {
    const runner = new NodeFfmpegProcessRunner(candidate);
    await rejects(runner.run(command), 'process_failed'); assert.equal(sideEffects, 0);
  });
});

test('Unix termination targets the detached process group', () => {
  assert.equal(unixProcessGroupTargetTestOnly(42), -42); assert.throws(() => unixProcessGroupTargetTestOnly(0));
});

test('Windows termination uses tree scope before force scope', () => {
  assert.deepEqual(windowsTaskkillArgsTestOnly(42, false), ['/PID', '42', '/T']);
  assert.deepEqual(windowsTaskkillArgsTestOnly(42, true), ['/PID', '42', '/T', '/F']);
});

test('pure Windows termination harness preserves bounded outcomes and cancellation without executable callbacks', async t => {
  const cases = [['graceful success', 'success', 'success'], ['graceful launch error', 'launch_error', 'success'],
    ['graceful non-zero', 'non_zero', 'success'], ['graceful hung', 'hung', 'success'],
    ['force success', 'success', 'success'], ['force launch error', 'success', 'launch_error'],
    ['force non-zero', 'success', 'non_zero'], ['force hung', 'success', 'hung']];
  for (const [name, gracefulOutcome, forceOutcome] of cases) await t.test(name, () => {
    const result = simulateWindowsTerminationTestOnly({ pid: 42, originalChildExit: 'never', gracefulOutcome, forceOutcome });
    assert.equal(result.settled, true); assert.equal(result.timedOut, true); assert.equal(result.taskkillAttemptTimeoutMs, 1000);
    assert.equal(result.gracePeriodMs, 5000); assert.deepEqual(result.attempts.map(attempt => attempt.args),
      [['/PID', '42', '/T'], ['/PID', '42', '/T', '/F']]); assert.equal(result.attempts.every(attempt => attempt.bounded), true);
  });
  assert.deepEqual(simulateWindowsTerminationTestOnly({ pid: 42, originalChildExit: 'before_timeout',
    gracefulOutcome: 'hung', forceOutcome: 'hung' }).attempts, []);
  assert.deepEqual(simulateWindowsTerminationTestOnly({ pid: 42, originalChildExit: 'during_grace',
    gracefulOutcome: 'success', forceOutcome: 'hung' }).attempts.map(attempt => attempt.kind), ['graceful']);
  fails(() => simulateWindowsTerminationTestOnly({ pid: 42, originalChildExit: { processLooking: true },
    gracefulOutcome: 'success', forceOutcome: 'success' }), 'process_failed');
});

test('Windows termination harness validates descriptors before semantic property access', async t => {
  const valid = () => ({ pid: 42, originalChildExit: 'never', gracefulOutcome: 'success', forceOutcome: 'success' });
  for (const field of ['pid', 'originalChildExit', 'gracefulOutcome', 'forceOutcome']) await t.test(`rejects ${field} getter without invocation`, () => {
    let invoked = false; const input = valid(); Object.defineProperty(input, field, { enumerable: true, get() { invoked = true; throw new Error('getter'); } });
    fails(() => simulateWindowsTerminationTestOnly(input), 'process_failed'); assert.equal(invoked, false);
  });
  await t.test('rejects setter-only accessor', () => { const input = valid(); Object.defineProperty(input, 'pid', { enumerable: true, set() {} });
    fails(() => simulateWindowsTerminationTestOnly(input), 'process_failed'); });
  await t.test('rejects symbol property', () => { const input = valid(); input[Symbol('hidden')] = true;
    fails(() => simulateWindowsTerminationTestOnly(input), 'process_failed'); });
  await t.test('rejects custom prototype', () => {
    fails(() => simulateWindowsTerminationTestOnly(Object.assign(Object.create({}), valid())), 'process_failed');
  });
  await t.test('rejects unexpected non-enumerable property', () => { const input = valid(); Object.defineProperty(input, 'hidden', { value: true });
    fails(() => simulateWindowsTerminationTestOnly(input), 'process_failed'); });
  await t.test('rejects unexpected enumerable property', () => { const input = { ...valid(), extra: true };
    fails(() => simulateWindowsTerminationTestOnly(input), 'process_failed'); });
  await t.test('rejects function-valued field', () => { const input = { ...valid(), gracefulOutcome() {} };
    fails(() => simulateWindowsTerminationTestOnly(input), 'process_failed'); });
  await t.test('accepts a valid frozen ordinary object', () => {
    assert.equal(simulateWindowsTerminationTestOnly(Object.freeze(valid())).settled, true);
  });
});

test('Windows termination harness closes proxy reflection failure without semantic reads', () => {
  let reflectionTraps = 0; let semanticReads = 0; const input = new Proxy({}, {
    getPrototypeOf() { reflectionTraps += 1; throw new Error('proxy reflection'); },
    get() { semanticReads += 1; throw new Error('semantic read'); }
  });
  fails(() => simulateWindowsTerminationTestOnly(input), 'process_failed');
  assert.equal(reflectionTraps, 1); assert.equal(semanticReads, 0);
});

test('process-runner exports contain no raw executable test adapter or arbitrary process callback seam', () => {
  assert.equal('createWindowsProcessTreeAdapterTestOnly' in processRunnerModule, false);
  assert.equal('startTerminationSequenceTestOnly' in processRunnerModule, false);
  assert.equal('ProcessInvocationAdapter' in processRunnerModule, false);
  assert.equal(NodeFfmpegProcessRunner.length, 0);
  assert.deepEqual(Object.getOwnPropertyNames(NodeFfmpegProcessRunner.prototype).sort(), ['constructor', 'run']);
  assert.equal('execute' in NodeFfmpegProcessRunner.prototype, false);
  assert.equal('spawn' in NodeFfmpegProcessRunner.prototype, false);
  for (const [name, value] of Object.entries(processRunnerModule)) {
    assert.equal(typeof value === 'object' && value !== null && typeof value.execute === 'function', false);
    assert.equal(typeof value === 'object' && value !== null && typeof value.spawn === 'function', false);
  }
});

async function orchestrationHarness(overrides = {}) {
  const phaseOne = await phaseOneFixture(); const appRoot = await mkdtemp(path.join(os.tmpdir(), 'vep-render-'));
  let processCalls = 0; let cleanupCalls = 0; let inspectionCalls = 0;
  const workspace = FixtureWorkspaceResolver.createTestOnly(appRoot,
    () => ({ freeWorkspaceBytes: PHASE_TWO_RESOURCE_LIMITS.minimumFreeWorkspaceBytes }), undefined, undefined,
    { onCleanup: () => { cleanupCalls += 1; }, failCleanup: Boolean(overrides.cleanupFailure) });
  const output = Buffer.from('synthetic-mp4-fixture');
  const processRunner = overrides.processRunner ?? { async run(command) { processCalls += 1; await writeFile(command.outputPaths[0], output); return { exitCode: 0 }; } };
  const inspectorDelegate = overrides.inspector ?? { async inspect(outputPath) { const bytes = await readFile(outputPath);
    return { container: 'mp4', byteLength: bytes.length, width: 1080, height: 1920, frameRate: 30,
      constantFrameRate: true, durationSeconds: 30, streams: ['video', 'audio'], videoCodecFamily: 'h264', audioCodecFamily: 'aac' }; } };
  const inspector = TrustedMediaInspector.createTestOnly({ async inspect(outputPath) { inspectionCalls += 1; return inspectorDelegate.inspect(outputPath); } });
  const environment = TrustedPhaseTwoEnvironment.createTestOnly(metadata(), expectations());
  const request = { phaseOne, assets: [
    { logicalId: 'product-front', kind: 'image', byteLength: 5, bytes: Buffer.from('asset') },
    { logicalId: 'lace-base-close-up', kind: 'image', byteLength: 4, bytes: Buffer.from('lace') },
    { logicalId: 'approved-audio', kind: 'audio', byteLength: 5, bytes: Buffer.from('audio') }],
  };
  const composition = TrustedPhaseTwoFixtureComposition.createTestOnly({ environment, workspace,
    glyphCoverage: TrustedFontCoverage.createTestOnly(hash('d'), { supports: () => true }), processRunner, inspector,
    subtitleLayout: TrustedSubtitleLayoutCapability.createTestOnly(hash('d'), { measureLine(text, configuration) {
      assert.deepEqual(configuration, { fontSize: 64, weight: 700, widthAxis: 100 }); return { widthPx: Math.min(800, [...text].length * 20), heightPx: 64 }; } }) });
  return { request, composition, appRoot, counts: () => ({ processCalls, cleanupCalls }), inspectionCount: () => inspectionCalls };
}

test('trusted issued-file inspection, not declared metadata, controls video duration preflight', async t => {
  for (const scenario of [{ name: 'declared long but measured short', declared: 30, measured: 5, accepted: false },
    { name: 'declared short but measured long', declared: 5, measured: 20, accepted: true },
    { name: 'measured exactly assigned duration', declared: 30, measured: 15, accepted: true }]) {
    await t.test(scenario.name, async () => { let inspectedInputPath; const harness = await orchestrationHarness({ inspector: { async inspect(filePath) {
      const bytes = await readFile(filePath); if (!filePath.endsWith('fixture.mp4')) { inspectedInputPath = filePath;
        return { container: 'mp4', byteLength: bytes.length, width: 1080, height: 1920, frameRate: 30, constantFrameRate: true,
          durationSeconds: scenario.measured, streams: ['video', 'audio'], videoCodecFamily: 'h264', audioCodecFamily: 'aac' }; }
      return { container: 'mp4', byteLength: bytes.length, width: 1080, height: 1920, frameRate: 30, constantFrameRate: true,
        durationSeconds: 30, streams: ['video', 'audio'], videoCodecFamily: 'h264', audioCodecFamily: 'aac' }; } } });
      const assets = harness.request.assets.map(asset => asset.logicalId === 'product-front' ?
        { ...asset, kind: 'video', durationSeconds: scenario.declared } : asset);
      try { if (scenario.accepted) await renderDeterministicFixture({ ...harness.request, assets }, harness.composition);
        else await rejects(renderDeterministicFixture({ ...harness.request, assets }, harness.composition), 'asset_invalid');
        assert.match(inspectedInputPath, /inputs[\\/]product-front\.bin$/); assert.equal(harness.counts().processCalls, scenario.accepted ? 1 : 0);
      } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
    });
  }
});

test('input-video inspector failure is closed and prevents process invocation', async () => {
  const harness = await orchestrationHarness({ inspector: { async inspect(filePath) { if (!filePath.endsWith('fixture.mp4')) throw new Error('raw probe');
    throw new Error('must not reach output'); } } });
  const assets = harness.request.assets.map(asset => asset.logicalId === 'product-front' ? { ...asset, kind: 'video', durationSeconds: 30 } : asset);
  try { await rejects(renderDeterministicFixture({ ...harness.request, assets }, harness.composition), 'asset_invalid');
    assert.equal(harness.counts().processCalls, 0);
  } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('assets container and elements are descriptor-validated before inspection or processing', async t => {
  const cases = [
    ['numeric accessor', assets => { let invoked = false; Object.defineProperty(assets, '0', { enumerable: true, configurable: true,
      get() { invoked = true; return {}; } }); return () => assert.equal(invoked, false); }],
    ['symbol property', assets => { assets[Symbol('hostile')] = true; }],
    ['custom prototype', assets => { Object.setPrototypeOf(assets, Object.create(Array.prototype)); }],
    ['non-enumerable property', assets => { Object.defineProperty(assets, 'hidden', { value: true }); }],
    ['malformed element', assets => { assets[0] = 'invalid'; }],
    ['cyclic element', assets => { const changed = { ...assets[0] }; changed.self = changed; assets[0] = changed; }],
    ['element getter', assets => { let invoked = false; const changed = { ...assets[0] }; Object.defineProperty(changed, 'logicalId', {
      enumerable: true, get() { invoked = true; return 'product-front'; } }); assets[0] = changed; return () => assert.equal(invoked, false); }]
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => { const harness = await orchestrationHarness(); const assets = [...harness.request.assets];
    const verify = mutate(assets); try { await rejects(renderDeterministicFixture({ ...harness.request, assets }, harness.composition), 'asset_invalid');
      if (verify) verify(); assert.equal(harness.inspectionCount(), 0); assert.equal(harness.counts().processCalls, 0);
    } finally { await rm(harness.appRoot, { recursive: true, force: true }); } });
  const harness = await orchestrationHarness(); try { await renderDeterministicFixture({ ...harness.request,
    assets: Object.freeze([...harness.request.assets]) }, harness.composition); assert.equal(harness.counts().processCalls, 1);
  } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('fixture binds process output path to trusted inspection and bounded artifact evidence', async () => {
  const harness = await orchestrationHarness();
  try { const result = await renderDeterministicFixture(harness.request, harness.composition);
    assert.equal(result.resultKind, 'deterministic_render_fixture'); assert.equal(result.productionEligibility, 'prohibited');
    assert.equal(result.fixtureStatus, 'rendered'); assert.match(result.referenceEnvironmentId, /^[a-f0-9]{64}$/);
    assert.equal(result.executionTrust, 'test_only');
    assert.deepEqual(harness.counts(), { processCalls: 1, cleanupCalls: 1 });
  } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('oversized sparse output is rejected before trusted inspection and without full read', async () => {
  let inspections = 0;
  const harness = await orchestrationHarness({ processRunner: { async run(command) {
    await writeFile(command.outputPaths[0], Buffer.alloc(0));
    await truncate(command.outputPaths[0], PHASE_TWO_RESOURCE_LIMITS.maximumOutputBytes + 1); return { exitCode: 0 };
  } }, inspector: { async inspect() { inspections += 1; throw new Error('must not inspect'); } } });
  try { await rejects(renderDeterministicFixture(harness.request, harness.composition), 'resource_limit_exceeded'); assert.equal(inspections, 0); }
  finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('ordinary callers cannot forge inspector or glyph success', async () => {
  const harness = await orchestrationHarness();
  try {
    const services = { ...harness.composition.services, inspector: { inspector: { inspect: async () => ({}) } } };
    await rejects(renderDeterministicFixture(harness.request, TrustedPhaseTwoFixtureComposition.createTestOnly(services)), 'output_invalid');
    const glyphServices = { ...harness.composition.services, glyphCoverage: { coverage: { supports: () => true }, fontSha256: hash('d') } };
    await rejects(renderDeterministicFixture(harness.request, TrustedPhaseTwoFixtureComposition.createTestOnly(glyphServices)), 'font_invalid');
  } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('test-only composition cannot authorize the real local process runner', async () => {
  const harness = await orchestrationHarness();
  try { const services = { ...harness.composition.services, processRunner: new NodeFfmpegProcessRunner({
    async execute() { throw new Error('must not execute'); } }) };
    await rejects(renderDeterministicFixture(harness.request, TrustedPhaseTwoFixtureComposition.createTestOnly(services)), 'toolchain_invalid');
  } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('primary controlled failure survives cleanup failure', async () => {
  const harness = await orchestrationHarness({ cleanupFailure: true, processRunner: { async run() { throw new RenderingPhaseTwoFailure('process_failed'); } } });
  try { await rejects(renderDeterministicFixture(harness.request, harness.composition), 'process_failed'); }
  finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('closed failure values are runtime validated, frozen, and sanitized', () => {
  for (const code of RENDERING_PHASE_TWO_FAILURE_CODES) {
    const failure = new RenderingPhaseTwoFailure(code); assert.ok(Object.isFrozen(failure));
    assert.deepEqual(Object.keys(failure).sort(), ['code', 'name']); assert.equal('message' in failure, false);
  }
  assert.throws(() => new RenderingPhaseTwoFailure('forged'), TypeError);
});

test('missing required visual asset fails before workspace or process execution', async () => {
  const harness = await orchestrationHarness();
  try { await rejects(renderDeterministicFixture({ ...harness.request,
    assets: harness.request.assets.filter(asset => asset.logicalId !== 'product-front') }, harness.composition), 'asset_invalid');
    assert.deepEqual(harness.counts(), { processCalls: 0, cleanupCalls: 0 });
  } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('extra arbitrary visual asset fails before process execution', async () => {
  const harness = await orchestrationHarness();
  try { await rejects(renderDeterministicFixture({ ...harness.request, assets: [...harness.request.assets,
    { logicalId: 'extra', kind: 'image', byteLength: 1, bytes: Buffer.from('x') }] }, harness.composition), 'asset_invalid');
    assert.equal(harness.counts().processCalls, 0);
  } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('subtitle cue referencing an unknown scene is rejected', async () => {
  const phaseOne = await phaseOneFixture();
  fails(() => buildCanonicalSrt([{ cueId: 'cue', sceneId: 'unknown-scene', lines: ['text'], startSecond: 0, endSecond: 1 }],
    phaseOne.manifest), 'subtitle_invalid');
});

test('successful fixture result is not replaced when operational cleanup fails', async () => {
  const harness = await orchestrationHarness({ cleanupFailure: true });
  try { const result = await renderDeterministicFixture(harness.request, harness.composition);
    assert.equal(result.fixtureStatus, 'rendered'); assert.equal(result.productionEligibility, 'prohibited');
  } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('inspector observes the actual resolver-issued output path', async () => {
  let inspectedPath;
  const harness = await orchestrationHarness({ inspector: { async inspect(outputPath) { inspectedPath = outputPath;
    const bytes = await readFile(outputPath); return { container: 'mp4', byteLength: bytes.length, width: 1080, height: 1920,
      frameRate: 30, constantFrameRate: true, durationSeconds: 30, streams: ['video', 'audio'],
      videoCodecFamily: 'h264', audioCodecFamily: 'aac' }; } } });
  try { await renderDeterministicFixture(harness.request, harness.composition);
    assert.match(inspectedPath, /fixture\.mp4$/); assert.equal(path.isAbsolute(inspectedPath), true);
  } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('native inspector exception is contained by the public Phase 2 failure boundary', async () => {
  const harness = await orchestrationHarness({ inspector: { async inspect() { throw new Error('raw path and media detail'); } } });
  try { await rejects(renderDeterministicFixture(harness.request, harness.composition), 'output_invalid'); }
  finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});

test('arbitrary malformed JavaScript input always becomes a closed Phase 2 failure', async () => {
  const harness = await orchestrationHarness();
  try { for (const malformed of [null, {}, { phaseOne: {}, assets: [] },
    { phaseOne: { resultKind: 'deterministic_render_dry_run', productionEligibility: 'prohibited', validationResult: 'valid',
      sourcePackageId: hash('a'), sourcePackageRevisionHash: hash('b'), canonicalRenderIdentity: hash('c') }, assets: [] }]) {
    await rejects(renderDeterministicFixture(malformed, harness.composition), 'local_validation');
  } } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
});
