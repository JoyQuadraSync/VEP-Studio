import { WorkflowCondition } from './workflow-condition';

export interface WorkflowUnconditionalEdge<TStepId extends string = string> {
  readonly id: string;
  readonly from: TStepId;
  readonly to: TStepId;
  readonly condition?: never;
  readonly default?: never;
}

export interface WorkflowConditionalEdge<TStepId extends string = string> {
  readonly id: string;
  readonly from: TStepId;
  readonly to: TStepId;
  readonly condition: WorkflowCondition;
  readonly default?: never;
}

export interface WorkflowDefaultEdge<TStepId extends string = string> {
  readonly id: string;
  readonly from: TStepId;
  readonly to: TStepId;
  readonly condition?: never;
  readonly default: true;
}

export type WorkflowEdge<TStepId extends string = string> =
  | WorkflowUnconditionalEdge<TStepId>
  | WorkflowConditionalEdge<TStepId>
  | WorkflowDefaultEdge<TStepId>;

export function isWorkflowConditionalEdge<TStepId extends string>(
  edge: WorkflowEdge<TStepId>
): edge is WorkflowConditionalEdge<TStepId> {
  return 'condition' in edge && edge.condition !== undefined;
}

export function isWorkflowDefaultEdge<TStepId extends string>(
  edge: WorkflowEdge<TStepId>
): edge is WorkflowDefaultEdge<TStepId> {
  return 'default' in edge && edge.default === true;
}
