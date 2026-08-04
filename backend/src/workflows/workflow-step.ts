export interface WorkflowStartStep<TStepId extends string = string> {
  readonly id: TStepId;
  readonly name: string;
  readonly kind: 'start';
}

export interface WorkflowActionStep<TStepId extends string = string> {
  readonly id: TStepId;
  readonly name: string;
  readonly kind: 'action';
  readonly operation: string;
}

export interface WorkflowFinishStep<TStepId extends string = string> {
  readonly id: TStepId;
  readonly name: string;
  readonly kind: 'finish';
}

export interface WorkflowDecisionStep<TStepId extends string = string> {
  readonly id: TStepId;
  readonly name: string;
  readonly kind: 'decision';
}

export interface WorkflowForkStep<TStepId extends string = string> {
  readonly id: TStepId;
  readonly type: 'fork';
  readonly name: string;
  readonly joinStepId: TStepId;
}

export interface WorkflowJoinStep<TStepId extends string = string> {
  readonly id: TStepId;
  readonly type: 'join';
  readonly name: string;
  readonly forkStepId: TStepId;
}

export type WorkflowStepKind =
  | 'start'
  | 'action'
  | 'decision'
  | 'fork'
  | 'join'
  | 'finish';

export type WorkflowStep<TStepId extends string = string> =
  | WorkflowStartStep<TStepId>
  | WorkflowActionStep<TStepId>
  | WorkflowDecisionStep<TStepId>
  | WorkflowForkStep<TStepId>
  | WorkflowJoinStep<TStepId>
  | WorkflowFinishStep<TStepId>;

export function getWorkflowStepKind(step: WorkflowStep): WorkflowStepKind {
  return 'kind' in step ? step.kind : step.type;
}
