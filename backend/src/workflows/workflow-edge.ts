export interface WorkflowEdge<TStepId extends string = string> {
  readonly id: string;
  readonly from: TStepId;
  readonly to: TStepId;
}
