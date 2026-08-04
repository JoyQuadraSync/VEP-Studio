import { WorkflowDefinition } from '../workflow-definition';
import { WorkflowValidator } from '../workflow-validator';
import { WorkflowExecution } from '../runtime/workflow-execution';
import { WorkflowRunner } from '../runtime/workflow-runner';
import { WorkflowState } from '../runtime/workflow-state';
import { WorkflowDefinitionResolver } from './workflow-definition-resolver';
import {
  PersistedWorkflowExecutionRecord,
  SaveWorkflowExecutionRequest
} from './workflow-execution-record';
import { WorkflowExecutionRecoveryValidator } from './workflow-execution-recovery-validator';
import { WorkflowExecutionRepository } from './workflow-execution-repository';
import { WorkflowExecutionSerializer } from './workflow-execution-serializer';
import { WorkflowExecutionWriteIdGenerator } from './workflow-execution-write-id-generator';
import { WorkflowJsonValue } from './workflow-json-value';
import { WorkflowPersistenceError } from './workflow-persistence-error';

export interface WorkflowExecutionCoordinator {
  start(
    definition: WorkflowDefinition,
    workflowInput: WorkflowJsonValue
  ): Promise<PersistedWorkflowExecutionRecord>;
  resume(executionId: string): Promise<PersistedWorkflowExecutionRecord>;
}

export class DurableWorkflowExecutionCoordinator implements WorkflowExecutionCoordinator {
  constructor(
    private readonly runner: WorkflowRunner,
    private readonly repository: WorkflowExecutionRepository,
    private readonly serializer: WorkflowExecutionSerializer,
    private readonly recoveryValidator: WorkflowExecutionRecoveryValidator,
    private readonly definitionResolver: WorkflowDefinitionResolver,
    private readonly definitionValidator: WorkflowValidator,
    private readonly writeIdGenerator: WorkflowExecutionWriteIdGenerator
  ) {}

  async start(
    definition: WorkflowDefinition,
    workflowInput: WorkflowJsonValue
  ): Promise<PersistedWorkflowExecutionRecord> {
    this.assertValidDefinition(definition);
    const execution = this.runner.createExecution(definition, workflowInput);
    const initialWriteId = this.nextWriteId();
    const createRequest = {
      writeId: initialWriteId,
      execution: this.serializer.serialize(execution)
    };
    let initial: PersistedWorkflowExecutionRecord;

    try {
      initial = await this.repository.create(createRequest);
    } catch (error: unknown) {
      if (
        !(error instanceof WorkflowPersistenceError) ||
        error.details.code !== 'repository_unavailable'
      ) {
        throw error;
      }

      initial = await this.repository.create(createRequest);
    }
    return this.progress(definition, initial, execution);
  }

  async resume(executionId: string): Promise<PersistedWorkflowExecutionRecord> {
    const record = await this.repository.findByExecutionId(executionId);

    if (!record) {
      throw new WorkflowPersistenceError({
        code: 'execution_not_found',
        message: 'Workflow execution does not exist.',
        executionId
      });
    }

    this.validateEnvelope(record);
    const execution = this.serializer.deserialize(record.execution);

    if (
      execution.executionId !== record.executionId ||
      execution.workflowId !== record.workflowId ||
      execution.workflowVersion !== record.workflowVersion
    ) {
      throw new WorkflowPersistenceError({
        code: 'identity_mismatch',
        message: 'Persisted envelope and workflow execution identities do not match.',
        executionId
      });
    }

    const definition = this.definitionResolver.resolve(
      record.workflowId,
      record.workflowVersion
    );

    if (!definition) {
      throw new WorkflowPersistenceError({
        code: 'definition_not_found',
        message: 'Exact workflow definition version is not registered.',
        executionId,
        workflowId: record.workflowId,
        workflowVersion: record.workflowVersion
      });
    }

    this.assertValidDefinition(definition);
    this.recoveryValidator.validate(definition, execution);

    if (this.isTerminal(execution)) {
      throw new WorkflowPersistenceError({
        code: 'terminal_execution_not_resumable',
        message: 'Completed and failed workflow executions cannot be resumed.',
        executionId
      });
    }

    return this.progress(definition, record, execution);
  }

  private async progress(
    definition: WorkflowDefinition,
    initialRecord: PersistedWorkflowExecutionRecord,
    initialExecution: WorkflowExecution
  ): Promise<PersistedWorkflowExecutionRecord> {
    let record = initialRecord;
    let execution = initialExecution;

    while (!this.isTerminal(execution)) {
      const nextExecution = await this.runner.advance(definition, execution);
      const request: SaveWorkflowExecutionRequest = {
        executionId: execution.executionId,
        expectedRevision: record.revision,
        writeId: this.nextWriteId(),
        execution: this.serializer.serialize(nextExecution)
      };
      record = await this.saveWithAmbiguousResponseProtection(request);
      execution = nextExecution;
    }

    return record;
  }

  private async saveWithAmbiguousResponseProtection(
    request: SaveWorkflowExecutionRequest
  ): Promise<PersistedWorkflowExecutionRecord> {
    try {
      return await this.repository.save(request);
    } catch (error: unknown) {
      if (
        error instanceof WorkflowPersistenceError &&
        error.details.code === 'repository_unavailable'
      ) {
        return this.repository.save(request);
      }

      throw error;
    }
  }

  private assertValidDefinition(definition: WorkflowDefinition): void {
    const result = this.definitionValidator.validate(definition);

    if (!result.valid) {
      throw new WorkflowPersistenceError({
        code: 'recovery_validation_failed',
        message: 'Workflow definition is invalid.',
        workflowId: definition.id,
        workflowVersion: definition.version
      });
    }
  }

  private validateEnvelope(record: PersistedWorkflowExecutionRecord): void {
    if (record.schemaVersion !== 1 || record.execution.schemaVersion !== 1) {
      throw new WorkflowPersistenceError({
        code: 'unsupported_schema_version',
        message: 'Persisted workflow execution uses an unsupported schema version.',
        executionId: record.executionId
      });
    }

    if (
      record.executionId.length === 0 ||
      record.workflowId.length === 0 ||
      !Number.isInteger(record.workflowVersion) || record.workflowVersion <= 0 ||
      !Number.isInteger(record.revision) || record.revision <= 0 ||
      record.writeId.length === 0
    ) {
      throw new WorkflowPersistenceError({
        code: 'recovery_validation_failed',
        message: 'Persisted workflow execution envelope is malformed.',
        executionId: record.executionId
      });
    }
  }

  private nextWriteId(): string {
    const writeId = this.writeIdGenerator.generate();

    if (writeId.length === 0) {
      throw new WorkflowPersistenceError({
        code: 'repository_unavailable',
        message: 'Workflow execution write identifier must not be empty.'
      });
    }

    return writeId;
  }

  private isTerminal(execution: WorkflowExecution): boolean {
    return execution.state === WorkflowState.COMPLETED || execution.state === WorkflowState.FAILED;
  }
}
