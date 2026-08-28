const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { mkdtemp, rm, writeFile, readFile, symlink, rename, truncate } = require('node:fs/promises');
const { input, clientResult } = require('./helpers/voluvia-video-package-fixture');
const { createVoluviaVideoPackageOperation } = require('../dist/workflows/examples/voluvia/video-package/voluvia-video-package.operation');
const { runDeterministicRenderDryRun } = require('../dist/rendering/dry-run/deterministic-render-dry-run');
const { RenderingPhaseTwoFailure, RENDERING_PHASE_TWO_FAILURE_CODES } = require('../dist/rendering/phase-two/failures/rendering-phase-two-failure');
const toolchainModule = require('../dist/rendering/phase-two/toolchain/toolchain-profile');
const { PHASE_TWO_BUILD_CONFIGURATION, PHASE_TWO_HARFBUZZ_PROFILE, PHASE_TWO_TOOLCHAIN_PROFILE, TrustedPhaseTwoEnvironment,
  PHASE_TWO_FONT_PROFILE, referenceEnvironmentIdForEvidenceTestOnly,
  verifyTrustedToolchain } = toolchainModule;
const { PHASE_TWO_RESOURCE_LIMITS, validateResourcePreflight } = require('../dist/rendering/phase-two/resources/resource-limits');
const { assertTrustedSubtitleLayout, buildCanonicalSrt, PHASE_TWO_SUBTITLE_STYLE, TrustedFontCoverage,
  TrustedSubtitleLayoutCapability, validateSubtitleGlyphCoverage } = require('../dist/rendering/phase-two/subtitles/subtitle-boundary');
const { FixtureWorkspaceResolver } = require('../dist/rendering/phase-two/workspace/fixture-workspace');
const { buildLogicalCommandManifest, resolveExecutionManifest } = require('../dist/rendering/phase-two/command/ffmpeg-command-manifest');
const { renderDeterministicFixture, TrustedPhaseTwoFixtureComposition } = require('../dist/rendering/phase-two/fixture/deterministic-render-fixture');
const mediaInspectionModule = require('../dist/rendering/phase-two/inspection/media-inspector');
const { getTrustedInputVideoDuration, getTrustedMediaInspector, TrustedInputVideoInspection,
  TrustedMediaInspector } = mediaInspectionModule;
const processRunnerModule = require('../dist/rendering/phase-two/process/ffmpeg-process-runner');
const { diagnoseNonzeroExitCauseForTestOnly, diagnoseProcessFailureForTestOnly,
  exerciseNonzeroExitCauseClassificationForTestOnly, exerciseProcessFailureClassificationForTestOnly,
  exerciseRegisteredNonzeroExitCauseForTestOnly, exerciseRegisteredProcessFailureForTestOnly,
  exerciseStderrLimitNonzeroCollisionForTestOnly, NodeFfmpegProcessRunner, simulateWindowsTerminationTestOnly, unixProcessGroupTargetTestOnly,
  windowsTaskkillArgsTestOnly } = processRunnerModule;
const trustedLocalRuntimeModule = require('../dist/rendering/phase-two/runtime/trusted-local-runtime');

const utf16be = value => { const result = Buffer.alloc(value.length * 2); for (let index = 0; index < value.length; index += 1)
  result.writeUInt16BE(value.charCodeAt(index), index * 2); return result; };
function staticFontFixture(overrides = {}) {
  const nameValues = { 1: 'Noto Sans', 2: 'Bold', 5: 'Version 2.015; ttfautohint (v1.8.4.7-5d5b)', 6: 'NotoSans-Bold',
    ...overrides.names };
  const nameRecords = [1, 2, 5, 6].map(nameId => ({ nameId, bytes: utf16be(nameValues[nameId]) }));
  if (overrides.duplicateNameId) nameRecords.push({ nameId: overrides.duplicateNameId,
    bytes: utf16be(overrides.duplicateNameValue ?? nameValues[overrides.duplicateNameId]) });
  if (overrides.malformedUtf16) nameRecords.find(record => record.nameId === 6).bytes = Buffer.from([0xd8, 0x00]);
  const stringOffset = 6 + nameRecords.length * 12; const nameLength = stringOffset + nameRecords.reduce((sum, record) => sum + record.bytes.length, 0);
  const name = Buffer.alloc(nameLength); name.writeUInt16BE(0, 0); name.writeUInt16BE(nameRecords.length, 2); name.writeUInt16BE(stringOffset, 4);
  let relativeOffset = 0; nameRecords.forEach((record, index) => { const offset = 6 + index * 12;
    name.writeUInt16BE(3, offset); name.writeUInt16BE(1, offset + 2); name.writeUInt16BE(0x0409, offset + 4);
    name.writeUInt16BE(record.nameId, offset + 6); name.writeUInt16BE(record.bytes.length, offset + 8);
    name.writeUInt16BE(relativeOffset, offset + 10); record.bytes.copy(name, stringOffset + relativeOffset); relativeOffset += record.bytes.length; });
  if (overrides.malformedNameOffset) name.writeUInt16BE(0xffff, 16);
  const os2 = Buffer.alloc(64); os2.writeUInt16BE(overrides.weight ?? 700, 4); os2.writeUInt16BE(overrides.width ?? 5, 6);
  os2.writeUInt16BE(overrides.selection ?? 0x00a0, 62);
  const head = Buffer.alloc(46); head.writeUInt16BE(overrides.macStyle ?? 0x0001, 44);
  const maxp = Buffer.alloc(6); maxp.writeUInt16BE(overrides.glyphCount ?? 4515, 4);
  const tables = { cmap: Buffer.alloc(4), GDEF: Buffer.alloc(4), GPOS: Buffer.alloc(4), GSUB: Buffer.alloc(4), glyf: Buffer.alloc(4),
    hmtx: Buffer.alloc(4), head, maxp, name, 'OS/2': os2 };
  if (overrides.missingTable) delete tables[overrides.missingTable]; if (overrides.variableTable) tables[overrides.variableTable] = Buffer.alloc(4);
  const entries = Object.entries(tables); const directoryLength = 12 + entries.length * 16;
  const totalLength = directoryLength + entries.reduce((sum, [, bytes]) => sum + bytes.length, 0); const result = Buffer.alloc(totalLength);
  result.writeUInt32BE(0x00010000, 0); result.writeUInt16BE(entries.length, 4); let tableOffset = directoryLength;
  entries.forEach(([tag, bytes], index) => { const entry = 12 + index * 16; result.write(tag, entry, 4, 'ascii');
    result.writeUInt32BE(tableOffset, entry + 8); result.writeUInt32BE(bytes.length, entry + 12); bytes.copy(result, tableOffset); tableOffset += bytes.length; });
  return result;
}
const tableDirectoryEntry = (font, tag) => { const count = font.readUInt16BE(4); for (let index = 0; index < count; index += 1) {
  const offset = 12 + index * 16; if (font.toString('ascii', offset, offset + 4) === tag) return offset; } throw new Error('missing fixture table'); };

const hash = character => character.repeat(64);
const fails = (fn, code) => assert.throws(fn, error => error instanceof RenderingPhaseTwoFailure && error.code === code);
const rejects = (promise, code) => assert.rejects(promise, error => error instanceof RenderingPhaseTwoFailure && error.code === code);
const validInspection = (byteLength, durationSeconds = 30) => ({ container: 'mp4', formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  byteLength, width: 1080, height: 1920, frameRate: 30, constantFrameRate: true, durationSeconds,
  streams: ['video', 'audio'], streamIndexes: [0, 1], videoCodecFamily: 'h264', videoProfile: 'Constrained Baseline',
  videoLevel: 42, pixelFormat: 'yuv420p', videoDurationSeconds: durationSeconds, audioCodecFamily: 'aac', audioProfile: 'LC',
  audioSampleRate: 48000, audioChannels: 2, audioDurationSeconds: durationSeconds });
async function phaseOneFixture() {
  const pkg = await createVoluviaVideoPackageOperation({ generatePackageCandidate: async () => clientResult() },
    { now: () => new Date('2026-08-06T12:00:00.000Z') })({ stepInput: input() });
  return runDeterministicRenderDryRun(pkg, { productionPurpose: 'internal_fixture', exactSubtitlesRequired: true,
    exactSceneTimingRequired: true, approvedAssetIds: ['product-front', 'lace-base-close-up'] });
}
const metadata = overrides => ({ operatingSystemIdentity: 'windows-x64-10.0.26100', ffmpegVersion: '8.1.2',
  openH264Version: '2.6.0', freeTypeVersion: '2.14.3', harfBuzzVersion: '14.2.1',
  harfBuzzBuildIdentity: PHASE_TWO_HARFBUZZ_PROFILE, buildConfiguration: [...PHASE_TWO_BUILD_CONFIGURATION],
  ffmpegBinarySha256: hash('a'), ffprobeBinarySha256: hash('f'), openH264BinarySha256: hash('b'), freeTypeBinarySha256: hash('c'),
  harfBuzzBinarySha256: hash('e'), sourceVariableFontSha256: hash('1'), fontSha256: hash('d'),
  fontMetricBinarySha256: hash('2'), codecConfiguration: PHASE_TWO_TOOLCHAIN_PROFILE, ...overrides });
const expectations = overrides => ({ ...metadata(), executionReady: true, ...overrides });

test('toolchain profile and reference identity bind every frozen environment input', () => {
  assert.equal(PHASE_TWO_TOOLCHAIN_PROFILE.video.width, 1080); assert.equal(PHASE_TWO_TOOLCHAIN_PROFILE.video.height, 1920);
  assert.equal(PHASE_TWO_TOOLCHAIN_PROFILE.video.frameRate, 30); assert.equal(PHASE_TWO_TOOLCHAIN_PROFILE.video.pixelFormat, 'yuv420p');
  const verified = verifyTrustedToolchain(metadata(), expectations()); assert.match(verified.referenceEnvironmentId, /^[a-f0-9]{64}$/);
  for (const [field, value, code] of [['operatingSystemIdentity', 'linux-x64', 'toolchain_invalid'],
    ['ffmpegBinarySha256', hash('e'), 'toolchain_invalid'], ['ffprobeBinarySha256', hash('e'), 'toolchain_invalid'],
    ['openH264BinarySha256', hash('e'), 'toolchain_invalid'],
    ['freeTypeBinarySha256', hash('f'), 'toolchain_invalid'], ['harfBuzzBinarySha256', hash('f'), 'toolchain_invalid'],
    ['sourceVariableFontSha256', hash('f'), 'font_invalid'], ['fontSha256', hash('f'), 'font_invalid'],
    ['fontMetricBinarySha256', hash('f'), 'toolchain_invalid']]) {
    fails(() => verifyTrustedToolchain(metadata({ [field]: value }), expectations(),), code);
  }
  assert.notEqual(verified.referenceEnvironmentId,
    verifyTrustedToolchain(metadata({ operatingSystemIdentity: 'linux-x64' }), expectations({ operatingSystemIdentity: 'linux-x64' })).referenceEnvironmentId);
  const environment = TrustedPhaseTwoEnvironment.createTestOnly(metadata(), expectations());
  assert.equal(environment.verified.executionTrust, 'test_only'); assert.equal('createTrustedLocalReference' in TrustedPhaseTwoEnvironment, false);
  for (const field of ['operatingSystemIdentity', 'openH264BinarySha256', 'freeTypeBinarySha256', 'harfBuzzBinarySha256',
    'sourceVariableFontSha256', 'fontSha256', 'fontMetricBinarySha256']) {
    fails(() => TrustedPhaseTwoEnvironment.createTestOnly(metadata({ [field]: undefined }), expectations()),
      field === 'fontSha256' || field === 'sourceVariableFontSha256' ? 'font_invalid' : 'toolchain_invalid');
  }
});

test('reference identity binds FFprobe and the complete codec configuration', () => {
  const baseline = referenceEnvironmentIdForEvidenceTestOnly(metadata());
  assert.notEqual(referenceEnvironmentIdForEvidenceTestOnly(metadata({ ffprobeBinarySha256: hash('9') })), baseline);
  const changedCodec = structuredClone(PHASE_TWO_TOOLCHAIN_PROFILE); changedCodec.audio.bitrate = 128000;
  assert.notEqual(referenceEnvironmentIdForEvidenceTestOnly(metadata({ codecConfiguration: changedCodec })), baseline);
  fails(() => verifyTrustedToolchain(metadata({ codecConfiguration: changedCodec }),
    expectations({ codecConfiguration: changedCodec })), 'toolchain_invalid');
});

test('trusted-local runtime exposes one zero-material preflight and rejects forged authority', () => {
  assert.equal(trustedLocalRuntimeModule.establishTrustedLocalRuntime.length, 0);
  const exports = Object.keys(trustedLocalRuntimeModule).sort();
  assert.equal(exports.includes('establishTrustedLocalRuntime'), true);
  for (const forbidden of ['registerTrustedLocal', 'createTrustedLocal', 'constructTrustedLocal', 'resolveTrustedLocalExecutionInternal'])
    assert.equal(exports.includes(forbidden), false);
  for (const forbidden of ['createTrustedFontMetric', 'registerFontMetric', 'setFontMetricPath', 'createMetricProcessAdapter'])
    assert.equal(exports.includes(forbidden), false);
  const parsedMetric = trustedLocalRuntimeModule.parseFrozenFontMetricOutputForTestOnly('VEP_FONT_METRIC_V1\t1\t1\t1\t1\r\n');
  assert.deepEqual(parsedMetric, { glyphCoverage: true, widthPx: 1, heightPx: 1, lineCount: 1 });
  assert.equal('executionTrust' in parsedMetric, false); assert.equal(Object.isFrozen(parsedMetric), true);
  for (const forged of [{}, Object.freeze({}), { executionTrust: 'trusted_local_reference' },
    JSON.parse('{"executionTrust":"trusted_local_reference"}')]) assert.equal(trustedLocalRuntimeModule.isTrustedLocalCapability(forged), false);
  for (const constructor of [TrustedPhaseTwoEnvironment, TrustedMediaInspector, TrustedFontCoverage,
    TrustedSubtitleLayoutCapability, FixtureWorkspaceResolver, TrustedPhaseTwoFixtureComposition])
    assert.equal(Object.getOwnPropertyNames(constructor).some(name => /TrustedLocal/u.test(name)), false);
  fails(() => trustedLocalRuntimeModule.assertTrustedLocalComposition({}, []), 'toolchain_invalid');
  fails(() => trustedLocalRuntimeModule.authorizeTrustedLocalResolvedExecution({}, Object.freeze({})), 'process_failed');
});

test('trusted-local rejected variants are closed without issuing provenance', async t => {
  const expectedHashes = { ffmpeg: '47f90e890b4fd06605f708791b3b6f3635c0ac65af001936e7bf364f8e25d089',
    ffprobe: '256459de6566608a65f4d1b6e42ea3cdac39ad472e69baafdca103252bdfb228',
    freetype: '4c7336efdb382de3513e2532b547d5f747bd6660a37905737d0e6f7655173537',
    harfbuzz: 'bb764b49def39b96640b81f136f8df0fec46bac9a2109b95dd9da0d66ca5fef3',
    openh264: '4f74bc5e8f8b18ae3816aef71748175131a2a17d82099742fb4284bee05b0037',
    sourceFont: 'bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d',
    font: '3a08a47daa00cade516425c15c57615aef2fd418ec9811a7b9f465088f92cc05',
    fontMetrics: '82f5cf116ef6d0434809acf607b24784987a536a2111f212a7aa9d9357c44e11' };
  const required = ['libopenh264', 'aac', 'drawtext', 'scale', 'pad', 'trim', 'setpts', 'concat', 'atrim', 'apad', 'asetpts', 'mp4', 'file', 'pipe'];
  const observation = overrides => ({ hashes: { ...expectedHashes }, ffmpegVersion: '8.1.2', ffprobeVersion: '8.1.2',
    buildConfiguration: [...PHASE_TWO_BUILD_CONFIGURATION], capabilities: [...required], ordinaryArtifacts: true,
    unexpectedConfiguration: false, ...overrides });
  assert.deepEqual(trustedLocalRuntimeModule.validateTrustedLocalObservationForTestOnly(observation()), { validated: true });
  const cases = [
    ['wrong FFmpeg hash', observation({ hashes: { ...expectedHashes, ffmpeg: hash('0') } }), 'toolchain_invalid'],
    ['wrong FFprobe hash', observation({ hashes: { ...expectedHashes, ffprobe: hash('0') } }), 'toolchain_invalid'],
    ['wrong dependency hash', observation({ hashes: { ...expectedHashes, harfbuzz: hash('0') } }), 'toolchain_invalid'],
    ['wrong source font hash', observation({ hashes: { ...expectedHashes, sourceFont: hash('0') } }), 'font_invalid'],
    ['wrong font hash', observation({ hashes: { ...expectedHashes, font: hash('0') } }), 'font_invalid'],
    ['wrong metric helper hash', observation({ hashes: { ...expectedHashes, fontMetrics: hash('0') } }), 'toolchain_invalid'],
    ['missing or linked artifact', observation({ ordinaryArtifacts: false }), 'toolchain_invalid'],
    ['FFmpeg version mismatch', observation({ ffmpegVersion: '8.1.1' }), 'toolchain_invalid'],
    ['FFprobe version mismatch', observation({ ffprobeVersion: '8.1.1' }), 'toolchain_invalid'],
    ['buildconf mismatch', observation({ buildConfiguration: PHASE_TWO_BUILD_CONFIGURATION.slice(1) }), 'toolchain_invalid'],
    ['missing capability', observation({ capabilities: required.slice(1) }), 'toolchain_invalid'],
    ['unexpected capability', observation({ capabilities: [...required, 'libx264'] }), 'toolchain_invalid'],
    ['unexpected configuration', observation({ unexpectedConfiguration: true }), 'toolchain_invalid']
  ];
  for (const [name, candidate, code] of cases) await t.test(name, () => fails(() =>
    trustedLocalRuntimeModule.validateTrustedLocalObservationForTestOnly(candidate), code));
  assert.equal('executionTrust' in trustedLocalRuntimeModule.validateTrustedLocalObservationForTestOnly(observation()), false);
});

test('trusted-local capability parser is exact and rejects similarly named or unexpected entries', () => {
  const version = 'ffmpeg version 8.1.2\n'; const probe = 'ffprobe version 8.1.2\n';
  const buildconf = PHASE_TWO_BUILD_CONFIGURATION.map(value => `  ${value}`).join('\n');
  const encoders = ' V....D libopenh264 OpenH264\n A....D aac AAC';
  const filters = ['drawtext', 'scale', 'pad', 'trim', 'setpts', 'concat', 'atrim', 'apad', 'asetpts'].map(value => ` .. ${value} V->V description`).join('\n');
  const muxers = ' E mp4 MP4'; const protocols = 'Input:\n  file\n  pipe\nOutput:\n  file\n  pipe';
  assert.doesNotThrow(() => trustedLocalRuntimeModule.validateRuntimeCapabilityOutputForTestOnly(version, buildconf,
    encoders, filters, muxers, protocols, probe));
  fails(() => trustedLocalRuntimeModule.validateRuntimeCapabilityOutputForTestOnly(version, buildconf,
    encoders.replace('libopenh264', 'libopenh264_fake'), filters, muxers, protocols, probe), 'toolchain_invalid');
  fails(() => trustedLocalRuntimeModule.validateRuntimeCapabilityOutputForTestOnly(version, buildconf,
    encoders, filters.replace('drawtext', 'drawtext_extra'), muxers, protocols, probe), 'toolchain_invalid');
  fails(() => trustedLocalRuntimeModule.validateRuntimeCapabilityOutputForTestOnly(version, buildconf,
    `${encoders}\n V....D libx264 x264`, filters, muxers, protocols, probe), 'toolchain_invalid');
});

test('FFmpeg 8.1.2 filter-table parser accepts exact two-flag rows and ignores legends structurally', () => {
  const version = 'ffmpeg version 8.1.2\n'; const probe = 'ffprobe version 8.1.2\n';
  const buildconf = PHASE_TWO_BUILD_CONFIGURATION.map(value => `  ${value}`).join('\n');
  const encoders = ' V....D libopenh264 OpenH264\n A....D aac AAC'; const muxers = ' E mp4 MP4';
  const protocols = 'Input:\n  file\n  pipe\nOutput:\n  file\n  pipe';
  const rows = [
    ' T. drawtext          V->V       Draw text on top of video frames using libfreetype library.',
    ' .. scale             V->V       Scale the input video size and/or convert the image format.',
    ' T. pad               V->V       Pad the input video.',
    ' T. trim              V->V       Pick one continuous section from the input, drop the rest.',
    ' .. setpts            V->V       Set PTS for the output video frame.',
    ' .. concat            N->N       Concatenate audio and video streams.',
    ' T. atrim             A->A       Pick one continuous section from the input, drop the rest.',
    ' T. apad              A->A       Pad audio with silence.',
    ' .. asetpts           A->A       Set PTS for the output audio frame.'
  ];
  const listing = eol => ['Filters:', '  T.. = Timeline support', '  .S. = Slice threading',
    '  A = Audio input/output', '  V = Video input/output', '  N = Dynamic number and/or type of input/output',
    '  | = Source or sink filter', '  ------', '', ...rows, ''].join(eol);
  for (const eol of ['\n', '\r\n']) assert.doesNotThrow(() =>
    trustedLocalRuntimeModule.validateRuntimeCapabilityOutputForTestOnly(version, buildconf, encoders, listing(eol), muxers, protocols, probe));
  for (const [required, similar] of [['drawtext', 'drawtext2'], ['scale', 'scale2ref'], ['pad', 'tpad'],
    ['trim', 'trimfoo'], ['asetpts', 'asetpts_extra']]) fails(() =>
    trustedLocalRuntimeModule.validateRuntimeCapabilityOutputForTestOnly(version, buildconf, encoders,
      listing('\n').replace(new RegExp(`(\\s)${required}(\\s)`, 'u'), `$1${similar}$2`), muxers, protocols, probe), 'toolchain_invalid');
  fails(() => trustedLocalRuntimeModule.validateRuntimeCapabilityOutputForTestOnly(version, buildconf, encoders,
    listing('\n').replace(' T. drawtext          V->V', ' T. drawtext          malformed'), muxers, protocols, probe), 'toolchain_invalid');
  const previousIncompatible = rows.map(row => row.replace(/^ ([T.][S.]) /u, ' ... ')).join('\n');
  fails(() => trustedLocalRuntimeModule.validateRuntimeCapabilityOutputForTestOnly(version, buildconf, encoders,
    previousIncompatible, muxers, protocols, probe), 'toolchain_invalid');
});

test('static-font semantic parser validates the frozen UTF-16BE identity and fails closed on drift', async t => {
  const validate = trustedLocalRuntimeModule.validateStaticFontBufferForTestOnly; const valid = staticFontFixture();
  assert.deepEqual(validate(valid), { validated: true });
  assert.equal(valid.toString('latin1').includes('NotoSans-Bold'), false);
  for (const version of ['Version 2.015', 'Version 2.015; ttfautohint (v1.8.4.7-5d5b)', 'Version 2.015;abc'])
    await t.test(`accepted version: ${version}`, () => assert.doesNotThrow(() => validate(staticFontFixture({ names: { 5: version } }))));
  for (const version of ['Version 2.015;', 'Version 2.015; ', 'Version 2.015;    ', 'Version 2.0150', 'Version 2.015x',
    'Noto Version 2.015', ' Version 2.015', 'Version 2.015 ', 'Version 2.014'])
    await t.test(`rejected version: ${JSON.stringify(version)}`, () => fails(() =>
      validate(staticFontFixture({ names: { 5: version } })), 'font_invalid'));
  const cases = [
    ['wrong PostScript name', staticFontFixture({ names: { 6: 'NotoSans-Regular' } })],
    ['wrong family', staticFontFixture({ names: { 1: 'Other Sans' } })],
    ['wrong subfamily', staticFontFixture({ names: { 2: 'Regular' } })],
    ['missing name table', staticFontFixture({ missingTable: 'name' })],
    ['malformed name offset', staticFontFixture({ malformedNameOffset: true })],
    ['malformed UTF-16BE', staticFontFixture({ malformedUtf16: true })],
    ['duplicate selected name', staticFontFixture({ duplicateNameId: 6 })],
    ['conflicting selected name', staticFontFixture({ duplicateNameId: 6, duplicateNameValue: 'Conflicting-Name' })],
    ['wrong weight class', staticFontFixture({ weight: 400 })],
    ['wrong width class', staticFontFixture({ width: 4 })],
    ['missing OS/2 bold style', staticFontFixture({ selection: 0x0080 })],
    ['missing head bold style', staticFontFixture({ macStyle: 0x0000 })],
    ['wrong glyph count', staticFontFixture({ glyphCount: 4514 })],
    ['missing required table', staticFontFixture({ missingTable: 'GPOS' })],
    ['fvar present', staticFontFixture({ variableTable: 'fvar' })],
    ['gvar present', staticFontFixture({ variableTable: 'gvar' })]
  ];
  const truncatedDirectory = valid.subarray(0, 20); cases.push(['truncated table directory', truncatedDirectory]);
  const outOfRange = Buffer.from(valid); outOfRange.writeUInt32BE(outOfRange.length + 1, tableDirectoryEntry(outOfRange, 'cmap') + 8);
  cases.push(['out-of-range table offset', outOfRange]);
  for (const [name, fixture] of cases) await t.test(name, () => fails(() => validate(fixture), 'font_invalid'));
  const expectedHashes = { ffmpeg: '47f90e890b4fd06605f708791b3b6f3635c0ac65af001936e7bf364f8e25d089',
    ffprobe: '256459de6566608a65f4d1b6e42ea3cdac39ad472e69baafdca103252bdfb228',
    freetype: '4c7336efdb382de3513e2532b547d5f747bd6660a37905737d0e6f7655173537',
    harfbuzz: 'bb764b49def39b96640b81f136f8df0fec46bac9a2109b95dd9da0d66ca5fef3',
    openh264: '4f74bc5e8f8b18ae3816aef71748175131a2a17d82099742fb4284bee05b0037',
    sourceFont: 'bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d',
    font: '3a08a47daa00cade516425c15c57615aef2fd418ec9811a7b9f465088f92cc05',
    fontMetrics: '82f5cf116ef6d0434809acf607b24784987a536a2111f212a7aa9d9357c44e11' };
  const observation = { hashes: { ...expectedHashes, font: hash('0') }, ffmpegVersion: '8.1.2', ffprobeVersion: '8.1.2',
    buildConfiguration: [...PHASE_TWO_BUILD_CONFIGURATION], capabilities: ['libopenh264', 'aac', 'drawtext', 'scale', 'pad', 'trim', 'setpts',
      'concat', 'atrim', 'apad', 'asetpts', 'mp4', 'file', 'pipe'], ordinaryArtifacts: true, unexpectedConfiguration: false };
  fails(() => trustedLocalRuntimeModule.validateTrustedLocalObservationForTestOnly(observation), 'font_invalid');
});

test('trusted-local lineage is unique and bounded hashing rejects growth and early close', async () => {
  assert.equal(trustedLocalRuntimeModule.verifyLineageIsolationForTestOnly(), true);
  const bytes = Buffer.from('verified'); const expected = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  assert.equal(await trustedLocalRuntimeModule.hashChunksForTestOnly([bytes], bytes.length), expected);
  await rejects(trustedLocalRuntimeModule.hashChunksForTestOnly([bytes], bytes.length - 1), 'toolchain_invalid');
  await rejects(trustedLocalRuntimeModule.hashChunksForTestOnly([bytes], bytes.length + 1), 'toolchain_invalid');
});

test('trusted-local source fixes cwd and Windows environment and contains no render call', async () => {
  const source = await readFile(path.join(__dirname, '..', 'src', 'rendering', 'phase-two', 'runtime', 'trusted-local-runtime.ts'), 'utf8');
  assert.match(source, /cwd: FFMPEG_ROOT/u); assert.match(source, /env: \{ PATH: '', SystemRoot: 'C:\\\\Windows' \}/u);
  assert.equal(source.includes('process.env.SYSTEMROOT'), false); assert.equal(source.includes('process.cwd'), false);
  assert.equal(source.includes('.run('), false); assert.equal(source.includes('fixture.mp4'), false); assert.equal(source.includes('subtitles.srt'), false);
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
    'freeTypeBinarySha256', 'harfBuzzVersion', 'harfBuzzBinarySha256', 'harfBuzzBuildIdentity',
    'sourceVariableFontSha256', 'fontSha256', 'fontMetricBinarySha256']) {
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

test('frozen static font provenance and metric helper bind canonical environment identity', () => {
  assert.deepEqual(PHASE_TWO_FONT_PROFILE, { family: 'Noto Sans', version: '2.015',
    sourceVariableFileName: 'NotoSans[wdth,wght].ttf', runtimeFileName: 'NotoSans-wght700-wdth100.ttf',
    weight: 700, width: 100, faceIndex: 0, pixelSize: 64, fallback: 'prohibited' });
  const baseline = referenceEnvironmentIdForEvidenceTestOnly(metadata());
  for (const changed of [
    metadata({ sourceVariableFontSha256: hash('3') }), metadata({ fontSha256: hash('4') }),
    metadata({ fontMetricBinarySha256: hash('5') })
  ]) assert.notEqual(referenceEnvironmentIdForEvidenceTestOnly(changed), baseline);
  fails(() => verifyTrustedToolchain(metadata({ sourceVariableFontSha256: hash('3') }), expectations()), 'font_invalid');
  fails(() => verifyTrustedToolchain(metadata({ fontSha256: hash('4') }), expectations()), 'font_invalid');
  fails(() => verifyTrustedToolchain(metadata({ fontMetricBinarySha256: hash('5') }), expectations()), 'toolchain_invalid');
});

test('closed native metric fixtures cover kerning, combining marks, surrogate pairs, and missing glyphs', () => {
  const parse = value => trustedLocalRuntimeModule.parseFrozenFontMetricOutputForTestOnly(value);
  const helper = 'C:\\Users\\Jiayi\\AppData\\Local\\VEP-Studio\\toolchain\\install\\metrics\\frozen-font-metrics.exe';
  assert.equal(fs.existsSync(helper), true);
  const info = fs.lstatSync(helper); assert.equal(info.isFile(), true); assert.equal(info.isSymbolicLink(), false);
  assert.equal(createHash('sha256').update(fs.readFileSync(helper)).digest('hex'),
    '82f5cf116ef6d0434809acf607b24784987a536a2111f212a7aa9d9357c44e11');
  const execute = input => {
    const result = spawnSync(helper, [], { shell: false, cwd: path.dirname(helper), windowsHide: true,
      input, encoding: 'utf8', timeout: 5000, maxBuffer: 1024, env: { PATH: '', SystemRoot: 'C:\\Windows' } });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
    assert.equal(result.stderr, ''); assert.ok(Buffer.byteLength(result.stdout, 'utf8') <= 128);
    return parse(result.stdout);
  };
  const a = execute('A'); const v = execute('V'); const av = execute('AV');
  assert.ok(av.widthPx < a.widthPx + v.widthPx);
  assert.deepEqual(execute('e\u0301'),
    { glyphCoverage: true, widthPx: 39, heightPx: 50, lineCount: 1 });
  assert.deepEqual(execute('\u{10780}'),
    { glyphCoverage: true, widthPx: 43, heightPx: 21, lineCount: 1 });
  assert.equal(execute('\u{1F600}').glyphCoverage, false);
  for (const invalid of ['', 'VEP_FONT_METRIC_V1\t1\t84\t46\t1',
    'VEP_FONT_METRIC_V1\ttrue\t84\t46\t1\r\n', 'VEP_FONT_METRIC_V1\t1\t84\t46\t3\r\n',
    'VEP_FONT_METRIC_V1\t1\t84\t46\t1\r\nraw']) fails(() => parse(invalid), 'font_invalid');
});

test('font metric integrity failures remain font_invalid while genuine missing glyphs remain glyph_unsupported', async () => {
  const phaseOne = await phaseOneFixture();
  const integrityFailure = TrustedFontCoverage.createTestOnly(hash('d'), { supports() {
    throw new RenderingPhaseTwoFailure('font_invalid');
  } });
  assert.throws(() => validateSubtitleGlyphCoverage(phaseOne.manifest.subtitles.canonicalCues, integrityFailure, hash('d')),
    error => error instanceof RenderingPhaseTwoFailure && error.code === 'font_invalid');
  const missingGlyph = TrustedFontCoverage.createTestOnly(hash('d'), { supports: () => false });
  fails(() => validateSubtitleGlyphCoverage(phaseOne.manifest.subtitles.canonicalCues, missingGlyph, hash('d')), 'glyph_unsupported');
});

test('scalar coverage exempts only U+0020 while visible and other invisible scalars remain authoritative', () => {
  const cue = text => [{ cueId: 'cue-01', sceneId: 'scene-01', lines: [text], startSecond: 0, endSecond: 1 }];
  const observed = [];
  const coverage = TrustedFontCoverage.createTestOnly(hash('d'), { supports(codePoint) {
    observed.push(codePoint); return codePoint === 0x41;
  } });
  assert.doesNotThrow(() => validateSubtitleGlyphCoverage(cue(' '), coverage, hash('d')));
  assert.deepEqual(observed, []);
  assert.doesNotThrow(() => validateSubtitleGlyphCoverage(cue('A A'), coverage, hash('d')));
  assert.deepEqual(observed, [0x41, 0x41]);
  for (const codePoint of [0x00a0, 0x09, 0x2000, 0x2007, 0x200a, 0x2028, 0x2029, 0x200b, 0x2060]) {
    const before = observed.length;
    fails(() => validateSubtitleGlyphCoverage(cue(String.fromCodePoint(codePoint)), coverage, hash('d')), 'glyph_unsupported');
    assert.deepEqual(observed.slice(before), [codePoint]);
  }
  const missingVisible = TrustedFontCoverage.createTestOnly(hash('d'), { supports: () => false });
  fails(() => validateSubtitleGlyphCoverage(cue('B'), missingVisible, hash('d')), 'glyph_unsupported');
  const failedHelper = TrustedFontCoverage.createTestOnly(hash('d'), { supports() {
    throw new RenderingPhaseTwoFailure('font_invalid');
  } });
  fails(() => validateSubtitleGlyphCoverage(cue('A'), failedHelper, hash('d')), 'font_invalid');
});

test('ordinary spaces remain part of authoritative full-line metrics and zero-height blocks fail closed', () => {
  let measuredLines;
  const layout = TrustedSubtitleLayoutCapability.createTestOnly(hash('d'), { measureBlock(lines) {
    measuredLines = [...lines]; return { glyphCoverage: true, widthPx: 700, heightPx: 164, lineCount: lines.length };
  } });
  assert.doesNotThrow(() => layout.verify(['Ein Hair Topper', 'dein eigenes Haar'], hash('d')));
  assert.deepEqual(measuredLines, ['Ein Hair Topper', 'dein eigenes Haar']);
  const zeroHeight = TrustedSubtitleLayoutCapability.createTestOnly(hash('d'), { measureBlock(lines) {
    return { glyphCoverage: true, widthPx: 700, heightPx: 0, lineCount: lines.length };
  } });
  fails(() => zeroHeight.verify(['line with spaces'], hash('d')), 'subtitle_invalid');
  fails(() => trustedLocalRuntimeModule.parseFrozenFontMetricOutputForTestOnly(
    'VEP_FONT_METRIC_V1\t1\t700\t0\t1\n'), 'font_invalid');
});

test('final trusted execution consumption revalidates both FFmpeg and the frozen static font', async () => {
  const runtimeSource = await readFile(path.join(__dirname, '..', 'src', 'rendering', 'phase-two', 'runtime', 'trusted-local-runtime.ts'), 'utf8');
  const boundary = runtimeSource.slice(runtimeSource.indexOf('export async function revalidateTrustedExecutionForConsumption'),
    runtimeSource.indexOf('export function verifyLineageIsolationForTestOnly'));
  assert.match(boundary, /observeArtifact\(PATHS\.ffmpeg, HASHES\.ffmpeg\)/u);
  assert.match(boundary, /observeArtifact\(PATHS\.font, HASHES\.font\)/u);
  assert.match(boundary, /RenderingPhaseTwoFailure\('font_invalid'\)/u);
  assert.equal(boundary.includes('processRunner.run'), false);
  assert.deepEqual(await trustedLocalRuntimeModule.exerciseFinalConsumptionBoundaryForTestOnly('unchanged_font'),
    { outcome: 'accepted', processInvocationCount: 1 });
  assert.deepEqual(await trustedLocalRuntimeModule.exerciseFinalConsumptionBoundaryForTestOnly('replaced_font'),
    { outcome: 'font_invalid', processInvocationCount: 0 });
});

test('wrong frozen metric-helper identity fails before helper process invocation', () => {
  assert.deepEqual(trustedLocalRuntimeModule.exerciseMetricHelperIdentityBoundaryForTestOnly('correct_hash'),
    { outcome: 'accepted', helperInvocationCount: 1 });
  assert.deepEqual(trustedLocalRuntimeModule.exerciseMetricHelperIdentityBoundaryForTestOnly('wrong_hash'),
    { outcome: 'font_invalid', helperInvocationCount: 0 });
});

test('authoritative block metrics enforce exact horizontal and vertical boundaries without reflow or truncation', () => {
  const capability = result => TrustedSubtitleLayoutCapability.createTestOnly(hash('d'), { measureBlock(lines) {
    return { ...result, lineCount: lines.length }; } });
  assert.doesNotThrow(() => capability({ glyphCoverage: true, widthPx: 852, heightPx: 272 }).verify(['one', 'two'], hash('d')));
  fails(() => capability({ glyphCoverage: true, widthPx: 853, heightPx: 46 }).verify(['one'], hash('d')), 'subtitle_invalid');
  fails(() => capability({ glyphCoverage: true, widthPx: 100, heightPx: 273 }).verify(['one', 'two'], hash('d')), 'subtitle_invalid');
  fails(() => capability({ glyphCoverage: false, widthPx: 38, heightPx: 46 }).verify(['unsupported'], hash('d')), 'glyph_unsupported');
  fails(() => capability({ glyphCoverage: true, widthPx: 100, heightPx: 46 }).verify(['one', 'two', 'three'], hash('d')), 'subtitle_invalid');
  for (const malformed of ['\ud800', '\udc00', 'x\nvalue', 'x\tvalue', 'x'.repeat(43)])
    fails(() => capability({ glyphCoverage: true, widthPx: 100, heightPx: 46 }).verify([malformed], hash('d')), 'subtitle_invalid');
  const wrongLineCount = TrustedSubtitleLayoutCapability.createTestOnly(hash('d'), { measureBlock() {
    return { glyphCoverage: true, widthPx: 100, heightPx: 46, lineCount: 1 }; } });
  fails(() => wrongLineCount.verify(['one', 'two'], hash('d')), 'subtitle_invalid');
});

test('metric capabilities remain weak-membership protected and cannot be copied, serialized, or prototype-forged', () => {
  const legitimate = TrustedSubtitleLayoutCapability.createTestOnly(hash('d'), { measureBlock() {
    return { glyphCoverage: true, widthPx: 100, heightPx: 46, lineCount: 1 }; } });
  assert.doesNotThrow(() => assertTrustedSubtitleLayout(legitimate, 'test_only'));
  for (const forged of [{ ...legitimate }, JSON.parse(JSON.stringify(legitimate)), Object.create(Object.getPrototypeOf(legitimate))])
    fails(() => assertTrustedSubtitleLayout(forged, 'test_only'), 'subtitle_invalid');
  assert.equal(trustedLocalRuntimeModule.verifyLineageIsolationForTestOnly(), true);
});

test('trusted-local font metric source is fixed-path, bounded, static-font-only, and non-rendering', async () => {
  const runtimeSource = await readFile(path.join(__dirname, '..', 'src', 'rendering', 'phase-two', 'runtime', 'trusted-local-runtime.ts'), 'utf8');
  const nativeSource = await readFile(path.join(__dirname, '..', 'src', 'rendering', 'phase-two', 'runtime', 'native', 'frozen-font-metrics.c'), 'utf8');
  assert.match(runtimeSource, /NotoSans-wght700-wdth100\.ttf/u);
  assert.match(runtimeSource, /3a08a47daa00cade516425c15c57615aef2fd418ec9811a7b9f465088f92cc05/u);
  assert.match(runtimeSource, /bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d/u);
  assert.match(runtimeSource, /spawnSync\(PATHS\.fontMetrics, \[\]/u);
  assert.match(runtimeSource, /timeout: 5000, maxBuffer: 1024/u);
  assert.equal(runtimeSource.includes('measureFrozenNotoLine'), false);
  assert.equal(runtimeSource.includes('codePoint >= 0x20'), false);
  for (const token of ['FT_New_Face', 'FT_Set_Pixel_Sizes(face, 0, 64)', 'hb_ft_font_create_referenced', 'hb_shape',
    '#define MAX_INPUT_BYTES 512', 'NotoSans-wght700-wdth100.ttf']) assert.equal(nativeSource.includes(token), true);
  assert.equal(nativeSource.includes('ffmpeg'), false); assert.equal(nativeSource.includes('ffprobe'), false);
});

test('resolved drawtext binds the exact frozen static runtime fontfile', async () => {
  const phaseOne = await phaseOneFixture(); const logical = buildLogicalCommandManifest(phaseOne.manifest, [
    { logicalId: 'product-front', kind: 'image' }, { logicalId: 'lace-base-close-up', kind: 'image' },
    { logicalId: 'approved-audio', kind: 'audio' }]).logicalManifest;
  const staticFont = 'C:\\Users\\Jiayi\\AppData\\Local\\VEP-Studio\\toolchain\\install\\fonts\\NotoSans-wght700-wdth100.ttf';
  const resolved = resolveExecutionManifest(logical, { executablePath: 'C:\\trusted\\ffmpeg.exe', fontPath: staticFont,
    assetPaths: { 'product-front': 'C:\\work\\one.bin', 'lace-base-close-up': 'C:\\work\\two.bin',
      'approved-audio': 'C:\\work\\audio.wav' },
    subtitleTextFilePaths: phaseOne.manifest.subtitles.canonicalCues.map((_, index) => `C:\\work\\cue-${index}.txt`),
    outputMp4Path: 'C:\\work\\fixture.mp4', outputSrtPath: 'C:\\work\\subtitles.srt', videoInspections: {} }, () => {});
  const graph = resolved.args[resolved.args.indexOf('-filter_complex') + 1];
  assert.ok(graph.includes('NotoSans-wght700-wdth100.ttf')); assert.equal(resolved.inputPaths.includes(staticFont), true);
  assert.equal(graph.includes('NotoSans[wdth,wght].ttf'), false);
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

test('closed process-failure seam shares production classification without process authority', async t => {
  const cases = [
    ['spawn_error', 'process_failed'],
    ['nonzero_exit', 'process_failed'],
    ['signal', 'process_failed'],
    ['timeout', 'process_timeout'],
    ['stderr_limit', 'process_failed'],
    ['process_adapter', 'process_failed']
  ];
  for (const [scenario, outcome] of cases) await t.test(scenario, () => {
    assert.deepEqual(exerciseProcessFailureClassificationForTestOnly(scenario), { outcome, subcategory: scenario });
  });
  for (const hostile of [undefined, null, '', 'stdout_limit', 'invalid_result', {}, [], () => {},
    { scenario: 'spawn_error' }, 'C:\\ffmpeg.exe', ['-i'], { PATH: 'hostile' }])
    fails(() => exerciseProcessFailureClassificationForTestOnly(hostile), 'process_failed');
  assert.equal(exerciseProcessFailureClassificationForTestOnly.length, 1);
  assert.equal(NodeFfmpegProcessRunner.length, 0);
  assert.deepEqual(Object.getOwnPropertyNames(NodeFfmpegProcessRunner.prototype).sort(), ['constructor', 'run']);
  for (const result of cases.map(([scenario]) => exerciseProcessFailureClassificationForTestOnly(scenario))) {
    assert.equal(Object.isFrozen(result), true);
    assert.equal('run' in result, false); assert.equal('execute' in result, false); assert.equal('spawn' in result, false);
    assert.equal('path' in result, false); assert.equal('args' in result, false); assert.equal('env' in result, false);
  }
});

test('process diagnostics are identity-bound to failures from the shared production construction path', async t => {
  const cases = [
    ['spawn_error', 'process_failed'],
    ['nonzero_exit', 'process_failed'],
    ['signal', 'process_failed'],
    ['timeout', 'process_timeout'],
    ['stderr_limit', 'process_failed'],
    ['process_adapter', 'process_failed']
  ];
  for (const [scenario, code] of cases) await t.test(scenario, () => {
    let failure;
    try { exerciseRegisteredProcessFailureForTestOnly(scenario); } catch (error) { failure = error; }
    assert.ok(failure instanceof RenderingPhaseTwoFailure); assert.equal(failure.code, code);
    assert.deepEqual(diagnoseProcessFailureForTestOnly(failure), { available: true, subcategory: scenario });
    assert.deepEqual(Object.keys(failure).sort(), ['code', 'name']);
    assert.equal('subcategory' in failure, false);
    for (const forged of [new Error(), { ...failure }, JSON.parse(JSON.stringify(failure)),
      Object.assign(Object.create(Object.getPrototypeOf(failure)), failure), { code }, Object.freeze({ code, name: failure.name })])
      assert.deepEqual(diagnoseProcessFailureForTestOnly(forged), { available: false });
  });
  for (const unavailable of [undefined, null, '', 1, Symbol('failure'), () => {}])
    assert.deepEqual(diagnoseProcessFailureForTestOnly(unavailable), { available: false });
  assert.equal(diagnoseProcessFailureForTestOnly.length, 1);
  assert.equal(exerciseRegisteredProcessFailureForTestOnly.length, 1);
});

test('closed nonzero-exit classifier uses fixed bounded fixtures and deterministic precedence', async t => {
  const cases = [
    ['resource_or_io', 'resource_or_io'],
    ['invalid_option', 'invalid_option'],
    ['drawtext_or_font', 'drawtext_or_font'],
    ['input_open_or_decode', 'input_open_or_decode'],
    ['filtergraph_parse_or_init', 'filtergraph_parse_or_init'],
    ['encoder_initialization', 'encoder_initialization'],
    ['muxer_or_output', 'muxer_or_output'],
    ['unknown_nonzero_exit', 'unknown_nonzero_exit'],
    ['split_marker_across_chunks', 'muxer_or_output'],
    ['generic_invalid_argument_only', 'unknown_nonzero_exit']
  ];
  for (const [scenario, causeFamily] of cases) await t.test(scenario, () => {
    const result = exerciseNonzeroExitCauseClassificationForTestOnly(scenario);
    assert.deepEqual(result, { causeFamily }); assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(Object.keys(result), ['causeFamily']);
  });
  assert.equal(exerciseNonzeroExitCauseClassificationForTestOnly('resource_or_io').causeFamily, 'resource_or_io',
    'resource marker wins over the invalid-option marker in the internally owned precedence fixture');
  for (const hostile of [undefined, null, '', 'error', 'failed', {}, [], Buffer.from('Could not write header'),
    { scenario: 'muxer_or_output' }, 'C:\\ffmpeg.exe', ['-i'], { PATH: 'hostile' }])
    fails(() => exerciseNonzeroExitCauseClassificationForTestOnly(hostile), 'process_failed');
  assert.equal(exerciseNonzeroExitCauseClassificationForTestOnly.length, 1);
});

test('nonzero-exit cause is bound only to the exact shared failure object', async t => {
  const families = ['resource_or_io', 'invalid_option', 'drawtext_or_font', 'input_open_or_decode',
    'filtergraph_parse_or_init', 'encoder_initialization', 'muxer_or_output', 'unknown_nonzero_exit'];
  for (const scenario of families) await t.test(scenario, () => {
    let failure;
    try { exerciseRegisteredNonzeroExitCauseForTestOnly(scenario); } catch (error) { failure = error; }
    assert.ok(failure instanceof RenderingPhaseTwoFailure); assert.equal(failure.code, 'process_failed');
    assert.deepEqual(diagnoseProcessFailureForTestOnly(failure), { available: true, subcategory: 'nonzero_exit' });
    assert.deepEqual(diagnoseNonzeroExitCauseForTestOnly(failure), { available: true, causeFamily: scenario });
    assert.deepEqual(Object.keys(failure).sort(), ['code', 'name']);
    assert.equal('causeFamily' in failure, false); assert.equal('stderr' in failure, false);
    for (const forged of [new Error(), { ...failure }, JSON.parse(JSON.stringify(failure)),
      Object.assign(Object.create(Object.getPrototypeOf(failure)), failure), { code: failure.code },
      Object.freeze({ code: failure.code, name: failure.name })])
      assert.deepEqual(diagnoseNonzeroExitCauseForTestOnly(forged), { available: false });
  });
  for (const scenario of ['spawn_error', 'signal', 'timeout', 'stderr_limit', 'process_adapter']) await t.test(`unavailable-${scenario}`, () => {
    let failure;
    try { exerciseRegisteredProcessFailureForTestOnly(scenario); } catch (error) { failure = error; }
    assert.deepEqual(diagnoseNonzeroExitCauseForTestOnly(failure), { available: false });
  });
  for (const unavailable of [undefined, null, '', 1, Symbol('failure'), () => {}])
    assert.deepEqual(diagnoseNonzeroExitCauseForTestOnly(unavailable), { available: false });
  assert.equal(diagnoseNonzeroExitCauseForTestOnly.length, 1);
  assert.equal(exerciseRegisteredNonzeroExitCauseForTestOnly.length, 1);
});

test('nonzero-exit cause diagnostics preserve public failure and stderr-limit contracts', () => {
  assert.deepEqual(exerciseProcessFailureClassificationForTestOnly('stderr_limit'),
    { outcome: 'process_failed', subcategory: 'stderr_limit' });
  let failure;
  try { exerciseRegisteredNonzeroExitCauseForTestOnly('split_marker_across_chunks'); } catch (error) { failure = error; }
  assert.equal(failure.code, 'process_failed');
  assert.deepEqual(Object.keys(failure).sort(), ['code', 'name']);
  const diagnostic = diagnoseNonzeroExitCauseForTestOnly(failure);
  assert.deepEqual(diagnostic, { available: true, causeFamily: 'muxer_or_output' });
  assert.equal('stderr' in diagnostic, false); assert.equal('bytes' in diagnostic, false); assert.equal('path' in diagnostic, false);
});

test('stderr containment overrides nonzero exit and prevents cause-family registration', () => {
  let failure;
  try { exerciseStderrLimitNonzeroCollisionForTestOnly(); } catch (error) { failure = error; }
  assert.ok(failure instanceof RenderingPhaseTwoFailure); assert.equal(failure.code, 'process_failed');
  assert.deepEqual(diagnoseProcessFailureForTestOnly(failure), { available: true, subcategory: 'stderr_limit' });
  assert.deepEqual(diagnoseNonzeroExitCauseForTestOnly(failure), { available: false });
  assert.deepEqual(Object.keys(failure).sort(), ['code', 'name']);
  assert.equal('causeFamily' in failure, false); assert.equal('stderr' in failure, false);
  assert.equal(exerciseStderrLimitNonzeroCollisionForTestOnly.length, 0);
  let ordinaryNonzero;
  try { exerciseRegisteredNonzeroExitCauseForTestOnly('muxer_or_output'); } catch (error) { ordinaryNonzero = error; }
  assert.deepEqual(diagnoseProcessFailureForTestOnly(ordinaryNonzero), { available: true, subcategory: 'nonzero_exit' });
  assert.deepEqual(diagnoseNonzeroExitCauseForTestOnly(ordinaryNonzero),
    { available: true, causeFamily: 'muxer_or_output' });
  let unknownNonzero;
  try { exerciseRegisteredNonzeroExitCauseForTestOnly('unknown_nonzero_exit'); } catch (error) { unknownNonzero = error; }
  assert.deepEqual(diagnoseNonzeroExitCauseForTestOnly(unknownNonzero),
    { available: true, causeFamily: 'unknown_nonzero_exit' });
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
    return validInspection(bytes.length); } };
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
        return validInspection(bytes.length, scenario.measured); }
      return validInspection(bytes.length); } } });
      const assets = harness.request.assets.map(asset => asset.logicalId === 'product-front' ?
        { ...asset, kind: 'video', durationSeconds: scenario.declared } : asset);
      try { if (scenario.accepted) await renderDeterministicFixture({ ...harness.request, assets }, harness.composition);
        else await rejects(renderDeterministicFixture({ ...harness.request, assets }, harness.composition), 'asset_invalid');
        assert.match(inspectedInputPath, /inputs[\\/]product-front\.bin$/); assert.equal(harness.counts().processCalls, scenario.accepted ? 1 : 0);
      } finally { await rm(harness.appRoot, { recursive: true, force: true }); }
    });
  }
});

const validProbeJson = overrides => JSON.stringify({ programs: [], stream_groups: [], streams: [
  { index: 0, codec_name: 'h264', profile: 'Constrained Baseline', codec_type: 'video', width: 1080, height: 1920,
    pix_fmt: 'yuv420p', level: 42, r_frame_rate: '30/1', avg_frame_rate: '30/1', duration: '30.000000', ...(overrides?.video ?? {}) },
  { index: 1, codec_name: 'aac', profile: 'LC', codec_type: 'audio', sample_rate: '48000', channels: 2,
    r_frame_rate: '0/0', avg_frame_rate: '0/0', duration: '30.000000', ...(overrides?.audio ?? {}) },
  ...(overrides?.extraStreams ?? [])], format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '30.000000', size: '21',
    ...(overrides?.format ?? {}) } });

test('strict FFprobe JSON parser accepts only the frozen ordered MP4 output contract', async t => {
  const parse = trustedLocalRuntimeModule.parseFfprobeMediaOutputForTestOnly;
  const accepted = parse(validProbeJson()); assert.deepEqual(accepted.streamIndexes, [0, 1]); assert.equal(accepted.audioSampleRate, 48000);
  const cases = [
    ['wrong format', { format: { format_name: 'matroska,webm' } }],
    ['extra stream', { extraStreams: [{ index: 2, codec_type: 'data' }] }],
    ['reversed stream order', { video: { index: 1, codec_type: 'audio' }, audio: { index: 0, codec_type: 'video' } }],
    ['wrong video index', { video: { index: 2 } }], ['wrong audio index', { audio: { index: 2 } }],
    ['wrong video profile', { video: { profile: 'High' } }], ['wrong level', { video: { level: 41 } }],
    ['wrong pixel format', { video: { pix_fmt: 'yuv444p' } }], ['wrong width', { video: { width: 1079 } }],
    ['wrong height', { video: { height: 1919 } }], ['wrong real frame rate', { video: { r_frame_rate: '30000/1001' } }],
    ['wrong average frame rate', { video: { avg_frame_rate: '30000/1001' } }],
    ['wrong audio profile', { audio: { profile: 'HE-AAC' } }], ['wrong sample rate', { audio: { sample_rate: '44100' } }],
    ['wrong channel count', { audio: { channels: 1 } }], ['zero size', { format: { size: '0' } }],
    ['unsafe size', { format: { size: '9007199254740992' } }]
  ];
  for (const [name, changes] of cases) await t.test(name, () => fails(() => parse(validProbeJson(changes)), 'output_invalid'));
  await t.test('malformed numeric string', () => fails(() => parse(validProbeJson({ format: { duration: '30 seconds' } })), 'output_invalid'));
  await t.test('unexpected structural field', () => fails(() => parse(JSON.stringify({ ...JSON.parse(validProbeJson()), unexpected: true })), 'output_invalid'));
});

test('frozen first-controlled fixture digest set is exact and caller cannot redirect its zero-input loader', () => {
  const validate = require('../dist/rendering/phase-two/fixture/deterministic-render-fixture').validateFirstControlledFixtureAssetsForTestOnly;
  const expected = [
    { logicalId: 'product-front', sha256: '2c0af122cd390d90b175ed10682fc377622b2458654ae5dbc221c81b9f5b2b1e' },
    { logicalId: 'lace-base-close-up', sha256: 'e000ed0489acff9e4f2208e72c822a1a170e7df1905940851730fac9212098a9' },
    { logicalId: 'approved-audio', sha256: '990790c83918824382bf8a4da999a2fbf50f123fc1d78ffff7736fbb82e3aeb5' }
  ];
  assert.equal(validate('valid'), 'accepted');
  assert.equal(validate('legacy_png_visuals'), 'asset_invalid');
  for (const scenario of ['product_front_substituted', 'lace_base_substituted', 'audio_substituted'])
    assert.equal(validate(scenario), 'asset_invalid');
  assert.equal(trustedLocalRuntimeModule.loadFirstControlledFixtureAssets.length, 0);
  const nonRedirected = trustedLocalRuntimeModule.exerciseFirstControlledFixtureLoaderNonRedirectionForTestOnly('hostile_extra_arguments');
  assert.deepEqual(nonRedirected, { acceptedFixedIdentity: true, callerMaterialConsumed: false,
    logicalIds: expected.map((item) => item.logicalId),
    fileNames: ['product-front.ppm', 'lace-base-close-up.ppm', 'approved-audio.wav'],
    sha256: expected.map((item) => item.sha256) });
});

test('fixture rejects duration and local/probe size mismatch after processing and still cleans its workspace', async t => {
  for (const scenario of [
    { name: 'format duration mismatch', change: value => ({ ...value, durationSeconds: 29 }) },
    { name: 'video duration mismatch', change: value => ({ ...value, videoDurationSeconds: 29 }) },
    { name: 'audio duration mismatch', change: value => ({ ...value, audioDurationSeconds: 29 }) },
    { name: 'local and probe size mismatch', change: value => ({ ...value, byteLength: value.byteLength + 1 }) }
  ]) await t.test(scenario.name, async () => { const harness = await orchestrationHarness({ inspector: { async inspect(outputPath) {
      const bytes = await readFile(outputPath); return scenario.change(validInspection(bytes.length)); } } });
    try { await rejects(renderDeterministicFixture(harness.request, harness.composition), 'output_invalid');
      assert.deepEqual(harness.counts(), { processCalls: 1, cleanupCalls: 1 });
    } finally { await rm(harness.appRoot, { recursive: true, force: true }); } });
});

test('first-controlled retention is byte-identical, hash-bound, idempotent, and conflict-closed', async () => {
  const exercise = require('../dist/rendering/phase-two/fixture/deterministic-render-fixture').exerciseFirstControlledRetentionForTestOnly;
  const retained = await exercise('retained'); assert.deepEqual(retained, { outcome: 'retained', byteIdentical: true, hashMatches: true });
  const idempotent = await exercise('idempotent'); assert.deepEqual(idempotent, { outcome: 'idempotent', byteIdentical: true, hashMatches: true });
  const conflict = await exercise('different_existing'); assert.deepEqual(conflict,
    { outcome: 'workspace_invalid', byteIdentical: false, hashMatches: false });
});

test('first-controlled completion sequence retains only validated output and always cleans up', async t => {
  const exercise = require('../dist/rendering/phase-two/fixture/deterministic-render-fixture').exerciseFirstControlledCompletionSequenceForTestOnly;
  await t.test('valid output', async () => { const result = await exercise('valid_output');
    assert.deepEqual(result, { outcome: 'rendered', events: ['process', 'hash', 'inspect', 'validate', 'retain', 'production_cleanup'],
      retentionInvocationCount: 1, cleanupInvocationCount: 1, productionEligibility: 'prohibited' }); });
  await t.test('invalid output', async () => { const result = await exercise('invalid_output');
    assert.deepEqual(result, { outcome: 'output_invalid', events: ['process', 'hash', 'inspect', 'validate', 'production_cleanup'],
      retentionInvocationCount: 0, cleanupInvocationCount: 1 }); });
  await t.test('retention failure', async () => { const result = await exercise('retention_failure');
    assert.deepEqual(result, { outcome: 'workspace_invalid', events: ['process', 'hash', 'inspect', 'validate', 'retain', 'production_cleanup'],
      retentionInvocationCount: 1, cleanupInvocationCount: 1 }); });
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
    const bytes = await readFile(outputPath); return validInspection(bytes.length); } } });
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
