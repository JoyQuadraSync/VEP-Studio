import { spawn } from 'node:child_process';
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
type ProcessFailureObservation = Readonly<
  | { kind: 'spawn_error' | 'process_adapter' }
  | { kind: 'completed'; exitCode: number; timedOut: boolean; stderrBytes: number; signalTerminated: boolean;
      boundedStderr: Uint8Array }>;
interface ProcessFailureClassification {
  readonly outcome: 'success' | 'process_failed' | 'process_timeout';
  readonly subcategory?: ProcessFailureSubcategory;
  readonly nonzeroExitCause?: NonzeroExitCauseFamily;
}
const processFailureDiagnostics = new WeakMap<object, ProcessFailureSubcategory>();
const nonzeroExitCauseDiagnostics = new WeakMap<object, NonzeroExitCauseFamily>();
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
const NONZERO_EXIT_MARKERS: readonly Readonly<{ causeFamily: Exclude<NonzeroExitCauseFamily, 'unknown_nonzero_exit'>;
  markers: readonly Uint8Array[] }>[] = Object.freeze([
  Object.freeze({ causeFamily: 'resource_or_io', markers: Object.freeze([
    Buffer.from('cannot allocate memory', 'ascii'), Buffer.from('no space left on device', 'ascii'),
    Buffer.from('too many open files', 'ascii')]) }),
  Object.freeze({ causeFamily: 'invalid_option', markers: Object.freeze([
    Buffer.from('unrecognized option', 'ascii'), Buffer.from('option not found', 'ascii')]) }),
  Object.freeze({ causeFamily: 'drawtext_or_font', markers: Object.freeze([
    Buffer.from("error initializing filter 'drawtext'", 'ascii'), Buffer.from('could not load font', 'ascii'),
    Buffer.from('cannot find a valid font', 'ascii')]) }),
  Object.freeze({ causeFamily: 'input_open_or_decode', markers: Object.freeze([
    Buffer.from('error opening input file', 'ascii'), Buffer.from('invalid data found when processing input', 'ascii')]) }),
  Object.freeze({ causeFamily: 'filtergraph_parse_or_init', markers: Object.freeze([
    Buffer.from('error initializing complex filters', 'ascii'), Buffer.from('no such filter:', 'ascii')]) }),
  Object.freeze({ causeFamily: 'encoder_initialization', markers: Object.freeze([
    Buffer.from('error while opening encoder', 'ascii'), Buffer.from('unknown encoder', 'ascii')]) }),
  Object.freeze({ causeFamily: 'muxer_or_output', markers: Object.freeze([
    Buffer.from('error opening output file', 'ascii'), Buffer.from('could not write header', 'ascii')]) })
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
  for (const family of NONZERO_EXIT_MARKERS)
    if (family.markers.some((marker) => containsBytes(folded, marker))) return family.causeFamily;
  return 'unknown_nonzero_exit';
}
function appendBoundedStderr(chunks: readonly Uint8Array[], chunk: Uint8Array): readonly Uint8Array[] {
  const retainedBytes = chunks.reduce((total, current) => total + current.byteLength, 0);
  const remaining = STDERR_LIMIT_BYTES - retainedBytes;
  if (remaining <= 0) return chunks;
  return Object.freeze([...chunks, Uint8Array.from(chunk.subarray(0, remaining))]);
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
        nonzeroExitCause: classifyNonzeroExitCause(observation.boundedStderr) });
      return Object.freeze({ outcome: 'success' });
    default: return assertNever(observation);
  }
}

function createRegisteredProcessFailure(classified: Readonly<ProcessFailureClassification>): RenderingPhaseTwoFailure {
  if (classified.outcome === 'success' || classified.subcategory === undefined) throw new RenderingPhaseTwoFailure('process_failed');
  const failure = new RenderingPhaseTwoFailure(classified.outcome === 'process_timeout' ? 'process_timeout' : 'process_failed');
  processFailureDiagnostics.set(failure, classified.subcategory);
  if (classified.subcategory === 'nonzero_exit' && classified.nonzeroExitCause !== undefined)
    nonzeroExitCauseDiagnostics.set(failure, classified.nonzeroExitCause);
  return failure;
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
    try {
      const runtime = require('../runtime/trusted-local-runtime') as { revalidateTrustedExecutionForConsumption(value: unknown): Promise<void> };
      await runtime.revalidateTrustedExecutionForConsumption(command);
      const result = await this.#adapter.execute(command, { timeoutMs: 180000, gracefulTerminationMs: 5000 });
      const classified = classifyProcessObservation({ kind: 'completed', ...result });
      if (classified.outcome !== 'success') throw createRegisteredProcessFailure(classified);
      return Object.freeze({ exitCode: 0 });
    } catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error;
      const classified = classifyProcessObservation(error instanceof ProcessInvocationFailure ? { kind: 'spawn_error' } : { kind: 'process_adapter' });
      throw createRegisteredProcessFailure(classified); }
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
