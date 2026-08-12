import { createHash } from 'node:crypto';
import { canonicalizeVideoPackageValue } from '../../workflows/examples/voluvia/video-package/voluvia-video-package-validator';
import { RenderingPhaseOneFailure } from '../failures/rendering-phase-one-failure';
import { RenderManifest } from '../manifest/render-manifest';
import { RendererSelection } from '../policy/renderer-selection-policy';

export const RENDER_CONTRACT_SCHEMA_VERSION = 1;
export function calculateCanonicalRenderIdentity(manifest: RenderManifest, selection: RendererSelection): string {
  try {
    const canonical = canonicalizeVideoPackageValue({ renderContractSchemaVersion: RENDER_CONTRACT_SCHEMA_VERSION,
      rendererPolicyVersion: selection.policyVersion,
      rendererClassification: selection.rendererClassification,
      productionPurpose: selection.productionPurpose,
      sourcePackageId: manifest.sourcePackageId,
      sourcePackageRevisionHash: manifest.sourcePackageRevisionHash,
      manifest });
    return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
  } catch { throw new RenderingPhaseOneFailure('manifest_identity_failed'); }
}
