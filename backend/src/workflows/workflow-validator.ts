import { WorkflowDefinition } from './workflow-definition';

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
