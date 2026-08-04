import { WorkflowFailure } from './workflow-failure';
import {
  WorkflowParallelExecution,
  WorkflowParallelRegionResult
} from './workflow-parallel-execution';
import { WorkflowState } from './workflow-state';
import { WorkflowStepResult } from './workflow-step-result';

export interface WorkflowExecution {
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly state: WorkflowState;
  readonly currentStepId: string;
  readonly workflowInput: unknown;
  readonly workflowOutput?: unknown;
  readonly completedSteps: readonly string[];
  readonly stepResults: readonly WorkflowStepResult[];
  readonly failure?: WorkflowFailure;
  readonly durationMs?: number;
  readonly activeParallel?: WorkflowParallelExecution;
  readonly parallelRegions: readonly WorkflowParallelRegionResult[];
}

export interface WorkflowExecutionIdGenerator {
  next(): string;
}
