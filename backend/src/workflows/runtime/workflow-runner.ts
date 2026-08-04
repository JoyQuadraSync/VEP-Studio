import { Clock } from '../../runtime/services/clock';
import { WorkflowDefinition } from '../workflow-definition';
import {
  isWorkflowConditionalEdge,
  isWorkflowDefaultEdge,
  WorkflowEdge
} from '../workflow-edge';
import { WorkflowStep } from '../workflow-step';
import { ConditionEvaluator } from './condition-evaluator';
import { OperationRegistry } from './operation-registry';
import { WorkflowExecution, WorkflowExecutionIdGenerator } from './workflow-execution';
import { WorkflowFailure } from './workflow-failure';
import { WorkflowState, WorkflowStepResultStatus } from './workflow-state';
import { WorkflowStepResult } from './workflow-step-result';

export interface WorkflowRunner {
  createExecution(definition: WorkflowDefinition, workflowInput: unknown): WorkflowExecution;
  run(
    definition: WorkflowDefinition,
    execution: WorkflowExecution
  ): Promise<WorkflowExecution>;
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
      stepResults: []
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
      stepResults: [...execution.stepResults]
    };

    while (currentExecution.state === WorkflowState.RUNNING) {
      const step = definition.steps.find(
        (candidate) => candidate.id === currentExecution.currentStepId
      );

      if (!step) {
        const failure: WorkflowFailure = {
          code: 'invalid_step',
          message: 'Workflow references a step that does not exist.',
          stepId: currentExecution.currentStepId
        };

        return this.failExecution(currentExecution, failure, executionStartedAt);
      }

      if (currentExecution.completedSteps.includes(step.id)) {
        const failure: WorkflowFailure = {
          code: 'invalid_step',
          message: 'Workflow attempted to execute a completed step again.',
          stepId: step.id
        };

        return this.failExecution(currentExecution, failure, executionStartedAt);
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

      if (step.kind === 'finish') {
        if (definition.edges.some((edge) => edge.from === step.id)) {
          const failure: WorkflowFailure = {
            code: 'invalid_finish_step',
            message: 'Finish step must not have outgoing edges.',
            stepId: step.id
          };

          return this.failExecution(currentExecution, failure, executionStartedAt);
        }

        const executionFinishedAt = this.clock.now();

        return {
          ...currentExecution,
          state: WorkflowState.COMPLETED,
          workflowOutput: currentValue,
          durationMs: this.durationMs(executionStartedAt, executionFinishedAt)
        };
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

      currentExecution = {
        ...currentExecution,
        currentStepId: nextStep.stepId
      };
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
  }

  private async executeStep(
    step: WorkflowStep,
    input: unknown,
    execution: WorkflowExecution
  ): Promise<WorkflowStepResult> {
    const startedAt = this.clock.now();

    if (step.kind !== 'action') {
      const finishedAt = this.clock.now();

      return {
        stepId: step.id,
        status: WorkflowStepResultStatus.COMPLETED,
        input,
        output: input,
        durationMs: this.durationMs(startedAt, finishedAt)
      };
    }

    const handler = this.operationRegistry.resolve(step.operation);

    if (!handler) {
      const finishedAt = this.clock.now();
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
        durationMs: this.durationMs(startedAt, finishedAt)
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
      const finishedAt = this.clock.now();

      return {
        stepId: step.id,
        status: WorkflowStepResultStatus.COMPLETED,
        input,
        output,
        durationMs: this.durationMs(startedAt, finishedAt)
      };
    } catch {
      const finishedAt = this.clock.now();
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
        durationMs: this.durationMs(startedAt, finishedAt)
      };
    }
  }

  private resolveNextStep(
    definition: WorkflowDefinition,
    step: WorkflowStep,
    execution: WorkflowExecution,
    stepInput: unknown,
    stepOutput: unknown
  ): { readonly stepId: string; readonly failure?: undefined } | {
    readonly stepId?: undefined;
    readonly failure: WorkflowFailure;
  } {
    const outgoingEdges = definition.edges.filter((edge) => edge.from === step.id);

    if (step.kind === 'decision') {
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

    if (isWorkflowConditionalEdge(edge) || isWorkflowDefaultEdge(edge)) {
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
  ): { readonly stepId: string; readonly failure?: undefined } | {
    readonly stepId?: undefined;
    readonly failure: WorkflowFailure;
  } {
    const conditionalEdges = outgoingEdges.filter(isWorkflowConditionalEdge);
    const defaultEdges = outgoingEdges.filter(isWorkflowDefaultEdge);
    const invalidEdges = outgoingEdges.filter(
      (edge) => !isWorkflowConditionalEdge(edge) && !isWorkflowDefaultEdge(edge)
    );
    const overlappingEdges = outgoingEdges.filter(
      (edge) => isWorkflowConditionalEdge(edge) && isWorkflowDefaultEdge(edge)
    );

    if (defaultEdges.length > 1 || invalidEdges.length > 0 || overlappingEdges.length > 0) {
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
  ): { readonly stepId: string; readonly failure?: undefined } | {
    readonly stepId?: undefined;
    readonly failure: WorkflowFailure;
  } {

    if (!definition.steps.some((candidate) => candidate.id === edge.to)) {
      return {
        failure: {
          code: 'invalid_step',
          message: 'Workflow edge references a step that does not exist.',
          stepId: edge.to
        }
      };
    }

    return { stepId: edge.to };
  }

  private failExecution(
    execution: WorkflowExecution,
    failure: WorkflowFailure | undefined,
    executionStartedAt: Date
  ): WorkflowExecution {
    const executionFinishedAt = this.clock.now();
    const normalizedFailure: WorkflowFailure = failure ?? {
      code: 'invalid_step',
      message: 'Workflow execution failed without structured failure information.',
      stepId: execution.currentStepId
    };

    return {
      ...execution,
      state: WorkflowState.FAILED,
      failure: normalizedFailure,
      durationMs: this.durationMs(executionStartedAt, executionFinishedAt)
    };
  }

  private durationMs(startedAt: Date, finishedAt: Date): number {
    return finishedAt.getTime() - startedAt.getTime();
  }
}
