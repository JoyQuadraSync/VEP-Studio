import { calculateCanonicalRenderIdentity } from '../identity/canonical-render-identity';
import { M3PackageIntegrityOptions, validateStandaloneM3Package } from '../integrity/m3-package-integrity-validator';
import { compileRenderManifest, RenderManifest } from '../manifest/render-manifest';
import { RendererSelectionInput, selectRenderer } from '../policy/renderer-selection-policy';

export interface DeterministicRenderDryRunResult {
  readonly resultKind: 'deterministic_render_dry_run';
  readonly productionEligibility: 'prohibited';
  readonly sourcePackageId: string;
  readonly sourcePackageRevisionHash: string;
  readonly rendererPolicyVersion: 1;
  readonly rendererClassification: 'm4b_deterministic';
  readonly manifest: RenderManifest;
  readonly canonicalRenderIdentity: string;
  readonly validationResult: 'valid';
}
export interface DryRunServices {
  readonly validate: typeof validateStandaloneM3Package;
  readonly select: typeof selectRenderer;
  readonly compile: typeof compileRenderManifest;
  readonly identify: typeof calculateCanonicalRenderIdentity;
}
const defaults: DryRunServices = Object.freeze({ validate: validateStandaloneM3Package,
  select: selectRenderer, compile: compileRenderManifest, identify: calculateCanonicalRenderIdentity });
export interface DryRunOptions extends M3PackageIntegrityOptions { readonly services?: DryRunServices }
export function runDeterministicRenderDryRun(value: unknown, input: RendererSelectionInput,
  options: DryRunOptions = {}): DeterministicRenderDryRunResult {
  const services = options.services ?? defaults;
  const validated = services.validate(value, { expectedPackageRevisionHash: options.expectedPackageRevisionHash });
  const selection = services.select(validated.package, input);
  const manifest = services.compile(validated.package, validated.packageRevisionHash);
  return Object.freeze({ resultKind: 'deterministic_render_dry_run', productionEligibility: 'prohibited',
    sourcePackageId: validated.packageId, sourcePackageRevisionHash: validated.packageRevisionHash,
    rendererPolicyVersion: selection.policyVersion,
    rendererClassification: selection.rendererClassification, manifest,
    canonicalRenderIdentity: services.identify(manifest, selection), validationResult: 'valid' });
}
