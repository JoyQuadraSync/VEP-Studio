import { WorkflowDefinition } from '../workflow-definition';
import { VOLUVIA_AI_SCRIPT_OPERATION_ID } from '../examples/voluvia/ai/voluvia-ai-script-contracts';

export type VoluviaTikTokContentAiStepId = 'start' | 'generate-ai-script' | 'finish';

export const voluviaTikTokContentAiWorkflow: WorkflowDefinition<
  'voluvia.tiktok.content.ai.workflow',
  VoluviaTikTokContentAiStepId
> = {
  id: 'voluvia.tiktok.content.ai.workflow',
  version: 1,
  name: 'Voluvia TikTok AI Content Workflow v1',
  startStepId: 'start',
  finishStepId: 'finish',
  steps: [
    { id: 'start', name: 'Start', kind: 'start' },
    {
      id: 'generate-ai-script',
      name: 'Generate AI Script',
      kind: 'action',
      operation: VOLUVIA_AI_SCRIPT_OPERATION_ID
    },
    { id: 'finish', name: 'Finish', kind: 'finish' }
  ],
  edges: [
    { id: 'start-to-generate-ai-script', from: 'start', to: 'generate-ai-script' },
    { id: 'generate-ai-script-to-finish', from: 'generate-ai-script', to: 'finish' }
  ]
};
