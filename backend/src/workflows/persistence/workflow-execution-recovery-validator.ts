import { WorkflowDefinition } from '../workflow-definition';
import {
  getWorkflowEdgeSource,
  getWorkflowEdgeTarget,
  isWorkflowParallelEdge,
  WorkflowParallelEdge
} from '../workflow-edge';
import { WorkflowExecution } from '../runtime/workflow-execution';
import { WorkflowBranchExecution } from '../runtime/workflow-parallel-execution';
import { WorkflowState } from '../runtime/workflow-state';
import { WorkflowPersistenceError } from './workflow-persistence-error';

export interface WorkflowExecutionRecoveryValidator {
  validate(definition: WorkflowDefinition, execution: WorkflowExecution): void;
}

export class DefaultWorkflowExecutionRecoveryValidator
implements WorkflowExecutionRecoveryValidator {
  validate(definition: WorkflowDefinition, execution: WorkflowExecution): void {
    if (
      definition.id !== execution.workflowId ||
      definition.version !== execution.workflowVersion
    ) {
      this.fail('Recovered execution does not match the resolved workflow definition.', execution);
    }

    const stepIds = new Set(definition.steps.map((step) => step.id));

    if (!stepIds.has(execution.currentStepId)) {
      this.fail('Recovered execution references an invalid current step.', execution);
    }

    if (!Object.values(WorkflowState).includes(execution.state)) {
      this.fail('Recovered execution has an impossible workflow state.', execution);
    }

    this.validateHistory(execution.completedSteps, execution.stepResults, stepIds, execution);
    this.validateDuration(execution.durationMs, execution);

    if (execution.state === WorkflowState.CREATED && execution.activeParallel) {
      this.fail('Created execution cannot contain active parallel state.', execution);
    }

    if (execution.activeParallel) {
      this.validateActiveParallel(definition, execution);
    }

    for (const region of execution.parallelRegions) {
      if (!stepIds.has(region.forkStepId) || !stepIds.has(region.joinStepId)) {
        this.fail('Recovered parallel region references an invalid step.', execution);
      }

      this.validateDuration(region.durationMs, execution);
      this.validateBranches(region.branches, stepIds, execution);
      this.validateRegionOwnership(definition, region.forkStepId, region.joinStepId, region.branches, execution);

      if (region.state === 'completed' && region.branches.some((branch) => branch.state !== 'completed')) {
        this.fail('Completed parallel region contains an incomplete branch.', execution);
      }

      if (region.state === 'failed' && !region.branches.some((branch) => branch.state === 'failed')) {
        this.fail('Failed parallel region does not contain a failed branch.', execution);
      }
    }
  }

  private validateActiveParallel(
    definition: WorkflowDefinition,
    execution: WorkflowExecution
  ): void {
    const active = execution.activeParallel;

    if (!active) {
      return;
    }

    const fork = definition.steps.find((step) => step.id === active.forkStepId);
    const join = definition.steps.find((step) => step.id === active.joinStepId);
    const expectedBranchIds = definition.edges
      .filter((edge): edge is WorkflowParallelEdge =>
        getWorkflowEdgeSource(edge) === active.forkStepId && isWorkflowParallelEdge(edge)
      )
      .map((edge) => edge.branchId)
      .sort(this.compareUtf16);
    const actualBranchIds = active.branches.map((branch) => branch.branchId);

    if (
      !fork || !join ||
      !('joinStepId' in fork) || fork.joinStepId !== join.id ||
      !('forkStepId' in join) || join.forkStepId !== fork.id ||
      expectedBranchIds.length !== actualBranchIds.length ||
      expectedBranchIds.some((branchId, index) => branchId !== actualBranchIds[index])
    ) {
      this.fail('Recovered active parallel region does not match its definition.', execution);
    }

    const stepIds = new Set(definition.steps.map((step) => step.id));
    this.validateBranches(active.branches, stepIds, execution);
    this.validateRegionOwnership(
      definition,
      active.forkStepId,
      active.joinStepId,
      active.branches,
      execution
    );

    for (const branch of active.branches) {
      const edge = definition.edges.find(
        (candidate): candidate is WorkflowParallelEdge =>
          getWorkflowEdgeSource(candidate) === active.forkStepId &&
          isWorkflowParallelEdge(candidate) &&
          candidate.branchId === branch.branchId
      );

      if (!edge || edge.targetStepId !== branch.startStepId) {
        this.fail('Recovered branch ownership does not match the definition.', execution);
      }
    }
  }

  private validateBranches(
    branches: readonly WorkflowBranchExecution[],
    stepIds: ReadonlySet<string>,
    execution: WorkflowExecution
  ): void {
    const sorted = branches.map((branch) => branch.branchId).sort(this.compareUtf16);

    if (branches.some((branch, index) => branch.branchId !== sorted[index])) {
      this.fail('Recovered branches are not in canonical order.', execution);
    }

    for (const branch of branches) {
      if (branch.currentStepId && !stepIds.has(branch.currentStepId)) {
        this.fail('Recovered branch references an invalid current step.', execution);
      }

      if ((branch.state === 'completed' || branch.state === 'failed') && branch.currentStepId) {
        this.fail('Settled branch must not retain a current step.', execution);
      }

      this.validateHistory(branch.completedSteps, branch.stepResults, stepIds, execution);
      this.validateDuration(branch.durationMs, execution);
    }
  }

  private validateHistory(
    completedSteps: readonly string[],
    stepResults: readonly { readonly stepId: string; readonly durationMs: number }[],
    stepIds: ReadonlySet<string>,
    execution: WorkflowExecution
  ): void {
    const uniqueCompleted = new Set(completedSteps);

    if (
      uniqueCompleted.size !== completedSteps.length ||
      completedSteps.some((stepId) => !stepIds.has(stepId))
    ) {
      this.fail('Recovered completed-step history is invalid.', execution);
    }

    for (const result of stepResults) {
      if (!stepIds.has(result.stepId)) {
        this.fail('Recovered step result references an invalid step.', execution);
      }

      this.validateDuration(result.durationMs, execution);
    }

    const completedResultIds = stepResults
      .filter((result) => 'status' in result && result.status === 'completed')
      .map((result) => result.stepId);

    if (
      completedResultIds.length !== completedSteps.length ||
      completedResultIds.some((stepId, index) => stepId !== completedSteps[index])
    ) {
      this.fail('Recovered completed steps do not match completed step results.', execution);
    }
  }

  private validateRegionOwnership(
    definition: WorkflowDefinition,
    forkStepId: string,
    joinStepId: string,
    branches: readonly WorkflowBranchExecution[],
    execution: WorkflowExecution
  ): void {
    for (const branch of branches) {
      const owned = this.collectBranchSteps(
        definition,
        branch.startStepId,
        joinStepId,
        new Set<string>()
      );
      const referenced = [
        ...branch.completedSteps,
        ...branch.stepResults.map((result) => result.stepId),
        ...(branch.currentStepId && branch.currentStepId !== joinStepId
          ? [branch.currentStepId]
          : [])
      ];

      if (referenced.some((stepId) => !owned.has(stepId))) {
        this.fail(`Recovered branch ${branch.branchId} contains history owned by another branch.`, execution);
      }

      const edge = definition.edges.find(
        (candidate): candidate is WorkflowParallelEdge =>
          getWorkflowEdgeSource(candidate) === forkStepId &&
          isWorkflowParallelEdge(candidate) &&
          candidate.branchId === branch.branchId
      );

      if (!edge || edge.targetStepId !== branch.startStepId) {
        this.fail('Recovered branch start does not match its parallel edge.', execution);
      }
    }
  }

  private collectBranchSteps(
    definition: WorkflowDefinition,
    stepId: string,
    joinStepId: string,
    visited: Set<string>
  ): Set<string> {
    if (stepId === joinStepId || visited.has(stepId)) {
      return visited;
    }

    visited.add(stepId);

    for (const edge of definition.edges.filter(
      (candidate) => getWorkflowEdgeSource(candidate) === stepId
    )) {
      this.collectBranchSteps(definition, getWorkflowEdgeTarget(edge), joinStepId, visited);
    }

    return visited;
  }

  private validateDuration(durationMs: number | undefined, execution: WorkflowExecution): void {
    if (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs < 0)) {
      this.fail('Recovered execution contains an invalid duration.', execution);
    }
  }

  private compareUtf16(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  private fail(message: string, execution: WorkflowExecution): never {
    throw new WorkflowPersistenceError({
      code: 'recovery_validation_failed',
      message,
      executionId: execution.executionId,
      workflowId: execution.workflowId,
      workflowVersion: execution.workflowVersion
    });
  }
}
