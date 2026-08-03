import { Clock } from '../../runtime/services/clock';
import { WorkflowDefinition } from '../workflow-definition';
import { WorkflowStep } from '../workflow-step';
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

      const nextStep = this.resolveNextStep(definition, step);

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
    step: WorkflowStep
  ): { readonly stepId: string; readonly failure?: undefined } | {
    readonly stepId?: undefined;
    readonly failure: WorkflowFailure;
  } {
    const outgoingEdges = definition.edges.filter((edge) => edge.from === step.id);

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
