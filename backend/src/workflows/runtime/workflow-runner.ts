import { Clock } from '../../runtime/services/clock';
import { WorkflowDefinition } from '../workflow-definition';
import {
  getWorkflowEdgeSource,
  getWorkflowEdgeTarget,
  isWorkflowConditionalEdge,
  isWorkflowDefaultEdge,
  isWorkflowParallelEdge,
  WorkflowEdge,
  WorkflowParallelEdge
} from '../workflow-edge';
import {
  getWorkflowStepKind,
  WorkflowForkStep,
  WorkflowStep
} from '../workflow-step';
import { ConditionEvaluator } from './condition-evaluator';
import { OperationRegistry } from './operation-registry';
import { WorkflowExecution, WorkflowExecutionIdGenerator } from './workflow-execution';
import { WorkflowFailure } from './workflow-failure';
import {
  ParallelBranchResult,
  WorkflowBranchExecution,
  WorkflowFailedParallelRegionResult,
  WorkflowParallelRegionResult
} from './workflow-parallel-execution';
import { WorkflowState, WorkflowStepResultStatus } from './workflow-state';
import { WorkflowStepResult } from './workflow-step-result';

type NextStepResult =
  | { readonly stepId: string; readonly failure?: undefined }
  | { readonly stepId?: undefined; readonly failure: WorkflowFailure };

export interface WorkflowRunner {
  createExecution(definition: WorkflowDefinition, workflowInput: unknown): WorkflowExecution;
  advance(definition: WorkflowDefinition, execution: WorkflowExecution): Promise<WorkflowExecution>;
  run(definition: WorkflowDefinition, execution: WorkflowExecution): Promise<WorkflowExecution>;
}

export class InMemoryWorkflowRunner implements WorkflowRunner {
  constructor(
    private readonly operationRegistry: OperationRegistry,
    private readonly conditionEvaluator: ConditionEvaluator,
    private readonly clock: Clock,
    private readonly executionIdGenerator: WorkflowExecutionIdGenerator
  ) {}

  createExecution(definition: WorkflowDefinition, workflowInput: unknown): WorkflowExecution {
    return {
      executionId: this.executionIdGenerator.next(),
      workflowId: definition.id,
      workflowVersion: definition.version,
      state: WorkflowState.CREATED,
      currentStepId: definition.startStepId,
      workflowInput,
      completedSteps: [],
      stepResults: [],
      parallelRegions: []
    };
  }

  async run(
    definition: WorkflowDefinition,
    execution: WorkflowExecution
  ): Promise<WorkflowExecution> {
    if (definition.id !== execution.workflowId || definition.version !== execution.workflowVersion) {
      throw new Error('Workflow definition does not match the execution identity.');
    }

    if (execution.activeParallel) {
      throw new Error('Workflow execution must not contain active parallel state before running.');
    }

    if (execution.state !== WorkflowState.CREATED) {
      throw new Error('Workflow execution must be in the created state before running.');
    }

    const executionStartedAt = this.clock.now();
    let currentExecution = execution;

    do {
      currentExecution = await this.advance(definition, currentExecution);
    } while (
      currentExecution.state !== WorkflowState.COMPLETED &&
      currentExecution.state !== WorkflowState.FAILED
    );

    return {
      ...currentExecution,
      durationMs: this.durationMs(executionStartedAt, this.clock.now())
    };
  }

  async advance(
    definition: WorkflowDefinition,
    execution: WorkflowExecution
  ): Promise<WorkflowExecution> {
    this.assertAdvanceContract(definition, execution);
    const currentExecution: WorkflowExecution = execution.state === WorkflowState.CREATED
      ? { ...execution, state: WorkflowState.RUNNING }
      : this.cloneExecution(execution);

    if (currentExecution.activeParallel) {
      if (currentExecution.activeParallel.branches.every(
        (branch) => branch.state === 'completed' || branch.state === 'failed'
      )) {
        return this.completeParallelJoin(definition, currentExecution);
      }

      return this.advanceParallelRound(definition, currentExecution);
    }

    const step = this.findStep(definition, currentExecution.currentStepId);

    if (!step || currentExecution.completedSteps.includes(currentExecution.currentStepId)) {
      return this.failExecution(currentExecution, {
        code: 'invalid_step',
        message: 'Workflow references an invalid or already completed step.',
        stepId: currentExecution.currentStepId
      });
    }

    const input = this.currentValue(currentExecution);
    const stepKind = getWorkflowStepKind(step);
    const stepResult = stepKind === 'action'
      ? await this.executeStep(step, input, currentExecution)
      : this.executePassThroughStep(step, input);

    if (stepResult.status === WorkflowStepResultStatus.FAILED) {
      return this.failExecution(
        { ...currentExecution, stepResults: [...currentExecution.stepResults, stepResult] },
        stepResult.failure
      );
    }

    const progressed: WorkflowExecution = {
      ...currentExecution,
      completedSteps: [...currentExecution.completedSteps, step.id],
      stepResults: [...currentExecution.stepResults, stepResult]
    };
    if (stepKind === 'finish') {
      if (definition.edges.some((edge) => getWorkflowEdgeSource(edge) === step.id)) {
        return this.failExecution(progressed, {
          code: 'invalid_finish_step',
          message: 'Finish step must not have outgoing edges.',
          stepId: step.id
        });
      }

      return {
        ...progressed,
        state: WorkflowState.COMPLETED,
        workflowOutput: stepResult.output,
        durationMs: this.aggregateDuration(progressed)
      };
    }

    if (stepKind === 'fork') {
      if (!('joinStepId' in step)) {
        return this.failExecution(progressed, this.parallelJoinMismatch(step.id));
      }

      return this.createParallelExecution(definition, step, stepResult.output, progressed);
    }

    const nextStep = this.resolveNextStep(
      definition,
      step,
      progressed,
      stepResult.input,
      stepResult.output
    );

    return nextStep.failure
      ? this.failExecution(progressed, nextStep.failure)
      : { ...progressed, currentStepId: nextStep.stepId };
  }

  private assertAdvanceContract(
    definition: WorkflowDefinition,
    execution: WorkflowExecution
  ): void {
    if (
      definition.id !== execution.workflowId ||
      definition.version !== execution.workflowVersion
    ) {
      throw new Error('Workflow definition does not match the execution identity.');
    }

    if (
      execution.state !== WorkflowState.CREATED &&
      execution.state !== WorkflowState.RUNNING
    ) {
      throw new Error('Terminal workflow executions cannot be advanced.');
    }

    if (execution.state === WorkflowState.CREATED && execution.activeParallel) {
      throw new Error('Created workflow execution must not contain active parallel state.');
    }
  }

  private createParallelExecution(
    definition: WorkflowDefinition,
    fork: WorkflowForkStep,
    input: unknown,
    execution: WorkflowExecution
  ): WorkflowExecution {
    const join = this.findStep(definition, fork.joinStepId);
    const forkOutgoingEdges = definition.edges.filter(
      (edge) => getWorkflowEdgeSource(edge) === fork.id
    );
    const branchEdges = forkOutgoingEdges
      .filter(
        (edge): edge is WorkflowParallelEdge => isWorkflowParallelEdge(edge)
      )
      .sort((left, right) => this.compareBranchIds(left.branchId, right.branchId));

    if (
      !join ||
      getWorkflowStepKind(join) !== 'join' ||
      !('forkStepId' in join) ||
      join.forkStepId !== fork.id ||
      branchEdges.length !== forkOutgoingEdges.length ||
      branchEdges.length < 2 ||
      !this.hasValidRuntimeBranchIds(branchEdges)
    ) {
      return this.failExecution(execution, this.parallelJoinMismatch(fork.joinStepId));
    }

    const pendingBranches: readonly WorkflowBranchExecution[] = branchEdges.map((edge) => ({
      branchId: edge.branchId,
      startStepId: edge.targetStepId,
      currentStepId: edge.targetStepId,
      state: 'pending',
      input,
      completedSteps: [],
      stepResults: []
    }));
    return {
      ...execution,
      activeParallel: {
      forkStepId: fork.id,
      joinStepId: fork.joinStepId,
      input,
      branches: pendingBranches
      }
    };
  }

  private async advanceParallelRound(
    definition: WorkflowDefinition,
    execution: WorkflowExecution
  ): Promise<WorkflowExecution> {
    const active = execution.activeParallel;

    if (!active) {
      throw new Error('Parallel advancement requires active parallel state.');
    }

    const branches = (await Promise.all(active.branches.map(async (branch) => {
      if (branch.state === 'completed' || branch.state === 'failed') {
        return this.cloneBranch(branch);
      }

      return this.advanceBranch(definition, active.joinStepId, branch, execution);
    }))).sort((left, right) => this.compareBranchIds(left.branchId, right.branchId));

    return { ...execution, activeParallel: { ...active, branches } };
  }

  private async completeParallelJoin(
    definition: WorkflowDefinition,
    execution: WorkflowExecution
  ): Promise<WorkflowExecution> {
    const active = execution.activeParallel;

    if (!active) {
      throw new Error('Parallel join requires active parallel state.');
    }

    const branches = [...active.branches]
      .map((branch) => this.cloneBranch(branch))
      .sort((left, right) => this.compareBranchIds(left.branchId, right.branchId));
    const regionDurationMs = branches.reduce(
      (maximum, branch) => Math.max(maximum, branch.durationMs ?? 0),
      0
    );
    const branchCompletedSteps = branches.flatMap((branch) => branch.completedSteps);
    const branchStepResults = branches.flatMap((branch) => branch.stepResults);
    const failedBranches = branches.filter((branch) => branch.state === 'failed');

    if (failedBranches.length > 0) {
      const failure: WorkflowFailure = {
        code: 'parallel_branch_failed',
        message: 'One or more parallel branches failed.',
        stepId: active.joinStepId
      };
      const region: WorkflowFailedParallelRegionResult = {
        forkStepId: active.forkStepId,
        joinStepId: active.joinStepId,
        state: 'failed',
        branches,
        failure,
        durationMs: regionDurationMs
      };

      return this.failExecution(
        {
          ...this.withoutActiveParallel(execution),
          currentStepId: active.joinStepId,
          completedSteps: [...execution.completedSteps, ...branchCompletedSteps],
          stepResults: [...execution.stepResults, ...branchStepResults],
          parallelRegions: [...execution.parallelRegions, region]
        },
        failure
      );
    }

    const output: readonly ParallelBranchResult[] = branches.map((branch) => ({
      branchId: branch.branchId,
      output: branch.output
    }));
    const region: WorkflowParallelRegionResult = {
      forkStepId: active.forkStepId,
      joinStepId: active.joinStepId,
      state: 'completed',
      branches,
      output,
      durationMs: regionDurationMs
    };

    const withoutActive = {
      ...this.withoutActiveParallel(execution),
      currentStepId: active.joinStepId,
      completedSteps: [...execution.completedSteps, ...branchCompletedSteps],
      stepResults: [...execution.stepResults, ...branchStepResults],
      parallelRegions: [...execution.parallelRegions, region]
    };
    const join = this.findStep(definition, active.joinStepId);

    if (!join || getWorkflowStepKind(join) !== 'join') {
      return this.failExecution(withoutActive, this.parallelJoinMismatch(active.joinStepId));
    }

    const joinResult = this.executePassThroughStep(join, output);
    const joined = {
      ...withoutActive,
      completedSteps: [...withoutActive.completedSteps, join.id],
      stepResults: [...withoutActive.stepResults, joinResult]
    };
    const nextStep = this.resolveNextStep(
      definition,
      join,
      joined,
      joinResult.input,
      joinResult.output
    );

    return nextStep.failure
      ? this.failExecution(joined, nextStep.failure)
      : { ...joined, currentStepId: nextStep.stepId };
  }

  private async advanceBranch(
    definition: WorkflowDefinition,
    joinStepId: string,
    initialBranch: WorkflowBranchExecution,
    parentExecution: WorkflowExecution
  ): Promise<WorkflowBranchExecution> {
    const branchStartedAt = this.clock.now();
    const branch = initialBranch.state === 'pending'
      ? { ...initialBranch, state: 'running' as const }
      : this.cloneBranch(initialBranch);
    const currentValue = branch.stepResults.length === 0
      ? branch.input
      : branch.stepResults[branch.stepResults.length - 1].output;

      if (branch.currentStepId === joinStepId) {
        const { currentStepId: ignoredCurrentStepId, ...branchWithoutCurrentStep } = branch;
        void ignoredCurrentStepId;
        return {
          ...branchWithoutCurrentStep,
          state: 'completed',
          output: currentValue,
          durationMs: (branch.durationMs ?? 0) + this.durationMs(branchStartedAt, this.clock.now())
        };
      }

      const currentStepId = branch.currentStepId;

      if (!currentStepId) {
        return this.failBranch(
          branch,
          this.parallelJoinMismatch(joinStepId),
          branchStartedAt
        );
      }

      const step = this.findStep(definition, currentStepId);

      if (!step) {
        return this.failBranch(
          branch,
          {
            code: 'invalid_step',
            message: 'Workflow references a step that does not exist.',
            stepId: currentStepId
          },
          branchStartedAt
        );
      }

      const stepKind = getWorkflowStepKind(step);

      if (
        stepKind === 'start' ||
        stepKind === 'fork' ||
        stepKind === 'join' ||
        stepKind === 'finish'
      ) {
        return this.failBranch(
          branch,
          this.parallelJoinMismatch(joinStepId),
          branchStartedAt
        );
      }

      if (branch.completedSteps.includes(step.id)) {
        return this.failBranch(
          branch,
          {
            code: 'invalid_step',
            message: 'Workflow attempted to execute a completed step again.',
            stepId: step.id
          },
          branchStartedAt
        );
      }

      const branchExecutionView: WorkflowExecution = {
        ...parentExecution,
        stepResults: [...parentExecution.stepResults, ...branch.stepResults]
      };
      const stepResult = await this.executeStep(step, currentValue, branchExecutionView);

      if (stepResult.status === WorkflowStepResultStatus.FAILED) {
        return this.failBranch(
          { ...branch, stepResults: [...branch.stepResults, stepResult] },
          stepResult.failure ?? this.parallelJoinMismatch(joinStepId),
          branchStartedAt
        );
      }

      const progressed = {
        ...branch,
        completedSteps: [...branch.completedSteps, step.id],
        stepResults: [...branch.stepResults, stepResult]
      };

      const nextStep = this.resolveNextStep(
        definition,
        step,
        {
          ...branchExecutionView,
          stepResults: [...parentExecution.stepResults, ...progressed.stepResults]
        },
        stepResult.input,
        stepResult.output
      );

      if (nextStep.failure) {
        return this.failBranch(progressed, nextStep.failure, branchStartedAt);
      }

      return {
        ...progressed,
        currentStepId: nextStep.stepId,
        durationMs: (branch.durationMs ?? 0) + this.durationMs(branchStartedAt, this.clock.now())
      };
  }

  private failBranch(
    branch: WorkflowBranchExecution,
    failure: WorkflowFailure,
    branchStartedAt: Date
  ): WorkflowBranchExecution {
    const { currentStepId: ignoredCurrentStepId, ...branchWithoutCurrentStep } = branch;
    void ignoredCurrentStepId;

    return {
      ...branchWithoutCurrentStep,
      state: 'failed',
      failure,
      durationMs: (branch.durationMs ?? 0) + this.durationMs(branchStartedAt, this.clock.now())
    };
  }

  private cloneExecution(execution: WorkflowExecution): WorkflowExecution {
    return {
      ...execution,
      completedSteps: [...execution.completedSteps],
      stepResults: [...execution.stepResults],
      parallelRegions: [...execution.parallelRegions],
      ...(execution.activeParallel
        ? {
            activeParallel: {
              ...execution.activeParallel,
              branches: execution.activeParallel.branches.map((branch) => this.cloneBranch(branch))
            }
          }
        : {})
    };
  }

  private cloneBranch(branch: WorkflowBranchExecution): WorkflowBranchExecution {
    return {
      ...branch,
      completedSteps: [...branch.completedSteps],
      stepResults: [...branch.stepResults]
    };
  }

  private currentValue(execution: WorkflowExecution): unknown {
    return execution.stepResults.length === 0
      ? execution.workflowInput
      : execution.stepResults[execution.stepResults.length - 1].output;
  }

  private aggregateDuration(execution: WorkflowExecution): number {
    return execution.stepResults.reduce((total, result) => total + result.durationMs, 0);
  }

  private async executeStep(
    step: WorkflowStep,
    input: unknown,
    execution: WorkflowExecution
  ): Promise<WorkflowStepResult> {
    const startedAt = this.clock.now();

    if (getWorkflowStepKind(step) !== 'action' || !('operation' in step)) {
      return {
        stepId: step.id,
        status: WorkflowStepResultStatus.COMPLETED,
        input,
        output: input,
        durationMs: this.durationMs(startedAt, this.clock.now())
      };
    }

    const handler = this.operationRegistry.resolve(step.operation);

    if (!handler) {
      const failure: WorkflowFailure = {
        code: 'operation_not_registered',
        message: 'Workflow operation is not registered.',
        stepId: step.id,
        operationId: step.operation
      };

      return {
        stepId: step.id,
        status: WorkflowStepResultStatus.FAILED,
        input,
        failure,
        durationMs: this.durationMs(startedAt, this.clock.now())
      };
    }

    try {
      const output = await Promise.resolve(
        handler({
          executionId: execution.executionId,
          workflowId: execution.workflowId,
          workflowVersion: execution.workflowVersion,
          stepId: step.id,
          workflowInput: execution.workflowInput,
          stepInput: input
        })
      );

      return {
        stepId: step.id,
        status: WorkflowStepResultStatus.COMPLETED,
        input,
        output,
        durationMs: this.durationMs(startedAt, this.clock.now())
      };
    } catch {
      const failure: WorkflowFailure = {
        code: 'operation_failed',
        message: 'Workflow operation failed.',
        stepId: step.id,
        operationId: step.operation
      };

      return {
        stepId: step.id,
        status: WorkflowStepResultStatus.FAILED,
        input,
        failure,
        durationMs: this.durationMs(startedAt, this.clock.now())
      };
    }
  }

  private executePassThroughStep(step: WorkflowStep, input: unknown): WorkflowStepResult {
    const startedAt = this.clock.now();
    return {
      stepId: step.id,
      status: WorkflowStepResultStatus.COMPLETED,
      input,
      output: input,
      durationMs: this.durationMs(startedAt, this.clock.now())
    };
  }

  private resolveNextStep(
    definition: WorkflowDefinition,
    step: WorkflowStep,
    execution: WorkflowExecution,
    stepInput: unknown,
    stepOutput: unknown
  ): NextStepResult {
    const outgoingEdges = definition.edges.filter(
      (edge) => getWorkflowEdgeSource(edge) === step.id
    );

    if (getWorkflowStepKind(step) === 'decision') {
      return this.resolveDecisionBranch(
        definition,
        step,
        outgoingEdges,
        execution,
        stepInput,
        stepOutput
      );
    }

    if (outgoingEdges.length === 0) {
      return {
        failure: {
          code: 'no_next_step',
          message: 'Workflow step does not have a next step.',
          stepId: step.id
        }
      };
    }

    if (outgoingEdges.length > 1) {
      return {
        failure: {
          code: 'unsupported_multiple_outgoing_edges',
          message: 'Multiple outgoing edges are not supported by the linear workflow runtime.',
          stepId: step.id
        }
      };
    }

    const edge = outgoingEdges[0];

    if (
      isWorkflowParallelEdge(edge) ||
      isWorkflowConditionalEdge(edge) ||
      isWorkflowDefaultEdge(edge)
    ) {
      return {
        failure: {
          code: 'invalid_step',
          message: 'Non-decision step must use an unconditional edge.',
          stepId: step.id
        }
      };
    }

    return this.resolveEdgeTarget(definition, edge);
  }

  private resolveDecisionBranch(
    definition: WorkflowDefinition,
    step: WorkflowStep,
    outgoingEdges: readonly WorkflowEdge[],
    execution: WorkflowExecution,
    stepInput: unknown,
    stepOutput: unknown
  ): NextStepResult {
    const conditionalEdges = outgoingEdges.filter(isWorkflowConditionalEdge);
    const defaultEdges = outgoingEdges.filter(isWorkflowDefaultEdge);
    const invalidEdges = outgoingEdges.filter(
      (edge) =>
        isWorkflowParallelEdge(edge) ||
        !isWorkflowConditionalEdge(edge) && !isWorkflowDefaultEdge(edge)
    );

    if (defaultEdges.length > 1 || invalidEdges.length > 0) {
      return {
        failure: {
          code: 'invalid_default_branch',
          message: 'Decision step contains an invalid default or unconditional branch.',
          stepId: step.id
        }
      };
    }

    const evaluationInput = {
      workflowInput: execution.workflowInput,
      currentStepInput: stepInput,
      currentStepOutput: stepOutput,
      completedStepResults: execution.stepResults,
      executionMetadata: {
        executionId: execution.executionId,
        workflowId: execution.workflowId,
        workflowVersion: execution.workflowVersion,
        state: execution.state
      }
    };
    const evaluations = conditionalEdges.map((edge) => ({
      edge,
      result: this.conditionEvaluator.evaluate(edge.condition, evaluationInput)
    }));

    if (evaluations.some((evaluation) => !evaluation.result.success)) {
      return {
        failure: {
          code: 'condition_evaluation_failed',
          message: 'Decision branch condition evaluation failed.',
          stepId: step.id
        }
      };
    }

    const matchingEdges = evaluations
      .filter((evaluation) => evaluation.result.success && evaluation.result.value)
      .map((evaluation) => evaluation.edge);

    if (matchingEdges.length > 1) {
      return {
        failure: {
          code: 'multiple_matching_branches',
          message: 'Decision step has multiple matching conditional branches.',
          stepId: step.id
        }
      };
    }

    if (matchingEdges.length === 1) {
      return this.resolveEdgeTarget(definition, matchingEdges[0]);
    }

    if (defaultEdges.length === 1) {
      return this.resolveEdgeTarget(definition, defaultEdges[0]);
    }

    return {
      failure: {
        code: 'no_matching_branch',
        message: 'Decision step has no matching branch and no default branch.',
        stepId: step.id
      }
    };
  }

  private resolveEdgeTarget(
    definition: WorkflowDefinition,
    edge: WorkflowEdge
  ): NextStepResult {
    const targetStepId = getWorkflowEdgeTarget(edge);

    if (!this.findStep(definition, targetStepId)) {
      return {
        failure: {
          code: 'invalid_step',
          message: 'Workflow edge references a step that does not exist.',
          stepId: targetStepId
        }
      };
    }

    return { stepId: targetStepId };
  }

  private findStep(definition: WorkflowDefinition, stepId: string): WorkflowStep | undefined {
    return definition.steps.find((candidate) => candidate.id === stepId);
  }

  private hasValidRuntimeBranchIds(edges: readonly WorkflowParallelEdge[]): boolean {
    const branchIds = new Set<string>();

    for (const edge of edges) {
      if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(edge.branchId)) {
        return false;
      }

      if (branchIds.has(edge.branchId)) {
        return false;
      }

      branchIds.add(edge.branchId);
    }

    return true;
  }

  private compareBranchIds(left: string, right: string): number {
    if (left < right) {
      return -1;
    }

    if (left > right) {
      return 1;
    }

    return 0;
  }

  private withoutActiveParallel(execution: WorkflowExecution): WorkflowExecution {
    const { activeParallel: ignoredActiveParallel, ...executionWithoutActiveParallel } = execution;
    void ignoredActiveParallel;
    return executionWithoutActiveParallel;
  }

  private parallelJoinMismatch(stepId: string): WorkflowFailure {
    return {
      code: 'parallel_join_mismatch',
      message: 'Parallel branch did not reach its paired join.',
      stepId
    };
  }

  private failExecution(
    execution: WorkflowExecution,
    failure: WorkflowFailure | undefined
  ): WorkflowExecution {
    const normalizedFailure: WorkflowFailure = failure ?? {
      code: 'invalid_step',
      message: 'Workflow execution failed without structured failure information.',
      stepId: execution.currentStepId
    };

    return {
      ...execution,
      state: WorkflowState.FAILED,
      failure: normalizedFailure,
      durationMs: this.aggregateDuration(execution)
    };
  }

  private durationMs(startedAt: Date, finishedAt: Date): number {
    const elapsedMs = finishedAt.getTime() - startedAt.getTime();
    return Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : 0;
  }
}
