import { VoluviaVideoPackage } from '../../workflows/examples/voluvia/video-package/voluvia-video-package-contracts';
import { RenderingPhaseOneFailure } from '../failures/rendering-phase-one-failure';

export const RENDER_MANIFEST_SCHEMA_VERSION = 1;
export interface RenderManifest {
  readonly schemaVersion: typeof RENDER_MANIFEST_SCHEMA_VERSION;
  readonly sourcePackageId: string;
  readonly sourcePackageRevisionHash: string;
  readonly output: { readonly aspectRatio: '9:16'; readonly resolutionClass: 'vertical-hd'; readonly targetDurationSeconds: number };
  readonly timeline: { readonly originSecond: 0; readonly transition: 'cut'; readonly scenes: readonly RenderScene[] };
  readonly subtitles: {
    readonly canonicalCues: readonly RenderSubtitleCue[];
    readonly sidecarIntent: { readonly required: true; readonly encoding: 'UTF-8'; readonly lineEndings: 'LF'; readonly format: 'srt' };
    readonly burnedInIntent: { readonly required: true; readonly fontConfiguration: 'phase-2-required'; readonly safeAreaConfiguration: 'phase-2-required' };
  };
  readonly audio: { readonly authority: 'approved_immutable_media_artifact_required'; readonly slots: readonly NarrationSlot[] };
}
export interface RenderScene { readonly sceneId: string; readonly sequence: number; readonly startSecond: number; readonly endSecond: number; readonly assetOccurrences: readonly { readonly assetId: string; readonly startSecond: number; readonly endSecond: number }[] }
export interface NarrationSlot { readonly segmentId: string; readonly sceneId: string; readonly text: string; readonly allocationWindow: { readonly sceneStartSecond: number; readonly sceneEndSecond: number }; readonly estimatedSpokenSeconds: number; readonly audioArtifactStatus: 'unresolved' }
export interface RenderSubtitleCue { readonly cueId: string; readonly sceneId: string; readonly lines: readonly string[]; readonly startSecond: number; readonly endSecond: number }

function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(freeze);
  }
  return value;
}
export function compileRenderManifest(pkg: VoluviaVideoPackage, revision: string): RenderManifest {
  if (!/^[a-f0-9]{64}$/u.test(revision)) throw new RenderingPhaseOneFailure('manifest_validation_failed');
  const scenes: RenderScene[] = pkg.scenes.map((scene) => ({ sceneId: scene.sceneId,
    sequence: scene.sequence, startSecond: scene.startSecond,
    endSecond: scene.startSecond + scene.durationSeconds,
    assetOccurrences: scene.requiredAssetIds.map((assetId) => ({ assetId,
      startSecond: scene.startSecond, endSecond: scene.startSecond + scene.durationSeconds })) }));
  const slots: NarrationSlot[] = pkg.voiceover.segments.map((segment) => {
    const scene = pkg.scenes.find((entry) => entry.sceneId === segment.sceneId);
    if (!scene) throw new RenderingPhaseOneFailure('manifest_validation_failed');
    return { segmentId: segment.segmentId, sceneId: segment.sceneId, text: segment.spokenText,
      allocationWindow: { sceneStartSecond: scene.startSecond,
        sceneEndSecond: scene.startSecond + scene.durationSeconds },
      estimatedSpokenSeconds: segment.estimatedSeconds, audioArtifactStatus: 'unresolved' };
  });
  const manifest: RenderManifest = { schemaVersion: RENDER_MANIFEST_SCHEMA_VERSION,
    sourcePackageId: pkg.packageId, sourcePackageRevisionHash: revision,
    output: { aspectRatio: '9:16', resolutionClass: 'vertical-hd', targetDurationSeconds: pkg.summary.targetDurationSeconds },
    timeline: { originSecond: 0, transition: 'cut', scenes },
    subtitles: { canonicalCues: pkg.narrationPackage.subtitleLines.map((cue) => ({ ...cue, lines: [...cue.lines] })),
      sidecarIntent: { required: true, encoding: 'UTF-8', lineEndings: 'LF', format: 'srt' },
      burnedInIntent: { required: true, fontConfiguration: 'phase-2-required', safeAreaConfiguration: 'phase-2-required' } },
    audio: { authority: 'approved_immutable_media_artifact_required', slots } };
  if (scenes[0]?.startSecond !== 0 || scenes.at(-1)?.endSecond !== pkg.summary.targetDurationSeconds ||
      scenes.some((scene, index) => index > 0 && scenes[index - 1]!.endSecond !== scene.startSecond)) {
    throw new RenderingPhaseOneFailure('manifest_validation_failed');
  }
  return freeze(manifest);
}
