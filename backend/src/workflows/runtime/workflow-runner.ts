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
  WorkflowParallelExecution,
  WorkflowParallelRegionResult
} from './workflow-parallel-execution';
import { WorkflowState, WorkflowStepResultStatus } from './workflow-state';
import { WorkflowStepResult } from './workflow-step-result';

type NextStepResult =
  | { readonly stepId: string; readonly failure?: undefined }
  | { readonly stepId?: undefined; readonly failure: WorkflowFailure };

type ParallelRegionExecutionResult =
  | {
      readonly execution: WorkflowExecution;
      readonly output: readonly ParallelBranchResult[];
      readonly failure?: undefined;
    }
  | {
      readonly execution: WorkflowExecution;
      readonly output?: undefined;
      readonly failure: WorkflowFailure;
    };

export interface WorkflowRunner {
  createExecution(definition: WorkflowDefinition, workflowInput: unknown): WorkflowExecution;
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
    this.assertExecutionContract(definition, execution);

    const executionStartedAt = this.clock.now();
    let currentValue = execution.workflowInput;
    let currentExecution: WorkflowExecution = {
      ...execution,
      state: WorkflowState.RUNNING,
      completedSteps: [...execution.completedSteps],
      stepResults: [...execution.stepResults],
      parallelRegions: [...execution.parallelRegions]
    };

    while (currentExecution.state === WorkflowState.RUNNING) {
      const step = this.findStep(definition, currentExecution.currentStepId);

      if (!step) {
        return this.failExecution(
          currentExecution,
          {
            code: 'invalid_step',
            message: 'Workflow references a step that does not exist.',
            stepId: currentExecution.currentStepId
          },
          executionStartedAt
        );
      }

      if (currentExecution.completedSteps.includes(step.id)) {
        return this.failExecution(
          currentExecution,
          {
            code: 'invalid_step',
            message: 'Workflow attempted to execute a completed step again.',
            stepId: step.id
          },
          executionStartedAt
        );
      }

      const stepResult = await this.executeStep(step, currentValue, currentExecution);

      if (stepResult.status === WorkflowStepResultStatus.FAILED) {
        return this.failExecution(
          {
            ...currentExecution,
            stepResults: [...currentExecution.stepResults, stepResult]
          },
          stepResult.failure,
          executionStartedAt
        );
      }

      currentValue = stepResult.output;
      currentExecution = {
        ...currentExecution,
        completedSteps: [...currentExecution.completedSteps, step.id],
        stepResults: [...currentExecution.stepResults, stepResult]
      };

      const stepKind = getWorkflowStepKind(step);

      if (stepKind === 'finish') {
        if (definition.edges.some((edge) => getWorkflowEdgeSource(edge) === step.id)) {
          return this.failExecution(
            currentExecution,
            {
              code: 'invalid_finish_step',
              message: 'Finish step must not have outgoing edges.',
              stepId: step.id
            },
            executionStartedAt
          );
        }

        return {
          ...currentExecution,
          state: WorkflowState.COMPLETED,
          workflowOutput: currentValue,
          durationMs: this.durationMs(executionStartedAt, this.clock.now())
        };
      }

      if (stepKind === 'fork') {
        if (!('joinStepId' in step)) {
          return this.failExecution(
            currentExecution,
            this.parallelJoinMismatch(step.id),
            executionStartedAt
          );
        }

        const parallelResult = await this.executeParallelRegion(
          definition,
          step,
          currentValue,
          currentExecution
        );
        currentExecution = parallelResult.execution;

        if (parallelResult.failure) {
          return this.failExecution(
            currentExecution,
            parallelResult.failure,
            executionStartedAt
          );
        }

        currentValue = parallelResult.output;
        currentExecution = {
          ...currentExecution,
          currentStepId: step.joinStepId
        };
        continue;
      }

      const nextStep = this.resolveNextStep(
        definition,
        step,
        currentExecution,
        stepResult.input,
        stepResult.output
      );

      if (nextStep.failure) {
        return this.failExecution(currentExecution, nextStep.failure, executionStartedAt);
      }

      currentExecution = { ...currentExecution, currentStepId: nextStep.stepId };
    }

    return currentExecution;
  }

  private assertExecutionContract(
    definition: WorkflowDefinition,
    execution: WorkflowExecution
  ): void {
    if (
      definition.id !== execution.workflowId ||
      definition.version !== execution.workflowVersion
    ) {
      throw new Error('Workflow definition does not match the execution identity.');
    }

    if (execution.state !== WorkflowState.CREATED) {
      throw new Error('Workflow execution must be in the created state before running.');
    }

    if (execution.activeParallel) {
      throw new Error('Workflow execution must not contain active parallel state before running.');
    }
  }

  private async executeParallelRegion(
    definition: WorkflowDefinition,
    fork: WorkflowForkStep,
    input: unknown,
    execution: WorkflowExecution
  ): Promise<ParallelRegionExecutionResult> {
    const regionStartedAt = this.clock.now();
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
      return {
        execution,
        failure: this.parallelJoinMismatch(fork.joinStepId)
      };
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
    const activeParallel: WorkflowParallelExecution = {
      forkStepId: fork.id,
      joinStepId: fork.joinStepId,
      input,
      branches: pendingBranches
    };
    let activeExecution: WorkflowExecution = { ...execution, activeParallel };
    const runningBranches = pendingBranches.map((branch) => ({
      ...branch,
      state: 'running' as const,
      completedSteps: [...branch.completedSteps],
      stepResults: [...branch.stepResults]
    }));

    activeExecution = {
      ...activeExecution,
      activeParallel: { ...activeParallel, branches: runningBranches }
    };

    const settlements = await Promise.allSettled(
      runningBranches.map((branch) =>
        this.executeBranch(definition, fork.joinStepId, branch, activeExecution)
      )
    );
    const branches = settlements
      .map((settlement, index): WorkflowBranchExecution => {
        if (settlement.status === 'fulfilled') {
          return settlement.value;
        }

        const branch = runningBranches[index];
        const { currentStepId: ignoredCurrentStepId, ...branchWithoutCurrentStep } = branch;
        void ignoredCurrentStepId;
        return {
          ...branchWithoutCurrentStep,
          state: 'failed',
          failure: this.parallelJoinMismatch(fork.joinStepId),
          durationMs: 0
        };
      })
      .sort((left, right) => this.compareBranchIds(left.branchId, right.branchId));
    const regionDurationMs = this.durationMs(regionStartedAt, this.clock.now());
    const branchCompletedSteps = branches.flatMap((branch) => branch.completedSteps);
    const branchStepResults = branches.flatMap((branch) => branch.stepResults);
    const failedBranches = branches.filter((branch) => branch.state === 'failed');

    if (failedBranches.length > 0) {
      const failure: WorkflowFailure = {
        code: 'parallel_branch_failed',
        message: 'One or more parallel branches failed.',
        stepId: fork.joinStepId
      };
      const region: WorkflowFailedParallelRegionResult = {
        forkStepId: fork.id,
        joinStepId: fork.joinStepId,
        state: 'failed',
        branches,
        failure,
        durationMs: regionDurationMs
      };

      return {
        execution: {
          ...this.withoutActiveParallel(activeExecution),
          currentStepId: fork.joinStepId,
          completedSteps: [...activeExecution.completedSteps, ...branchCompletedSteps],
          stepResults: [...activeExecution.stepResults, ...branchStepResults],
          parallelRegions: [...activeExecution.parallelRegions, region]
        },
        failure
      };
    }

    const output: readonly ParallelBranchResult[] = branches.map((branch) => ({
      branchId: branch.branchId,
      output: branch.output
    }));
    const region: WorkflowParallelRegionResult = {
      forkStepId: fork.id,
      joinStepId: fork.joinStepId,
      state: 'completed',
      branches,
      output,
      durationMs: regionDurationMs
    };

    return {
      execution: {
        ...this.withoutActiveParallel(activeExecution),
        currentStepId: fork.joinStepId,
        completedSteps: [...activeExecution.completedSteps, ...branchCompletedSteps],
        stepResults: [...activeExecution.stepResults, ...branchStepResults],
        parallelRegions: [...activeExecution.parallelRegions, region]
      },
      output
    };
  }

  private async executeBranch(
    definition: WorkflowDefinition,
    joinStepId: string,
    initialBranch: WorkflowBranchExecution,
    parentExecution: WorkflowExecution
  ): Promise<WorkflowBranchExecution> {
    const branchStartedAt = this.clock.now();
    let branch = initialBranch;
    let currentValue = initialBranch.input;

    while (branch.state === 'running') {
      if (branch.currentStepId === joinStepId) {
        const { currentStepId: ignoredCurrentStepId, ...branchWithoutCurrentStep } = branch;
        void ignoredCurrentStepId;
        return {
          ...branchWithoutCurrentStep,
          state: 'completed',
          output: currentValue,
          durationMs: this.durationMs(branchStartedAt, this.clock.now())
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

      currentValue = stepResult.output;
      branch = {
        ...branch,
        completedSteps: [...branch.completedSteps, step.id],
        stepResults: [...branch.stepResults, stepResult]
      };

      const nextStep = this.resolveNextStep(
        definition,
        step,
        {
          ...branchExecutionView,
          stepResults: [...parentExecution.stepResults, ...branch.stepResults]
        },
        stepResult.input,
        stepResult.output
      );

      if (nextStep.failure) {
        return this.failBranch(branch, nextStep.failure, branchStartedAt);
      }

      branch = { ...branch, currentStepId: nextStep.stepId };
    }

    return branch;
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
      durationMs: this.durationMs(branchStartedAt, this.clock.now())
    };
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
    failure: WorkflowFailure | undefined,
    executionStartedAt: Date
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
      durationMs: this.durationMs(executionStartedAt, this.clock.now())
    };
  }

  private durationMs(startedAt: Date, finishedAt: Date): number {
    const elapsedMs = finishedAt.getTime() - startedAt.getTime();
    return Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : 0;
  }
}
