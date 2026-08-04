import { WorkflowFailure } from './workflow-failure';
import { WorkflowStepResult } from './workflow-step-result';

export type WorkflowBranchState = 'pending' | 'running' | 'completed' | 'failed';

export type WorkflowParallelRegionState = 'completed' | 'failed';

export interface ParallelBranchResult {
  readonly branchId: string;
  readonly output: unknown;
}

export interface WorkflowBranchExecution {
  readonly branchId: string;
  readonly startStepId: string;
  readonly currentStepId?: string;
  readonly state: WorkflowBranchState;
  readonly input: unknown;
  readonly output?: unknown;
  readonly completedSteps: readonly string[];
  readonly stepResults: readonly WorkflowStepResult[];
  readonly failure?: WorkflowFailure;
  readonly durationMs?: number;
}

export interface WorkflowParallelExecution {
  readonly forkStepId: string;
  readonly joinStepId: string;
  readonly input: unknown;
  readonly branches: readonly WorkflowBranchExecution[];
}

export interface WorkflowCompletedParallelRegionResult {
  readonly forkStepId: string;
  readonly joinStepId: string;
  readonly state: 'completed';
  readonly branches: readonly WorkflowBranchExecution[];
  readonly output: readonly ParallelBranchResult[];
  readonly durationMs: number;
}

export interface WorkflowFailedParallelRegionResult {
  readonly forkStepId: string;
  readonly joinStepId: string;
  readonly state: 'failed';
  readonly branches: readonly WorkflowBranchExecution[];
  readonly failure: WorkflowFailure;
  readonly durationMs: number;
}

export type WorkflowParallelRegionResult =
  | WorkflowCompletedParallelRegionResult
  | WorkflowFailedParallelRegionResult;
