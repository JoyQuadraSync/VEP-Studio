import { RenderingPhaseTwoFailure } from '../failures/rendering-phase-two-failure';

export interface MediaInspectionResult {
  readonly container: 'mp4'; readonly byteLength: number; readonly width: number; readonly height: number;
  readonly frameRate: 30; readonly constantFrameRate: true; readonly durationSeconds: number;
  readonly streams: readonly ['video', 'audio']; readonly videoCodecFamily: 'h264'; readonly audioCodecFamily: 'aac';
}
export interface MediaInspector { inspect(outputPath: string): Promise<MediaInspectionResult> }

const capabilities = new WeakSet<object>();
const videoEvidenceCapabilities = new WeakSet<object>();
const capabilityConstructionToken = Object.freeze({});
export class TrustedMediaInspector {
  readonly inspector: MediaInspector; readonly executionTrust: 'test_only' = 'test_only';
  private constructor(inspector: MediaInspector, token: object) {
    if (token !== capabilityConstructionToken || !inspector || typeof inspector.inspect !== 'function') throw new RenderingPhaseTwoFailure('output_invalid');
    this.inspector = inspector; capabilities.add(this); Object.freeze(this);
  }
  static createTestOnly(inspector: MediaInspector): TrustedMediaInspector {
    return new TrustedMediaInspector(inspector, capabilityConstructionToken);
  }
}
export function getTrustedMediaInspector(value: unknown): MediaInspector {
  if (typeof value !== 'object' || value === null || !capabilities.has(value)) throw new RenderingPhaseTwoFailure('output_invalid');
  return (value as TrustedMediaInspector).inspector;
}
export function getMediaInspectorTrust(value: unknown): 'test_only' {
  if (typeof value !== 'object' || value === null || !capabilities.has(value)) throw new RenderingPhaseTwoFailure('output_invalid');
  return 'test_only';
}
export class TrustedInputVideoInspection {
  readonly issuedPath: string; readonly durationSeconds: number; readonly executionTrust: 'test_only';
  private constructor(issuedPath: string, durationSeconds: number, token: object) {
    if (token !== capabilityConstructionToken) throw new RenderingPhaseTwoFailure('asset_invalid');
    this.issuedPath = issuedPath; this.durationSeconds = durationSeconds; this.executionTrust = 'test_only';
    videoEvidenceCapabilities.add(this); Object.freeze(this);
  }
  static async inspect(trusted: TrustedMediaInspector, issuedPath: string): Promise<TrustedInputVideoInspection> {
    try { const result = await getTrustedMediaInspector(trusted).inspect(issuedPath);
      if (!result || typeof result.durationSeconds !== 'number' || !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0)
        throw new RenderingPhaseTwoFailure('asset_invalid');
      return new TrustedInputVideoInspection(issuedPath, result.durationSeconds, capabilityConstructionToken);
    } catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('asset_invalid'); }
  }
}
export function getTrustedInputVideoDuration(value: unknown, issuedPath: string): number {
  if (typeof value !== 'object' || value === null || !videoEvidenceCapabilities.has(value) ||
      (value as TrustedInputVideoInspection).issuedPath !== issuedPath || (value as TrustedInputVideoInspection).executionTrust !== 'test_only')
    throw new RenderingPhaseTwoFailure('asset_invalid');
  return (value as TrustedInputVideoInspection).durationSeconds;
}
