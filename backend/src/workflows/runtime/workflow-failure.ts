export type WorkflowFailureCode =
  | 'operation_not_registered'
  | 'operation_failed'
  | 'no_next_step'
  | 'unsupported_multiple_outgoing_edges'
  | 'invalid_step'
  | 'invalid_finish_step'
  | 'condition_evaluation_failed'
  | 'multiple_matching_branches'
  | 'no_matching_branch'
  | 'invalid_default_branch'
  | 'parallel_branch_failed'
  | 'parallel_join_mismatch';

export interface WorkflowFailure {
  readonly code: WorkflowFailureCode;
  readonly message: string;
  readonly stepId: string;
  readonly operationId?: string;
}
