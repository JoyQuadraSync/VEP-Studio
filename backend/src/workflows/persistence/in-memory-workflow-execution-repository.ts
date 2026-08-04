import {
  NewWorkflowExecutionRecord,
  PersistedWorkflowExecutionRecord,
  SaveWorkflowExecutionRequest,
  SerializedWorkflowExecution
} from './workflow-execution-record';
import { WorkflowExecutionRepository } from './workflow-execution-repository';
import { WorkflowPersistenceError } from './workflow-persistence-error';

interface AcceptedWrite {
  readonly kind: 'create' | 'save';
  readonly expectedRevision?: number;
  readonly canonicalJson: string;
  readonly record: PersistedWorkflowExecutionRecord;
}

interface StoredExecution {
  record: PersistedWorkflowExecutionRecord;
  readonly writes: Map<string, AcceptedWrite>;
}

export class InMemoryWorkflowExecutionRepository implements WorkflowExecutionRepository {
  private readonly executions = new Map<string, StoredExecution>();

  async create(
    request: NewWorkflowExecutionRecord
  ): Promise<PersistedWorkflowExecutionRecord> {
    const identity = this.readIdentity(request.execution);
    const existing = this.executions.get(identity.executionId);

    if (existing) {
      const accepted = existing.writes.get(request.writeId);

      if (accepted) {
        if (
          accepted.kind === 'create' &&
          accepted.canonicalJson === request.execution.canonicalJson
        ) {
          return this.copyRecord(accepted.record);
        }

        throw this.duplicateConflict(identity.executionId, request.writeId);
      }

      throw new WorkflowPersistenceError({
        code: 'execution_already_exists',
        message: 'Workflow execution already exists.',
        executionId: identity.executionId,
        writeId: request.writeId
      });
    }

    const record: PersistedWorkflowExecutionRecord = {
      schemaVersion: 1,
      ...identity,
      revision: 1,
      writeId: request.writeId,
      execution: this.copySerialized(request.execution)
    };
    const accepted: AcceptedWrite = {
      kind: 'create',
      canonicalJson: request.execution.canonicalJson,
      record
    };

    this.executions.set(identity.executionId, {
      record,
      writes: new Map([[request.writeId, accepted]])
    });
    return this.copyRecord(record);
  }

  async findByExecutionId(
    executionId: string
  ): Promise<PersistedWorkflowExecutionRecord | undefined> {
    const stored = this.executions.get(executionId);
    return stored ? this.copyRecord(stored.record) : undefined;
  }

  async save(request: SaveWorkflowExecutionRequest): Promise<PersistedWorkflowExecutionRecord> {
    const stored = this.executions.get(request.executionId);

    if (!stored) {
      throw new WorkflowPersistenceError({
        code: 'execution_not_found',
        message: 'Workflow execution does not exist.',
        executionId: request.executionId
      });
    }

    const accepted = stored.writes.get(request.writeId);

    if (accepted) {
      if (
        accepted.kind === 'save' &&
        accepted.expectedRevision === request.expectedRevision &&
        accepted.canonicalJson === request.execution.canonicalJson
      ) {
        return this.copyRecord(accepted.record);
      }

      throw this.duplicateConflict(request.executionId, request.writeId);
    }

    if (stored.record.revision !== request.expectedRevision) {
      throw new WorkflowPersistenceError({
        code: 'stale_revision',
        message: 'Workflow execution revision is stale.',
        executionId: request.executionId,
        expectedRevision: request.expectedRevision,
        actualRevision: stored.record.revision,
        writeId: request.writeId
      });
    }

    const identity = this.readIdentity(request.execution);

    if (
      identity.executionId !== request.executionId ||
      identity.workflowId !== stored.record.workflowId ||
      identity.workflowVersion !== stored.record.workflowVersion
    ) {
      throw new WorkflowPersistenceError({
        code: 'identity_mismatch',
        message: 'Saved execution identity does not match its persisted record.',
        executionId: request.executionId
      });
    }

    const record: PersistedWorkflowExecutionRecord = {
      schemaVersion: 1,
      ...identity,
      revision: stored.record.revision + 1,
      writeId: request.writeId,
      execution: this.copySerialized(request.execution)
    };
    stored.record = record;
    stored.writes.set(request.writeId, {
      kind: 'save',
      expectedRevision: request.expectedRevision,
      canonicalJson: request.execution.canonicalJson,
      record
    });
    return this.copyRecord(record);
  }

  private readIdentity(execution: SerializedWorkflowExecution): {
    readonly executionId: string;
    readonly workflowId: string;
    readonly workflowVersion: number;
  } {
    let value: unknown;

    try {
      value = JSON.parse(execution.canonicalJson);
    } catch {
      throw new WorkflowPersistenceError({
        code: 'deserialization_failed',
        message: 'Persisted execution identity cannot be decoded.'
      });
    }

    if (
      typeof value !== 'object' ||
      value === null ||
      !('executionId' in value) ||
      !('workflowId' in value) ||
      !('workflowVersion' in value) ||
      typeof value.executionId !== 'string' ||
      typeof value.workflowId !== 'string' ||
      typeof value.workflowVersion !== 'number' ||
      !Number.isInteger(value.workflowVersion)
    ) {
      throw new WorkflowPersistenceError({
        code: 'deserialization_failed',
        message: 'Persisted execution identity is malformed.'
      });
    }

    return {
      executionId: value.executionId,
      workflowId: value.workflowId,
      workflowVersion: value.workflowVersion
    };
  }

  private copyRecord(record: PersistedWorkflowExecutionRecord): PersistedWorkflowExecutionRecord {
    return { ...record, execution: this.copySerialized(record.execution) };
  }

  private copySerialized(execution: SerializedWorkflowExecution): SerializedWorkflowExecution {
    return { schemaVersion: 1, canonicalJson: execution.canonicalJson };
  }

  private duplicateConflict(executionId: string, writeId: string): WorkflowPersistenceError {
    return new WorkflowPersistenceError({
      code: 'duplicate_write_conflict',
      message: 'Write identifier was reused with conflicting content or revision.',
      executionId,
      writeId
    });
  }
}
