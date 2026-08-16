import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
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
export class TrustedPhaseTwoFixtureComposition {
  readonly services: FixtureRenderServices;
  private constructor(services: FixtureRenderServices) { this.services = Object.freeze({ ...services }); compositions.add(this); Object.freeze(this); }
  /** Explicit test seam; it can only produce the prohibited Phase 2 engineering result. */
  static createTestOnly(services: FixtureRenderServices): TrustedPhaseTwoFixtureComposition { return new TrustedPhaseTwoFixtureComposition(services); }
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
  if (verified.executionTrust !== 'test_only' || getMediaInspectorTrust(services.inspector) !== 'test_only') throw new RenderingPhaseTwoFailure('toolchain_invalid');
  if (services.processRunner instanceof NodeFfmpegProcessRunner) throw new RenderingPhaseTwoFailure('toolchain_invalid');
  services.workspace.assertTrusted(); assertTrustedSubtitleLayout(services.subtitleLayout, 'test_only');
  validateSubtitleGlyphCoverage(input.phaseOne.manifest.subtitles.canonicalCues, services.glyphCoverage, verified.fontSha256);
  for (const cue of input.phaseOne.manifest.subtitles.canonicalCues) services.subtitleLayout.verify(cue.lines, verified.fontSha256);
  const srt = buildCanonicalSrt(input.phaseOne.manifest.subtitles.canonicalCues, input.phaseOne.manifest);
  const logicalAssets: LogicalAssetReference[] = assets.map(({ logicalId, kind, durationSeconds }) =>
    durationSeconds === undefined ? { logicalId, kind } : { logicalId, kind, durationSeconds });
  const command = buildLogicalCommandManifest(input.phaseOne.manifest, logicalAssets);
  let workspace: Awaited<ReturnType<FixtureWorkspaceResolver['create']>> | undefined;
  let primaryFailure: unknown; let successfulResult: DeterministicRenderFixtureResult | undefined; let slotAcquired = false;
  try {
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
    const resolved = resolveExecutionManifest(command.logicalManifest, { executablePath: verified.executablePath,
      fontPath: verified.fontPath, assetPaths, subtitleTextFilePaths: textPaths,
      outputMp4Path: workspace.outputMp4Path, outputSrtPath: workspace.outputSrtPath, videoInspections }, (value) => {
      if (value === verified.executablePath || value === verified.fontPath) return; services.workspace.assertIssued(workspace!, value);
    });
    await services.workspace.revalidate(workspace); const processResult = await services.processRunner.run(resolved);
    if (processResult.exitCode !== 0) throw new RenderingPhaseTwoFailure('process_failed');
    await services.workspace.validateIssuedFile(workspace, workspace.outputMp4Path);
    const artifact = await hashBoundedArtifact(workspace.outputMp4Path);
    await services.workspace.validateIssuedFile(workspace, workspace.outputMp4Path);
    let inspection;
    try { inspection = await getTrustedMediaInspector(services.inspector).inspect(workspace.outputMp4Path); }
    catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('output_invalid'); }
    validateInspection(inspection, input.phaseOne.manifest.output.targetDurationSeconds, artifact.byteLength);
    successfulResult = deepFreeze({ resultKind: 'deterministic_render_fixture', productionEligibility: 'prohibited',
      sourcePackageId: input.phaseOne.sourcePackageId, sourcePackageRevisionHash: input.phaseOne.sourcePackageRevisionHash,
      canonicalRenderIdentity: input.phaseOne.canonicalRenderIdentity, commandManifestSha256: command.commandManifestSha256,
      artifactSha256: artifact.sha256, subtitleSidecarSha256: srt.sha256, outputDurationSeconds: inspection.durationSeconds,
      resolution: '1080x1920', frameRate: 30, fixtureStatus: 'rendered', referenceEnvironmentId: verified.referenceEnvironmentId,
      executionTrust: verified.executionTrust });
    return successfulResult;
  } catch (error) { primaryFailure = error; if (error instanceof RenderingPhaseTwoFailure) throw error;
    throw new RenderingPhaseTwoFailure('local_validation');
  } finally {
    if (workspace) { try { await services.workspace.cleanup(workspace); } catch {
      // Cleanup is operational-only: never replace a primary failure or mutate a successful fixture result.
      if (!primaryFailure && !successfulResult) throw new RenderingPhaseTwoFailure('cleanup_failed');
    } }
    if (slotAcquired) services.workspace.releaseRenderSlot();
  }
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
    const info = await stat(filePath); if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0 ||
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
  if (!value || value.container !== 'mp4' || value.byteLength !== byteLength || value.width !== 1080 || value.height !== 1920 ||
      value.frameRate !== 30 || value.constantFrameRate !== true || value.durationSeconds !== expectedDuration ||
      value.videoCodecFamily !== 'h264' || value.audioCodecFamily !== 'aac' || !Array.isArray(value.streams) ||
      value.streams.length !== 2 || value.streams[0] !== 'video' || value.streams[1] !== 'audio') throw new RenderingPhaseTwoFailure('output_invalid');
}
