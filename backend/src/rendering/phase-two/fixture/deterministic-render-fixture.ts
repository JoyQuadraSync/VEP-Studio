import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeterministicRenderDryRunResult } from '../../dry-run/deterministic-render-dry-run';
import { buildLogicalCommandManifest, LogicalAssetReference, resolveExecutionManifest } from '../command/ffmpeg-command-manifest';
import { deepFreeze, isSha256 } from '../contracts/phase-two-contracts';
import { RenderingPhaseTwoFailure } from '../failures/rendering-phase-two-failure';
import { getMediaInspectorTrust, getTrustedMediaInspector, TrustedInputVideoInspection, TrustedMediaInspector } from '../inspection/media-inspector';
import { FfmpegProcessRunner, NodeFfmpegProcessRunner } from '../process/ffmpeg-process-runner';
import { FixtureAssetDescriptor, PHASE_TWO_RESOURCE_LIMITS, validateResourcePreflight } from '../resources/resource-limits';
import { assertTrustedSubtitleLayout, buildCanonicalSrt, TrustedFontCoverage, TrustedSubtitleLayoutCapability,
  validateSubtitleGlyphCoverage } from '../subtitles/subtitle-boundary';
import { assertTrustedPhaseTwoEnvironment, TrustedPhaseTwoEnvironment } from '../toolchain/toolchain-profile';
import { PHASE_TWO_TOOLCHAIN_PROFILE } from '../toolchain/toolchain-profile';
import { FixtureWorkspaceResolver } from '../workspace/fixture-workspace';

export interface FixtureAssetInput extends FixtureAssetDescriptor { readonly bytes: Buffer }
export interface DeterministicRenderFixtureResult { readonly resultKind: 'deterministic_render_fixture'; readonly productionEligibility: 'prohibited';
  readonly sourcePackageId: string; readonly sourcePackageRevisionHash: string; readonly canonicalRenderIdentity: string;
  readonly commandManifestSha256: string; readonly artifactSha256: string; readonly subtitleSidecarSha256: string;
  readonly outputDurationSeconds: number; readonly resolution: '1080x1920'; readonly frameRate: 30;
  readonly fixtureStatus: 'rendered'; readonly referenceEnvironmentId: string;
  readonly executionTrust: 'test_only' | 'trusted_local_reference';
}
export interface FixtureRenderInput { readonly phaseOne: DeterministicRenderDryRunResult; readonly assets: readonly FixtureAssetInput[] }
export interface FixtureRenderServices { readonly environment: TrustedPhaseTwoEnvironment; readonly workspace: FixtureWorkspaceResolver;
  readonly glyphCoverage: TrustedFontCoverage; readonly processRunner: FfmpegProcessRunner;
  readonly inspector: TrustedMediaInspector; readonly subtitleLayout: TrustedSubtitleLayoutCapability }
const compositions = new WeakSet<object>();
const fixtureResolvedExecutions = new WeakSet<object>();
const FIRST_FIXTURE_HASHES = Object.freeze({
  'product-front': '2c0af122cd390d90b175ed10682fc377622b2458654ae5dbc221c81b9f5b2b1e',
  'lace-base-close-up': 'e000ed0489acff9e4f2208e72c822a1a170e7df1905940851730fac9212098a9',
  'approved-audio': '990790c83918824382bf8a4da999a2fbf50f123fc1d78ffff7736fbb82e3aeb5'
} as const);
const EVIDENCE_ROOT = 'C:\\Users\\Jiayi\\AppData\\Local\\VEP-Studio\\toolchain\\evidence\\renders\\first-controlled';
export function isFixtureResolvedExecutionInternal(value: unknown): boolean {
  return typeof value === 'object' && value !== null && fixtureResolvedExecutions.has(value);
}
export class TrustedPhaseTwoFixtureComposition {
  readonly services: FixtureRenderServices;
  private constructor(services: FixtureRenderServices) { this.services = Object.freeze({ ...services }); compositions.add(this); Object.freeze(this); }
  /** Explicit test seam; it can only produce the prohibited Phase 2 engineering result. */
  static createTestOnly(services: FixtureRenderServices): TrustedPhaseTwoFixtureComposition { return new TrustedPhaseTwoFixtureComposition(services); }
}
/** Closed identity check; it accepts no paths, bytes, hashes, callbacks, or authority. */
export function validateFirstControlledFixtureAssetsForTestOnly(scenario: unknown): 'accepted' | 'asset_invalid' {
  if (!['valid', 'legacy_png_visuals', 'product_front_substituted', 'lace_base_substituted', 'audio_substituted'].includes(scenario as string))
    throw new RenderingPhaseTwoFailure('asset_invalid');
  const selected: { logicalId: string; sha256: string }[] =
    Object.entries(FIRST_FIXTURE_HASHES).map(([logicalId, sha256]) => ({ logicalId, sha256 }));
  const substitutedIndex = scenario === 'product_front_substituted' ? 0 : scenario === 'lace_base_substituted' ? 1 :
    scenario === 'audio_substituted' ? 2 : -1;
  if (scenario === 'legacy_png_visuals') {
    selected[0] = { ...selected[0]!, sha256: 'c65ec5cab50d358c0eaec4f5b4d071beb04f0923f8c98582d4dc37904fd489ea' };
    selected[1] = { ...selected[1]!, sha256: '0eec9459e2e09584a789f34a8fcfa00d602f0830bc30fe5f5e80e7f3a17f6c47' };
  }
  if (substitutedIndex >= 0) selected[substitutedIndex] = { ...selected[substitutedIndex]!, sha256: '0'.repeat(64) };
  try { validateFirstControlledDigests(selected); return 'accepted'; }
  catch (error) { if (error instanceof RenderingPhaseTwoFailure && error.code === 'asset_invalid') return 'asset_invalid'; throw error; }
}
/** Closed retention harness: it uses a self-owned temporary root and exposes no path, callback, or write authority. */
export async function exerciseFirstControlledRetentionForTestOnly(scenario: unknown): Promise<Readonly<{
  outcome: 'retained' | 'idempotent' | 'workspace_invalid'; byteIdentical: boolean; hashMatches: boolean }>> {
  if (!['retained', 'idempotent', 'different_existing'].includes(scenario as string)) throw new RenderingPhaseTwoFailure('workspace_invalid');
  const parent = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), 'vep-first-render-evidence-')));
  const root = path.join(parent, 'first-controlled'); const source = path.join(parent, 'source.mp4'); const bytes = Buffer.from('verified-engineering-mp4');
  await writeFile(source, bytes, { flag: 'wx' }); const sha256 = createHash('sha256').update(bytes).digest('hex');
  const inspection = testInspection(bytes.length); const result = testFixtureResult(sha256);
  try {
    await retainFirstControlledEvidence(source, { byteLength: bytes.length, sha256 }, inspection, result, 'd'.repeat(64), root);
    if (scenario === 'idempotent') await retainFirstControlledEvidence(source, { byteLength: bytes.length, sha256 }, inspection, result, 'd'.repeat(64), root);
    if (scenario === 'different_existing') { await rm(path.join(root, 'fixture.mp4')); await writeFile(path.join(root, 'fixture.mp4'), Buffer.from('different'));
      try { await retainFirstControlledEvidence(source, { byteLength: bytes.length, sha256 }, inspection, result, 'd'.repeat(64), root); }
      catch (error) { if (error instanceof RenderingPhaseTwoFailure && error.code === 'workspace_invalid')
        return Object.freeze({ outcome: 'workspace_invalid', byteIdentical: false, hashMatches: false }); throw error; } }
    const retained = await readFile(path.join(root, 'fixture.mp4'));
    return Object.freeze({ outcome: scenario === 'idempotent' ? 'idempotent' : 'retained', byteIdentical: retained.equals(bytes),
      hashMatches: createHash('sha256').update(retained).digest('hex') === sha256 });
  } finally { await rm(parent, { recursive: true, force: true }); }
}
/** Closed orchestration harness. It cannot issue lineage, resolve execution, or reach the real process/toolchain/evidence roots. */
export async function exerciseFirstControlledCompletionSequenceForTestOnly(scenario: unknown): Promise<Readonly<{
  outcome: 'rendered' | 'output_invalid' | 'workspace_invalid'; events: readonly string[];
  retentionInvocationCount: 0 | 1; cleanupInvocationCount: 1; productionEligibility?: 'prohibited' }>> {
  if (!['valid_output', 'invalid_output', 'retention_failure'].includes(scenario as string)) throw new RenderingPhaseTwoFailure('local_validation');
  const { mkdtemp } = await import('node:fs/promises'); const parent = await mkdtemp(path.join(os.tmpdir(), 'vep-first-render-sequence-'));
  const outputPath = path.join(parent, 'controlled-output.bin'); const evidenceRoot = path.join(parent, 'evidence', 'first-controlled');
  const bytes = Buffer.from('controlled-render-output'); const events: string[] = ['process']; let retentionInvocationCount: 0 | 1 = 0;
  let outcome: 'rendered' | 'output_invalid' | 'workspace_invalid' = 'rendered'; let productionEligibility: 'prohibited' | undefined;
  await writeFile(outputPath, bytes, { flag: 'wx' });
  const result = await executeProductionFixtureLifecycle(async () => {
    const completed = await completeRenderedFixture({ outputPath, expectedDuration: 30, events,
      validateIssued: async () => { const info = await lstat(outputPath); if (!info.isFile()) throw new RenderingPhaseTwoFailure('workspace_invalid'); },
      inspect: async () => scenario === 'invalid_output' ? { ...testInspection(bytes.length), videoProfile: 'High' as 'Constrained Baseline' } : testInspection(bytes.length),
      buildResult: (artifact) => testFixtureResult(artifact.sha256),
      retain: async (artifact, inspection, result) => { retentionInvocationCount = 1;
        if (scenario === 'retention_failure') throw new RenderingPhaseTwoFailure('workspace_invalid');
        await retainFirstControlledEvidence(outputPath, artifact, inspection, result, 'd'.repeat(64), evidenceRoot); } });
    productionEligibility = completed.productionEligibility; return completed;
  }, async () => { await rm(parent, { recursive: true, force: true }); events.push('production_cleanup'); }, () => undefined)
    .then(() => undefined, (error: unknown) => {
    const failure = error instanceof RenderingPhaseTwoFailure && (error.code === 'output_invalid' || error.code === 'workspace_invalid') ? error.code : undefined;
    if (!failure) throw error; outcome = failure;
  });
  void result;
  return Object.freeze(productionEligibility === undefined ? { outcome, events: Object.freeze([...events]), retentionInvocationCount,
    cleanupInvocationCount: 1 as const } : { outcome, events: Object.freeze([...events]), retentionInvocationCount,
    cleanupInvocationCount: 1 as const, productionEligibility });
}

export async function renderDeterministicFixture(input: FixtureRenderInput,
  composition: TrustedPhaseTwoFixtureComposition): Promise<DeterministicRenderFixtureResult> {
  try { return await renderContained(input, composition); }
  catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('local_validation'); }
}
async function renderContained(input: FixtureRenderInput,
  composition: TrustedPhaseTwoFixtureComposition): Promise<DeterministicRenderFixtureResult> {
  const assets = detachSafeAssets(input);
  if (typeof composition !== 'object' || composition === null || !compositions.has(composition)) throw new RenderingPhaseTwoFailure('toolchain_invalid');
  const services = composition.services; assertTrustedPhaseTwoEnvironment(services.environment);
  validatePhaseOne(input.phaseOne); validateAssets(input.phaseOne, assets);
  const verified = services.environment.verified;
  const runtime = require('../runtime/trusted-local-runtime') as { assertTrustedLocalComposition(value: unknown, services: readonly unknown[]): void;
    authorizeTrustedLocalResolvedExecution(composition: unknown, resolved: object): void;
    revalidateTrustedCompositionForRender(value: unknown): Promise<void> };
  const trust = verified.executionTrust; if (getMediaInspectorTrust(services.inspector) !== trust || services.workspace.executionTrust !== trust)
    throw new RenderingPhaseTwoFailure('toolchain_invalid');
  if ((trust === 'test_only') === (services.processRunner instanceof NodeFfmpegProcessRunner)) throw new RenderingPhaseTwoFailure('toolchain_invalid');
  services.workspace.assertTrusted(); assertTrustedSubtitleLayout(services.subtitleLayout, trust);
  if (trust === 'trusted_local_reference') validateFirstControlledAssets(assets);
  validateSubtitleGlyphCoverage(input.phaseOne.manifest.subtitles.canonicalCues, services.glyphCoverage, verified.fontSha256, trust);
  if (trust === 'trusted_local_reference') runtime.assertTrustedLocalComposition(composition,
    [services.environment, services.inspector, services.glyphCoverage, services.subtitleLayout, services.workspace]);
  if (trust === 'trusted_local_reference') await runtime.revalidateTrustedCompositionForRender(composition);
  for (const cue of input.phaseOne.manifest.subtitles.canonicalCues) services.subtitleLayout.verify(cue.lines, verified.fontSha256);
  const srt = buildCanonicalSrt(input.phaseOne.manifest.subtitles.canonicalCues, input.phaseOne.manifest);
  const logicalAssets: LogicalAssetReference[] = assets.map(({ logicalId, kind, durationSeconds }) =>
    durationSeconds === undefined ? { logicalId, kind } : { logicalId, kind, durationSeconds });
  const command = buildLogicalCommandManifest(input.phaseOne.manifest, logicalAssets);
  let workspace: Awaited<ReturnType<FixtureWorkspaceResolver['create']>> | undefined;
  let successfulResult: DeterministicRenderFixtureResult | undefined; let slotAcquired = false;
  return executeProductionFixtureLifecycle(async () => {
    const measurements = services.workspace.acquireRenderSlot(); slotAcquired = true;
    validateResourcePreflight({ manifest: input.phaseOne.manifest, assets, ...measurements, width: 1080, height: 1920, frameRate: 30 });
    workspace = await services.workspace.create(); const assetPaths: Record<string, string> = {};
    for (const asset of assets) {
      if (!Buffer.isBuffer(asset.bytes) || asset.bytes.length !== asset.byteLength) throw new RenderingPhaseTwoFailure('asset_invalid');
      assetPaths[asset.logicalId] = await services.workspace.writeTrustedFile(workspace, 'inputs', `${asset.logicalId}.bin`, asset.bytes);
    }
    await services.workspace.writeTrustedFile(workspace, 'text', 'subtitles.srt', srt.bytes());
    const textPaths: string[] = [];
    for (const [index, cue] of input.phaseOne.manifest.subtitles.canonicalCues.entries()) {
      textPaths.push(await services.workspace.writeTrustedFile(workspace, 'text', `cue-${String(index + 1).padStart(2, '0')}.txt`, Buffer.from(cue.lines.join('\n'), 'utf8')));
    }
    await services.workspace.revalidate(workspace);
    const videoInspections: Record<string, TrustedInputVideoInspection> = {};
    for (const asset of assets) {
      if (asset.kind !== 'video') continue;
      const issuedPath = assetPaths[asset.logicalId]!;
      await services.workspace.validateIssuedFile(workspace, issuedPath);
      videoInspections[asset.logicalId] = await TrustedInputVideoInspection.inspect(services.inspector, issuedPath);
    }
    const resolution = { executablePath: verified.executablePath,
      fontPath: verified.fontPath, assetPaths, subtitleTextFilePaths: textPaths,
      outputMp4Path: workspace.outputMp4Path, outputSrtPath: workspace.outputSrtPath, videoInspections };
    const assertPath = (value: string): void => {
      if (value === verified.executablePath || value === verified.fontPath) return; services.workspace.assertIssued(workspace!, value);
    };
    const resolved = resolveExecutionManifest(command.logicalManifest, resolution, assertPath);
    if (trust === 'trusted_local_reference') { fixtureResolvedExecutions.add(resolved); runtime.authorizeTrustedLocalResolvedExecution(composition, resolved); }
    await services.workspace.revalidate(workspace); const processResult = await services.processRunner.run(resolved);
    if (processResult.exitCode !== 0) throw new RenderingPhaseTwoFailure('process_failed');
    successfulResult = await completeRenderedFixture({ outputPath: workspace.outputMp4Path,
      expectedDuration: input.phaseOne.manifest.output.targetDurationSeconds,
      validateIssued: () => services.workspace.validateIssuedFile(workspace!, workspace!.outputMp4Path),
      inspect: () => getTrustedMediaInspector(services.inspector).inspect(workspace!.outputMp4Path),
      buildResult: (artifact, inspection) => deepFreeze({ resultKind: 'deterministic_render_fixture', productionEligibility: 'prohibited',
        sourcePackageId: input.phaseOne.sourcePackageId, sourcePackageRevisionHash: input.phaseOne.sourcePackageRevisionHash,
        canonicalRenderIdentity: input.phaseOne.canonicalRenderIdentity, commandManifestSha256: command.commandManifestSha256,
        artifactSha256: artifact.sha256, subtitleSidecarSha256: srt.sha256, outputDurationSeconds: inspection.durationSeconds,
        resolution: '1080x1920', frameRate: 30, fixtureStatus: 'rendered', referenceEnvironmentId: verified.referenceEnvironmentId,
        executionTrust: verified.executionTrust }),
      retain: trust === 'trusted_local_reference' ? (artifact, inspection, result) =>
        retainFirstControlledEvidence(workspace!.outputMp4Path, artifact, inspection, result, verified.fontSha256) : undefined });
    return successfulResult;
  }, async () => { if (workspace) await services.workspace.cleanup(workspace); },
  () => { if (slotAcquired) services.workspace.releaseRenderSlot(); });
}
async function executeProductionFixtureLifecycle<T>(run: () => Promise<T>, cleanup: () => Promise<void>, release: () => void): Promise<T> {
  let primaryFailure: unknown; let successful = false;
  try { const result = await run(); successful = true; return result; }
  catch (error) { primaryFailure = error; if (error instanceof RenderingPhaseTwoFailure) throw error;
    throw new RenderingPhaseTwoFailure('local_validation'); }
  finally {
    try { await cleanup(); } catch {
      // Cleanup is operational-only: never replace a primary failure or mutate a successful fixture result.
      if (!primaryFailure && !successful) throw new RenderingPhaseTwoFailure('cleanup_failed');
    }
    release();
  }
}
function validateFirstControlledAssets(assets: readonly FixtureAssetInput[]): void {
  validateFirstControlledDigests(assets.map((asset) => ({ logicalId: asset.logicalId,
    sha256: createHash('sha256').update(asset.bytes).digest('hex') })));
}
function validateFirstControlledDigests(value: readonly Readonly<{ logicalId: string; sha256: string }>[]): void {
  if (!Array.isArray(value) || value.length !== 3 || new Set(value.map((item) => item.logicalId)).size !== 3) throw new RenderingPhaseTwoFailure('asset_invalid');
  for (const item of value) { const expected = FIRST_FIXTURE_HASHES[item.logicalId as keyof typeof FIRST_FIXTURE_HASHES];
    if (!expected || item.sha256 !== expected) throw new RenderingPhaseTwoFailure('asset_invalid'); }
}
interface RenderCompletionContext {
  readonly outputPath: string; readonly expectedDuration: number; readonly events?: string[];
  readonly validateIssued: () => Promise<void>;
  readonly inspect: () => Promise<Awaited<ReturnType<ReturnType<typeof getTrustedMediaInspector>['inspect']>>>;
  readonly buildResult: (artifact: { readonly byteLength: number; readonly sha256: string },
    inspection: Awaited<ReturnType<ReturnType<typeof getTrustedMediaInspector>['inspect']>>) => DeterministicRenderFixtureResult;
  readonly retain?: (artifact: { readonly byteLength: number; readonly sha256: string },
    inspection: Awaited<ReturnType<ReturnType<typeof getTrustedMediaInspector>['inspect']>>,
    result: DeterministicRenderFixtureResult) => Promise<void>;
}
async function completeRenderedFixture(context: RenderCompletionContext): Promise<DeterministicRenderFixtureResult> {
  await context.validateIssued(); const artifact = await hashBoundedArtifact(context.outputPath); context.events?.push('hash');
  await context.validateIssued(); context.events?.push('inspect'); let inspection;
  try { inspection = await context.inspect(); }
  catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('output_invalid'); }
  context.events?.push('validate'); validateInspection(inspection, context.expectedDuration, artifact.byteLength);
  const result = context.buildResult(artifact, inspection);
  if (context.retain) { context.events?.push('retain'); await context.retain(artifact, inspection, result); }
  return result;
}
function testInspection(byteLength: number): Awaited<ReturnType<ReturnType<typeof getTrustedMediaInspector>['inspect']>> {
  return Object.freeze({ container: 'mp4', formatName: 'mov,mp4,m4a,3gp,3g2,mj2', byteLength, width: 1080, height: 1920,
    frameRate: 30, constantFrameRate: true, durationSeconds: 30, streams: ['video', 'audio'] as const, streamIndexes: [0, 1] as const,
    videoCodecFamily: 'h264', videoProfile: 'Constrained Baseline', videoLevel: 42, pixelFormat: 'yuv420p', videoDurationSeconds: 30,
    audioCodecFamily: 'aac', audioProfile: 'LC', audioSampleRate: 48000, audioChannels: 2, audioDurationSeconds: 30 });
}
function testFixtureResult(artifactSha256: string): DeterministicRenderFixtureResult {
  return Object.freeze({ resultKind: 'deterministic_render_fixture', productionEligibility: 'prohibited', sourcePackageId: 'a'.repeat(64),
    sourcePackageRevisionHash: 'b'.repeat(64), canonicalRenderIdentity: 'c'.repeat(64), commandManifestSha256: 'd'.repeat(64),
    artifactSha256, subtitleSidecarSha256: 'e'.repeat(64), outputDurationSeconds: 30, resolution: '1080x1920', frameRate: 30,
    fixtureStatus: 'rendered', referenceEnvironmentId: 'f'.repeat(64), executionTrust: 'test_only' });
}
async function retainFirstControlledEvidence(sourcePath: string, artifact: { readonly byteLength: number; readonly sha256: string },
  inspection: Awaited<ReturnType<ReturnType<typeof getTrustedMediaInspector>['inspect']>>,
  result: DeterministicRenderFixtureResult, fontSha256: string, evidenceRoot = EVIDENCE_ROOT): Promise<void> {
  let createdRoot = false;
  try {
    const bytes = await readFile(sourcePath);
    if (bytes.length !== artifact.byteLength || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error();
    const evidence = Buffer.from(`${JSON.stringify({ schemaVersion: 1, referenceEnvironmentId: result.referenceEnvironmentId,
      sourcePackageId: result.sourcePackageId, sourcePackageRevisionHash: result.sourcePackageRevisionHash,
      canonicalRenderIdentity: result.canonicalRenderIdentity, fixtureMediaSha256: FIRST_FIXTURE_HASHES,
      staticFontSha256: fontSha256, metricHelperSha256: '82f5cf116ef6d0434809acf607b24784987a536a2111f212a7aa9d9357c44e11',
      ffmpegSha256: '47f90e890b4fd06605f708791b3b6f3635c0ac65af001936e7bf364f8e25d089',
      ffprobeSha256: '256459de6566608a65f4d1b6e42ea3cdac39ad472e69baafdca103252bdfb228',
      codecContract: PHASE_TWO_TOOLCHAIN_PROFILE, verifiedOutput: inspection, mp4ByteLength: artifact.byteLength,
      mp4Sha256: artifact.sha256, productionEligibility: 'prohibited', publishingPerformed: false })}\n`, 'utf8');
    if (evidence.length > 64 * 1024) throw new Error();
    const evidenceParent = path.dirname(evidenceRoot); await mkdir(evidenceParent, { recursive: true }); const parent = await realpath(evidenceParent);
    if (path.resolve(parent) !== path.resolve(evidenceParent)) throw new Error();
    try { await mkdir(evidenceRoot); createdRoot = true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const rootInfo = await lstat(evidenceRoot); if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() ||
      path.resolve(await realpath(evidenceRoot)) !== path.resolve(evidenceRoot)) throw new Error();
    const mp4Path = path.join(evidenceRoot, 'fixture.mp4'); const jsonPath = path.join(evidenceRoot, 'verification.json');
    if (createdRoot) { await writeFile(mp4Path, bytes, { flag: 'wx', mode: 0o400 }); await writeFile(jsonPath, evidence, { flag: 'wx', mode: 0o400 }); }
    else {
      const [existingMp4, existingEvidence] = await Promise.all([readOrdinaryEvidenceFile(mp4Path), readOrdinaryEvidenceFile(jsonPath)]);
      if (!existingMp4.equals(bytes) || !existingEvidence.equals(evidence)) throw new Error();
    }
    const retained = await readOrdinaryEvidenceFile(mp4Path);
    if (retained.length !== artifact.byteLength || createHash('sha256').update(retained).digest('hex') !== artifact.sha256) throw new Error();
  } catch {
    if (createdRoot) await rm(evidenceRoot, { recursive: true, force: true }).catch(() => undefined);
    throw new RenderingPhaseTwoFailure('workspace_invalid');
  }
}
async function readOrdinaryEvidenceFile(filePath: string): Promise<Buffer> {
  const info = await lstat(filePath); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size <= 0 ||
    info.size > PHASE_TWO_RESOURCE_LIMITS.maximumOutputBytes || path.resolve(await realpath(filePath)) !== path.resolve(filePath)) throw new Error();
  const bytes = await readFile(filePath); if (bytes.length !== info.size) throw new Error(); return bytes;
}
function validateAssets(phaseOne: DeterministicRenderDryRunResult, assets: readonly FixtureAssetInput[]): void {
  const required = phaseOne.manifest.timeline.scenes.flatMap((scene) => scene.assetOccurrences.map((item) => item.assetId));
  const uniqueRequired = [...new Set(required)]; const visual = assets.filter((asset) => asset.kind !== 'audio').map((asset) => asset.logicalId);
  const audio = assets.filter((asset) => asset.kind === 'audio');
  if (audio.length !== 1 || visual.length !== uniqueRequired.length || uniqueRequired.some((id) => !visual.includes(id)) ||
      visual.some((id) => !uniqueRequired.includes(id)) || new Set(assets.map((asset) => asset.logicalId)).size !== assets.length) {
    throw new RenderingPhaseTwoFailure('asset_invalid');
  }
}
function detachSafeAssets(value: unknown): readonly FixtureAssetInput[] {
  if (!plainDataObject(value)) throw new RenderingPhaseTwoFailure('local_validation');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (!exactEnumerableData(descriptors, ['phaseOne', 'assets']) || !Array.isArray(descriptors.assets!.value)) throw new RenderingPhaseTwoFailure('local_validation');
  const source = descriptors.assets!.value as unknown[];
  if (Object.getPrototypeOf(source) !== Array.prototype || Object.getOwnPropertySymbols(source).length !== 0) throw new RenderingPhaseTwoFailure('asset_invalid');
  const arrayDescriptors = Object.getOwnPropertyDescriptors(source) as unknown as PropertyDescriptorMap; const length = arrayDescriptors['length'];
  if (!length || !('value' in length) || !Number.isSafeInteger(length.value) || length.value < 0 || length.enumerable || length.configurable)
    throw new RenderingPhaseTwoFailure('asset_invalid');
  const expectedKeys = Array.from({ length: length.value as number }, (_, index) => String(index));
  if (Object.keys(arrayDescriptors).length !== expectedKeys.length + 1 || expectedKeys.some((key) => {
    const descriptor = arrayDescriptors[key]; return !descriptor || !descriptor.enumerable || !('value' in descriptor);
  })) throw new RenderingPhaseTwoFailure('asset_invalid');
  const detached: FixtureAssetInput[] = [];
  for (const key of expectedKeys) {
    const asset = arrayDescriptors[key]!.value;
    if (!plainDataObject(asset)) throw new RenderingPhaseTwoFailure('asset_invalid');
    const item = Object.getOwnPropertyDescriptors(asset); const allowed = ['logicalId', 'kind', 'byteLength', 'bytes', 'durationSeconds'];
    if (!Object.keys(item).every((key) => allowed.includes(key)) || !['logicalId', 'kind', 'byteLength', 'bytes'].every((key) => key in item) ||
      Object.values(item).some((entry) => !entry.enumerable || !('value' in entry))) throw new RenderingPhaseTwoFailure('asset_invalid');
    const logicalId = item.logicalId!.value; const kind = item.kind!.value; const byteLength = item.byteLength!.value;
    const bytes = item.bytes!.value; const durationSeconds = item.durationSeconds?.value;
    if (typeof logicalId !== 'string' || !['image', 'video', 'audio'].includes(kind) || !Number.isSafeInteger(byteLength) || byteLength < 0 ||
        !Buffer.isBuffer(bytes) || (durationSeconds !== undefined && (!Number.isSafeInteger(durationSeconds) || durationSeconds < 0)))
      throw new RenderingPhaseTwoFailure('asset_invalid');
    detached.push(durationSeconds === undefined ? Object.freeze({ logicalId, kind, byteLength, bytes: Buffer.from(bytes) }) :
      Object.freeze({ logicalId, kind, byteLength, bytes: Buffer.from(bytes), durationSeconds }));
  }
  return Object.freeze(detached);
}
function validateJsonData(value: unknown, active = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value !== 'object' || Object.getOwnPropertySymbols(value).length !== 0 || active.has(value)) throw new RenderingPhaseTwoFailure('local_validation');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new RenderingPhaseTwoFailure('local_validation');
  active.add(value); const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) { if (Array.isArray(value) && key === 'length') continue;
    if (!descriptor.enumerable || !('value' in descriptor)) throw new RenderingPhaseTwoFailure('local_validation'); validateJsonData(descriptor.value, active); }
  active.delete(value);
}
function plainDataObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null &&
  Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0; }
function exactEnumerableData(descriptors: PropertyDescriptorMap, keys: readonly string[]): boolean { return Object.keys(descriptors).length === keys.length &&
  keys.every((key) => key in descriptors) && Object.values(descriptors).every((entry) => entry.enumerable && 'value' in entry); }
async function hashBoundedArtifact(filePath: string): Promise<{ readonly byteLength: number; readonly sha256: string }> {
  try {
    const info = await stat(filePath); if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size <= 0 ||
      info.size > PHASE_TWO_RESOURCE_LIMITS.maximumOutputBytes) throw new RenderingPhaseTwoFailure('resource_limit_exceeded');
    const hash = createHash('sha256'); let consumed = 0;
    await new Promise<void>((resolve, reject) => { const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
      stream.on('data', (chunk: string | Buffer) => { const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        consumed += bytes.length; if (consumed > PHASE_TWO_RESOURCE_LIMITS.maximumOutputBytes || consumed > info.size) {
          stream.destroy(new Error()); return; } hash.update(bytes); }); stream.once('end', resolve); stream.once('error', reject); });
    if (consumed !== info.size) throw new RenderingPhaseTwoFailure('artifact_hash_failed');
    const sha256 = hash.digest('hex'); if (!isSha256(sha256)) throw new RenderingPhaseTwoFailure('artifact_hash_failed');
    return Object.freeze({ byteLength: consumed, sha256 });
  } catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('artifact_hash_failed'); }
}
function validatePhaseOne(value: DeterministicRenderDryRunResult): void {
  validateJsonData(value);
  if (!value || value.resultKind !== 'deterministic_render_dry_run' || value.productionEligibility !== 'prohibited' ||
      value.validationResult !== 'valid' || !isSha256(value.sourcePackageId) || !isSha256(value.sourcePackageRevisionHash) ||
      !isSha256(value.canonicalRenderIdentity) || !value.manifest || !Array.isArray(value.manifest.timeline?.scenes) ||
      !Array.isArray(value.manifest.subtitles?.canonicalCues) || !value.manifest.output ||
      value.manifest.timeline.scenes.some((scene) => !scene || !Array.isArray(scene.assetOccurrences)) ||
      value.manifest.subtitles.canonicalCues.some((cue) => !cue || !Array.isArray(cue.lines))) throw new RenderingPhaseTwoFailure('local_validation');
}
function validateInspection(value: Awaited<ReturnType<ReturnType<typeof getTrustedMediaInspector>['inspect']>>,
  expectedDuration: number, byteLength: number): void {
  if (!value || value.container !== 'mp4' || value.formatName !== 'mov,mp4,m4a,3gp,3g2,mj2' ||
      !Number.isSafeInteger(value.byteLength) || value.byteLength <= 0 || value.byteLength !== byteLength || value.width !== 1080 || value.height !== 1920 ||
      value.frameRate !== 30 || value.constantFrameRate !== true || value.durationSeconds !== expectedDuration ||
      value.videoDurationSeconds !== expectedDuration || value.audioDurationSeconds !== expectedDuration ||
      value.videoCodecFamily !== 'h264' || value.videoProfile !== 'Constrained Baseline' || value.videoLevel !== 42 ||
      value.pixelFormat !== 'yuv420p' || value.audioCodecFamily !== 'aac' || value.audioProfile !== 'LC' ||
      value.audioSampleRate !== 48000 || value.audioChannels !== 2 || !Array.isArray(value.streams) || !Array.isArray(value.streamIndexes) ||
      value.streams.length !== 2 || value.streams[0] !== 'video' || value.streams[1] !== 'audio' ||
      value.streamIndexes.length !== 2 || value.streamIndexes[0] !== 0 || value.streamIndexes[1] !== 1) throw new RenderingPhaseTwoFailure('output_invalid');
}
