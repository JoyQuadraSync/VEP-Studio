import { VOLUVIA_VIDEO_ASSET_IDS, VoluviaVideoAssetId, VoluviaVideoPackage } from '../../workflows/examples/voluvia/video-package/voluvia-video-package-contracts';
import { VIDEO_SCENE_ASSETS } from '../../workflows/examples/voluvia/video-package/voluvia-video-package-compatibility';
import { RenderingPhaseOneFailure } from '../failures/rendering-phase-one-failure';

export const RENDERER_POLICY_VERSION = 1;
export type RenderingPurpose = 'internal_fixture' | 'final_candidate';
export type RendererClassification = 'm4b_deterministic';

export interface RendererSelectionInput {
  readonly productionPurpose: RenderingPurpose;
  readonly exactSubtitlesRequired: true;
  readonly exactSceneTimingRequired: true;
  readonly approvedAssetIds: readonly VoluviaVideoAssetId[];
}
export interface RendererSelection {
  readonly policyVersion: typeof RENDERER_POLICY_VERSION;
  readonly rendererClassification: RendererClassification;
  readonly productionPurpose: RenderingPurpose;
}

export function selectRenderer(pkg: VoluviaVideoPackage, input: RendererSelectionInput): RendererSelection {
  if ((input.productionPurpose !== 'internal_fixture' && input.productionPurpose !== 'final_candidate') ||
      input.exactSubtitlesRequired !== true || input.exactSceneTimingRequired !== true ||
      !Array.isArray(input.approvedAssetIds) ||
      input.approvedAssetIds.some((id) => typeof id !== 'string' || !VOLUVIA_VIDEO_ASSET_IDS.includes(id as VoluviaVideoAssetId)) ||
      new Set(input.approvedAssetIds).size !== input.approvedAssetIds.length) {
    throw new RenderingPhaseOneFailure('renderer_selection_failed');
  }
  const approved = [...input.approvedAssetIds].sort() as VoluviaVideoAssetId[];
  const available = new Set(approved);
  const evidenceAssets = pkg.scenes.flatMap((scene) => {
    const beforeAfter = /^(?:parting|crown)-(?:before|after)-view$/u.test(scene.sourceSuggestedScene);
    return pkg.summary.visualProofRequired || beforeAfter ? VIDEO_SCENE_ASSETS[scene.sourceSuggestedScene] : [];
  });
  if (pkg.assetChecklist.some((asset) => asset.required && !available.has(asset.assetId)) ||
      evidenceAssets.some((asset) => !available.has(asset))) {
    throw new RenderingPhaseOneFailure('renderer_selection_failed');
  }
  return Object.freeze({ policyVersion: RENDERER_POLICY_VERSION,
    rendererClassification: 'm4b_deterministic', productionPurpose: input.productionPurpose });
}
