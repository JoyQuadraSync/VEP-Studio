export type WorkflowPersistenceErrorCode =
  | 'execution_not_found'
  | 'execution_already_exists'
  | 'stale_revision'
  | 'duplicate_write_conflict'
  | 'repository_unavailable'
  | 'serialization_failed'
  | 'deserialization_failed'
  | 'unsupported_schema_version'
  | 'definition_not_found'
  | 'identity_mismatch'
  | 'recovery_validation_failed'
  | 'terminal_execution_not_resumable';

export interface WorkflowPersistenceErrorDetails {
  readonly code: WorkflowPersistenceErrorCode;
  readonly message: string;
  readonly executionId?: string;
  readonly workflowId?: string;
  readonly workflowVersion?: number;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;
  readonly writeId?: string;
}

export class WorkflowPersistenceError extends Error {
  readonly details: WorkflowPersistenceErrorDetails;

  constructor(details: WorkflowPersistenceErrorDetails) {
    super(details.message);
    this.name = 'WorkflowPersistenceError';
    this.details = { ...details };
  }
}
