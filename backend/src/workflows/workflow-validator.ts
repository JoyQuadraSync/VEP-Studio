import {
  ConditionOperand,
  ConditionReference,
  WorkflowCondition
} from './workflow-condition';
import { WorkflowDefinition } from './workflow-definition';
import {
  isWorkflowConditionalEdge,
  isWorkflowDefaultEdge,
  WorkflowEdge
} from './workflow-edge';
import { WorkflowStep } from './workflow-step';

export interface WorkflowValidationIssue {
  readonly code: string;
  readonly message: string;
}

export interface WorkflowValidationResult {
  readonly valid: boolean;
  readonly issues: readonly WorkflowValidationIssue[];
}

export interface WorkflowValidator {
  validate(definition: WorkflowDefinition): WorkflowValidationResult;
}

export class GraphWorkflowValidator implements WorkflowValidator {
  constructor(private readonly maximumConditionDepth = 20) {}

  validate(definition: WorkflowDefinition): WorkflowValidationResult {
    const issues: WorkflowValidationIssue[] = [];
    const stepIds = new Set<string>();
    const edgeIds = new Set<string>();

    if (!this.isNamespacedWorkflowId(definition.id)) {
      issues.push({
        code: 'INVALID_WORKFLOW_ID',
        message: 'Workflow id must use a lowercase dotted namespace.'
      });
    }

    if (definition.name.trim().length === 0) {
      issues.push({ code: 'INVALID_WORKFLOW_NAME', message: 'Workflow name must not be empty.' });
    }

    if (!Number.isInteger(definition.version) || definition.version <= 0) {
      issues.push({
        code: 'INVALID_WORKFLOW_VERSION',
        message: 'Workflow version must be a positive integer.'
      });
    }

    for (const step of definition.steps) {
      if (stepIds.has(step.id)) {
        issues.push({ code: 'DUPLICATE_STEP_ID', message: `Duplicate step id: ${step.id}` });
      }

      stepIds.add(step.id);
    }

    const startStep = definition.steps.find((step) => step.id === definition.startStepId);
    const finishStep = definition.steps.find((step) => step.id === definition.finishStepId);

    if (!startStep || startStep.kind !== 'start') {
      issues.push({
        code: 'INVALID_START_STEP',
        message: 'startStepId must reference a start step.'
      });
    }

    if (!finishStep || finishStep.kind !== 'finish') {
      issues.push({
        code: 'INVALID_FINISH_STEP',
        message: 'finishStepId must reference a finish step.'
      });
    }

    if (definition.startStepId === definition.finishStepId) {
      issues.push({
        code: 'START_EQUALS_FINISH',
        message: 'Start and finish steps must be different.'
      });
    }

    const adjacency = this.createAdjacency(stepIds);
    const reverseAdjacency = this.createAdjacency(stepIds);

    for (const edge of definition.edges) {
      if (edgeIds.has(edge.id)) {
        issues.push({ code: 'DUPLICATE_EDGE_ID', message: `Duplicate edge id: ${edge.id}` });
      }

      edgeIds.add(edge.id);

      if (!stepIds.has(edge.from)) {
        issues.push({
          code: 'UNKNOWN_EDGE_SOURCE',
          message: `Edge ${edge.id} references unknown source step: ${edge.from}`
        });
      }

      if (!stepIds.has(edge.to)) {
        issues.push({
          code: 'UNKNOWN_EDGE_TARGET',
          message: `Edge ${edge.id} references unknown target step: ${edge.to}`
        });
      }

      if (stepIds.has(edge.from) && stepIds.has(edge.to)) {
        adjacency.get(edge.from)?.add(edge.to);
        reverseAdjacency.get(edge.to)?.add(edge.from);
      }

      if (isWorkflowConditionalEdge(edge)) {
        if (this.containsUnsupportedValue(edge.condition, new WeakSet<object>())) {
          issues.push({
            code: 'NON_SERIALIZABLE_CONDITION',
            message: `Edge ${edge.id} contains a non-serializable condition value.`
          });
        } else {
          this.validateCondition(edge.condition, stepIds, issues, 1, new WeakSet<object>());
        }
      }
    }

    for (const step of definition.steps) {
      this.validateStepEdges(
        step,
        definition.edges.filter((edge) => edge.from === step.id),
        issues
      );
    }

    if (startStep && finishStep) {
      const reachableFromStart = this.collectReachable(definition.startStepId, adjacency);
      const ableToReachFinish = this.collectReachable(definition.finishStepId, reverseAdjacency);

      if (!reachableFromStart.has(definition.finishStepId)) {
        issues.push({
          code: 'NO_START_TO_FINISH_PATH',
          message: 'Workflow must contain a path from start to finish.'
        });
      }

      for (const stepId of stepIds) {
        if (!reachableFromStart.has(stepId)) {
          issues.push({
            code: 'UNREACHABLE_STEP',
            message: `Step is not reachable from start: ${stepId}`
          });
        }

        if (!ableToReachFinish.has(stepId)) {
          issues.push({
            code: 'STEP_CANNOT_REACH_FINISH',
            message: `Step cannot reach finish: ${stepId}`
          });
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }

  private validateStepEdges(
    step: WorkflowStep,
    outgoingEdges: readonly WorkflowEdge[],
    issues: WorkflowValidationIssue[]
  ): void {
    if (step.kind === 'finish') {
      if (outgoingEdges.length > 0) {
        issues.push({
          code: 'INVALID_FINISH_OUTGOING_EDGES',
          message: `Finish step ${step.id} must not have outgoing edges.`
        });
      }

      return;
    }

    if (step.kind === 'decision') {
      if (outgoingEdges.length === 0) {
        issues.push({
          code: 'DECISION_REQUIRES_OUTGOING_EDGE',
          message: `Decision step ${step.id} must have at least one outgoing edge.`
        });
      }

      const defaultEdges = outgoingEdges.filter(isWorkflowDefaultEdge);

      if (defaultEdges.length > 1) {
        issues.push({
          code: 'MULTIPLE_DEFAULT_EDGES',
          message: `Decision step ${step.id} must not have multiple default edges.`
        });
      }

      for (const edge of outgoingEdges) {
        const edgeId = edge.id;
        const conditional = isWorkflowConditionalEdge(edge);
        const defaultEdge = isWorkflowDefaultEdge(edge);

        if (conditional && defaultEdge) {
          issues.push({
            code: 'DEFAULT_EDGE_HAS_CONDITION',
            message: `Default edge ${edgeId} must not contain a condition.`
          });
        } else if (!conditional && !defaultEdge) {
          issues.push({
            code: 'DECISION_EDGE_REQUIRES_CONDITION_OR_DEFAULT',
            message: `Decision edge ${edge.id} must be conditional or default.`
          });
        }
      }

      return;
    }

    if (outgoingEdges.length !== 1) {
      issues.push({
        code: 'LINEAR_STEP_REQUIRES_ONE_OUTGOING_EDGE',
        message: `${step.kind} step ${step.id} must have exactly one outgoing edge.`
      });
    }

    for (const edge of outgoingEdges) {
      if (isWorkflowConditionalEdge(edge) || isWorkflowDefaultEdge(edge)) {
        issues.push({
          code: 'LINEAR_STEP_REQUIRES_UNCONDITIONAL_EDGE',
          message: `${step.kind} step ${step.id} must use an unconditional edge.`
        });
      }
    }
  }

  private validateCondition(
    condition: WorkflowCondition,
    stepIds: ReadonlySet<string>,
    issues: WorkflowValidationIssue[],
    depth: number,
    activeConditions: WeakSet<object>
  ): void {
    if (typeof condition !== 'object' || condition === null) {
      issues.push({ code: 'INVALID_CONDITION', message: 'Condition must be an object.' });
      return;
    }

    if (depth > this.maximumConditionDepth) {
      issues.push({
        code: 'CONDITION_DEPTH_EXCEEDED',
        message: 'Condition exceeds the configured maximum depth.'
      });
      return;
    }

    if (activeConditions.has(condition)) {
      issues.push({ code: 'CYCLIC_CONDITION', message: 'Condition must not contain cycles.' });
      return;
    }

    activeConditions.add(condition);

    switch (condition.operator) {
      case 'equals':
      case 'not_equals':
      case 'greater_than':
      case 'greater_than_or_equal':
      case 'less_than':
      case 'less_than_or_equal':
        this.validateOperand(condition.left, stepIds, issues);
        this.validateOperand(condition.right, stepIds, issues);
        break;
      case 'exists':
      case 'not_exists':
        this.validateReference(condition.operand.reference, stepIds, issues);
        break;
      case 'and':
      case 'or':
        if (condition.conditions.length < 2) {
          issues.push({
            code: 'INVALID_LOGICAL_CONDITION_ARITY',
            message: `${condition.operator} requires at least two child conditions.`
          });
        }

        for (const child of condition.conditions) {
          this.validateCondition(child, stepIds, issues, depth + 1, activeConditions);
        }
        break;
      case 'not':
        this.validateCondition(condition.condition, stepIds, issues, depth + 1, activeConditions);
        break;
      default:
        issues.push({
          code: 'UNSUPPORTED_CONDITION_OPERATOR',
          message: 'Condition contains an unsupported operator.'
        });
    }

    activeConditions.delete(condition);
  }

  private validateOperand(
    operand: ConditionOperand,
    stepIds: ReadonlySet<string>,
    issues: WorkflowValidationIssue[]
  ): void {
    if (operand.kind === 'literal') {
      if (!this.isConditionScalar(operand.value)) {
        issues.push({
          code: 'INVALID_CONDITION_LITERAL',
          message: 'Condition literal must be a JSON-compatible scalar.'
        });
      }

      return;
    }

    this.validateReference(operand.reference, stepIds, issues);
  }

  private validateReference(
    reference: ConditionReference,
    stepIds: ReadonlySet<string>,
    issues: WorkflowValidationIssue[]
  ): void {
    if (reference.source === 'execution_metadata') {
      if (!['executionId', 'workflowId', 'workflowVersion', 'state'].includes(reference.field)) {
        issues.push({
          code: 'INVALID_EXECUTION_METADATA_FIELD',
          message: 'Condition references unsupported execution metadata.'
        });
      }

      if ('path' in reference) {
        issues.push({
          code: 'INVALID_EXECUTION_METADATA_PATH',
          message: 'Execution metadata references must not contain a path.'
        });
      }

      return;
    }

    if (reference.source === 'completed_step_result') {
      if (!stepIds.has(reference.stepId)) {
        issues.push({
          code: 'UNKNOWN_COMPLETED_STEP_REFERENCE',
          message: `Condition references unknown completed step: ${reference.stepId}`
        });
      }

      if (reference.field === 'input' || reference.field === 'output') {
        this.validatePath(reference.path, issues);
      } else if (!['status', 'failure.code'].includes(reference.field)) {
        issues.push({
          code: 'INVALID_COMPLETED_STEP_FIELD',
          message: 'Condition references unsupported completed-step data.'
        });
      } else if ('path' in reference) {
        issues.push({
          code: 'INVALID_COMPLETED_STEP_PATH',
          message: 'Completed-step status and failure code references must not contain a path.'
        });
      }

      return;
    }

    if (
      reference.source === 'workflow_input' ||
      reference.source === 'current_step_input' ||
      reference.source === 'current_step_output'
    ) {
      this.validatePath(reference.path, issues);
      return;
    }

    issues.push({
      code: 'UNSUPPORTED_CONDITION_SOURCE',
      message: 'Condition references an unsupported snapshot source.'
    });
  }

  private validatePath(
    path: readonly (string | number)[],
    issues: WorkflowValidationIssue[]
  ): void {
    for (const segment of path) {
      if (
        (typeof segment !== 'string' && typeof segment !== 'number') ||
        (typeof segment === 'number' && (!Number.isInteger(segment) || segment < 0))
      ) {
        issues.push({
          code: 'INVALID_CONDITION_PATH',
          message: 'Condition path must contain strings or non-negative integer indexes.'
        });
      }
    }
  }

  private containsUnsupportedValue(value: unknown, seen: WeakSet<object>): boolean {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return false;
    }

    if (typeof value !== 'object') {
      return true;
    }

    if (seen.has(value)) {
      return true;
    }

    if (!Array.isArray(value) && Object.prototype.toString.call(value) !== '[object Object]') {
      return true;
    }

    seen.add(value);

    for (const property of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, property);

      if (!descriptor || !('value' in descriptor) || this.containsUnsupportedValue(descriptor.value, seen)) {
        return true;
      }
    }

    seen.delete(value);
    return false;
  }

  private isConditionScalar(value: unknown): boolean {
    return value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value));
  }

  private isNamespacedWorkflowId(workflowId: string): boolean {
    return /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(workflowId);
  }

  private createAdjacency(stepIds: ReadonlySet<string>): Map<string, Set<string>> {
    const adjacency = new Map<string, Set<string>>();

    for (const stepId of stepIds) {
      adjacency.set(stepId, new Set<string>());
    }

    return adjacency;
  }

  private collectReachable(
    initialStepId: string,
    adjacency: ReadonlyMap<string, ReadonlySet<string>>
  ): Set<string> {
    const reachable = new Set<string>();
    const pending = [initialStepId];

    while (pending.length > 0) {
      const stepId = pending.pop();

      if (!stepId || reachable.has(stepId)) {
        continue;
      }

      reachable.add(stepId);

      for (const nextStepId of adjacency.get(stepId) ?? []) {
        if (!reachable.has(nextStepId)) {
          pending.push(nextStepId);
        }
      }
    }

    return reachable;
  }
}
