import { createHash } from 'node:crypto';
import { deepFreeze, isSha256 } from '../contracts/phase-two-contracts';
import { RenderingPhaseTwoFailure } from '../failures/rendering-phase-two-failure';

export const PHASE_TWO_BUILD_CONFIGURATION = Object.freeze([
  '--disable-autodetect', '--disable-gpl', '--disable-nonfree', '--disable-network',
  '--disable-devices', '--disable-hwaccels', '--disable-doc', '--disable-debug', '--disable-ffplay',
  '--disable-libx264', '--disable-libx265', '--disable-libfdk-aac', '--enable-ffmpeg',
  '--enable-ffprobe', '--enable-libopenh264', '--enable-libfreetype', '--enable-libharfbuzz'
] as const);

export const PHASE_TWO_HARFBUZZ_PROFILE = deepFreeze({
  version: '14.2.1', linkage: 'static', freeType: true, glib: false, icu: false, cairo: false,
  graphite2: false, gobject: false, harfRust: false, gpu: false, raster: false, vector: false,
  subset: false, bundledDependencyDownload: false
} as const);

export const PHASE_TWO_TOOLCHAIN_PROFILE = deepFreeze({
  ffmpegVersion: '8.1.2', openH264Version: '2.6.0', freeTypeVersion: '2.14.3', harfBuzzVersion: '14.2.1',
  harfBuzz: PHASE_TWO_HARFBUZZ_PROFILE,
  container: 'mp4', hardwareAcceleration: false, gplEnabled: false, nonfreeEnabled: false,
  video: { codec: 'libopenh264', profile: 'constrained_baseline', level: '4.2', pixelFormat: 'yuv420p',
    width: 1080, height: 1920, frameRate: 30, rateControl: 'cbr', bitrate: 8_000_000,
    maxRate: 8_000_000, bufferSize: 16_000_000, gop: 60, bFrames: 0, threads: 1 },
  audio: { codec: 'aac', profile: 'aac_low', sampleRate: 48_000, channels: 2, bitrate: 192_000 },
  buildConfiguration: PHASE_TWO_BUILD_CONFIGURATION
} as const);

export const PHASE_TWO_FONT_PROFILE = deepFreeze({ family: 'Noto Sans', version: '2.015',
  fileName: 'NotoSans[wdth,wght].ttf', weight: 700, width: 100, fallback: 'prohibited' } as const);

export interface TrustedToolchainMetadata {
  readonly operatingSystemIdentity: string;
  readonly ffmpegVersion: string;
  readonly openH264Version: string;
  readonly freeTypeVersion: string;
  readonly harfBuzzVersion: string;
  readonly harfBuzzBuildIdentity: typeof PHASE_TWO_HARFBUZZ_PROFILE;
  readonly buildConfiguration: readonly string[];
  readonly ffmpegBinarySha256: string;
  readonly openH264BinarySha256: string;
  readonly freeTypeBinarySha256: string;
  readonly harfBuzzBinarySha256: string;
  readonly fontSha256: string;
}
export interface TrustedToolchainExpectations extends TrustedToolchainMetadata { readonly executionReady: true }
export interface VerifiedToolchain {
  readonly profile: typeof PHASE_TWO_TOOLCHAIN_PROFILE;
  readonly font: typeof PHASE_TWO_FONT_PROFILE;
  readonly referenceEnvironmentId: string;
  readonly executablePath: string;
  readonly fontPath: string;
  readonly fontSha256: string;
  readonly executionTrust: 'test_only' | 'trusted_local_reference';
}

const capabilities = new WeakSet<object>();
const TEST_ONLY_EXECUTABLE_PATH = 'C:\\vep-phase-two-test-only\\ffmpeg.exe';
const TEST_ONLY_FONT_PATH = 'C:\\vep-phase-two-test-only\\NotoSans.ttf';
export class TrustedPhaseTwoEnvironment {
  readonly verified: VerifiedToolchain;
  private constructor(verified: VerifiedToolchain) { this.verified = verified; capabilities.add(this); Object.freeze(this); }
  /** Test-only materialization. Production must use an application-owned loader that observes and pins binaries. */
  static createTestOnly(metadata: unknown, expected: unknown): TrustedPhaseTwoEnvironment {
    return new TrustedPhaseTwoEnvironment(verifyObservedToolchain(metadata, expected,
      TEST_ONLY_EXECUTABLE_PATH, TEST_ONLY_FONT_PATH, 'test_only'));
  }
}
export function assertTrustedPhaseTwoEnvironment(value: unknown): asserts value is TrustedPhaseTwoEnvironment {
  if (typeof value !== 'object' || value === null || !capabilities.has(value)) throw new RenderingPhaseTwoFailure('toolchain_invalid');
}

function verifyObservedToolchain(observed: unknown, expectation: unknown,
  executablePath: string, fontPath: string, executionTrust: 'test_only' | 'trusted_local_reference'): VerifiedToolchain {
  const metadata = detachToolchainMetadata(observed, false) as TrustedToolchainMetadata;
  const expected = detachToolchainMetadata(expectation, true) as TrustedToolchainExpectations;
  const exactStrings = [metadata.operatingSystemIdentity, metadata.ffmpegVersion, metadata.openH264Version,
    metadata.freeTypeVersion, metadata.harfBuzzVersion, executablePath, fontPath];
  const sameBuild = Array.isArray(metadata.buildConfiguration) &&
    metadata.buildConfiguration.length === PHASE_TWO_BUILD_CONFIGURATION.length &&
    metadata.buildConfiguration.every((entry, index) => entry === PHASE_TWO_BUILD_CONFIGURATION[index]);
  if (exactStrings.some((value) => typeof value !== 'string' || value.length === 0) ||
      metadata.operatingSystemIdentity !== expected.operatingSystemIdentity ||
      metadata.ffmpegVersion !== PHASE_TWO_TOOLCHAIN_PROFILE.ffmpegVersion || metadata.ffmpegVersion !== expected.ffmpegVersion ||
      metadata.openH264Version !== PHASE_TWO_TOOLCHAIN_PROFILE.openH264Version || metadata.openH264Version !== expected.openH264Version ||
      metadata.freeTypeVersion !== PHASE_TWO_TOOLCHAIN_PROFILE.freeTypeVersion || metadata.freeTypeVersion !== expected.freeTypeVersion ||
      metadata.harfBuzzVersion !== PHASE_TWO_TOOLCHAIN_PROFILE.harfBuzzVersion || metadata.harfBuzzVersion !== expected.harfBuzzVersion ||
      JSON.stringify(metadata.harfBuzzBuildIdentity) !== JSON.stringify(PHASE_TWO_HARFBUZZ_PROFILE) ||
      JSON.stringify(metadata.harfBuzzBuildIdentity) !== JSON.stringify(expected.harfBuzzBuildIdentity) ||
      !sameBuild || JSON.stringify(metadata.buildConfiguration) !== JSON.stringify(expected.buildConfiguration) || !expected.executionReady) {
    throw new RenderingPhaseTwoFailure('toolchain_invalid');
  }
  for (const key of ['ffmpegBinarySha256', 'openH264BinarySha256', 'freeTypeBinarySha256', 'harfBuzzBinarySha256', 'fontSha256'] as const) {
    const code = key === 'fontSha256' ? 'font_invalid' : 'toolchain_invalid';
    if (!isSha256(metadata[key]) || !isSha256(expected[key]) || metadata[key] !== expected[key]) throw new RenderingPhaseTwoFailure(code);
  }
  return deepFreeze({ profile: PHASE_TWO_TOOLCHAIN_PROFILE, font: PHASE_TWO_FONT_PROFILE,
    referenceEnvironmentId: createReferenceEnvironmentId(metadata),
    executablePath, fontPath, fontSha256: metadata.fontSha256, executionTrust });
}

/** Pure evidence helper for rejected-variant identity-sensitivity tests; it grants no execution capability. */
export function referenceEnvironmentIdForEvidenceTestOnly(value: unknown): string {
  return createReferenceEnvironmentId(detachToolchainMetadata(value, false) as TrustedToolchainMetadata);
}
function createReferenceEnvironmentId(metadata: TrustedToolchainMetadata): string {
  const identityMaterial = JSON.stringify({ os: metadata.operatingSystemIdentity, ffmpegVersion: metadata.ffmpegVersion,
    build: metadata.buildConfiguration, ffmpeg: metadata.ffmpegBinarySha256, openh264: metadata.openH264BinarySha256,
    freetype: metadata.freeTypeBinarySha256, harfbuzz: { version: metadata.harfBuzzVersion,
      binary: metadata.harfBuzzBinarySha256, build: metadata.harfBuzzBuildIdentity },
    font: metadata.fontSha256, codec: PHASE_TWO_TOOLCHAIN_PROFILE.video });
  return createHash('sha256').update(identityMaterial, 'utf8').digest('hex');
}

/** Compatibility verification remains preflight-only and cannot create an execution capability. */
export function verifyTrustedToolchain(metadata: unknown, expected: unknown): Omit<VerifiedToolchain, 'executablePath' | 'fontPath' | 'executionTrust'> {
  const verified = verifyObservedToolchain(metadata, expected, 'preflight-ffmpeg', 'preflight-font', 'test_only');
  const { executablePath: _executablePath, fontPath: _fontPath, executionTrust: _executionTrust, ...result } = verified;
  return result;
}

const METADATA_KEYS = Object.freeze(['operatingSystemIdentity', 'ffmpegVersion', 'openH264Version',
  'freeTypeVersion', 'harfBuzzVersion', 'harfBuzzBuildIdentity', 'buildConfiguration',
  'ffmpegBinarySha256', 'openH264BinarySha256', 'freeTypeBinarySha256', 'harfBuzzBinarySha256', 'fontSha256'] as const);
const HARFBUZZ_KEYS = Object.freeze(Object.keys(PHASE_TWO_HARFBUZZ_PROFILE));

function detachToolchainMetadata(value: unknown, includeExecutionReady: boolean): TrustedToolchainMetadata | TrustedToolchainExpectations {
  try { return detachToolchainMetadataUnsafe(value, includeExecutionReady); }
  catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('toolchain_invalid'); }
}
function detachToolchainMetadataUnsafe(value: unknown, includeExecutionReady: boolean): TrustedToolchainMetadata | TrustedToolchainExpectations {
  const rootKeys = includeExecutionReady ? [...METADATA_KEYS, 'executionReady'] : [...METADATA_KEYS];
  const root = exactDataDescriptors(value, rootKeys);
  const strings = ['operatingSystemIdentity', 'ffmpegVersion', 'openH264Version', 'freeTypeVersion', 'harfBuzzVersion'] as const;
  for (const key of strings) if (typeof root[key]!.value !== 'string') throw new RenderingPhaseTwoFailure('toolchain_invalid');
  for (const key of ['ffmpegBinarySha256', 'openH264BinarySha256', 'freeTypeBinarySha256', 'harfBuzzBinarySha256', 'fontSha256'] as const) {
    const kind = typeof root[key]!.value;
    if (root[key]!.value !== null && (kind === 'object' || kind === 'function' || kind === 'symbol' || kind === 'bigint'))
      throw new RenderingPhaseTwoFailure(key === 'fontSha256' ? 'font_invalid' : 'toolchain_invalid');
  }
  const build = detachStringArray(root.buildConfiguration!.value);
  const harfBuzzDescriptors = exactDataDescriptors(root.harfBuzzBuildIdentity!.value, HARFBUZZ_KEYS);
  const harfBuzz: Record<string, string | boolean> = {};
  for (const key of HARFBUZZ_KEYS) {
    const item = harfBuzzDescriptors[key]!.value;
    const expectedType = typeof PHASE_TWO_HARFBUZZ_PROFILE[key as keyof typeof PHASE_TWO_HARFBUZZ_PROFILE];
    if (typeof item !== expectedType || (typeof item !== 'string' && typeof item !== 'boolean'))
      throw new RenderingPhaseTwoFailure('toolchain_invalid');
    harfBuzz[key] = item;
  }
  if (includeExecutionReady && typeof root.executionReady!.value !== 'boolean') throw new RenderingPhaseTwoFailure('toolchain_invalid');
  const detached = { operatingSystemIdentity: root.operatingSystemIdentity!.value, ffmpegVersion: root.ffmpegVersion!.value,
    openH264Version: root.openH264Version!.value, freeTypeVersion: root.freeTypeVersion!.value,
    harfBuzzVersion: root.harfBuzzVersion!.value, harfBuzzBuildIdentity: deepFreeze(harfBuzz),
    buildConfiguration: build, ffmpegBinarySha256: root.ffmpegBinarySha256!.value,
    openH264BinarySha256: root.openH264BinarySha256!.value, freeTypeBinarySha256: root.freeTypeBinarySha256!.value,
    harfBuzzBinarySha256: root.harfBuzzBinarySha256!.value, fontSha256: root.fontSha256!.value };
  return deepFreeze(includeExecutionReady ? { ...detached, executionReady: root.executionReady!.value } : detached) as unknown as
    TrustedToolchainMetadata | TrustedToolchainExpectations;
}
function exactDataDescriptors(value: unknown, expectedKeys: readonly string[]): PropertyDescriptorMap {
  if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) throw new RenderingPhaseTwoFailure('toolchain_invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Object.keys(descriptors);
  if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key)) ||
      keys.some((key) => !expectedKeys.includes(key)) || Object.values(descriptors).some((item) => !item.enumerable || !('value' in item)))
    throw new RenderingPhaseTwoFailure('toolchain_invalid');
  return descriptors;
}
function detachStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0)
    throw new RenderingPhaseTwoFailure('toolchain_invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
  const length = descriptors['length'];
  if (!length || !('value' in length) || !Number.isSafeInteger(length.value) || length.value < 0 || length.enumerable || length.configurable)
    throw new RenderingPhaseTwoFailure('toolchain_invalid');
  const keys = Array.from({ length: length.value as number }, (_, index) => String(index));
  if (Object.keys(descriptors).length !== keys.length + 1 || keys.some((key) => {
    const item = descriptors[key]; return !item || !item.enumerable || !('value' in item) || typeof item.value !== 'string';
  })) throw new RenderingPhaseTwoFailure('toolchain_invalid');
  return Object.freeze(keys.map((key) => descriptors[key]!.value as string));
}
