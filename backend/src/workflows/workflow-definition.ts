import { WorkflowEdge } from './workflow-edge';
import { WorkflowStep } from './workflow-step';

export interface WorkflowDefinition<
  TWorkflowId extends string = string,
  TStepId extends string = string
> {
  readonly id: TWorkflowId;
  readonly version: number;
  readonly name: string;
  readonly startStepId: TStepId;
  readonly finishStepId: TStepId;
  readonly steps: readonly WorkflowStep<TStepId>[];
  readonly edges: readonly WorkflowEdge<TStepId>[];
}
