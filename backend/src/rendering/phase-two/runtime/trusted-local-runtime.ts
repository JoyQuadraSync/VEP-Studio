import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { Readable } from 'node:stream';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { statfsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RenderingPhaseTwoFailure } from '../failures/rendering-phase-two-failure';
import { PHASE_TWO_BUILD_CONFIGURATION, PHASE_TWO_HARFBUZZ_PROFILE, PHASE_TWO_TOOLCHAIN_PROFILE,
  TrustedPhaseTwoEnvironment, VerifiedToolchain } from '../toolchain/toolchain-profile';
import { TrustedMediaInspector } from '../inspection/media-inspector';
import { TrustedFontCoverage, TrustedSubtitleLayoutCapability } from '../subtitles/subtitle-boundary';
import { FixtureWorkspaceResolver } from '../workspace/fixture-workspace';
import { NodeFfmpegProcessRunner } from '../process/ffmpeg-process-runner';
import { TrustedPhaseTwoFixtureComposition } from '../fixture/deterministic-render-fixture';

const lineages = new WeakMap<object, object>();
const verifiedEnvironments = new WeakMap<object, VerifiedToolchain>();
const trustedResolved = new WeakMap<object, object>();
type ArtifactObserver = (filePath: string, expected: string) => Promise<string>;
const finalConsumptionTestObservers = new WeakMap<object, ArtifactObserver>();

export function isTrustedLocalCapability(value: unknown): boolean { return typeof value === 'object' && value !== null && lineages.has(value); }
export function trustedLocalVerifiedEnvironment(value: unknown): VerifiedToolchain | undefined {
  return typeof value === 'object' && value !== null ? verifiedEnvironments.get(value) : undefined;
}
export function assertTrustedLocalComposition(value: unknown, services: readonly unknown[]): void {
  if (typeof value !== 'object' || value === null) throw new RenderingPhaseTwoFailure('toolchain_invalid');
  const lineage = lineages.get(value); if (!lineage || services.some((service) => typeof service !== 'object' || service === null || lineages.get(service) !== lineage))
    throw new RenderingPhaseTwoFailure('toolchain_invalid');
}
export function authorizeTrustedLocalResolvedExecution(composition: unknown, resolved: object): void {
  if (typeof composition !== 'object' || composition === null) throw new RenderingPhaseTwoFailure('process_failed');
  const lineage = lineages.get(composition); if (!lineage) throw new RenderingPhaseTwoFailure('process_failed');
  const command = require('../command/ffmpeg-command-manifest') as { isTestOnlyResolvedExecutionInternal(value: unknown): boolean };
  const fixture = require('../fixture/deterministic-render-fixture') as { isFixtureResolvedExecutionInternal(value: unknown): boolean };
  const candidate = resolved as { executablePath?: unknown; inputPaths?: unknown; outputPaths?: unknown; args?: unknown };
  const workspaceRoot = path.join(ROOT, 'runtime', 'phase-two-workspaces');
  const contained = (value: unknown): boolean => typeof value === 'string' && path.resolve(value).startsWith(`${path.resolve(workspaceRoot)}${path.sep}`);
  if (!command.isTestOnlyResolvedExecutionInternal(resolved) || !fixture.isFixtureResolvedExecutionInternal(resolved) ||
      candidate.executablePath !== PATHS.ffmpeg || !Array.isArray(candidate.inputPaths) ||
      !Array.isArray(candidate.outputPaths) || !Array.isArray(candidate.args) || candidate.outputPaths.length !== 2 ||
      candidate.inputPaths.some((item) => item !== PATHS.font && !contained(item)) || candidate.outputPaths.some((item) => !contained(item)) ||
      candidate.args.at(-1) !== candidate.outputPaths[0]) throw new RenderingPhaseTwoFailure('process_failed');
  trustedResolved.set(resolved, lineage);
}
export function isTrustedLocalResolvedExecution(value: unknown): boolean { return typeof value === 'object' && value !== null && trustedResolved.has(value); }
export async function revalidateTrustedCompositionForRender(value: unknown): Promise<void> {
  if (typeof value !== 'object' || value === null || !lineages.has(value)) throw new RenderingPhaseTwoFailure('toolchain_invalid');
  try { await Promise.all([observe(PATHS.ffmpeg, HASHES.ffmpeg), observe(PATHS.ffprobe, HASHES.ffprobe), observe(PATHS.freetype, HASHES.freetype),
    observe(PATHS.harfbuzz, HASHES.harfbuzz), observe(PATHS.openh264, HASHES.openh264), observe(PATHS.sourceFont, HASHES.sourceFont),
    observe(PATHS.font, HASHES.font), observe(PATHS.fontMetrics, HASHES.fontMetrics)]); }
  catch { throw new RenderingPhaseTwoFailure('toolchain_invalid'); }
}
export async function revalidateTrustedExecutionForConsumption(value: unknown): Promise<void> {
  if (!isTrustedLocalResolvedExecution(value) || (value as { executablePath?: unknown }).executablePath !== PATHS.ffmpeg)
    throw new RenderingPhaseTwoFailure('process_failed');
  const observeArtifact = finalConsumptionTestObservers.get(value as object) ?? observe;
  try { await observeArtifact(PATHS.ffmpeg, HASHES.ffmpeg); } catch { throw new RenderingPhaseTwoFailure('process_failed'); }
  try { await observeArtifact(PATHS.font, HASHES.font); } catch { throw new RenderingPhaseTwoFailure('font_invalid'); }
}
/** Closed, side-effect-free ordering harness. It returns no authority, path, hash, callback, or trusted object. */
export async function exerciseFinalConsumptionBoundaryForTestOnly(scenario: unknown): Promise<Readonly<{
  outcome: 'accepted' | 'font_invalid'; processInvocationCount: 0 | 1 }>> {
  if (scenario !== 'unchanged_font' && scenario !== 'replaced_font') throw new RenderingPhaseTwoFailure('process_failed');
  const lineage = Object.freeze({}); const resolved = Object.freeze({ executablePath: PATHS.ffmpeg });
  trustedResolved.set(resolved, lineage); let processInvocationCount: 0 | 1 = 0;
  const invokeControlledProcessAdapter = (): void => { processInvocationCount = 1; };
  finalConsumptionTestObservers.set(resolved, async (filePath, expected) => {
    if (scenario === 'replaced_font' && filePath === PATHS.font) throw new Error(); return expected;
  });
  try { await revalidateTrustedExecutionForConsumption(resolved); invokeControlledProcessAdapter();
    return Object.freeze({ outcome: 'accepted', processInvocationCount });
  } catch (error) { if (error instanceof RenderingPhaseTwoFailure && error.code === 'font_invalid')
    return Object.freeze({ outcome: 'font_invalid', processInvocationCount }); throw error;
  } finally { finalConsumptionTestObservers.delete(resolved); trustedResolved.delete(resolved); }
}
export function verifyLineageIsolationForTestOnly(): boolean { const first = Object.freeze({}); const second = Object.freeze({});
  const metricOne = TrustedSubtitleLayoutCapability.createTestOnly(HASHES.font, { measureBlock: () =>
    ({ glyphCoverage: true, widthPx: 1, heightPx: 1, lineCount: 1 }) });
  const metricTwo = TrustedSubtitleLayoutCapability.createTestOnly(HASHES.font, { measureBlock: () =>
    ({ glyphCoverage: true, widthPx: 1, heightPx: 1, lineCount: 1 }) });
  const compositionOne = Object.freeze({}); lineages.set(compositionOne, first); lineages.set(metricOne, first); lineages.set(metricTwo, second);
  try { assertTrustedLocalComposition(compositionOne, [metricOne]); assertTrustedLocalComposition(compositionOne, [metricTwo]); return false; }
  catch (error) { return error instanceof RenderingPhaseTwoFailure; } }
export function validateRuntimeCapabilityOutputForTestOnly(version: string, buildconf: string, encoders: string, filters: string,
  muxers: string, protocols: string, probe: string): void { validateRuntime(version, buildconf, encoders, filters, muxers, protocols, probe); }
export async function hashChunksForTestOnly(chunks: readonly Buffer[], declaredSize: number): Promise<string> {
  try { return await hashReadable(Readable.from(chunks), declaredSize, MAX_ARTIFACT_BYTES); }
  catch { throw new RenderingPhaseTwoFailure('toolchain_invalid'); } }

const ROOT = 'C:\\Users\\Jiayi\\AppData\\Local\\VEP-Studio\\toolchain';
const FFMPEG_ROOT = path.join(ROOT, 'install', 'ffmpeg', '8.1.2');
const PREFIX = path.join(ROOT, 'install', 'dependencies');
const PATHS = Object.freeze({
  ffmpeg: path.join(FFMPEG_ROOT, 'bin', 'ffmpeg.exe'), ffprobe: path.join(FFMPEG_ROOT, 'bin', 'ffprobe.exe'),
  freetype: path.join(PREFIX, 'lib', 'libfreetype.a'), harfbuzz: path.join(PREFIX, 'lib', 'libharfbuzz.a'),
  openh264: path.join(PREFIX, 'lib', 'libopenh264.a'),
  freetypeHeader: path.join(PREFIX, 'include', 'freetype2', 'freetype', 'freetype.h'),
  harfbuzzPc: path.join(PREFIX, 'lib', 'pkgconfig', 'harfbuzz.pc'), openh264Header: path.join(PREFIX, 'include', 'wels', 'codec_ver.h'),
  sourceFont: path.join(ROOT, 'sources', 'NotoSans-v2.015', 'NotoSans', 'googlefonts', 'variable-ttf', 'NotoSans[wdth,wght].ttf'),
  font: path.join(ROOT, 'install', 'fonts', 'NotoSans-wght700-wdth100.ttf'),
  fontMetrics: path.join(ROOT, 'install', 'metrics', 'frozen-font-metrics.exe')
});
const HASHES = Object.freeze({ ffmpeg: '47f90e890b4fd06605f708791b3b6f3635c0ac65af001936e7bf364f8e25d089',
  ffprobe: '256459de6566608a65f4d1b6e42ea3cdac39ad472e69baafdca103252bdfb228',
  freetype: '4c7336efdb382de3513e2532b547d5f747bd6660a37905737d0e6f7655173537',
  harfbuzz: 'bb764b49def39b96640b81f136f8df0fec46bac9a2109b95dd9da0d66ca5fef3',
  openh264: '4f74bc5e8f8b18ae3816aef71748175131a2a17d82099742fb4284bee05b0037',
  sourceFont: 'bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d',
  font: '3a08a47daa00cade516425c15c57615aef2fd418ec9811a7b9f465088f92cc05',
  fontMetrics: '82f5cf116ef6d0434809acf607b24784987a536a2111f212a7aa9d9357c44e11' });
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024; const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface TrustedLocalPreflight { readonly environment: TrustedPhaseTwoEnvironment;
  readonly composition: TrustedPhaseTwoFixtureComposition; readonly verified: true }
interface TrustedLocalObservation {
  readonly hashes: typeof HASHES; readonly ffmpegVersion: string; readonly ffprobeVersion: string;
  readonly buildConfiguration: readonly string[]; readonly capabilities: readonly string[];
  readonly ordinaryArtifacts: boolean; readonly unexpectedConfiguration: boolean;
}
export function parseFrozenFontMetricOutputForTestOnly(value: unknown): Readonly<{
  glyphCoverage: boolean; widthPx: number; heightPx: number; lineCount: 1 | 2 }> { return parseFrozenFontMetricOutput(value); }
/** Closed, side-effect-free helper-ordering harness. It cannot access files, spawn a process, or issue provenance. */
export function exerciseMetricHelperIdentityBoundaryForTestOnly(scenario: unknown): Readonly<{
  outcome: 'accepted' | 'font_invalid'; helperInvocationCount: 0 | 1 }> {
  if (scenario !== 'correct_hash' && scenario !== 'wrong_hash') throw new RenderingPhaseTwoFailure('font_invalid');
  let helperInvocationCount: 0 | 1 = 0;
  try { runFrozenFontMetricsWith(['AV'], (filePath, expected) => {
      if (scenario === 'wrong_hash' && filePath === PATHS.fontMetrics) throw new Error(); return expected;
    }, () => { helperInvocationCount = 1; return Object.freeze({ error: undefined, signal: null, status: 0,
        stderr: '', stdout: 'VEP_FONT_METRIC_V1\t1\t84\t46\t1\n' }); });
    return Object.freeze({ outcome: 'accepted', helperInvocationCount });
  } catch (error) { if (error instanceof RenderingPhaseTwoFailure && error.code === 'font_invalid')
    return Object.freeze({ outcome: 'font_invalid', helperInvocationCount }); throw error; }
}
const REQUIRED_CAPABILITIES = Object.freeze(['libopenh264', 'aac', 'drawtext', 'scale', 'pad', 'trim', 'setpts', 'concat',
  'atrim', 'apad', 'asetpts', 'mp4', 'file', 'pipe']);

/** Pure rejected-variant seam. It validates evidence only and never issues runtime provenance. */
export function validateTrustedLocalObservationForTestOnly(value: unknown): Readonly<{ validated: true }> {
  const observation = detachObservation(value);
  if (!observation.ordinaryArtifacts || observation.unexpectedConfiguration || observation.ffmpegVersion !== '8.1.2' ||
      observation.ffprobeVersion !== '8.1.2' || JSON.stringify(observation.buildConfiguration) !== JSON.stringify(PHASE_TWO_BUILD_CONFIGURATION) ||
      REQUIRED_CAPABILITIES.some((item) => !observation.capabilities.includes(item)) || observation.capabilities.some((item) => !REQUIRED_CAPABILITIES.includes(item)))
    throw new RenderingPhaseTwoFailure('toolchain_invalid');
  for (const key of Object.keys(HASHES) as (keyof typeof HASHES)[]) if (observation.hashes[key] !== HASHES[key])
    throw new RenderingPhaseTwoFailure(key === 'font' || key === 'sourceFont' ? 'font_invalid' : 'toolchain_invalid');
  return Object.freeze({ validated: true });
}

/** The sole trusted-local entrypoint. It accepts no trust material and never renders media. */
export async function establishTrustedLocalRuntime(): Promise<TrustedLocalPreflight> {
  try {
    const lineage = Object.freeze({});
    const hashes = { ffmpegBinarySha256: await observe(PATHS.ffmpeg, HASHES.ffmpeg),
      ffprobeBinarySha256: await observe(PATHS.ffprobe, HASHES.ffprobe),
      freeTypeBinarySha256: await observe(PATHS.freetype, HASHES.freetype),
      harfBuzzBinarySha256: await observe(PATHS.harfbuzz, HASHES.harfbuzz),
      openH264BinarySha256: await observe(PATHS.openh264, HASHES.openh264),
      sourceVariableFontSha256: await observe(PATHS.sourceFont, HASHES.sourceFont), fontSha256: await observe(PATHS.font, HASHES.font) };
    await observe(PATHS.fontMetrics, HASHES.fontMetrics);
    const [version, buildconf, encoders, filters, muxers, protocols, probeVersion] = await Promise.all([
      run(PATHS.ffmpeg, ['-version']), run(PATHS.ffmpeg, ['-buildconf']), run(PATHS.ffmpeg, ['-encoders']),
      run(PATHS.ffmpeg, ['-filters']), run(PATHS.ffmpeg, ['-muxers']), run(PATHS.ffmpeg, ['-protocols']), run(PATHS.ffprobe, ['-version'])]);
    validateRuntime(version, buildconf, encoders, filters, muxers, protocols, probeVersion);
    validateTrustedLocalObservationForTestOnly({ hashes: { ffmpeg: hashes.ffmpegBinarySha256, ffprobe: hashes.ffprobeBinarySha256,
      freetype: hashes.freeTypeBinarySha256, harfbuzz: hashes.harfBuzzBinarySha256, openh264: hashes.openH264BinarySha256,
      sourceFont: hashes.sourceVariableFontSha256, font: hashes.fontSha256, fontMetrics: HASHES.fontMetrics },
      ffmpegVersion: '8.1.2', ffprobeVersion: '8.1.2', buildConfiguration: [...PHASE_TWO_BUILD_CONFIGURATION],
      capabilities: [...REQUIRED_CAPABILITIES], ordinaryArtifacts: true, unexpectedConfiguration: false });
    await validateDependencyIdentities(); await validateFontIdentity();
    // Close the establishment window: re-observe every security-relevant byte immediately before trust issuance.
    await Promise.all([observe(PATHS.ffmpeg, HASHES.ffmpeg), observe(PATHS.ffprobe, HASHES.ffprobe), observe(PATHS.freetype, HASHES.freetype),
      observe(PATHS.harfbuzz, HASHES.harfbuzz), observe(PATHS.openh264, HASHES.openh264), observe(PATHS.sourceFont, HASHES.sourceFont),
      observe(PATHS.font, HASHES.font), observe(PATHS.fontMetrics, HASHES.fontMetrics)]);
    const metadata = { operatingSystemIdentity: `windows-x64-${os.release()}`, ffmpegVersion: '8.1.2',
      openH264Version: '2.6.0', freeTypeVersion: '2.14.3', harfBuzzVersion: '14.2.1',
      harfBuzzBuildIdentity: PHASE_TWO_HARFBUZZ_PROFILE, buildConfiguration: [...PHASE_TWO_BUILD_CONFIGURATION],
      ...hashes, fontMetricBinarySha256: HASHES.fontMetrics, codecConfiguration: PHASE_TWO_TOOLCHAIN_PROFILE };
    const expected = { ...metadata, executionReady: true as const }; const environment = TrustedPhaseTwoEnvironment.createTestOnly(metadata, expected);
    const trustedVerified = Object.freeze({ ...environment.verified, executablePath: PATHS.ffmpeg, fontPath: PATHS.font,
      executionTrust: 'trusted_local_reference' as const }); verifiedEnvironments.set(environment, trustedVerified); lineages.set(environment, lineage);
    const inspector = TrustedMediaInspector.createTestOnly({ inspect: inspectMedia });
    const glyphCoverage = TrustedFontCoverage.createTestOnly(HASHES.font, { supports: supportsFrozenNotoScalar });
    const subtitleLayout = TrustedSubtitleLayoutCapability.createTestOnly(HASHES.font, { measureBlock: measureFrozenNotoBlock });
    const workspace = FixtureWorkspaceResolver.createTestOnly(path.join(ROOT, 'runtime', 'phase-two-workspaces'), measureWorkspace);
    const composition = TrustedPhaseTwoFixtureComposition.createTestOnly({ environment, inspector, glyphCoverage, subtitleLayout, workspace,
      processRunner: new NodeFfmpegProcessRunner() });
    for (const service of [inspector, glyphCoverage, subtitleLayout, workspace, composition]) lineages.set(service, lineage);
    return Object.freeze({ environment, composition, verified: true });
  } catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('toolchain_invalid'); }
}
function measureWorkspace(): { readonly freeWorkspaceBytes: number } { const info = statfsSync(ROOT, { bigint: true });
  const free = info.bavail * info.bsize; return Object.freeze({ freeWorkspaceBytes: free > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(free) }); }
function supportsFrozenNotoScalar(codePoint: number): boolean {
  if (!Number.isSafeInteger(codePoint) || codePoint < 0x20 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return false;
  return runFrozenFontMetrics([String.fromCodePoint(codePoint)]).glyphCoverage;
}
function measureFrozenNotoBlock(lines: readonly string[]): Readonly<{ glyphCoverage: boolean; widthPx: number; heightPx: number; lineCount: 1 | 2 }> {
  return runFrozenFontMetrics(lines);
}
function hasLoneSurrogate(value: string): boolean { for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(index + 1); if (!(next >= 0xdc00 && next <= 0xdfff)) return true; index += 1; }
  else if (code >= 0xdc00 && code <= 0xdfff) return true; } return false; }
function runFrozenFontMetrics(lines: readonly string[]): Readonly<{ glyphCoverage: boolean; widthPx: number; heightPx: number; lineCount: 1 | 2 }> {
  return runFrozenFontMetricsWith(lines, (filePath, expected) => { observeSync(filePath, expected); return expected; }, (input) => {
    const result = spawnSync(PATHS.fontMetrics, [], { shell: false, cwd: path.dirname(PATHS.fontMetrics), windowsHide: true,
      input, encoding: 'utf8', timeout: 5000, maxBuffer: 1024, env: { PATH: '', SystemRoot: 'C:\\Windows' } });
    return Object.freeze({ error: result.error, signal: result.signal, status: result.status, stderr: result.stderr, stdout: result.stdout });
  });
}
function runFrozenFontMetricsWith(lines: readonly string[], observeArtifact: (filePath: string, expected: string) => string,
  invokeHelper: (input: string) => Readonly<{ error: Error | undefined; signal: NodeJS.Signals | null; status: number | null;
    stderr: string; stdout: string }>): Readonly<{ glyphCoverage: boolean; widthPx: number; heightPx: number; lineCount: 1 | 2 }> {
  try {
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 2 || lines.some((line) => typeof line !== 'string' || line.length === 0 ||
        [...line].length > 42 || hasLoneSurrogate(line) || /[\r\n\t\u0000-\u001f]/u.test(line))) throw new Error();
    const input = lines.join('\n'); if (Buffer.byteLength(input, 'utf8') > 512) throw new Error();
    observeArtifact(PATHS.font, HASHES.font); observeArtifact(PATHS.fontMetrics, HASHES.fontMetrics);
    const result = invokeHelper(input);
    if (result.error || result.signal !== null || result.status !== 0 || result.stderr !== '') throw new Error();
    return parseFrozenFontMetricOutput(result.stdout);
  } catch { throw new RenderingPhaseTwoFailure('font_invalid'); }
}
function parseFrozenFontMetricOutput(value: unknown): Readonly<{ glyphCoverage: boolean; widthPx: number; heightPx: number; lineCount: 1 | 2 }> {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 128) throw new RenderingPhaseTwoFailure('font_invalid');
  const match = value.match(/^VEP_FONT_METRIC_V1\t([01])\t(0|[1-9][0-9]{0,3})\t([1-9][0-9]{0,3})\t([12])\r?\n$/u);
  if (!match) throw new RenderingPhaseTwoFailure('font_invalid');
  const widthPx = Number(match[2]); const heightPx = Number(match[3]); const lineCount = Number(match[4]);
  if (!Number.isSafeInteger(widthPx) || !Number.isSafeInteger(heightPx) || widthPx > 4096 || heightPx > 4096 ||
      (lineCount !== 1 && lineCount !== 2)) throw new RenderingPhaseTwoFailure('font_invalid');
  return Object.freeze({ glyphCoverage: match[1] === '1', widthPx, heightPx, lineCount });
}
function observeSync(filePath: string, expected: string): void {
  const info = lstatSync(filePath); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size <= 0 || info.size > MAX_ARTIFACT_BYTES ||
      path.resolve(realpathSync(filePath)) !== path.resolve(filePath)) throw new RenderingPhaseTwoFailure('font_invalid');
  const bytes = readFileSync(filePath); if (bytes.length !== info.size || createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new RenderingPhaseTwoFailure('font_invalid');
}
async function inspectMedia(outputPath: string): Promise<{ container: 'mp4'; byteLength: number; width: number; height: number; frameRate: 30;
  constantFrameRate: true; durationSeconds: number; streams: readonly ['video', 'audio']; videoCodecFamily: 'h264'; audioCodecFamily: 'aac' }> {
  await observe(PATHS.ffprobe, HASHES.ffprobe);
  const output = await run(PATHS.ffprobe, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate',
    '-of', 'json', outputPath]); const parsed = JSON.parse(output) as { format?: { duration?: string; size?: string }; streams?: { codec_type?: string;
      codec_name?: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string }[] };
  const video = parsed.streams?.find((item) => item.codec_type === 'video'); const audio = parsed.streams?.find((item) => item.codec_type === 'audio');
  if (!video || !audio || video.codec_name !== 'h264' || audio.codec_name !== 'aac' || video.width !== 1080 || video.height !== 1920 ||
      video.r_frame_rate !== '30/1' || video.avg_frame_rate !== '30/1') throw new RenderingPhaseTwoFailure('output_invalid');
  return Object.freeze({ container: 'mp4', byteLength: Number(parsed.format?.size), width: 1080, height: 1920, frameRate: 30,
    constantFrameRate: true, durationSeconds: Number(parsed.format?.duration), streams: ['video', 'audio'] as const, videoCodecFamily: 'h264', audioCodecFamily: 'aac' }); }
function detachObservation(value: unknown): TrustedLocalObservation {
  try {
    if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length)
      throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value); const keys = ['hashes', 'ffmpegVersion', 'ffprobeVersion', 'buildConfiguration',
      'capabilities', 'ordinaryArtifacts', 'unexpectedConfiguration'];
    if (Object.keys(descriptors).length !== keys.length || keys.some((key) => !descriptors[key]?.enumerable || !('value' in descriptors[key]!))) throw new Error();
    const hashes = Object.getOwnPropertyDescriptors(descriptors.hashes!.value); const hashKeys = Object.keys(HASHES);
    if (Object.keys(hashes).length !== hashKeys.length || hashKeys.some((key) => !hashes[key]?.enumerable || !('value' in hashes[key]!))) throw new Error();
    const strings = (name: 'buildConfiguration' | 'capabilities'): readonly string[] => {
      const source = descriptors[name]!.value; if (!Array.isArray(source) || Object.getPrototypeOf(source) !== Array.prototype ||
        Object.getOwnPropertySymbols(source).length || source.some((item) => typeof item !== 'string')) throw new Error(); return Object.freeze([...source]); };
    return Object.freeze({ hashes: Object.freeze(Object.fromEntries(hashKeys.map((key) => [key, hashes[key]!.value]))) as typeof HASHES,
      ffmpegVersion: descriptors.ffmpegVersion!.value, ffprobeVersion: descriptors.ffprobeVersion!.value,
      buildConfiguration: strings('buildConfiguration'), capabilities: strings('capabilities'),
      ordinaryArtifacts: descriptors.ordinaryArtifacts!.value, unexpectedConfiguration: descriptors.unexpectedConfiguration!.value });
  } catch { throw new RenderingPhaseTwoFailure('toolchain_invalid'); }
}

async function observe(filePath: string, expected: string): Promise<string> {
  const info = await lstat(filePath); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size <= 0 || info.size > MAX_ARTIFACT_BYTES)
    throw new RenderingPhaseTwoFailure('toolchain_invalid');
  if (path.resolve(await realpath(filePath)) !== path.resolve(filePath)) throw new RenderingPhaseTwoFailure('toolchain_invalid');
  const digest = await hashReadable(createReadStream(filePath, { highWaterMark: 64 * 1024 }), info.size, MAX_ARTIFACT_BYTES);
  if (digest !== expected) throw new RenderingPhaseTwoFailure(filePath === PATHS.font || filePath === PATHS.sourceFont ? 'font_invalid' : 'toolchain_invalid');
  return expected;
}
async function hashReadable(stream: Readable, declaredSize: number, maximum: number): Promise<string> { const hash = createHash('sha256'); let consumed = 0;
  for await (const chunk of stream) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array); consumed += bytes.length;
    if (consumed > declaredSize || consumed > maximum) { stream.destroy(); throw new Error('bounded'); } hash.update(bytes); }
  if (consumed !== declaredSize) throw new Error('bounded'); return hash.digest('hex'); }
async function run(executable: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => { let output = ''; let bytes = 0; let settled = false;
    const child = spawn(executable, [...args], { shell: false, cwd: FFMPEG_ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '', SystemRoot: 'C:\\Windows' } });
    const timer = setTimeout(() => { child.kill(); if (!settled) { settled = true; reject(new RenderingPhaseTwoFailure('toolchain_invalid')); } }, 30000);
    const collect = (chunk: Buffer): void => { bytes += chunk.length; if (bytes > MAX_OUTPUT_BYTES) child.kill(); else output += chunk.toString('utf8'); };
    child.stdout.on('data', collect); child.stderr.on('data', collect); child.once('error', () => { if (!settled) { settled = true; clearTimeout(timer); reject(new RenderingPhaseTwoFailure('toolchain_invalid')); } });
    child.once('close', (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 && bytes <= MAX_OUTPUT_BYTES ? resolve(output) : reject(new RenderingPhaseTwoFailure('toolchain_invalid')); });
  });
}
function validateRuntime(version: string, buildconf: string, encoders: string, filters: string, muxers: string, protocols: string, probe: string): void {
  if (!/^ffmpeg version 8\.1\.2\b/mu.test(version) || !/^ffprobe version 8\.1\.2\b/mu.test(probe)) throw new RenderingPhaseTwoFailure('toolchain_invalid');
  const flags = buildconf.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.startsWith('--'));
  if (JSON.stringify(flags) !== JSON.stringify(PHASE_TWO_BUILD_CONFIGURATION) || /--enable-(?:gpl|nonfree|network|devices|hwaccels|libx264|libx265|libfdk-aac)\b/u.test(buildconf))
    throw new RenderingPhaseTwoFailure('toolchain_invalid');
  const encoderNames = tableNames(encoders, /^[VASD\.]{6}\s+(\S+)\s+/u); const filterNames = tableNames(filters, /^[TSC\.]{3}\s+(\S+)\s+/u);
  const muxerNames = tableNames(muxers, /^[D\. ]?E\s+(\S+)\s+/u); const protocolNames = new Set(protocols.split(/\r?\n/u).map((line) => line.trim())
    .filter((line) => /^[a-z0-9_]+$/u.test(line)));
  for (const name of ['libopenh264', 'aac']) if (!encoderNames.has(name)) throw new RenderingPhaseTwoFailure('toolchain_invalid');
  for (const name of ['drawtext', 'scale', 'pad', 'trim', 'setpts', 'concat', 'atrim', 'apad', 'asetpts']) if (!filterNames.has(name))
    throw new RenderingPhaseTwoFailure('toolchain_invalid');
  if (!muxerNames.has('mp4') || !protocolNames.has('file') || !protocolNames.has('pipe')) throw new RenderingPhaseTwoFailure('toolchain_invalid');
  for (const unexpected of ['libx264', 'libx265', 'libfdk_aac']) if (encoderNames.has(unexpected)) throw new RenderingPhaseTwoFailure('toolchain_invalid');
}
function tableNames(value: string, pattern: RegExp): Set<string> { const names = new Set<string>(); for (const raw of value.split(/\r?\n/u)) {
  const match = raw.trim().match(pattern); if (match?.[1]) names.add(match[1]); } return names; }
async function boundedText(filePath: string): Promise<string> { const value = await readFile(filePath, 'utf8'); if (Buffer.byteLength(value) > 256 * 1024) throw new RenderingPhaseTwoFailure('toolchain_invalid'); return value; }
async function validateDependencyIdentities(): Promise<void> {
  const [ft, hb, oh] = await Promise.all([boundedText(PATHS.freetypeHeader), boundedText(PATHS.harfbuzzPc), boundedText(PATHS.openh264Header)]);
  if (!/FREETYPE_MAJOR\s+2/u.test(ft) || !/FREETYPE_MINOR\s+14/u.test(ft) || !/FREETYPE_PATCH\s+3/u.test(ft) ||
      !/^Version:\s*14\.2\.1\s*$/mu.test(hb) || !/OPENH264_MAJOR\s+\(?2\)?/u.test(oh) || !/OPENH264_MINOR\s+\(?6\)?/u.test(oh) || !/OPENH264_REVISION\s+\(?0\)?/u.test(oh))
    throw new RenderingPhaseTwoFailure('toolchain_invalid');
}
async function validateFontIdentity(): Promise<void> { const bytes = await readFile(PATHS.font); const latin = bytes.toString('latin1');
  if (!latin.includes('NotoSans-Bold') || !latin.includes('Version 2.015') || latin.includes('fvar') || latin.includes('gvar'))
    throw new RenderingPhaseTwoFailure('font_invalid'); }
