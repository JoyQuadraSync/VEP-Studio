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

export type WorkflowStep<TStepId extends string = string> =
  | WorkflowStartStep<TStepId>
  | WorkflowActionStep<TStepId>
  | WorkflowDecisionStep<TStepId>
  | WorkflowFinishStep<TStepId>;
