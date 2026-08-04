import {
  NewWorkflowExecutionRecord,
  PersistedWorkflowExecutionRecord,
  SaveWorkflowExecutionRequest
} from './workflow-execution-record';

export interface WorkflowExecutionRepository {
  create(record: NewWorkflowExecutionRecord): Promise<PersistedWorkflowExecutionRecord>;
  findByExecutionId(executionId: string): Promise<PersistedWorkflowExecutionRecord | undefined>;
  save(request: SaveWorkflowExecutionRequest): Promise<PersistedWorkflowExecutionRecord>;
}
