import {
  ConditionOperand,
  ConditionPathSegment,
  ConditionReference,
  ConditionScalar,
  WorkflowCondition
} from '../workflow-condition';
import { WorkflowState } from './workflow-state';
import { WorkflowStepResult } from './workflow-step-result';

export interface ConditionExecutionMetadata {
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly state: WorkflowState;
}

export interface ConditionEvaluationInput {
  readonly workflowInput: unknown;
  readonly currentStepInput: unknown;
  readonly currentStepOutput: unknown;
  readonly completedStepResults: readonly WorkflowStepResult[];
  readonly executionMetadata: ConditionExecutionMetadata;
}

export interface ConditionEvaluationFailure {
  readonly code: 'condition_evaluation_failed';
  readonly message: string;
}

export type ConditionEvaluationResult =
  | {
      readonly success: true;
      readonly value: boolean;
    }
  | {
      readonly success: false;
      readonly failure: ConditionEvaluationFailure;
    };

export interface ConditionEvaluator {
  evaluate(condition: WorkflowCondition, input: ConditionEvaluationInput): ConditionEvaluationResult;
}

type ResolvedValue =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false; readonly failure?: ConditionEvaluationFailure };

export class DeclarativeConditionEvaluator implements ConditionEvaluator {
  constructor(private readonly maximumDepth = 20) {}

  evaluate(condition: WorkflowCondition, input: ConditionEvaluationInput): ConditionEvaluationResult {
    return this.evaluateAtDepth(condition, input, 1);
  }

  private evaluateAtDepth(
    condition: WorkflowCondition,
    input: ConditionEvaluationInput,
    depth: number
  ): ConditionEvaluationResult {
    if (depth > this.maximumDepth) {
      return this.failure('Condition exceeds the configured maximum depth.');
    }

    switch (condition.operator) {
      case 'equals':
      case 'not_equals':
      case 'greater_than':
      case 'greater_than_or_equal':
      case 'less_than':
      case 'less_than_or_equal':
        return this.evaluateComparison(condition.operator, condition.left, condition.right, input);
      case 'exists':
      case 'not_exists': {
        const resolved = this.resolveReference(condition.operand.reference, input);

        if (!resolved.found && resolved.failure) {
          return { success: false, failure: resolved.failure };
        }

        const exists = resolved.found;
        return { success: true, value: condition.operator === 'exists' ? exists : !exists };
      }
      case 'and':
      case 'or': {
        if (condition.conditions.length < 2) {
          return this.failure('Logical condition requires at least two child conditions.');
        }

        const results = condition.conditions.map((child) =>
          this.evaluateAtDepth(child, input, depth + 1)
        );
        const failedResult = results.find((result) => !result.success);

        if (failedResult && !failedResult.success) {
          return failedResult;
        }

        const values = results.map((result) => result.success && result.value);
        return {
          success: true,
          value: condition.operator === 'and' ? values.every(Boolean) : values.some(Boolean)
        };
      }
      case 'not': {
        const result = this.evaluateAtDepth(condition.condition, input, depth + 1);

        if (!result.success) {
          return result;
        }

        return { success: true, value: !result.value };
      }
      default:
        return this.failure('Condition contains an unsupported operator.');
    }
  }

  private evaluateComparison(
    operator:
      | 'equals'
      | 'not_equals'
      | 'greater_than'
      | 'greater_than_or_equal'
      | 'less_than'
      | 'less_than_or_equal',
    leftOperand: ConditionOperand,
    rightOperand: ConditionOperand,
    input: ConditionEvaluationInput
  ): ConditionEvaluationResult {
    const left = this.resolveOperand(leftOperand, input);
    const right = this.resolveOperand(rightOperand, input);

    if (!left.found && left.failure) {
      return { success: false, failure: left.failure };
    }

    if (!right.found && right.failure) {
      return { success: false, failure: right.failure };
    }

    if (!left.found || !right.found) {
      return this.failure('Condition comparison references a value that does not exist.');
    }

    if (!this.isConditionScalar(left.value) || !this.isConditionScalar(right.value)) {
      return this.failure('Condition comparison operands must resolve to scalar values.');
    }

    if (this.scalarType(left.value) !== this.scalarType(right.value)) {
      return this.failure('Condition comparison operands must have the same scalar type.');
    }

    if (operator === 'equals' || operator === 'not_equals') {
      const equals = left.value === right.value;
      return { success: true, value: operator === 'equals' ? equals : !equals };
    }

    if (typeof left.value !== 'number' || typeof right.value !== 'number') {
      return this.failure('Ordered condition comparisons require numeric operands.');
    }

    switch (operator) {
      case 'greater_than':
        return { success: true, value: left.value > right.value };
      case 'greater_than_or_equal':
        return { success: true, value: left.value >= right.value };
      case 'less_than':
        return { success: true, value: left.value < right.value };
      case 'less_than_or_equal':
        return { success: true, value: left.value <= right.value };
    }
  }

  private resolveOperand(operand: ConditionOperand, input: ConditionEvaluationInput): ResolvedValue {
    if (operand.kind === 'literal') {
      return { found: true, value: operand.value };
    }

    return this.resolveReference(operand.reference, input);
  }

  private resolveReference(
    reference: ConditionReference,
    input: ConditionEvaluationInput
  ): ResolvedValue {
    switch (reference.source) {
      case 'workflow_input':
        return this.resolvePath(input.workflowInput, reference.path);
      case 'current_step_input':
        return this.resolvePath(input.currentStepInput, reference.path);
      case 'current_step_output':
        return this.resolvePath(input.currentStepOutput, reference.path);
      case 'execution_metadata':
        return this.resolveExecutionMetadata(reference.field, input);
      case 'completed_step_result': {
        const stepResult = input.completedStepResults.find(
          (candidate) => candidate.stepId === reference.stepId
        );

        if (!stepResult) {
          return { found: false };
        }

        if (reference.field === 'status') {
          return { found: true, value: stepResult.status };
        }

        if (reference.field === 'failure.code') {
          return stepResult.failure
            ? { found: true, value: stepResult.failure.code }
            : { found: false };
        }

        if ('path' in reference) {
          if (reference.field === 'input') {
            return this.resolvePath(stepResult.input, reference.path);
          }

          const output = this.readOwnProperty(stepResult, 'output');
          return output.found ? this.resolvePath(output.value, reference.path) : output;
        }

        return { found: false };
      }
      default:
        return this.invalidReference('Condition references an unsupported snapshot source.');
    }
  }

  private resolveExecutionMetadata(
    field: 'executionId' | 'workflowId' | 'workflowVersion' | 'state',
    input: ConditionEvaluationInput
  ): ResolvedValue {
    switch (field) {
      case 'executionId':
        return { found: true, value: input.executionMetadata.executionId };
      case 'workflowId':
        return { found: true, value: input.executionMetadata.workflowId };
      case 'workflowVersion':
        return { found: true, value: input.executionMetadata.workflowVersion };
      case 'state':
        return { found: true, value: input.executionMetadata.state };
      default:
        return this.invalidReference('Condition references unsupported execution metadata.');
    }
  }

  private resolvePath(value: unknown, path: readonly ConditionPathSegment[]): ResolvedValue {
    let resolved: ResolvedValue = { found: true, value };

    for (const segment of path) {
      if (!resolved.found) {
        return resolved;
      }

      if (typeof segment === 'number') {
        if (!Number.isInteger(segment) || segment < 0 || !Array.isArray(resolved.value)) {
          return this.invalidReference('Condition path cannot be traversed as an array.');
        }
      } else if (!this.isPlainObject(resolved.value)) {
        return this.invalidReference('Condition path cannot be traversed as an object.');
      }

      resolved = this.readOwnProperty(resolved.value, segment);
    }

    return resolved;
  }

  private readOwnProperty(value: object, property: PropertyKey): ResolvedValue {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);

    if (!descriptor) {
      return { found: false };
    }

    if (!('value' in descriptor)) {
      return this.invalidReference('Condition path must not invoke property accessors.');
    }

    return { found: true, value: descriptor.value };
  }

  private isPlainObject(value: unknown): value is object {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private isConditionScalar(value: unknown): value is ConditionScalar {
    return value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value));
  }

  private scalarType(value: ConditionScalar): string {
    return value === null ? 'null' : typeof value;
  }

  private failure(message: string): ConditionEvaluationResult {
    return {
      success: false,
      failure: { code: 'condition_evaluation_failed', message }
    };
  }

  private invalidReference(message: string): ResolvedValue {
    return {
      found: false,
      failure: { code: 'condition_evaluation_failed', message }
    };
  }
}
