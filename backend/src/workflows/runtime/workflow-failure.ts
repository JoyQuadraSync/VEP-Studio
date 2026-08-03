export type WorkflowFailureCode =
  | 'operation_not_registered'
  | 'operation_failed'
  | 'no_next_step'
  | 'unsupported_multiple_outgoing_edges'
  | 'invalid_step'
  | 'invalid_finish_step';

export interface WorkflowFailure {
  readonly code: WorkflowFailureCode;
  readonly message: string;
  readonly stepId: string;
  readonly operationId?: string;
}
