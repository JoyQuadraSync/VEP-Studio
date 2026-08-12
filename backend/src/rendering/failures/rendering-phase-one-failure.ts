export const RENDERING_PHASE_ONE_FAILURE_CODES = [
  'invalid_source_identity', 'package_validation_failed', 'package_revision_mismatch',
  'renderer_selection_failed', 'manifest_validation_failed',
  'manifest_identity_failed', 'unsafe_json', 'unknown_field', 'local_validation'
] as const;

export type RenderingPhaseOneFailureCode = typeof RENDERING_PHASE_ONE_FAILURE_CODES[number];

export class RenderingPhaseOneFailure {
  readonly name = 'RenderingPhaseOneFailure';
  readonly code: RenderingPhaseOneFailureCode;
  constructor(code: RenderingPhaseOneFailureCode) {
    if (!RENDERING_PHASE_ONE_FAILURE_CODES.includes(code)) {
      throw new TypeError('Invalid rendering failure category.');
    }
    this.code = code;
    Object.freeze(this);
  }
}
