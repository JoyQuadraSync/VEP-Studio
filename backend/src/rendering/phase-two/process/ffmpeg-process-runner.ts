import { spawn } from 'node:child_process';
import { RenderingPhaseTwoFailure } from '../failures/rendering-phase-two-failure';
import { assertTrustedLocalResolvedExecution, ResolvedFfmpegExecution } from '../command/ffmpeg-command-manifest';
import { PHASE_TWO_RESOURCE_LIMITS } from '../resources/resource-limits';

export interface ProcessExecutionResult { readonly exitCode: number }
export interface FfmpegProcessRunner { run(command: ResolvedFfmpegExecution): Promise<ProcessExecutionResult> }
export interface ProcessInvocationPolicy { readonly timeoutMs: 180000; readonly gracefulTerminationMs: 5000 }
interface ProcessInvocationAdapter {
  execute(command: ResolvedFfmpegExecution, policy: ProcessInvocationPolicy): Promise<{
    readonly exitCode: number; readonly timedOut: boolean; readonly stderrBytes: number; readonly signalTerminated: boolean }>;
}
type ProcessFailureSubcategory = 'spawn_error' | 'nonzero_exit' | 'signal' | 'timeout' | 'stderr_limit' | 'process_adapter';
type ProcessFailureObservation = Readonly<
  | { kind: 'spawn_error' | 'process_adapter' }
  | { kind: 'completed'; exitCode: number; timedOut: boolean; stderrBytes: number; signalTerminated: boolean }>;
interface ProcessFailureClassification {
  readonly outcome: 'success' | 'process_failed' | 'process_timeout';
  readonly subcategory?: ProcessFailureSubcategory;
}
const processFailureDiagnostics = new WeakMap<object, ProcessFailureSubcategory>();
const PROCESS_FAILURE_SCENARIOS: readonly ProcessFailureSubcategory[] = Object.freeze([
  'spawn_error', 'nonzero_exit', 'signal', 'timeout', 'stderr_limit', 'process_adapter'
]);
class ProcessInvocationFailure {
  readonly subcategory: 'spawn_error';
  constructor() { this.subcategory = 'spawn_error'; Object.freeze(this); }
}

function assertNever(value: never): never { void value; throw new RenderingPhaseTwoFailure('process_failed'); }
function isProcessFailureSubcategory(value: unknown): value is ProcessFailureSubcategory {
  return typeof value === 'string' && PROCESS_FAILURE_SCENARIOS.some((scenario) => scenario === value);
}

function classifyProcessObservation(observation: ProcessFailureObservation): Readonly<ProcessFailureClassification> {
  switch (observation.kind) {
    case 'spawn_error': return Object.freeze({ outcome: 'process_failed', subcategory: 'spawn_error' });
    case 'process_adapter': return Object.freeze({ outcome: 'process_failed', subcategory: 'process_adapter' });
    case 'completed':
      if (observation.timedOut) return Object.freeze({ outcome: 'process_timeout', subcategory: 'timeout' });
      if (observation.signalTerminated) return Object.freeze({ outcome: 'process_failed', subcategory: 'signal' });
      if (observation.exitCode !== 0) return Object.freeze({ outcome: 'process_failed', subcategory: 'nonzero_exit' });
      if (observation.stderrBytes > 64 * 1024) return Object.freeze({ outcome: 'process_failed', subcategory: 'stderr_limit' });
      return Object.freeze({ outcome: 'success' });
    default: return assertNever(observation);
  }
}

function createRegisteredProcessFailure(classified: Readonly<ProcessFailureClassification>): RenderingPhaseTwoFailure {
  if (classified.outcome === 'success' || classified.subcategory === undefined) throw new RenderingPhaseTwoFailure('process_failed');
  const failure = new RenderingPhaseTwoFailure(classified.outcome === 'process_timeout' ? 'process_timeout' : 'process_failed');
  processFailureDiagnostics.set(failure, classified.subcategory); return failure;
}

export function diagnoseProcessFailureForTestOnly(error: unknown): Readonly<
  | { available: true; subcategory: ProcessFailureSubcategory }
  | { available: false }> {
  if (typeof error !== 'object' || error === null) return Object.freeze({ available: false });
  const subcategory = processFailureDiagnostics.get(error);
  return subcategory === undefined ? Object.freeze({ available: false }) : Object.freeze({ available: true, subcategory });
}

/** Closed classification harness. It starts no process and accepts no execution or trust material. */
export function exerciseProcessFailureClassificationForTestOnly(scenario: unknown): Readonly<{
  outcome: 'process_failed' | 'process_timeout'; subcategory: ProcessFailureSubcategory }> {
  const observations: Readonly<Record<ProcessFailureSubcategory, ProcessFailureObservation>> = Object.freeze({
    spawn_error: Object.freeze({ kind: 'spawn_error' }),
    nonzero_exit: Object.freeze({ kind: 'completed', exitCode: 1, timedOut: false, stderrBytes: 0, signalTerminated: false }),
    signal: Object.freeze({ kind: 'completed', exitCode: -1, timedOut: false, stderrBytes: 0, signalTerminated: true }),
    timeout: Object.freeze({ kind: 'completed', exitCode: -1, timedOut: true, stderrBytes: 0, signalTerminated: false }),
    stderr_limit: Object.freeze({ kind: 'completed', exitCode: 0, timedOut: false, stderrBytes: 64 * 1024 + 1, signalTerminated: false }),
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
    nonzero_exit: Object.freeze({ kind: 'completed', exitCode: 1, timedOut: false, stderrBytes: 0, signalTerminated: false }),
    signal: Object.freeze({ kind: 'completed', exitCode: -1, timedOut: false, stderrBytes: 0, signalTerminated: true }),
    timeout: Object.freeze({ kind: 'completed', exitCode: -1, timedOut: true, stderrBytes: 0, signalTerminated: false }),
    stderr_limit: Object.freeze({ kind: 'completed', exitCode: 0, timedOut: false, stderrBytes: 64 * 1024 + 1, signalTerminated: false }),
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
    readonly exitCode: number; readonly timedOut: boolean; readonly stderrBytes: number; readonly signalTerminated: boolean }> {
    return new Promise((resolve, reject) => {
      let child;
      try { child = this.#spawnProcess(command.executablePath, [...command.args], { shell: false, detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: { PATH: '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' } }); }
      catch { reject(new ProcessInvocationFailure()); return; }
      let stderrBytes = 0; let timedOut = false; let forceTimer: TerminationTimer | undefined; let settled = false;
      const finish = (code: number, signalTerminated = false): void => { if (settled) return; settled = true; clearTimeout(timeout); forceTimer?.cancel();
        resolve(Object.freeze({ exitCode: code, timedOut, stderrBytes, signalTerminated })); };
      child.stderr?.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; });
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
