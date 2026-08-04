export interface SerializedWorkflowExecution {
  readonly schemaVersion: 1;
  readonly canonicalJson: string;
}

export interface PersistedWorkflowExecutionRecord {
  readonly schemaVersion: 1;
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly revision: number;
  readonly writeId: string;
  readonly execution: SerializedWorkflowExecution;
}

export interface NewWorkflowExecutionRecord {
  readonly writeId: string;
  readonly execution: SerializedWorkflowExecution;
}

export interface SaveWorkflowExecutionRequest {
  readonly executionId: string;
  readonly expectedRevision: number;
  readonly writeId: string;
  readonly execution: SerializedWorkflowExecution;
}
