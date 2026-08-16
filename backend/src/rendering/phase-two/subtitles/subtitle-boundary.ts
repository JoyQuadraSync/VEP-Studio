import { createHash } from 'node:crypto';
import { RenderManifest, RenderSubtitleCue } from '../../manifest/render-manifest';
import { PHASE_TWO_RESOURCE_LIMITS } from '../resources/resource-limits';
import { RenderingPhaseTwoFailure } from '../failures/rendering-phase-two-failure';
import { deepFreeze } from '../contracts/phase-two-contracts';

export const PHASE_TWO_SUBTITLE_STYLE = deepFreeze({ canvas: { width: 1080, height: 1920 },
  horizontalSafeBounds: { minimumX: 90, maximumX: 990, maximumWidth: 900 },
  verticalRegion: { minimumY: 1180, maximumY: 1500, topExclusion: 180, bottomExclusion: 420 },
  fontSize: 64, lineSpacing: 12, alignment: 'center', fontWeight: 700, fontWidthAxis: 100,
  textColor: 'FFFFFFFF', outlineColor: '000000FF', outlineWidth: 4, shadow: 'disabled',
  backgroundColor: '000000A6', padding: 24, maximumLines: 2, animation: 'prohibited', interpolation: 'prohibited'
} as const);
export interface CanonicalSrt { readonly text: string; readonly sha256: string; bytes(): Buffer }
function milliseconds(value: number): number { const result = value * 1000;
  if (!Number.isSafeInteger(result) || result < 0) throw new RenderingPhaseTwoFailure('subtitle_invalid'); return result; }
function timestamp(value: number): string { const ms = milliseconds(value); const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000); const seconds = Math.floor((ms % 60_000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; }
function hasLoneSurrogate(value: string): boolean { for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(index + 1); if (!(next >= 0xdc00 && next <= 0xdfff)) return true; index += 1; }
  else if (code >= 0xdc00 && code <= 0xdfff) return true; } return false; }
export function buildCanonicalSrt(cues: readonly RenderSubtitleCue[], manifest?: RenderManifest): CanonicalSrt {
  let priorEnd = 0; const blocks = cues.map((cue, index) => { const scene = manifest?.timeline.scenes.find((entry) => entry.sceneId === cue.sceneId);
    if (!Array.isArray(cue.lines) || cue.lines.length < 1 || cue.lines.length > PHASE_TWO_SUBTITLE_STYLE.maximumLines ||
      cue.lines.some((line) => typeof line !== 'string' || line.includes('\r') || line.includes('\n') || hasLoneSurrogate(line)) ||
      cue.startSecond < priorEnd || cue.endSecond <= cue.startSecond || (manifest !== undefined && (!scene || cue.startSecond < scene.startSecond ||
      cue.endSecond > scene.endSecond || cue.endSecond > manifest.output.targetDurationSeconds))) throw new RenderingPhaseTwoFailure('subtitle_invalid');
    priorEnd = cue.endSecond; return `${index + 1}\n${timestamp(cue.startSecond)} --> ${timestamp(cue.endSecond)}\n${cue.lines.join('\n')}`; });
  const text = `${blocks.join('\n\n')}\n`; const privateBytes = Buffer.from(text, 'utf8');
  if (privateBytes.length > PHASE_TWO_RESOURCE_LIMITS.maximumSrtBytes) throw new RenderingPhaseTwoFailure('resource_limit_exceeded');
  const sha256 = createHash('sha256').update(privateBytes).digest('hex'); return Object.freeze({ text, sha256, bytes: () => Buffer.from(privateBytes) });
}
export interface FontCoverage { supports(codePoint: number): boolean }
const coverageCapabilities = new WeakSet<object>();
export class TrustedFontCoverage { readonly fontSha256: string; readonly coverage: FontCoverage; readonly executionTrust: 'test_only' = 'test_only';
  private constructor(fontSha256: string, coverage: FontCoverage) { this.fontSha256 = fontSha256; this.coverage = coverage; coverageCapabilities.add(this); Object.freeze(this); }
  static createTestOnly(fontSha256: string, coverage: FontCoverage): TrustedFontCoverage { return new TrustedFontCoverage(fontSha256, coverage); } }
export function validateSubtitleGlyphCoverage(cues: readonly RenderSubtitleCue[], trusted: TrustedFontCoverage, expectedFontSha256?: string): void {
  if (typeof trusted !== 'object' || trusted === null || !coverageCapabilities.has(trusted) || trusted.executionTrust !== 'test_only' ||
    (expectedFontSha256 !== undefined && trusted.fontSha256 !== expectedFontSha256)) throw new RenderingPhaseTwoFailure('font_invalid');
  for (const cue of cues) for (const line of cue.lines) for (const scalar of line) { const codePoint = scalar.codePointAt(0);
    if (codePoint === undefined || !trusted.coverage.supports(codePoint)) throw new RenderingPhaseTwoFailure('glyph_unsupported'); }
}
export interface FontMetricImplementation { measureLine(text: string, configuration: { readonly fontSize: 64; readonly weight: 700; readonly widthAxis: 100 }):
  { readonly widthPx: number; readonly heightPx: number } }
const layoutCapabilities = new WeakSet<object>();
export class TrustedSubtitleLayoutCapability {
  readonly executionTrust: 'test_only' = 'test_only'; readonly fontSha256: string; readonly fontIdentity: 'Noto Sans@2.015'; readonly #metrics: FontMetricImplementation;
  private constructor(fontSha256: string, metrics: FontMetricImplementation) { this.fontSha256 = fontSha256; this.fontIdentity = 'Noto Sans@2.015';
    this.#metrics = metrics; layoutCapabilities.add(this); Object.freeze(this); }
  static createTestOnly(fontSha256: string, metrics: FontMetricImplementation): TrustedSubtitleLayoutCapability { return new TrustedSubtitleLayoutCapability(fontSha256, metrics); }
  verify(lines: readonly string[], expectedFontSha256: string): void {
    if (!layoutCapabilities.has(this) || this.fontSha256 !== expectedFontSha256 || !Array.isArray(lines) || lines.length < 1 || lines.length > 2)
      throw new RenderingPhaseTwoFailure('subtitle_invalid');
    let maximumWidth = 0; let lineHeight = 0;
    for (const line of lines) { const measured = this.#metrics.measureLine(line, { fontSize: 64, weight: 700, widthAxis: 100 });
      if (!Number.isFinite(measured.widthPx) || !Number.isFinite(measured.heightPx) || measured.widthPx < 0 || measured.heightPx <= 0)
        throw new RenderingPhaseTwoFailure('subtitle_invalid'); maximumWidth = Math.max(maximumWidth, measured.widthPx); lineHeight = Math.max(lineHeight, measured.heightPx); }
    const blockWidth = maximumWidth + 48; const blockHeight = lineHeight * lines.length + (lines.length - 1) * 12 + 48;
    if (blockWidth > 900 || blockHeight > 320 || 90 + blockWidth > 990 || 1180 + blockHeight > 1500) throw new RenderingPhaseTwoFailure('subtitle_invalid');
  }
}
export function assertTrustedSubtitleLayout(value: unknown, expectedTrust: 'test_only'): asserts value is TrustedSubtitleLayoutCapability {
  if (typeof value !== 'object' || value === null || !layoutCapabilities.has(value) || (value as TrustedSubtitleLayoutCapability).executionTrust !== expectedTrust)
    throw new RenderingPhaseTwoFailure('subtitle_invalid');
}
