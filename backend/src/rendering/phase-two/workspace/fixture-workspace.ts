import { randomBytes } from 'node:crypto';
import { lstat, mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RenderingPhaseTwoFailure } from '../failures/rendering-phase-two-failure';

/** Root is application-owned, unavailable to untrusted local writers, and hostile same-process code is excluded. */
export interface FixtureWorkspace { readonly root: string; readonly inputsDirectory: string; readonly textDirectory: string;
  readonly outputMp4Path: string; readonly outputSrtPath: string }
export interface WorkspaceMeasurements { readonly freeWorkspaceBytes: number }
export interface RetentionScheduler { schedule(callback: () => void, delayMs: 900000): { cancel(): void } }
export interface WorkspaceTestHooks { readonly onCleanup?: () => void; readonly failCleanup?: boolean }
export interface DeveloperRetention { readonly enabled: boolean; readonly deploymentMode: 'developer' | 'ci' | 'deployment';
  readonly maximumRetainedWorkspaces: 1; readonly maximumAgeMs: 900000 }
interface RootState { activeRenders: number; activeBytes: number; workspaceBytes: Map<string, number>;
  retained?: FixtureWorkspace; retentionTimer?: { cancel(): void } }
const trustedResolvers = new WeakSet<object>(); const rootStates = new Map<string, RootState>();
const defaultScheduler: RetentionScheduler = { schedule(callback, delayMs) { const timer = setTimeout(callback, delayMs); timer.unref();
  return Object.freeze({ cancel: () => clearTimeout(timer) }); } };
function stateFor(root: string): RootState { let state = rootStates.get(root); if (!state) { state = { activeRenders: 0, activeBytes: 0, workspaceBytes: new Map() }; rootStates.set(root, state); } return state; }
function unsafePath(value: string): boolean { if (!path.isAbsolute(value) || value.startsWith('\\\\') || value.startsWith('\\?\\') || value.startsWith('\\.\\')) return true;
  const remainder = /^[A-Za-z]:[\\/]/u.test(value) ? value.slice(2) : value; return remainder.split(/[\\/]/u).some((part) => part === '..' || part.includes(':')); }
async function ordinaryDirectory(value: string): Promise<string> { const info = await lstat(value);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new RenderingPhaseTwoFailure('workspace_invalid'); return realpath(value); }
async function ordinaryFile(value: string): Promise<void> { const info = await lstat(value);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new RenderingPhaseTwoFailure('workspace_invalid'); }
export class FixtureWorkspaceResolver {
  readonly #applicationRoot: string; readonly #retention: DeveloperRetention; readonly #measurements: () => WorkspaceMeasurements;
  readonly #scheduler: RetentionScheduler;
  get executionTrust(): 'test_only' | 'trusted_local_reference' { const runtime = require('../runtime/trusted-local-runtime') as { isTrustedLocalCapability(value: unknown): boolean };
    return runtime.isTrustedLocalCapability(this) ? 'trusted_local_reference' : 'test_only'; }
  readonly #testHooks: WorkspaceTestHooks;
  private constructor(applicationRoot: string, measurements: () => WorkspaceMeasurements, retention: DeveloperRetention, scheduler: RetentionScheduler,
    testHooks: WorkspaceTestHooks) {
    if (!path.isAbsolute(applicationRoot) || unsafePath(path.resolve(applicationRoot)) || retention.maximumRetainedWorkspaces !== 1 ||
      retention.maximumAgeMs !== 900000 || (retention.enabled && (retention.deploymentMode !== 'developer' || Boolean(process.env.CI))))
      throw new RenderingPhaseTwoFailure('workspace_invalid');
    this.#applicationRoot = path.resolve(applicationRoot); this.#measurements = measurements; this.#retention = Object.freeze({ ...retention });
    this.#scheduler = scheduler; this.#testHooks = Object.freeze({ ...testHooks }); trustedResolvers.add(this); Object.freeze(this);
  }
  static createTestOnly(applicationRoot: string, measurements: () => WorkspaceMeasurements,
    retention: DeveloperRetention = { enabled: false, deploymentMode: 'deployment', maximumRetainedWorkspaces: 1, maximumAgeMs: 900000 },
    scheduler: RetentionScheduler = defaultScheduler, testHooks: WorkspaceTestHooks = {}): FixtureWorkspaceResolver {
    return new FixtureWorkspaceResolver(applicationRoot, measurements, retention, scheduler, testHooks);
  }
  assertTrusted(): void { if (!trustedResolvers.has(this)) throw new RenderingPhaseTwoFailure('workspace_invalid'); }
  acquireRenderSlot(): { readonly freeWorkspaceBytes: number; readonly activeWorkspaceBytes: number; readonly activeRenderCount: 1 } {
    this.assertTrusted(); const state = stateFor(this.#applicationRoot); if (state.activeRenders !== 0) throw new RenderingPhaseTwoFailure('resource_limit_exceeded');
    let measured: WorkspaceMeasurements; try { measured = this.#measurements(); } catch { throw new RenderingPhaseTwoFailure('resource_limit_exceeded'); }
    if (!measured || !Number.isSafeInteger(measured.freeWorkspaceBytes) || measured.freeWorkspaceBytes < 0) throw new RenderingPhaseTwoFailure('resource_limit_exceeded');
    state.activeRenders = 1; return Object.freeze({ freeWorkspaceBytes: measured.freeWorkspaceBytes,
      activeWorkspaceBytes: state.activeBytes, activeRenderCount: 1 });
  }
  releaseRenderSlot(): void { const state = stateFor(this.#applicationRoot); state.activeRenders = 0; }
  async create(): Promise<FixtureWorkspace> { try { this.assertTrusted(); await mkdir(this.#applicationRoot, { recursive: true });
    const canonicalRoot = await ordinaryDirectory(this.#applicationRoot); if (path.resolve(canonicalRoot) !== this.#applicationRoot) throw new RenderingPhaseTwoFailure('workspace_invalid');
    const root = path.join(this.#applicationRoot, randomBytes(16).toString('hex')); const inputsDirectory = path.join(root, 'inputs'); const textDirectory = path.join(root, 'text');
    await mkdir(inputsDirectory, { recursive: true }); await mkdir(textDirectory, { recursive: true }); await this.#validateDirectory(root);
    await this.#validateDirectory(inputsDirectory); await this.#validateDirectory(textDirectory); stateFor(this.#applicationRoot).workspaceBytes.set(root, 0);
    return Object.freeze({ root, inputsDirectory, textDirectory, outputMp4Path: path.join(root, 'fixture.mp4'), outputSrtPath: path.join(textDirectory, 'subtitles.srt') });
  } catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('workspace_invalid'); } }
  async writeTrustedFile(workspace: FixtureWorkspace, area: 'inputs' | 'text', fileName: string, bytes: Uint8Array): Promise<string> { try {
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/u.test(fileName) || fileName.includes('..')) throw new RenderingPhaseTwoFailure('workspace_invalid');
    await this.revalidate(workspace); const directory = area === 'inputs' ? workspace.inputsDirectory : workspace.textDirectory; await this.#validateDirectory(directory);
    const target = path.join(directory, fileName); this.assertIssued(workspace, target); await writeFile(target, bytes, { flag: 'wx', mode: 0o400 }); await ordinaryFile(target);
    const state = stateFor(this.#applicationRoot); const prior = state.workspaceBytes.get(workspace.root) ?? 0; const next = prior + bytes.byteLength;
    if (!Number.isSafeInteger(next)) throw new RenderingPhaseTwoFailure('resource_limit_exceeded'); state.workspaceBytes.set(workspace.root, next); state.activeBytes += bytes.byteLength; return target;
  } catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('workspace_invalid'); } }
  assertIssued(workspace: FixtureWorkspace, candidate: string): void { const relative = path.relative(workspace.root, path.resolve(candidate));
    if (unsafePath(candidate) || relative.startsWith('..') || path.isAbsolute(relative)) throw new RenderingPhaseTwoFailure('workspace_invalid'); }
  async revalidate(workspace: FixtureWorkspace): Promise<void> { try { this.assertTrusted(); this.assertIssued({ ...workspace, root: this.#applicationRoot }, workspace.root);
    await this.#validateDirectory(this.#applicationRoot); await this.#validateDirectory(workspace.root); await this.#validateDirectory(workspace.inputsDirectory); await this.#validateDirectory(workspace.textDirectory);
  } catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('workspace_invalid'); } }
  async validateIssuedFile(workspace: FixtureWorkspace, candidate: string): Promise<void> { try { await this.revalidate(workspace); this.assertIssued(workspace, candidate);
    await ordinaryFile(candidate); const resolved = await realpath(candidate); this.assertIssued(workspace, resolved);
  } catch (error) { if (error instanceof RenderingPhaseTwoFailure) throw error; throw new RenderingPhaseTwoFailure('workspace_invalid'); } }
  async cleanup(workspace: FixtureWorkspace): Promise<void> { this.#testHooks.onCleanup?.();
    if (this.#testHooks.failCleanup) throw new RenderingPhaseTwoFailure('cleanup_failed'); const state = stateFor(this.#applicationRoot);
    if (this.#retention.enabled) { if (state.retained && state.retained.root !== workspace.root) await this.#remove(state.retained);
      state.retentionTimer?.cancel(); state.retained = workspace; state.retentionTimer = this.#scheduler.schedule(() => { const retained = state.retained;
        state.retained = undefined; state.retentionTimer = undefined; if (retained) void this.#remove(retained).catch(() => undefined); }, 900000); return; }
    await this.#remove(workspace); }
  async #remove(workspace: FixtureWorkspace): Promise<void> { try { await this.revalidate(workspace); this.assertIssued({ ...workspace, root: this.#applicationRoot }, workspace.root);
    await rm(workspace.root, { recursive: true, force: false }); const state = stateFor(this.#applicationRoot); const bytes = state.workspaceBytes.get(workspace.root) ?? 0;
    state.activeBytes = Math.max(0, state.activeBytes - bytes); state.workspaceBytes.delete(workspace.root);
  } catch { throw new RenderingPhaseTwoFailure('cleanup_failed'); } }
  async #validateDirectory(value: string): Promise<void> { const canonical = await ordinaryDirectory(value);
    if (path.resolve(canonical) !== path.resolve(value)) throw new RenderingPhaseTwoFailure('workspace_invalid'); const info = await stat(value);
    if (!info.isDirectory()) throw new RenderingPhaseTwoFailure('workspace_invalid'); }
}
