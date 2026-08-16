import { RenderManifest } from '../../manifest/render-manifest';
import { deepFreeze } from '../contracts/phase-two-contracts';
import { RenderingPhaseTwoFailure } from '../failures/rendering-phase-two-failure';

export const PHASE_TWO_RESOURCE_LIMITS = deepFreeze({ maximumTargetDurationSeconds: 45,
  maximumSceneCount: 5, maximumAssetCount: 20, maximumImageBytes: 20 * 1024 * 1024,
  maximumVideoBytes: 100 * 1024 * 1024, maximumAudioBytes: 25 * 1024 * 1024,
  maximumTotalInputBytes: 250 * 1024 * 1024, maximumWorkspaceBytes: 1024 * 1024 * 1024,
  maximumOutputBytes: 64 * 1024 * 1024, maximumSrtBytes: 256 * 1024, width: 1080,
  height: 1920, frameRate: 30, maximumProcessRuntimeMs: 180_000, terminationGraceMs: 5_000,
  concurrency: 1, minimumFreeWorkspaceBytes: 2 * 1024 * 1024 * 1024 } as const);
export type FixtureAssetKind = 'image' | 'video' | 'audio';
export interface FixtureAssetDescriptor { readonly logicalId: string; readonly kind: FixtureAssetKind; readonly byteLength: number; readonly durationSeconds?: number }
export interface ResourcePreflightInput { readonly manifest: RenderManifest; readonly assets: readonly FixtureAssetDescriptor[];
  readonly freeWorkspaceBytes: number; readonly activeWorkspaceBytes: number; readonly activeRenderCount: number; readonly width?: number;
  readonly height?: number; readonly frameRate?: number }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
export function validateResourcePreflight(input: ResourcePreflightInput): void {
  const limits = PHASE_TWO_RESOURCE_LIMITS;
  if (!input || !integer(input.freeWorkspaceBytes) || !integer(input.activeWorkspaceBytes) || input.activeRenderCount !== 1 ||
      !integer(input.manifest?.output?.targetDurationSeconds) || input.manifest.output.targetDurationSeconds > limits.maximumTargetDurationSeconds ||
      (input.width ?? limits.width) !== limits.width || (input.height ?? limits.height) !== limits.height ||
      (input.frameRate ?? limits.frameRate) !== limits.frameRate || !Array.isArray(input.manifest?.timeline?.scenes) ||
      input.manifest.timeline.scenes.length > limits.maximumSceneCount || !Array.isArray(input.assets) ||
      input.assets.length > limits.maximumAssetCount || input.freeWorkspaceBytes < limits.minimumFreeWorkspaceBytes ||
      input.activeWorkspaceBytes > limits.maximumWorkspaceBytes) throw new RenderingPhaseTwoFailure('resource_limit_exceeded');
  let total = 0;
  for (const asset of input.assets) {
    if (!asset || typeof asset.logicalId !== 'string' || !['image', 'video', 'audio'].includes(asset.kind) || !integer(asset.byteLength) ||
        (asset.durationSeconds !== undefined && !integer(asset.durationSeconds)) || (asset.kind === 'video' && asset.durationSeconds === undefined) ||
        (asset.kind === 'image' && asset.byteLength > limits.maximumImageBytes) ||
        (asset.kind === 'video' && asset.byteLength > limits.maximumVideoBytes) ||
        (asset.kind === 'audio' && asset.byteLength > limits.maximumAudioBytes)) throw new RenderingPhaseTwoFailure('resource_limit_exceeded');
    total += asset.byteLength; if (!Number.isSafeInteger(total) || total > limits.maximumTotalInputBytes) throw new RenderingPhaseTwoFailure('resource_limit_exceeded');
  }
  if (!Number.isSafeInteger(input.activeWorkspaceBytes + total) || input.activeWorkspaceBytes + total > limits.maximumWorkspaceBytes)
    throw new RenderingPhaseTwoFailure('resource_limit_exceeded');
}
