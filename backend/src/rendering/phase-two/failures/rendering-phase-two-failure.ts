export const RENDERING_PHASE_TWO_FAILURE_CODES = [
  'toolchain_invalid', 'font_invalid', 'resource_limit_exceeded', 'workspace_invalid',
  'asset_invalid', 'subtitle_invalid', 'glyph_unsupported', 'command_manifest_invalid',
  'process_timeout', 'process_failed', 'output_invalid', 'artifact_hash_failed',
  'cleanup_failed', 'local_validation'
] as const;

export type RenderingPhaseTwoFailureCode = typeof RENDERING_PHASE_TWO_FAILURE_CODES[number];

export class RenderingPhaseTwoFailure {
  readonly name = 'RenderingPhaseTwoFailure';
  readonly code: RenderingPhaseTwoFailureCode;

  constructor(code: RenderingPhaseTwoFailureCode) {
    if (!RENDERING_PHASE_TWO_FAILURE_CODES.includes(code)) {
      throw new TypeError('Invalid rendering phase-two failure category.');
    }
    this.code = code;
    Object.freeze(this);
  }
}
