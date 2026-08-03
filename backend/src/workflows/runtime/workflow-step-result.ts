import { WorkflowFailure } from './workflow-failure';
import { WorkflowStepResultStatus } from './workflow-state';

export interface WorkflowStepResult {
  readonly stepId: string;
  readonly status: WorkflowStepResultStatus;
  readonly input: unknown;
  readonly output?: unknown;
  readonly failure?: WorkflowFailure;
  readonly durationMs: number;
}
