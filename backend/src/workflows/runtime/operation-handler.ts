export interface OperationHandlerInput {
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly stepId: string;
  readonly workflowInput: unknown;
  readonly stepInput: unknown;
}

export type OperationHandler = (
  input: OperationHandlerInput
) => unknown | Promise<unknown>;
