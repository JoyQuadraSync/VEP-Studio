export type ConditionScalar = string | number | boolean | null;

export type ConditionPathSegment = string | number;

export interface WorkflowInputConditionReference {
  readonly source: 'workflow_input';
  readonly path: readonly ConditionPathSegment[];
}

export interface CurrentStepInputConditionReference {
  readonly source: 'current_step_input';
  readonly path: readonly ConditionPathSegment[];
}

export interface CurrentStepOutputConditionReference {
  readonly source: 'current_step_output';
  readonly path: readonly ConditionPathSegment[];
}

export type CompletedStepResultConditionReference =
  | {
      readonly source: 'completed_step_result';
      readonly stepId: string;
      readonly field: 'input' | 'output';
      readonly path: readonly ConditionPathSegment[];
    }
  | {
      readonly source: 'completed_step_result';
      readonly stepId: string;
      readonly field: 'status' | 'failure.code';
    };

export interface ExecutionMetadataConditionReference {
  readonly source: 'execution_metadata';
  readonly field: 'executionId' | 'workflowId' | 'workflowVersion' | 'state';
}

export type ConditionReference =
  | WorkflowInputConditionReference
  | CurrentStepInputConditionReference
  | CurrentStepOutputConditionReference
  | CompletedStepResultConditionReference
  | ExecutionMetadataConditionReference;

export type ConditionOperand =
  | {
      readonly kind: 'literal';
      readonly value: ConditionScalar;
    }
  | {
      readonly kind: 'reference';
      readonly reference: ConditionReference;
    };

export interface WorkflowComparisonCondition {
  readonly operator:
    | 'equals'
    | 'not_equals'
    | 'greater_than'
    | 'greater_than_or_equal'
    | 'less_than'
    | 'less_than_or_equal';
  readonly left: ConditionOperand;
  readonly right: ConditionOperand;
}

export interface WorkflowExistenceCondition {
  readonly operator: 'exists' | 'not_exists';
  readonly operand: {
    readonly kind: 'reference';
    readonly reference: ConditionReference;
  };
}

export interface WorkflowAndCondition {
  readonly operator: 'and';
  readonly conditions: readonly WorkflowCondition[];
}

export interface WorkflowOrCondition {
  readonly operator: 'or';
  readonly conditions: readonly WorkflowCondition[];
}

export interface WorkflowNotCondition {
  readonly operator: 'not';
  readonly condition: WorkflowCondition;
}

export type WorkflowCondition =
  | WorkflowComparisonCondition
  | WorkflowExistenceCondition
  | WorkflowAndCondition
  | WorkflowOrCondition
  | WorkflowNotCondition;
