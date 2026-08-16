import { createHash } from 'node:crypto';
import { canonicalizeVideoPackageValue } from '../../../workflows/examples/voluvia/video-package/voluvia-video-package-validator';
import { RenderManifest } from '../../manifest/render-manifest';
import { deepFreeze } from '../contracts/phase-two-contracts';
import { RenderingPhaseTwoFailure } from '../failures/rendering-phase-two-failure';
import { PHASE_TWO_RESOURCE_LIMITS } from '../resources/resource-limits';
import { PHASE_TWO_SUBTITLE_STYLE } from '../subtitles/subtitle-boundary';
import { PHASE_TWO_TOOLCHAIN_PROFILE } from '../toolchain/toolchain-profile';
import { getTrustedInputVideoDuration, TrustedInputVideoInspection } from '../inspection/media-inspector';

export interface LogicalAssetReference { readonly logicalId: string; readonly kind: 'image' | 'video' | 'audio'; readonly durationSeconds?: number }
export interface LogicalFfmpegCommandManifest {
  readonly schemaVersion: 1;
  readonly executable: 'trusted-ffmpeg-8.1.2';
  readonly sourcePackageId: string;
  readonly sourcePackageRevisionHash: string;
  readonly timeline: RenderManifest['timeline'];
  readonly subtitles: { readonly cues: readonly { readonly cueId: string; readonly sceneId: string; readonly startSecond: number; readonly endSecond: number }[];
    readonly source: 'resolver-issued-text-files'; readonly layoutVerification: 'trusted-pinned-font-required'; readonly style: typeof PHASE_TWO_SUBTITLE_STYLE };
  readonly assets: readonly LogicalAssetReference[];
  readonly encoding: typeof PHASE_TWO_TOOLCHAIN_PROFILE;
  readonly limits: typeof PHASE_TWO_RESOURCE_LIMITS;
  readonly outputNames: readonly ['fixture.mp4', 'subtitles.srt'];
}
export interface ResolvedFfmpegExecution {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly shell: false;
  readonly inputPaths: readonly string[];
  readonly outputPaths: readonly string[];
  readonly measuredVideoDurations: Readonly<Record<string, number>>;
  readonly executionTrust: 'test_only' | 'trusted_local_reference';
}
const resolvedExecutionTrust = new WeakMap<object, 'test_only' | 'trusted_local_reference'>();
export function assertTrustedLocalResolvedExecution(value: unknown): asserts value is ResolvedFfmpegExecution {
  if (typeof value !== 'object' || value === null || resolvedExecutionTrust.get(value) !== 'trusted_local_reference')
    throw new RenderingPhaseTwoFailure('process_failed');
}
export interface CommandManifestResult {
  readonly logicalManifest: LogicalFfmpegCommandManifest;
  readonly commandManifestSha256: string;
}

export function buildLogicalCommandManifest(manifest: RenderManifest,
  assets: readonly LogicalAssetReference[]): CommandManifestResult {
  if (!Array.isArray(assets) || new Set(assets.map((asset) => asset.logicalId)).size !== assets.length ||
      assets.some((asset) => !/^[a-z0-9][a-z0-9-]{0,99}$/u.test(asset.logicalId))) {
    throw new RenderingPhaseTwoFailure('command_manifest_invalid');
  }
  const logicalManifest: LogicalFfmpegCommandManifest = deepFreeze({ schemaVersion: 1,
    executable: 'trusted-ffmpeg-8.1.2', sourcePackageId: manifest.sourcePackageId,
    sourcePackageRevisionHash: manifest.sourcePackageRevisionHash, timeline: manifest.timeline,
    subtitles: { cues: manifest.subtitles.canonicalCues.map(({ cueId, sceneId, startSecond, endSecond }) => ({ cueId, sceneId, startSecond, endSecond })),
      source: 'resolver-issued-text-files', layoutVerification: 'trusted-pinned-font-required', style: PHASE_TWO_SUBTITLE_STYLE },
    assets: [...assets].sort((left, right) => left.logicalId < right.logicalId ? -1 : left.logicalId > right.logicalId ? 1 : 0),
    encoding: PHASE_TWO_TOOLCHAIN_PROFILE, limits: PHASE_TWO_RESOURCE_LIMITS,
    outputNames: ['fixture.mp4', 'subtitles.srt'] });
  try {
    const canonical = canonicalizeVideoPackageValue(logicalManifest);
    return deepFreeze({ logicalManifest,
      commandManifestSha256: createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex') });
  } catch { throw new RenderingPhaseTwoFailure('command_manifest_invalid'); }
}

export interface ExecutionPathResolution {
  readonly executablePath: string;
  readonly fontPath: string;
  readonly assetPaths: Readonly<Record<string, string>>;
  readonly subtitleTextFilePaths: readonly string[];
  readonly outputMp4Path: string;
  readonly outputSrtPath: string;
  readonly videoInspections: Readonly<Record<string, TrustedInputVideoInspection>>;
}

export function resolveExecutionManifest(logical: LogicalFfmpegCommandManifest,
  paths: ExecutionPathResolution, assertTrustedPath: (value: string) => void): ResolvedFfmpegExecution {
  try {
    assertTrustedPath(paths.executablePath); assertTrustedPath(paths.fontPath);
    assertTrustedPath(paths.outputMp4Path); assertTrustedPath(paths.outputSrtPath);
    Object.values(paths.assetPaths).forEach(assertTrustedPath); paths.subtitleTextFilePaths.forEach(assertTrustedPath);
  } catch { throw new RenderingPhaseTwoFailure('command_manifest_invalid'); }
  if (paths.subtitleTextFilePaths.length !== logical.subtitles.cues.length ||
      logical.assets.some((asset) => paths.assetPaths[asset.logicalId] === undefined)) {
    throw new RenderingPhaseTwoFailure('command_manifest_invalid');
  }
  const measuredVideoDurations: Record<string, number> = {};
  for (const asset of logical.assets) if (asset.kind === 'video') {
    measuredVideoDurations[asset.logicalId] = getTrustedInputVideoDuration(paths.videoInspections[asset.logicalId], paths.assetPaths[asset.logicalId]!);
  }
  const args: string[] = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y'];
  for (const asset of logical.assets) {
    if (asset.kind === 'image') args.push('-loop', '1');
    args.push('-i', paths.assetPaths[asset.logicalId]!);
  }
  const assetIndex = new Map(logical.assets.map((asset, index) => [asset.logicalId, index]));
  const sceneFilters = logical.timeline.scenes.flatMap((scene, sceneIndex) => {
    if (scene.assetOccurrences.length === 0 || scene.assetOccurrences.length > 2) throw new RenderingPhaseTwoFailure('command_manifest_invalid');
    const duration = scene.endSecond - scene.startSecond; const filters: string[] = [];
    const labels: string[] = [];
    for (const [occurrenceIndex, occurrence] of scene.assetOccurrences.entries()) {
      const sourceIndex = assetIndex.get(occurrence.assetId);
      if (sourceIndex === undefined || logical.assets[sourceIndex]?.kind === 'audio' ||
          occurrence.startSecond !== scene.startSecond || occurrence.endSecond !== scene.endSecond) throw new RenderingPhaseTwoFailure('command_manifest_invalid');
      const label = `s${sceneIndex}a${occurrenceIndex}`; labels.push(label);
      const asset = logical.assets[sourceIndex]!;
      if (asset.kind === 'video' && measuredVideoDurations[asset.logicalId]! < duration) throw new RenderingPhaseTwoFailure('asset_invalid');
      const width = scene.assetOccurrences.length === 1 ? 1080 : 540;
      filters.push(`[${sourceIndex}:v]scale=${width}:1920:force_original_aspect_ratio=decrease,pad=${width}:1920:(ow-iw)/2:(oh-ih)/2:black,trim=duration=${duration},setpts=PTS-STARTPTS[${label}]`);
    }
    let current = labels[0]!;
    for (let index = 1; index < labels.length; index += 1) {
      const output = index === labels.length - 1 ? `v${sceneIndex}` : `s${sceneIndex}o${index}`;
      filters.push(`[${current}][${labels[index]}]hstack=inputs=2:shortest=0[${output}]`); current = output;
    }
    if (labels.length === 1) filters.push(`[${current}]null[v${sceneIndex}]`);
    return filters;
  });
  const concatInputs = logical.timeline.scenes.map((_, index) => `[v${index}]`).join('');
  const subtitleFilters = paths.subtitleTextFilePaths.map((textPath, index) => {
    const cue = logical.subtitles.cues[index]!; const inputLabel = index === 0 ? 'base' : `sub${index}`;
    const outputLabel = index === paths.subtitleTextFilePaths.length - 1 ? 'videoout' : `sub${index + 1}`;
    return `[${inputLabel}]drawtext=fontfile='${escapeFilterPath(paths.fontPath)}':textfile='${escapeFilterPath(textPath)}':fontsize=64:fontcolor=white:borderw=4:bordercolor=black:shadowx=0:shadowy=0:box=1:boxcolor=black@0.65:boxborderw=24:line_spacing=12:text_align=C:x=max(90\,min(990-text_w\,(w-text_w)/2)):y=max(1180\,min(1500-text_h\,1180)):enable='between(t\,${cue.startSecond}\,${cue.endSecond})'[${outputLabel}]`;
  });
  const audio = logical.assets.findIndex((asset) => asset.kind === 'audio');
  if (audio < 0) throw new RenderingPhaseTwoFailure('command_manifest_invalid');
  const duration = logical.timeline.scenes.at(-1)?.endSecond;
  if (duration === undefined || !Number.isSafeInteger(duration) || duration <= 0) throw new RenderingPhaseTwoFailure('command_manifest_invalid');
  const filterGraph = [...sceneFilters, `${concatInputs}concat=n=${logical.timeline.scenes.length}:v=1:a=0,trim=duration=${duration},setpts=PTS-STARTPTS[base]`,
    ...subtitleFilters, `[${audio}:a]atrim=duration=${duration},apad=whole_dur=${duration},asetpts=PTS-STARTPTS[audioout]`].join(';');
  args.push('-filter_complex', filterGraph, '-map', '[videoout]', '-map', '[audioout]',
    '-c:v', 'libopenh264', '-profile:v', 'constrained_baseline',
    '-level:v', '4.2', '-pix_fmt', 'yuv420p', '-r', '30', '-vsync', 'cfr', '-b:v', '8000000',
    '-maxrate', '8000000', '-bufsize', '16000000', '-g', '60', '-bf', '0', '-threads', '1',
    '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2', '-b:a', '192000',
    '-map_metadata', '-1', '-map_chapters', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact',
    '-flags:a', '+bitexact', '-t', String(duration), paths.outputMp4Path);
  const resolved: ResolvedFfmpegExecution = deepFreeze({ executablePath: paths.executablePath, args, shell: false,
    inputPaths: [paths.fontPath, ...Object.values(paths.assetPaths), ...paths.subtitleTextFilePaths],
    outputPaths: [paths.outputMp4Path, paths.outputSrtPath], measuredVideoDurations, executionTrust: 'test_only' });
  resolvedExecutionTrust.set(resolved, 'test_only'); return resolved;
}

function escapeFilterPath(value: string): string {
  return value.replace(/\\/gu, '/').replace(/([\\':,;\[\]=% ])/gu, '\\$1');
}
