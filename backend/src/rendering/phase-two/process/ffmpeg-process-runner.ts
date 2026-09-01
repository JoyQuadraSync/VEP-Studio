import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { RenderingPhaseTwoFailure } from '../failures/rendering-phase-two-failure';
import { assertTrustedLocalResolvedExecution, ResolvedFfmpegExecution } from '../command/ffmpeg-command-manifest';
import { PHASE_TWO_RESOURCE_LIMITS } from '../resources/resource-limits';

export interface ProcessExecutionResult { readonly exitCode: number }
export interface FfmpegProcessRunner { run(command: ResolvedFfmpegExecution): Promise<ProcessExecutionResult> }
export interface ProcessInvocationPolicy { readonly timeoutMs: 180000; readonly gracefulTerminationMs: 5000 }
interface ProcessInvocationAdapter {
  execute(command: ResolvedFfmpegExecution, policy: ProcessInvocationPolicy): Promise<{
    readonly exitCode: number; readonly timedOut: boolean; readonly stderrBytes: number; readonly signalTerminated: boolean;
    readonly boundedStderr: Uint8Array }>;
}
type ProcessFailureSubcategory = 'spawn_error' | 'nonzero_exit' | 'signal' | 'timeout' | 'stderr_limit' | 'process_adapter';
type NonzeroExitCauseFamily = 'resource_or_io' | 'invalid_option' | 'drawtext_or_font' | 'input_open_or_decode' |
  'filtergraph_parse_or_init' | 'encoder_initialization' | 'muxer_or_output' | 'unknown_nonzero_exit';
type NonzeroExitDiagnosticSignal = 'openh264_create_encoder_failed' | 'openh264_initialize_failed' |
  'openh264_encode_frame_failed' | 'openh264_invalid_max_nal_size' | 'decoder_initialization_failed' |
  'filter_initialization_failed' | 'filter_configuration_failed' | 'unknown_nonzero_exit_signal';
type ClosedMarkerId = 'resource_memory' | 'resource_space' | 'resource_files' | 'option_unrecognized' | 'option_missing' |
  'drawtext_initialize' | 'font_load' | 'font_missing' | 'input_open' | 'input_invalid_data' | 'filter_complex_initialize' |
  'filter_missing' | 'encoder_open' | 'encoder_unknown' | 'output_open' | 'output_header' | 'openh264_create' |
  'openh264_initialize' | 'openh264_encode' | 'openh264_max_nal' | 'decoder_open_colon' | 'decoder_open' |
  'filter_configure_graph' | 'filter_configure_pad' | 'filter_initialize' | 'filter_reinitialize';
type ProcessFailureObservation = Readonly<
  | { kind: 'spawn_error' | 'process_adapter' }
  | { kind: 'completed'; exitCode: number; timedOut: boolean; stderrBytes: number; signalTerminated: boolean;
      boundedStderr: Uint8Array }>;
interface ProcessFailureClassification {
  readonly outcome: 'success' | 'process_failed' | 'process_timeout';
  readonly subcategory?: ProcessFailureSubcategory;
  readonly nonzeroExitCause?: NonzeroExitCauseFamily;
  readonly nonzeroExitDiagnosticSignal?: NonzeroExitDiagnosticSignal;
}
export interface ClosedProcessFailureObservationV1 {
  readonly schemaVersion: 1; readonly publicFailureCode: 'process_failed' | 'process_timeout';
  readonly processFailureSubcategory: ProcessFailureSubcategory;
  readonly causeFamily: NonzeroExitCauseFamily | 'unavailable';
  readonly diagnosticSignal: NonzeroExitDiagnosticSignal | 'unavailable';
  readonly markerHits: readonly ClosedMarkerId[]; readonly observationFingerprint: string;
  readonly stderrObservation: Readonly<{ totalByteCountBucket: 'zero' | 'one_to_1024' | '1025_to_8192' | '8193_to_65536' | 'over_65536';
    retainedByteCountBucket: 'zero' | 'one_to_1024' | '1025_to_8192' | '8193_to_65535' | '65536'; truncated: boolean;
    lineCountBucket: 'zero' | 'one' | 'two_to_four' | 'five_to_sixteen' | 'more_than_sixteen';
    asciiByteBucket: 'none' | 'low' | 'medium' | 'high'; nonAsciiByteBucket: 'none' | 'present'; controlByteBucket: 'none' | 'present' }>;
}
const processFailureDiagnostics = new WeakMap<object, ProcessFailureSubcategory>();
const nonzeroExitCauseDiagnostics = new WeakMap<object, NonzeroExitCauseFamily>();
const nonzeroExitDiagnosticSignals = new WeakMap<object, NonzeroExitDiagnosticSignal>();
const closedFailureObservations = new WeakMap<object, ClosedProcessFailureObservationV1>();
const consumedClosedFailureObservations = new WeakSet<object>();
const STDERR_LIMIT_BYTES = 64 * 1024;
const PROCESS_FAILURE_SCENARIOS: readonly ProcessFailureSubcategory[] = Object.freeze([
  'spawn_error', 'nonzero_exit', 'signal', 'timeout', 'stderr_limit', 'process_adapter'
]);
const NONZERO_EXIT_CAUSE_SCENARIOS = Object.freeze([
  'resource_or_io', 'invalid_option', 'drawtext_or_font', 'input_open_or_decode', 'filtergraph_parse_or_init',
  'encoder_initialization', 'muxer_or_output', 'unknown_nonzero_exit', 'split_marker_across_chunks',
  'generic_invalid_argument_only'
] as const);
type NonzeroExitCauseScenario = typeof NONZERO_EXIT_CAUSE_SCENARIOS[number];
const NONZERO_EXIT_DIAGNOSTIC_SIGNAL_SCENARIOS = Object.freeze([
  'openh264_create_encoder_failed', 'openh264_initialize_failed', 'openh264_encode_frame_failed',
  'openh264_invalid_max_nal_size', 'decoder_initialization_failed', 'filter_initialization_failed',
  'filter_configuration_failed', 'unknown_nonzero_exit_signal', 'specific_before_generic'
] as const);
type NonzeroExitDiagnosticSignalScenario = typeof NONZERO_EXIT_DIAGNOSTIC_SIGNAL_SCENARIOS[number];
interface CauseMarkerDefinition { readonly id: ClosedMarkerId; readonly bytes: Uint8Array;
  readonly causeFamily: Exclude<NonzeroExitCauseFamily, 'unknown_nonzero_exit'> }
interface SignalMarkerDefinition { readonly id: ClosedMarkerId; readonly bytes: Uint8Array;
  readonly signal: Exclude<NonzeroExitDiagnosticSignal, 'unknown_nonzero_exit_signal'> }
const causeMarker = (id: ClosedMarkerId, causeFamily: CauseMarkerDefinition['causeFamily'], value: string): CauseMarkerDefinition =>
  Object.freeze({ id, causeFamily, bytes: Buffer.from(value, 'ascii') });
const signalMarker = (id: ClosedMarkerId, signal: SignalMarkerDefinition['signal'], value: string): SignalMarkerDefinition =>
  Object.freeze({ id, signal, bytes: Buffer.from(value, 'ascii') });
const NONZERO_EXIT_MARKERS: readonly CauseMarkerDefinition[] = Object.freeze([
  causeMarker('resource_memory', 'resource_or_io', 'cannot allocate memory'), causeMarker('resource_space', 'resource_or_io', 'no space left on device'),
  causeMarker('resource_files', 'resource_or_io', 'too many open files'), causeMarker('option_unrecognized', 'invalid_option', 'unrecognized option'),
  causeMarker('option_missing', 'invalid_option', 'option not found'), causeMarker('drawtext_initialize', 'drawtext_or_font', "error initializing filter 'drawtext'"),
  causeMarker('font_load', 'drawtext_or_font', 'could not load font'), causeMarker('font_missing', 'drawtext_or_font', 'cannot find a valid font'),
  causeMarker('input_open', 'input_open_or_decode', 'error opening input file'), causeMarker('input_invalid_data', 'input_open_or_decode', 'invalid data found when processing input'),
  causeMarker('filter_complex_initialize', 'filtergraph_parse_or_init', 'error initializing complex filters'), causeMarker('filter_missing', 'filtergraph_parse_or_init', 'no such filter:'),
  causeMarker('encoder_open', 'encoder_initialization', 'error while opening encoder'), causeMarker('encoder_unknown', 'encoder_initialization', 'unknown encoder'),
  causeMarker('output_open', 'muxer_or_output', 'error opening output file'), causeMarker('output_header', 'muxer_or_output', 'could not write header')
]);
const NONZERO_EXIT_DIAGNOSTIC_SIGNAL_MARKERS: readonly SignalMarkerDefinition[] = Object.freeze([
  signalMarker('openh264_create', 'openh264_create_encoder_failed', 'unable to create encoder'),
  signalMarker('openh264_initialize', 'openh264_initialize_failed', 'initialize failed'),
  signalMarker('openh264_encode', 'openh264_encode_frame_failed', 'encodeframe failed'),
  signalMarker('openh264_max_nal', 'openh264_invalid_max_nal_size', 'invalid -max_nal_size'),
  signalMarker('decoder_open_colon', 'decoder_initialization_failed', 'error while opening decoder:'),
  signalMarker('decoder_open', 'decoder_initialization_failed', 'error opening decoder'),
  signalMarker('filter_configure_graph', 'filter_configuration_failed', 'error configuring filter graph:'),
  signalMarker('filter_configure_pad', 'filter_configuration_failed', 'failed to configure output pad on'),
  signalMarker('filter_initialize', 'filter_initialization_failed', 'error initializing filters'),
  signalMarker('filter_reinitialize', 'filter_initialization_failed', 'error reinitializing filters')
]);
class ProcessInvocationFailure {
  readonly subcategory: 'spawn_error';
  constructor() { this.subcategory = 'spawn_error'; Object.freeze(this); }
}

function assertNever(value: never): never { void value; throw new RenderingPhaseTwoFailure('process_failed'); }
function isProcessFailureSubcategory(value: unknown): value is ProcessFailureSubcategory {
  return typeof value === 'string' && PROCESS_FAILURE_SCENARIOS.some((scenario) => scenario === value);
}
function isNonzeroExitCauseScenario(value: unknown): value is NonzeroExitCauseScenario {
  return typeof value === 'string' && NONZERO_EXIT_CAUSE_SCENARIOS.some((scenario) => scenario === value);
}
function isNonzeroExitDiagnosticSignalScenario(value: unknown): value is NonzeroExitDiagnosticSignalScenario {
  return typeof value === 'string' && NONZERO_EXIT_DIAGNOSTIC_SIGNAL_SCENARIOS.some((scenario) => scenario === value);
}
function foldAscii(bytes: Uint8Array): Uint8Array {
  const folded = new Uint8Array(Math.min(bytes.byteLength, STDERR_LIMIT_BYTES));
  for (let index = 0; index < folded.byteLength; index += 1) {
    const value = bytes[index]!; folded[index] = value >= 0x41 && value <= 0x5a ? value + 0x20 : value;
  }
  return folded;
}
function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false;
  outer: for (let start = 0; start <= haystack.byteLength - needle.byteLength; start += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1)
      if (haystack[start + offset] !== needle[offset]) continue outer;
    return true;
  }
  return false;
}
function classifyNonzeroExitCause(bytes: Uint8Array): NonzeroExitCauseFamily {
  const folded = foldAscii(bytes);
  for (const marker of NONZERO_EXIT_MARKERS) if (containsBytes(folded, marker.bytes)) return marker.causeFamily;
  return 'unknown_nonzero_exit';
}
function classifyNonzeroExitDiagnosticSignal(bytes: Uint8Array): NonzeroExitDiagnosticSignal {
  const folded = foldAscii(bytes);
  for (const marker of NONZERO_EXIT_DIAGNOSTIC_SIGNAL_MARKERS) if (containsBytes(folded, marker.bytes)) return marker.signal;
  return 'unknown_nonzero_exit_signal';
}
function appendBoundedStderr(chunks: readonly Uint8Array[], chunk: Uint8Array): readonly Uint8Array[] {
  const retainedBytes = chunks.reduce((total, current) => total + current.byteLength, 0);
  const remaining = STDERR_LIMIT_BYTES - retainedBytes;
  if (remaining <= 0) return chunks;
  return Object.freeze([...chunks, Uint8Array.from(chunk.subarray(0, remaining))]);
}
function bucketTotal(value: number): ClosedProcessFailureObservationV1['stderrObservation']['totalByteCountBucket'] {
  return value === 0 ? 'zero' : value <= 1024 ? 'one_to_1024' : value <= 8192 ? '1025_to_8192' : value <= 65536 ? '8193_to_65536' : 'over_65536';
}
function bucketRetained(value: number): ClosedProcessFailureObservationV1['stderrObservation']['retainedByteCountBucket'] {
  return value === 0 ? 'zero' : value <= 1024 ? 'one_to_1024' : value <= 8192 ? '1025_to_8192' : value < 65536 ? '8193_to_65535' : '65536';
}
function closedObservation(classified: Readonly<ProcessFailureClassification>, source?: Readonly<{ stderrBytes: number; boundedStderr: Uint8Array }>): ClosedProcessFailureObservationV1 {
  if (classified.outcome === 'success' || classified.subcategory === undefined) throw new RenderingPhaseTwoFailure('process_failed');
  const bytes = source?.boundedStderr ?? new Uint8Array(); const total = source?.stderrBytes ?? 0;
  const folded = foldAscii(bytes); const markerHits: ClosedMarkerId[] = [];
  for (const marker of NONZERO_EXIT_MARKERS) if (containsBytes(folded, marker.bytes)) markerHits.push(marker.id);
  for (const marker of NONZERO_EXIT_DIAGNOSTIC_SIGNAL_MARKERS) if (containsBytes(folded, marker.bytes)) markerHits.push(marker.id);
  let lineCount = bytes.length === 0 ? 0 : 1; let ascii = 0; let nonAscii = false; let control = false;
  for (const value of bytes) { if (value === 0x0a) lineCount += 1; if (value < 0x80) ascii += 1; else nonAscii = true;
    if ((value < 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d) || value === 0x7f) control = true; }
  const stderrObservation: ClosedProcessFailureObservationV1['stderrObservation'] = Object.freeze({ totalByteCountBucket: bucketTotal(total),
    retainedByteCountBucket: bucketRetained(bytes.length), truncated: total > STDERR_LIMIT_BYTES,
    lineCountBucket: lineCount === 0 ? 'zero' as const : lineCount === 1 ? 'one' as const : lineCount <= 4 ? 'two_to_four' as const : lineCount <= 16 ? 'five_to_sixteen' as const : 'more_than_sixteen' as const,
    asciiByteBucket: ascii === 0 ? 'none' as const : ascii <= 1024 ? 'low' as const : ascii <= 8192 ? 'medium' as const : 'high' as const,
    nonAsciiByteBucket: nonAscii ? 'present' as const : 'none' as const, controlByteBucket: control ? 'present' as const : 'none' as const });
  const base = { schemaVersion: 1 as const, publicFailureCode: classified.outcome, processFailureSubcategory: classified.subcategory,
    causeFamily: classified.nonzeroExitCause ?? 'unavailable' as const, diagnosticSignal: classified.nonzeroExitDiagnosticSignal ?? 'unavailable' as const,
    markerHits: Object.freeze(markerHits), stderrObservation };
  return Object.freeze({ ...base, observationFingerprint: createHash('sha256').update(JSON.stringify(base)).digest('hex') });
}

function classifyProcessObservation(observation: ProcessFailureObservation): Readonly<ProcessFailureClassification> {
  switch (observation.kind) {
    case 'spawn_error': return Object.freeze({ outcome: 'process_failed', subcategory: 'spawn_error' });
    case 'process_adapter': return Object.freeze({ outcome: 'process_failed', subcategory: 'process_adapter' });
    case 'completed':
      if (observation.timedOut) return Object.freeze({ outcome: 'process_timeout', subcategory: 'timeout' });
      if (observation.signalTerminated) return Object.freeze({ outcome: 'process_failed', subcategory: 'signal' });
      if (observation.stderrBytes > STDERR_LIMIT_BYTES) return Object.freeze({ outcome: 'process_failed', subcategory: 'stderr_limit' });
      if (observation.exitCode !== 0) return Object.freeze({ outcome: 'process_failed', subcategory: 'nonzero_exit',
        nonzeroExitCause: classifyNonzeroExitCause(observation.boundedStderr),
        nonzeroExitDiagnosticSignal: classifyNonzeroExitDiagnosticSignal(observation.boundedStderr) });
      return Object.freeze({ outcome: 'success' });
    default: return assertNever(observation);
  }
}

function createRegisteredProcessFailure(classified: Readonly<ProcessFailureClassification>, source?: Readonly<{ stderrBytes: number; boundedStderr: Uint8Array }>): RenderingPhaseTwoFailure {
  if (classified.outcome === 'success' || classified.subcategory === undefined) throw new RenderingPhaseTwoFailure('process_failed');
  const failure = new RenderingPhaseTwoFailure(classified.outcome === 'process_timeout' ? 'process_timeout' : 'process_failed');
  processFailureDiagnostics.set(failure, classified.subcategory);
  if (classified.subcategory === 'nonzero_exit' && classified.nonzeroExitCause !== undefined)
    nonzeroExitCauseDiagnostics.set(failure, classified.nonzeroExitCause);
  if (classified.subcategory === 'nonzero_exit' && classified.nonzeroExitDiagnosticSignal !== undefined)
    nonzeroExitDiagnosticSignals.set(failure, classified.nonzeroExitDiagnosticSignal);
  closedFailureObservations.set(failure, closedObservation(classified, source));
  return failure;
}
export function consumeClosedProcessFailureObservationInternal(error: unknown): ClosedProcessFailureObservationV1 | undefined {
  if (typeof error !== 'object' || error === null || consumedClosedFailureObservations.has(error)) return undefined;
  const value = closedFailureObservations.get(error); if (!value) return undefined; consumedClosedFailureObservations.add(error); return value;
}
export function hasClosedProcessFailureObservationInternal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && closedFailureObservations.has(error) && !consumedClosedFailureObservations.has(error);
}

export function diagnoseProcessFailureForTestOnly(error: unknown): Readonly<
  | { available: true; subcategory: ProcessFailureSubcategory }
  | { available: false }> {
  if (typeof error !== 'object' || error === null) return Object.freeze({ available: false });
  const subcategory = processFailureDiagnostics.get(error);
  return subcategory === undefined ? Object.freeze({ available: false }) : Object.freeze({ available: true, subcategory });
}

export function diagnoseNonzeroExitCauseForTestOnly(error: unknown): Readonly<
  | { available: true; causeFamily: NonzeroExitCauseFamily }
  | { available: false }> {
  if (typeof error !== 'object' || error === null) return Object.freeze({ available: false });
  const causeFamily = nonzeroExitCauseDiagnostics.get(error);
  return causeFamily === undefined ? Object.freeze({ available: false }) : Object.freeze({ available: true, causeFamily });
}
export function diagnoseNonzeroExitDiagnosticSignalForTestOnly(error: unknown): Readonly<
  | { available: true; signal: NonzeroExitDiagnosticSignal }
  | { available: false }> {
  if (typeof error !== 'object' || error === null) return Object.freeze({ available: false });
  const signal = nonzeroExitDiagnosticSignals.get(error);
  return signal === undefined ? Object.freeze({ available: false }) : Object.freeze({ available: true, signal });
}

function causeScenarioChunks(scenario: NonzeroExitCauseScenario): readonly Uint8Array[] {
  switch (scenario) {
    case 'resource_or_io': return Object.freeze([Buffer.from('Unrecognized option x; Cannot allocate memory', 'ascii')]);
    case 'invalid_option': return Object.freeze([Buffer.from('Unrecognized option input_format', 'ascii')]);
    case 'drawtext_or_font': return Object.freeze([Buffer.from("Error initializing filter 'drawtext'", 'ascii')]);
    case 'input_open_or_decode': return Object.freeze([Buffer.from('Error opening input file fixture.png', 'ascii')]);
    case 'filtergraph_parse_or_init': return Object.freeze([Buffer.from('Error initializing complex filters', 'ascii')]);
    case 'encoder_initialization': return Object.freeze([Buffer.from('Error while opening encoder', 'ascii')]);
    case 'muxer_or_output': return Object.freeze([Buffer.from('Could not write header for output file', 'ascii')]);
    case 'unknown_nonzero_exit': return Object.freeze([Buffer.from('unclassified bounded diagnostic', 'ascii')]);
    case 'split_marker_across_chunks': return Object.freeze([Buffer.from('Could not write ', 'ascii'), Buffer.from('header for output file', 'ascii')]);
    case 'generic_invalid_argument_only': return Object.freeze([Buffer.from('Invalid argument', 'ascii')]);
    default: return assertNever(scenario);
  }
}
function boundedScenarioStderr(scenario: NonzeroExitCauseScenario): Uint8Array {
  let chunks: readonly Uint8Array[] = Object.freeze([]);
  for (const chunk of causeScenarioChunks(scenario)) chunks = appendBoundedStderr(chunks, chunk);
  return Uint8Array.from(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}
function diagnosticSignalScenarioChunks(scenario: NonzeroExitDiagnosticSignalScenario): readonly Uint8Array[] {
  switch (scenario) {
    case 'openh264_create_encoder_failed': return Object.freeze([Buffer.from('Unable to create encoder', 'ascii')]);
    case 'openh264_initialize_failed': return Object.freeze([Buffer.from('Initialize failed', 'ascii')]);
    case 'openh264_encode_frame_failed': return Object.freeze([Buffer.from('EncodeFrame failed', 'ascii')]);
    case 'openh264_invalid_max_nal_size': return Object.freeze([Buffer.from('Invalid -max_nal_size, value rejected', 'ascii')]);
    case 'decoder_initialization_failed': return Object.freeze([Buffer.from('Error while opening decoder: invalid data', 'ascii')]);
    case 'filter_initialization_failed': return Object.freeze([Buffer.from('Error initializing filters!', 'ascii')]);
    case 'filter_configuration_failed': return Object.freeze([Buffer.from('Error configuring filter graph: invalid argument', 'ascii')]);
    case 'unknown_nonzero_exit_signal': return Object.freeze([Buffer.from('Conversion failed!', 'ascii')]);
    case 'specific_before_generic': return Object.freeze([
      Buffer.from('Error initializing filters! Initialize failed Conversion failed!', 'ascii')]);
    default: return assertNever(scenario);
  }
}
function boundedDiagnosticSignalScenarioStderr(scenario: NonzeroExitDiagnosticSignalScenario): Uint8Array {
  let chunks: readonly Uint8Array[] = Object.freeze([]);
  for (const chunk of diagnosticSignalScenarioChunks(scenario)) chunks = appendBoundedStderr(chunks, chunk);
  return Uint8Array.from(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}
/** Closed byte-fixture harness. It accepts no stderr, process, path, or trust material. */
export function exerciseNonzeroExitCauseClassificationForTestOnly(scenario: unknown): Readonly<{
  causeFamily: NonzeroExitCauseFamily }> {
  if (!isNonzeroExitCauseScenario(scenario)) throw new RenderingPhaseTwoFailure('process_failed');
  return Object.freeze({ causeFamily: classifyNonzeroExitCause(boundedScenarioStderr(scenario)) });
}
/** Closed throw harness for the shared nonzero-exit classification and failure-registration path. */
export function exerciseRegisteredNonzeroExitCauseForTestOnly(scenario: unknown): never {
  if (!isNonzeroExitCauseScenario(scenario)) throw new RenderingPhaseTwoFailure('process_failed');
  const boundedStderr = boundedScenarioStderr(scenario);
  throw createRegisteredProcessFailure(classifyProcessObservation({ kind: 'completed', exitCode: 1, timedOut: false,
    stderrBytes: boundedStderr.byteLength, signalTerminated: false, boundedStderr }));
}
/** Closed frozen-source signal harness. It accepts no stderr, path, process, or trust material. */
export function exerciseNonzeroExitDiagnosticSignalForTestOnly(scenario: unknown): Readonly<{
  signal: NonzeroExitDiagnosticSignal }> {
  if (!isNonzeroExitDiagnosticSignalScenario(scenario)) throw new RenderingPhaseTwoFailure('process_failed');
  return Object.freeze({ signal: classifyNonzeroExitDiagnosticSignal(boundedDiagnosticSignalScenarioStderr(scenario)) });
}
/** Closed exact-object registration harness using the shared production observation and failure path. */
export function exerciseRegisteredNonzeroExitDiagnosticSignalForTestOnly(scenario: unknown): never {
  if (!isNonzeroExitDiagnosticSignalScenario(scenario)) throw new RenderingPhaseTwoFailure('process_failed');
  const boundedStderr = boundedDiagnosticSignalScenarioStderr(scenario);
  throw createRegisteredProcessFailure(classifyProcessObservation({ kind: 'completed', exitCode: 1, timedOut: false,
    stderrBytes: boundedStderr.byteLength, signalTerminated: false, boundedStderr }));
}
/** Closed evidence harness. It accepts no bytes, sizes, paths, process input, or authority. */
export function exerciseClosedProcessFailureObservationForTestOnly(scenario: unknown): Readonly<{
  observation: ClosedProcessFailureObservationV1; secondConsumptionAvailable: false }> {
  if (!isNonzeroExitDiagnosticSignalScenario(scenario)) throw new RenderingPhaseTwoFailure('process_failed');
  const boundedStderr = boundedDiagnosticSignalScenarioStderr(scenario);
  const classified = classifyProcessObservation({ kind: 'completed', exitCode: 1, timedOut: false,
    stderrBytes: boundedStderr.byteLength, signalTerminated: false, boundedStderr });
  const failure = createRegisteredProcessFailure(classified, { stderrBytes: boundedStderr.byteLength, boundedStderr });
  const observation = consumeClosedProcessFailureObservationInternal(failure); if (!observation) throw new RenderingPhaseTwoFailure('process_failed');
  if (consumeClosedProcessFailureObservationInternal(failure) !== undefined) throw new RenderingPhaseTwoFailure('process_failed');
  return Object.freeze({ observation, secondConsumptionAvailable: false as const });
}
const CLOSED_OBSERVATION_MATRIX_SCENARIOS = Object.freeze([
  'total_0', 'total_1', 'total_1024', 'total_1025', 'total_8192', 'total_8193', 'total_65536', 'total_65537', 'total_large_safe',
  'retained_0', 'retained_1', 'retained_1024', 'retained_1025', 'retained_8192', 'retained_8193', 'retained_65535', 'retained_65536',
  'lines_1', 'lines_2', 'lines_5', 'lines_17', 'ascii_none', 'ascii_low', 'ascii_medium', 'ascii_high', 'non_ascii', 'control',
  'all_markers_forward', 'all_markers_reverse_duplicate', 'unknown_marker', 'raw_same_a', 'raw_same_b'
] as const);
type ClosedObservationMatrixScenario = typeof CLOSED_OBSERVATION_MATRIX_SCENARIOS[number];
function isClosedObservationMatrixScenario(value: unknown): value is ClosedObservationMatrixScenario {
  return typeof value === 'string' && CLOSED_OBSERVATION_MATRIX_SCENARIOS.some((candidate) => candidate === value);
}
/** Closed synthetic observation matrix. Inputs select fixed data only and confer no process or native-data authority. */
export function exerciseClosedObservationMatrixForTestOnly(scenario: unknown): ClosedProcessFailureObservationV1 {
  if (!isClosedObservationMatrixScenario(scenario)) throw new RenderingPhaseTwoFailure('process_failed');
  const totalValues: Readonly<Record<string, number>> = Object.freeze({ total_0: 0, total_1: 1, total_1024: 1024, total_1025: 1025,
    total_8192: 8192, total_8193: 8193, total_65536: 65536, total_65537: 65537, total_large_safe: Number.MAX_SAFE_INTEGER });
  const retainedValues: Readonly<Record<string, number>> = Object.freeze({ retained_0: 0, retained_1: 1, retained_1024: 1024,
    retained_1025: 1025, retained_8192: 8192, retained_8193: 8193, retained_65535: 65535, retained_65536: 65536 });
  let bytes = new Uint8Array(); let total = totalValues[scenario] ?? 0;
  if (scenario in retainedValues) { bytes = new Uint8Array(retainedValues[scenario]!); bytes.fill(0x61); total = bytes.length; }
  else if (scenario.startsWith('total_') && total > 0) { bytes = Uint8Array.of(0x61); }
  else if (scenario.startsWith('lines_')) { const count = Number(scenario.slice(6)); bytes = Buffer.from(Array(count).fill('x').join('\n'), 'ascii'); total = bytes.length; }
  else if (scenario === 'ascii_none') bytes = Uint8Array.of(0x80);
  else if (scenario === 'ascii_low') bytes = Buffer.alloc(1, 0x61);
  else if (scenario === 'ascii_medium') bytes = Buffer.alloc(1025, 0x61);
  else if (scenario === 'ascii_high') bytes = Buffer.alloc(8193, 0x61);
  else if (scenario === 'non_ascii') bytes = Uint8Array.of(0x80);
  else if (scenario === 'control') bytes = Uint8Array.of(0x00);
  else if (scenario === 'all_markers_forward' || scenario === 'all_markers_reverse_duplicate') {
    const definitions = [...NONZERO_EXIT_MARKERS, ...NONZERO_EXIT_DIAGNOSTIC_SIGNAL_MARKERS];
    const ordered = scenario === 'all_markers_forward' ? definitions : [...definitions].reverse();
    bytes = Buffer.concat([...ordered.map((entry) => Buffer.from(entry.bytes)), ...(scenario === 'all_markers_reverse_duplicate' ?
      ordered.map((entry) => Buffer.from(entry.bytes)) : [])].map((entry) => Buffer.concat([entry, Buffer.from('\n')])));
  } else if (scenario === 'unknown_marker') bytes = Buffer.from('closed unknown native failure', 'ascii');
  else if (scenario === 'raw_same_a') bytes = Buffer.from('first unknown value', 'ascii');
  else if (scenario === 'raw_same_b') bytes = Buffer.from('other unknown value', 'ascii');
  if (!scenario.startsWith('total_') && !(scenario in retainedValues)) total = bytes.length;
  const classified = classifyProcessObservation({ kind: 'completed', exitCode: 1, timedOut: false, stderrBytes: total,
    signalTerminated: false, boundedStderr: bytes });
  return closedObservation(classified, { stderrBytes: total, boundedStderr: bytes });
}
/** Zero-input containment collision harness. It starts no process and exposes no stderr bytes. */
export function exerciseStderrLimitNonzeroCollisionForTestOnly(): never {
  const boundedStderr = boundedScenarioStderr('muxer_or_output');
  throw createRegisteredProcessFailure(classifyProcessObservation({ kind: 'completed', exitCode: 1, timedOut: false,
    stderrBytes: STDERR_LIMIT_BYTES + 1, signalTerminated: false, boundedStderr }));
}

/** Closed classification harness. It starts no process and accepts no execution or trust material. */
export function exerciseProcessFailureClassificationForTestOnly(scenario: unknown): Readonly<{
  outcome: 'process_failed' | 'process_timeout'; subcategory: ProcessFailureSubcategory }> {
  const observations: Readonly<Record<ProcessFailureSubcategory, ProcessFailureObservation>> = Object.freeze({
    spawn_error: Object.freeze({ kind: 'spawn_error' }),
    nonzero_exit: Object.freeze({ kind: 'completed', exitCode: 1, timedOut: false, stderrBytes: 0, signalTerminated: false, boundedStderr: new Uint8Array() }),
    signal: Object.freeze({ kind: 'completed', exitCode: -1, timedOut: false, stderrBytes: 0, signalTerminated: true, boundedStderr: new Uint8Array() }),
    timeout: Object.freeze({ kind: 'completed', exitCode: -1, timedOut: true, stderrBytes: 0, signalTerminated: false, boundedStderr: new Uint8Array() }),
    stderr_limit: Object.freeze({ kind: 'completed', exitCode: 0, timedOut: false, stderrBytes: STDERR_LIMIT_BYTES + 1, signalTerminated: false, boundedStderr: new Uint8Array(STDERR_LIMIT_BYTES) }),
    process_adapter: Object.freeze({ kind: 'process_adapter' })
  });
  if (!isProcessFailureSubcategory(scenario))
    throw new RenderingPhaseTwoFailure('process_failed');
  const classified = classifyProcessObservation(observations[scenario]);
  if (classified.outcome === 'success' || classified.subcategory === undefined) throw new RenderingPhaseTwoFailure('process_failed');
  return Object.freeze({ outcome: classified.outcome, subcategory: classified.subcategory });
}

/** Closed throw harness for the real shared failure-construction path. It never invokes the process runner. */
export function exerciseRegisteredProcessFailureForTestOnly(scenario: unknown): never {
  const observations: Readonly<Record<ProcessFailureSubcategory, ProcessFailureObservation>> = Object.freeze({
    spawn_error: Object.freeze({ kind: 'spawn_error' }),
    nonzero_exit: Object.freeze({ kind: 'completed', exitCode: 1, timedOut: false, stderrBytes: 0, signalTerminated: false, boundedStderr: new Uint8Array() }),
    signal: Object.freeze({ kind: 'completed', exitCode: -1, timedOut: false, stderrBytes: 0, signalTerminated: true, boundedStderr: new Uint8Array() }),
    timeout: Object.freeze({ kind: 'completed', exitCode: -1, timedOut: true, stderrBytes: 0, signalTerminated: false, boundedStderr: new Uint8Array() }),
    stderr_limit: Object.freeze({ kind: 'completed', exitCode: 0, timedOut: false, stderrBytes: STDERR_LIMIT_BYTES + 1, signalTerminated: false, boundedStderr: new Uint8Array(STDERR_LIMIT_BYTES) }),
    process_adapter: Object.freeze({ kind: 'process_adapter' })
  });
  if (!isProcessFailureSubcategory(scenario)) throw new RenderingPhaseTwoFailure('process_failed');
  throw createRegisteredProcessFailure(classifyProcessObservation(observations[scenario]));
}
export interface TerminationTimer { cancel(): void }
function unixProcessGroupTarget(pid: number): number { if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(); return -pid; }
function windowsTaskkillArgs(pid: number, force: boolean): readonly string[] { if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error();
  return Object.freeze(force ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid), '/T']); }
export function unixProcessGroupTargetTestOnly(pid: number): number { return unixProcessGroupTarget(pid); }
export function windowsTaskkillArgsTestOnly(pid: number, force: boolean): readonly string[] { return windowsTaskkillArgs(pid, force); }
export type SyntheticTaskkillOutcome = 'success' | 'launch_error' | 'non_zero' | 'hung';
export interface WindowsTerminationHarnessInput { readonly pid: number; readonly originalChildExit: 'before_timeout' | 'during_grace' | 'never';
  readonly gracefulOutcome: SyntheticTaskkillOutcome; readonly forceOutcome: SyntheticTaskkillOutcome }
export function simulateWindowsTerminationTestOnly(input: WindowsTerminationHarnessInput): Readonly<{
  timedOut: boolean; settled: true; taskkillAttemptTimeoutMs: 1000; gracePeriodMs: 5000; attempts: readonly Readonly<{
    kind: 'graceful' | 'force'; args: readonly string[]; outcome: SyntheticTaskkillOutcome; bounded: true }>[] }> {
  const safeInput = detachWindowsTerminationHarnessInput(input);
  const attempts: { kind: 'graceful' | 'force'; args: readonly string[]; outcome: SyntheticTaskkillOutcome; bounded: true }[] = [];
  if (safeInput.originalChildExit !== 'before_timeout') attempts.push({ kind: 'graceful', args: windowsTaskkillArgs(safeInput.pid, false),
    outcome: safeInput.gracefulOutcome, bounded: true });
  if (safeInput.originalChildExit === 'never') attempts.push({ kind: 'force', args: windowsTaskkillArgs(safeInput.pid, true),
    outcome: safeInput.forceOutcome, bounded: true });
  return Object.freeze({ timedOut: safeInput.originalChildExit !== 'before_timeout', settled: true,
    taskkillAttemptTimeoutMs: 1000, gracePeriodMs: 5000, attempts: Object.freeze(attempts.map((attempt) => Object.freeze(attempt))) });
}
function detachWindowsTerminationHarnessInput(input: unknown): Readonly<WindowsTerminationHarnessInput> {
  try {
    if (typeof input !== 'object' || input === null || Object.getPrototypeOf(input) !== Object.prototype ||
        Object.getOwnPropertySymbols(input).length !== 0) throw new RenderingPhaseTwoFailure('process_failed');
    const descriptors = Object.getOwnPropertyDescriptors(input); const keys = ['pid', 'originalChildExit', 'gracefulOutcome', 'forceOutcome'];
    if (Object.keys(descriptors).length !== keys.length || keys.some((key) => !(key in descriptors)) ||
        Object.values(descriptors).some((descriptor) => !descriptor.enumerable || !('value' in descriptor)))
      throw new RenderingPhaseTwoFailure('process_failed');
    const pid = descriptors.pid!.value; const originalChildExit = descriptors.originalChildExit!.value;
    const gracefulOutcome = descriptors.gracefulOutcome!.value; const forceOutcome = descriptors.forceOutcome!.value;
    if (!Number.isSafeInteger(pid) || pid <= 0 || !['before_timeout', 'during_grace', 'never'].includes(originalChildExit) ||
        !['success', 'launch_error', 'non_zero', 'hung'].includes(gracefulOutcome) ||
        !['success', 'launch_error', 'non_zero', 'hung'].includes(forceOutcome)) throw new RenderingPhaseTwoFailure('process_failed');
    return Object.freeze({ pid, originalChildExit, gracefulOutcome, forceOutcome }) as Readonly<WindowsTerminationHarnessInput>;
  } catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('process_failed'); }
}
export class NodeFfmpegProcessRunner implements FfmpegProcessRunner {
  #used = false; readonly #adapter: ProcessInvocationAdapter;
  constructor() { this.#adapter = createPlatformProcessAdapter(); }
  async run(command: ResolvedFfmpegExecution): Promise<ProcessExecutionResult> {
    assertTrustedLocalResolvedExecution(command);
    if (this.#used) throw new RenderingPhaseTwoFailure('process_failed'); this.#used = true;
    const runtime = require('../runtime/trusted-local-runtime') as { revalidateTrustedExecutionForConsumption(value: unknown): Promise<void>;
      bindProcessFailureToEvidenceAttemptInternal(resolved: unknown, failure: unknown): void };
    try {
      await runtime.revalidateTrustedExecutionForConsumption(command);
      const result = await this.#adapter.execute(command, { timeoutMs: 180000, gracefulTerminationMs: 5000 });
      const classified = classifyProcessObservation({ kind: 'completed', ...result });
      if (classified.outcome !== 'success') { const failure = createRegisteredProcessFailure(classified, result);
        runtime.bindProcessFailureToEvidenceAttemptInternal(command, failure); throw failure; }
      return Object.freeze({ exitCode: 0 });
    } catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error;
      const classified = classifyProcessObservation(error instanceof ProcessInvocationFailure ? { kind: 'spawn_error' } : { kind: 'process_adapter' });
      const failure = createRegisteredProcessFailure(classified); runtime.bindProcessFailureToEvidenceAttemptInternal(command, failure); throw failure; }
  }
}
function createPlatformProcessAdapter(): ProcessInvocationAdapter {
  return process.platform === 'win32' ? new WindowsProcessTreeAdapter() : new UnixProcessGroupAdapter();
}
abstract class SpawnProcessTreeAdapter implements ProcessInvocationAdapter {
  readonly #spawnProcess: typeof spawn;
  constructor(spawnProcess: typeof spawn = spawn) { this.#spawnProcess = spawnProcess; }
  abstract terminate(pid: number, force: boolean): Promise<boolean>;
  async execute(command: ResolvedFfmpegExecution, policy: ProcessInvocationPolicy): Promise<{
    readonly exitCode: number; readonly timedOut: boolean; readonly stderrBytes: number; readonly signalTerminated: boolean;
    readonly boundedStderr: Uint8Array }> {
    return new Promise((resolve, reject) => {
      let child;
      try { child = this.#spawnProcess(command.executablePath, [...command.args], { shell: false, detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: { PATH: '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' } }); }
      catch { reject(new ProcessInvocationFailure()); return; }
      let stderrBytes = 0; let boundedStderrChunks: readonly Uint8Array[] = Object.freeze([]);
      let timedOut = false; let forceTimer: TerminationTimer | undefined; let settled = false;
      const finish = (code: number, signalTerminated = false): void => { if (settled) return; settled = true; clearTimeout(timeout); forceTimer?.cancel();
        const boundedStderr = Uint8Array.from(Buffer.concat(boundedStderrChunks.map((chunk) => Buffer.from(chunk))));
        boundedStderrChunks = Object.freeze([]);
        resolve(Object.freeze({ exitCode: code, timedOut, stderrBytes, signalTerminated, boundedStderr })); };
      child.stderr?.on('data', (chunk: Buffer) => { stderrBytes += chunk.length;
        boundedStderrChunks = appendBoundedStderr(boundedStderrChunks, chunk); });
      const timeout = setTimeout(() => { timedOut = true; const pid = child.pid ?? -1;
        void this.terminate(pid, false).catch(() => false).finally(() => {
          if (settled) return;
          const timer = setTimeout(() => { void this.terminate(pid, true).catch(() => false).finally(() => finish(-1)); },
            policy.gracefulTerminationMs);
          forceTimer = { cancel: () => clearTimeout(timer) };
        });
      }, policy.timeoutMs);
      child.once('error', () => { if (!settled) { settled = true; clearTimeout(timeout); forceTimer?.cancel(); reject(new ProcessInvocationFailure()); } });
      child.once('close', (code, signal) => finish(code ?? -1, code === null || signal !== null));
    });
  }
}
class UnixProcessGroupAdapter extends SpawnProcessTreeAdapter {
  async terminate(pid: number, force: boolean): Promise<boolean> {
    try { process.kill(unixProcessGroupTarget(pid), force ? 'SIGKILL' : 'SIGTERM'); return true; } catch { return false; }
  }
}
class WindowsProcessTreeAdapter extends SpawnProcessTreeAdapter {
  readonly #spawnTaskkill: typeof spawn;
  constructor(spawnProcess: typeof spawn = spawn, spawnTaskkill: typeof spawn = spawn) { super(spawnProcess); this.#spawnTaskkill = spawnTaskkill; }
  async terminate(pid: number, force: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false; let killer; let bound: ReturnType<typeof setTimeout> | undefined;
      const finish = (success: boolean): void => { if (settled) return; settled = true; if (bound) clearTimeout(bound); resolve(success); };
      try { killer = this.#spawnTaskkill('taskkill', [...windowsTaskkillArgs(pid, force)], { windowsHide: true, stdio: 'ignore' }); }
      catch { resolve(false); return; }
      bound = setTimeout(() => { try { killer.kill(); } catch { /* sanitized */ } finish(false); }, 1000);
      killer.once('error', () => finish(false));
      killer.once('close', (code) => finish(code === 0));
    });
  }
}
