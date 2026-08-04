import {
  ConditionOperand,
  ConditionReference,
  WorkflowCondition
} from './workflow-condition';
import { WorkflowDefinition } from './workflow-definition';
import {
  getWorkflowEdgeSource,
  getWorkflowEdgeTarget,
  isWorkflowConditionalEdge,
  isWorkflowDefaultEdge,
  isWorkflowParallelEdge,
  WorkflowEdge,
  WorkflowParallelEdge
} from './workflow-edge';
import {
  getWorkflowStepKind,
  WorkflowForkStep,
  WorkflowStep
} from './workflow-step';

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

    if (!startStep || getWorkflowStepKind(startStep) !== 'start') {
      issues.push({
        code: 'INVALID_START_STEP',
        message: 'startStepId must reference a start step.'
      });
    }

    if (!finishStep || getWorkflowStepKind(finishStep) !== 'finish') {
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
      const sourceStepId = getWorkflowEdgeSource(edge);
      const targetStepId = getWorkflowEdgeTarget(edge);

      if (edgeIds.has(edge.id)) {
        issues.push({ code: 'DUPLICATE_EDGE_ID', message: `Duplicate edge id: ${edge.id}` });
      }

      edgeIds.add(edge.id);

      if (!stepIds.has(sourceStepId)) {
        issues.push({
          code: 'UNKNOWN_EDGE_SOURCE',
          message: `Edge ${edge.id} references unknown source step: ${sourceStepId}`
        });
      }

      if (!stepIds.has(targetStepId)) {
        issues.push({
          code: 'UNKNOWN_EDGE_TARGET',
          message: `Edge ${edge.id} references unknown target step: ${targetStepId}`
        });
      }

      if (stepIds.has(sourceStepId) && stepIds.has(targetStepId)) {
        adjacency.get(sourceStepId)?.add(targetStepId);
        reverseAdjacency.get(targetStepId)?.add(sourceStepId);
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
        definition.edges.filter((edge) => getWorkflowEdgeSource(edge) === step.id),
        issues
      );
    }

    this.validateParallelRegions(definition, stepIds, reverseAdjacency, issues);

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
    const stepKind = getWorkflowStepKind(step);

    if (stepKind === 'finish') {
      if (outgoingEdges.length > 0) {
        issues.push({
          code: 'INVALID_FINISH_OUTGOING_EDGES',
          message: `Finish step ${step.id} must not have outgoing edges.`
        });
      }

      return;
    }

    if (stepKind === 'decision') {
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
        const parallelEdge = isWorkflowParallelEdge(edge);

        if (conditional && defaultEdge) {
          issues.push({
            code: 'DEFAULT_EDGE_HAS_CONDITION',
            message: `Default edge ${edgeId} must not contain a condition.`
          });
        } else if (!conditional && !defaultEdge || parallelEdge) {
          issues.push({
            code: 'DECISION_EDGE_REQUIRES_CONDITION_OR_DEFAULT',
            message: `Decision edge ${edge.id} must be conditional or default.`
          });
        }
      }

      return;
    }

    if (stepKind === 'fork') {
      if (outgoingEdges.length < 2) {
        issues.push({
          code: 'FORK_REQUIRES_MULTIPLE_BRANCHES',
          message: `Fork step ${step.id} must have at least two outgoing parallel edges.`
        });
      }

      const branchIds = new Set<string>();

      for (const edge of outgoingEdges) {
        if (!isWorkflowParallelEdge(edge)) {
          issues.push({
            code: 'FORK_REQUIRES_PARALLEL_EDGE',
            message: `Fork step ${step.id} must use parallel edges.`
          });
          continue;
        }

        if (!this.isValidBranchId(edge.branchId)) {
          issues.push({
            code: 'INVALID_PARALLEL_BRANCH_ID',
            message: `Parallel branch id is invalid: ${edge.branchId}`
          });
        }

        if (branchIds.has(edge.branchId)) {
          issues.push({
            code: 'DUPLICATE_PARALLEL_BRANCH_ID',
            message: `Fork step ${step.id} contains duplicate branch id: ${edge.branchId}`
          });
        }

        branchIds.add(edge.branchId);
      }

      return;
    }

    if (stepKind === 'join') {
      if (outgoingEdges.length !== 1) {
        issues.push({
          code: 'JOIN_REQUIRES_ONE_OUTGOING_EDGE',
          message: `Join step ${step.id} must have exactly one outgoing edge.`
        });
      }

      for (const edge of outgoingEdges) {
        if (
          isWorkflowParallelEdge(edge) ||
          isWorkflowConditionalEdge(edge) ||
          isWorkflowDefaultEdge(edge)
        ) {
          issues.push({
            code: 'JOIN_REQUIRES_UNCONDITIONAL_EDGE',
            message: `Join step ${step.id} must use an unconditional edge.`
          });
        }
      }

      return;
    }

    if (outgoingEdges.length !== 1) {
      issues.push({
        code: 'LINEAR_STEP_REQUIRES_ONE_OUTGOING_EDGE',
        message: `${stepKind} step ${step.id} must have exactly one outgoing edge.`
      });
    }

    for (const edge of outgoingEdges) {
      if (
        isWorkflowParallelEdge(edge) ||
        isWorkflowConditionalEdge(edge) ||
        isWorkflowDefaultEdge(edge)
      ) {
        issues.push({
          code: 'LINEAR_STEP_REQUIRES_UNCONDITIONAL_EDGE',
          message: `${stepKind} step ${step.id} must use an unconditional edge.`
        });
      }
    }
  }

  private validateParallelRegions(
    definition: WorkflowDefinition,
    stepIds: ReadonlySet<string>,
    reverseAdjacency: ReadonlyMap<string, ReadonlySet<string>>,
    issues: WorkflowValidationIssue[]
  ): void {
    const stepById = new Map(definition.steps.map((step) => [step.id, step]));
    const forks = definition.steps.filter(
      (step): step is WorkflowForkStep => getWorkflowStepKind(step) === 'fork'
    );
    const joins = definition.steps.filter((step) => getWorkflowStepKind(step) === 'join');
    const joinOwners = new Map<string, string>();
    const globallyOwnedSteps = new Map<string, string>();

    for (const join of joins) {
      if (!('forkStepId' in join)) {
        continue;
      }

      const fork = stepById.get(join.forkStepId);

      if (!fork || getWorkflowStepKind(fork) !== 'fork') {
        issues.push({
          code: 'INVALID_JOIN_FORK_REFERENCE',
          message: `Join step ${join.id} must reference an existing fork step.`
        });
      } else if (!('joinStepId' in fork) || fork.joinStepId !== join.id) {
        issues.push({
          code: 'PARALLEL_PAIR_MISMATCH',
          message: `Join step ${join.id} and fork step ${join.forkStepId} must reference each other.`
        });
      }
    }

    for (const fork of forks) {
      const join = stepById.get(fork.joinStepId);

      if (!join || getWorkflowStepKind(join) !== 'join') {
        issues.push({
          code: 'INVALID_FORK_JOIN_REFERENCE',
          message: `Fork step ${fork.id} must reference an existing join step.`
        });
        continue;
      }

      if (!('forkStepId' in join) || join.forkStepId !== fork.id) {
        issues.push({
          code: 'PARALLEL_PAIR_MISMATCH',
          message: `Fork step ${fork.id} and join step ${join.id} must reference each other.`
        });
        continue;
      }

      const existingOwner = joinOwners.get(join.id);

      if (existingOwner && existingOwner !== fork.id) {
        issues.push({
          code: 'JOIN_HAS_MULTIPLE_FORKS',
          message: `Join step ${join.id} must belong to exactly one fork.`
        });
        continue;
      }

      joinOwners.set(join.id, fork.id);

      const branchEdges = definition.edges.filter(
        (edge): edge is WorkflowParallelEdge =>
          getWorkflowEdgeSource(edge) === fork.id && isWorkflowParallelEdge(edge)
      );

      if (branchEdges.length < 2) {
        continue;
      }

      const regionOwner = `${fork.id}:${join.id}`;
      const branchOwnership = new Map<string, string>();
      const reachesFork = this.collectReachable(fork.id, reverseAdjacency);

      for (const branchEdge of branchEdges) {
        this.validateParallelBranch(
          definition,
          stepById,
          fork,
          join.id,
          branchEdge,
          branchOwnership,
          issues
        );
      }

      for (const [stepId, branchId] of branchOwnership) {
        const globalOwner = globallyOwnedSteps.get(stepId);

        if (globalOwner && globalOwner !== regionOwner) {
          issues.push({
            code: 'OVERLAPPING_PARALLEL_REGIONS',
            message: `Step ${stepId} belongs to overlapping parallel regions.`
          });
        }

        globallyOwnedSteps.set(stepId, regionOwner);
        this.validateParallelBranchIncomingEdges(
          definition,
          fork.id,
          stepId,
          branchId,
          branchOwnership,
          issues
        );

        const step = stepById.get(stepId);

        if (step && getWorkflowStepKind(step) === 'decision') {
          this.validateParallelConditionVisibility(
            definition,
            step.id,
            fork.id,
            branchId,
            branchOwnership,
            reachesFork,
            stepIds,
            issues
          );
        }
      }

      this.validateParallelJoinIncomingEdges(
        definition,
        fork.id,
        join.id,
        branchOwnership,
        issues
      );
    }
  }

  private validateParallelBranch(
    definition: WorkflowDefinition,
    stepById: ReadonlyMap<string, WorkflowStep>,
    fork: WorkflowForkStep,
    joinStepId: string,
    branchEdge: WorkflowParallelEdge,
    branchOwnership: Map<string, string>,
    issues: WorkflowValidationIssue[]
  ): void {
    const evaluated = new Map<string, boolean>();
    const active = new Set<string>();

    const reachesJoin = (stepId: string): boolean => {
      if (stepId === joinStepId) {
        return true;
      }

      const memoized = evaluated.get(stepId);

      if (memoized !== undefined) {
        return memoized;
      }

      if (active.has(stepId)) {
        issues.push({
          code: 'PARALLEL_BRANCH_LOOP',
          message: `Parallel branch ${branchEdge.branchId} must not contain a loop.`
        });
        evaluated.set(stepId, false);
        return false;
      }

      const step = stepById.get(stepId);

      if (!step) {
        evaluated.set(stepId, false);
        return false;
      }

      const kind = getWorkflowStepKind(step);

      if (kind === 'start') {
        issues.push({
          code: 'PARALLEL_BRANCH_INVALID_STEP_KIND',
          message: `Parallel branch ${branchEdge.branchId} must not contain a start step.`
        });
        evaluated.set(stepId, false);
        return false;
      }

      if (kind === 'fork') {
        issues.push({
          code: 'NESTED_PARALLEL_REGION',
          message: `Parallel branch ${branchEdge.branchId} must not contain a nested fork.`
        });
        evaluated.set(stepId, false);
        return false;
      }

      if (kind === 'join') {
        issues.push({
          code: 'PARALLEL_BRANCH_REACHES_WRONG_JOIN',
          message: `Parallel branch ${branchEdge.branchId} reaches an unpaired join.`
        });
        evaluated.set(stepId, false);
        return false;
      }

      if (kind === 'finish') {
        issues.push({
          code: 'PARALLEL_BRANCH_BYPASSES_JOIN',
          message: `Parallel branch ${branchEdge.branchId} reaches finish before its join.`
        });
        evaluated.set(stepId, false);
        return false;
      }

      const existingOwner = branchOwnership.get(stepId);

      if (existingOwner && existingOwner !== branchEdge.branchId) {
        issues.push({
          code: 'PARALLEL_BRANCH_OWNERSHIP_CONFLICT',
          message: `Step ${stepId} is shared by parallel branches ${existingOwner} and ${branchEdge.branchId}.`
        });
        evaluated.set(stepId, false);
        return false;
      }

      branchOwnership.set(stepId, branchEdge.branchId);
      active.add(stepId);

      const outgoingEdges = definition.edges.filter(
        (edge) => getWorkflowEdgeSource(edge) === stepId
      );

      if (outgoingEdges.length === 0) {
        issues.push({
          code: 'PARALLEL_BRANCH_DEAD_END',
          message: `Parallel branch ${branchEdge.branchId} must reach join ${joinStepId}.`
        });
        active.delete(stepId);
        evaluated.set(stepId, false);
        return false;
      }

      const everyPathReachesJoin = outgoingEdges.every((edge) =>
        reachesJoin(getWorkflowEdgeTarget(edge))
      );
      active.delete(stepId);
      evaluated.set(stepId, everyPathReachesJoin);
      return everyPathReachesJoin;
    };

    if (!reachesJoin(branchEdge.targetStepId)) {
      issues.push({
        code: 'PARALLEL_BRANCH_MUST_REACH_JOIN',
        message: `Parallel branch ${branchEdge.branchId} must reach join ${joinStepId} on every path.`
      });
    }
  }

  private validateParallelBranchIncomingEdges(
    definition: WorkflowDefinition,
    forkStepId: string,
    stepId: string,
    branchId: string,
    branchOwnership: ReadonlyMap<string, string>,
    issues: WorkflowValidationIssue[]
  ): void {
    const incomingEdges = definition.edges.filter(
      (edge) => getWorkflowEdgeTarget(edge) === stepId
    );

    for (const edge of incomingEdges) {
      const sourceStepId = getWorkflowEdgeSource(edge);
      const fromFork =
        sourceStepId === forkStepId &&
        isWorkflowParallelEdge(edge) &&
        edge.branchId === branchId;
      const fromSameBranch = branchOwnership.get(sourceStepId) === branchId;

      if (!fromFork && !fromSameBranch) {
        issues.push({
          code: 'PARALLEL_BRANCH_OUTSIDE_ENTRY',
          message: `Step ${stepId} has an incoming edge from outside branch ${branchId}.`
        });
      }
    }
  }

  private validateParallelJoinIncomingEdges(
    definition: WorkflowDefinition,
    forkStepId: string,
    joinStepId: string,
    branchOwnership: ReadonlyMap<string, string>,
    issues: WorkflowValidationIssue[]
  ): void {
    const incomingEdges = definition.edges.filter(
      (edge) => getWorkflowEdgeTarget(edge) === joinStepId
    );

    for (const edge of incomingEdges) {
      const sourceStepId = getWorkflowEdgeSource(edge);
      const directBranch = sourceStepId === forkStepId && isWorkflowParallelEdge(edge);
      const ownedBranchStep = branchOwnership.has(sourceStepId);

      if (!directBranch && !ownedBranchStep) {
        issues.push({
          code: 'PARALLEL_JOIN_OUTSIDE_ENTRY',
          message: `Join step ${joinStepId} has an incoming edge from outside its fork region.`
        });
      }
    }
  }

  private validateParallelConditionVisibility(
    definition: WorkflowDefinition,
    decisionStepId: string,
    forkStepId: string,
    branchId: string,
    branchOwnership: ReadonlyMap<string, string>,
    reachesFork: ReadonlySet<string>,
    stepIds: ReadonlySet<string>,
    issues: WorkflowValidationIssue[]
  ): void {
    const outgoingEdges = definition.edges.filter(
      (edge) => getWorkflowEdgeSource(edge) === decisionStepId && isWorkflowConditionalEdge(edge)
    );

    for (const edge of outgoingEdges) {
      if (!isWorkflowConditionalEdge(edge)) {
        continue;
      }

      const references = this.collectCompletedStepReferences(edge.condition);

      for (const referencedStepId of references) {
        if (!stepIds.has(referencedStepId)) {
          continue;
        }

        const sameBranch = branchOwnership.get(referencedStepId) === branchId;
        const preFork = reachesFork.has(referencedStepId);

        if (!sameBranch && !preFork && referencedStepId !== forkStepId) {
          issues.push({
            code: 'PARALLEL_CONDITION_REFERENCE_OUTSIDE_BRANCH',
            message: `Decision step ${decisionStepId} references a step outside its visible branch history: ${referencedStepId}`
          });
        }
      }
    }
  }

  private collectCompletedStepReferences(condition: WorkflowCondition): readonly string[] {
    const references: string[] = [];

    const collectOperand = (operand: ConditionOperand): void => {
      if (operand.kind === 'reference' && operand.reference.source === 'completed_step_result') {
        references.push(operand.reference.stepId);
      }
    };

    switch (condition.operator) {
      case 'equals':
      case 'not_equals':
      case 'greater_than':
      case 'greater_than_or_equal':
      case 'less_than':
      case 'less_than_or_equal':
        collectOperand(condition.left);
        collectOperand(condition.right);
        break;
      case 'exists':
      case 'not_exists':
        if (condition.operand.reference.source === 'completed_step_result') {
          references.push(condition.operand.reference.stepId);
        }
        break;
      case 'and':
      case 'or':
        for (const child of condition.conditions) {
          references.push(...this.collectCompletedStepReferences(child));
        }
        break;
      case 'not':
        references.push(...this.collectCompletedStepReferences(condition.condition));
        break;
    }

    return references;
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

  private isValidBranchId(branchId: string): boolean {
    return /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(branchId);
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
