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

export interface WorkflowParallelEdge<TStepId extends string = string> {
  readonly id: string;
  readonly type: 'parallel';
  readonly sourceStepId: TStepId;
  readonly targetStepId: TStepId;
  readonly branchId: string;
}

export type WorkflowEdge<TStepId extends string = string> =
  | WorkflowUnconditionalEdge<TStepId>
  | WorkflowConditionalEdge<TStepId>
  | WorkflowDefaultEdge<TStepId>
  | WorkflowParallelEdge<TStepId>;

export function isWorkflowParallelEdge<TStepId extends string>(
  edge: WorkflowEdge<TStepId>
): edge is WorkflowParallelEdge<TStepId> {
  return 'type' in edge && edge.type === 'parallel';
}

export function getWorkflowEdgeSource<TStepId extends string>(
  edge: WorkflowEdge<TStepId>
): TStepId {
  return isWorkflowParallelEdge(edge) ? edge.sourceStepId : edge.from;
}

export function getWorkflowEdgeTarget<TStepId extends string>(
  edge: WorkflowEdge<TStepId>
): TStepId {
  return isWorkflowParallelEdge(edge) ? edge.targetStepId : edge.to;
}

export function isWorkflowConditionalEdge<TStepId extends string>(
  edge: WorkflowEdge<TStepId>
): edge is WorkflowConditionalEdge<TStepId> {
  return !isWorkflowParallelEdge(edge) && 'condition' in edge && edge.condition !== undefined;
}

export function isWorkflowDefaultEdge<TStepId extends string>(
  edge: WorkflowEdge<TStepId>
): edge is WorkflowDefaultEdge<TStepId> {
  return !isWorkflowParallelEdge(edge) && 'default' in edge && edge.default === true;
}
