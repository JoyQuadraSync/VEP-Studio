import { WorkflowDefinition } from '../workflow-definition';
import {
  VOLUVIA_CONTENT_PLAN_OPERATION_ID,
  VOLUVIA_CONTENT_PLANNER_WORKFLOW_ID,
  VOLUVIA_CONTENT_PLANNER_WORKFLOW_VERSION
} from '../examples/voluvia/planner/voluvia-content-planner-contracts';

export type VoluviaTikTokContentPlanningAiStepId =
  | 'start'
  | 'generate-content-plan'
  | 'finish';

export const voluviaTikTokContentPlanningAiWorkflow: WorkflowDefinition<
  typeof VOLUVIA_CONTENT_PLANNER_WORKFLOW_ID,
  VoluviaTikTokContentPlanningAiStepId
> = {
  id: VOLUVIA_CONTENT_PLANNER_WORKFLOW_ID,
  version: VOLUVIA_CONTENT_PLANNER_WORKFLOW_VERSION,
  name: 'Voluvia TikTok AI Content Planning Workflow v1',
  startStepId: 'start',
  finishStepId: 'finish',
  steps: [
    { id: 'start', name: 'Start', kind: 'start' },
    {
      id: 'generate-content-plan',
      name: 'Generate Content Plan',
      kind: 'action',
      operation: VOLUVIA_CONTENT_PLAN_OPERATION_ID
    },
    { id: 'finish', name: 'Finish', kind: 'finish' }
  ],
  edges: [
    { id: 'start-to-generate-content-plan', from: 'start', to: 'generate-content-plan' },
    { id: 'generate-content-plan-to-finish', from: 'generate-content-plan', to: 'finish' }
  ]
};
