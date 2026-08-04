import { WorkflowExecution } from '../runtime/workflow-execution';
import { WorkflowPersistenceError } from './workflow-persistence-error';
import { SerializedWorkflowExecution } from './workflow-execution-record';

export interface WorkflowExecutionSerializer {
  serialize(execution: WorkflowExecution): SerializedWorkflowExecution;
  deserialize(serialized: SerializedWorkflowExecution): WorkflowExecution;
}

export class CanonicalWorkflowExecutionSerializer implements WorkflowExecutionSerializer {
  serialize(execution: WorkflowExecution): SerializedWorkflowExecution {
    try {
      return { schemaVersion: 1, canonicalJson: this.canonicalize(execution, new Set<object>()) };
    } catch (error: unknown) {
      if (error instanceof WorkflowPersistenceError) {
        throw error;
      }

      throw this.serializationError('Workflow execution contains a non-persistable value.');
    }
  }

  deserialize(serialized: SerializedWorkflowExecution): WorkflowExecution {
    if (serialized.schemaVersion !== 1) {
      throw new WorkflowPersistenceError({
        code: 'unsupported_schema_version',
        message: 'Persisted workflow execution uses an unsupported schema version.'
      });
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(serialized.canonicalJson);
    } catch {
      throw new WorkflowPersistenceError({
        code: 'deserialization_failed',
        message: 'Persisted workflow execution is not valid JSON.'
      });
    }

    let canonicalJson: string;

    try {
      canonicalJson = this.canonicalize(parsed, new Set<object>());
    } catch {
      throw new WorkflowPersistenceError({
        code: 'deserialization_failed',
        message: 'Persisted workflow execution contains an unsupported value.'
      });
    }

    if (canonicalJson !== serialized.canonicalJson || !this.isExecutionShape(parsed)) {
      throw new WorkflowPersistenceError({
        code: 'deserialization_failed',
        message: 'Persisted workflow execution is malformed or non-canonical.'
      });
    }

    return parsed;
  }

  private canonicalize(value: unknown, active: Set<object>): string {
    if (value === null) {
      return 'null';
    }

    if (typeof value === 'string') {
      return JSON.stringify(value);
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw this.serializationError('Persisted numbers must be finite.');
      }

      return Object.is(value, -0) ? '0' : String(value);
    }

    if (typeof value !== 'object') {
      throw this.serializationError('Persisted values must be JSON-safe.');
    }

    if (active.has(value)) {
      throw this.serializationError('Persisted values must not contain cycles.');
    }

    active.add(value);

    try {
      if (Array.isArray(value)) {
        if (Object.getOwnPropertySymbols(value).length > 0) {
          throw this.serializationError('Persisted arrays must not contain symbol keys.');
        }

        const elements: string[] = [];

        for (let index = 0; index < value.length; index += 1) {
          if (!Object.prototype.hasOwnProperty.call(value, index)) {
            throw this.serializationError('Persisted arrays must not contain holes.');
          }

          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));

          if (!descriptor || !('value' in descriptor)) {
            throw this.serializationError('Persisted arrays must not contain accessors.');
          }

          elements.push(this.canonicalize(descriptor.value, active));
        }

        const additionalKeys = Object.keys(value).filter(
          (key) => !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length
        );

        if (additionalKeys.length > 0) {
          throw this.serializationError('Persisted arrays must not contain named properties.');
        }

        return `[${elements.join(',')}]`;
      }

      const prototype = Object.getPrototypeOf(value);

      if (prototype !== Object.prototype && prototype !== null) {
        throw this.serializationError('Persisted objects must be plain objects.');
      }

      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw this.serializationError('Persisted objects must not contain symbol keys.');
      }

      const keys = Object.getOwnPropertyNames(value).sort(this.compareUtf16);
      const properties: string[] = [];

      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);

        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw this.serializationError('Persisted objects must contain enumerable data properties only.');
        }

        properties.push(`${JSON.stringify(key)}:${this.canonicalize(descriptor.value, active)}`);
      }

      return `{${properties.join(',')}}`;
    } finally {
      active.delete(value);
    }
  }

  private isExecutionShape(value: unknown): value is WorkflowExecution {
    if (!this.isRecord(value)) {
      return false;
    }

    return typeof value.executionId === 'string' &&
      typeof value.workflowId === 'string' &&
      Number.isInteger(value.workflowVersion) &&
      typeof value.state === 'string' &&
      typeof value.currentStepId === 'string' &&
      Array.isArray(value.completedSteps) &&
      Array.isArray(value.stepResults) &&
      Array.isArray(value.parallelRegions) &&
      Object.prototype.hasOwnProperty.call(value, 'workflowInput');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private compareUtf16(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  private serializationError(message: string): WorkflowPersistenceError {
    return new WorkflowPersistenceError({ code: 'serialization_failed', message });
  }
}
