import { spawn } from 'node:child_process';
import { RenderingPhaseTwoFailure } from '../failures/rendering-phase-two-failure';
import { assertTrustedLocalResolvedExecution, ResolvedFfmpegExecution } from '../command/ffmpeg-command-manifest';
import { PHASE_TWO_RESOURCE_LIMITS } from '../resources/resource-limits';

export interface ProcessExecutionResult { readonly exitCode: number }
export interface FfmpegProcessRunner { run(command: ResolvedFfmpegExecution): Promise<ProcessExecutionResult> }
export interface ProcessInvocationPolicy { readonly timeoutMs: 180000; readonly gracefulTerminationMs: 5000 }
interface ProcessInvocationAdapter {
  execute(command: ResolvedFfmpegExecution, policy: ProcessInvocationPolicy): Promise<{
    readonly exitCode: number; readonly timedOut: boolean; readonly stderrBytes: number }>;
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
      const result = await this.#adapter.execute(command, { timeoutMs: 180000, gracefulTerminationMs: 5000 });
      if (result.timedOut) throw new RenderingPhaseTwoFailure('process_timeout');
      if (result.exitCode !== 0 || result.stderrBytes > 64 * 1024) throw new RenderingPhaseTwoFailure('process_failed');
      return Object.freeze({ exitCode: 0 });
    } catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('process_failed'); }
  }
}
function createPlatformProcessAdapter(): ProcessInvocationAdapter {
  return process.platform === 'win32' ? new WindowsProcessTreeAdapter() : new UnixProcessGroupAdapter();
}
abstract class SpawnProcessTreeAdapter implements ProcessInvocationAdapter {
  readonly #spawnProcess: typeof spawn;
  constructor(spawnProcess: typeof spawn = spawn) { this.#spawnProcess = spawnProcess; }
  abstract terminate(pid: number, force: boolean): Promise<boolean>;
  async execute(command: ResolvedFfmpegExecution, policy: ProcessInvocationPolicy): Promise<{ readonly exitCode: number; readonly timedOut: boolean; readonly stderrBytes: number }> {
    return new Promise((resolve, reject) => {
      let child;
      try { child = this.#spawnProcess(command.executablePath, [...command.args], { shell: false, detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: { PATH: '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' } }); }
      catch { reject(new RenderingPhaseTwoFailure('process_failed')); return; }
      let stderrBytes = 0; let timedOut = false; let forceTimer: TerminationTimer | undefined; let settled = false;
      const finish = (code: number): void => { if (settled) return; settled = true; clearTimeout(timeout); forceTimer?.cancel();
        resolve(Object.freeze({ exitCode: code, timedOut, stderrBytes })); };
      child.stderr?.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; });
      const timeout = setTimeout(() => { timedOut = true; const pid = child.pid ?? -1;
        void this.terminate(pid, false).catch(() => false).finally(() => {
          if (settled) return;
          const timer = setTimeout(() => { void this.terminate(pid, true).catch(() => false).finally(() => finish(-1)); },
            policy.gracefulTerminationMs);
          forceTimer = { cancel: () => clearTimeout(timer) };
        });
      }, policy.timeoutMs);
      child.once('error', () => { if (!settled) { settled = true; clearTimeout(timeout); forceTimer?.cancel(); reject(new RenderingPhaseTwoFailure('process_failed')); } });
      child.once('close', (code) => finish(code ?? -1));
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
