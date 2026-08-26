import { WorkflowDefinition } from '../workflow-definition';
import { VOLUVIA_VIDEO_PACKAGE_OPERATION_ID, VOLUVIA_VIDEO_PACKAGE_OPERATION_V2_ID,
  VOLUVIA_VIDEO_PACKAGE_WORKFLOW_ID, VOLUVIA_VIDEO_PACKAGE_WORKFLOW_VERSION,
  VOLUVIA_VIDEO_PACKAGE_WORKFLOW_V2_VERSION } from '../examples/voluvia/video-package/voluvia-video-package-contracts';

export type VoluviaVideoPackageStepId = 'start' | 'generate-video-package' | 'finish';
export const voluviaVideoPackageGenerationAiWorkflow: WorkflowDefinition<typeof VOLUVIA_VIDEO_PACKAGE_WORKFLOW_ID, VoluviaVideoPackageStepId> = {
  id: VOLUVIA_VIDEO_PACKAGE_WORKFLOW_ID, version: VOLUVIA_VIDEO_PACKAGE_WORKFLOW_VERSION,
  name: 'Voluvia Video Package Generation AI Workflow v1', startStepId: 'start', finishStepId: 'finish',
  steps: [
    { id: 'start', name: 'Start', kind: 'start' },
    { id: 'generate-video-package', name: 'Generate Video Package', kind: 'action', operation: VOLUVIA_VIDEO_PACKAGE_OPERATION_ID },
    { id: 'finish', name: 'Finish', kind: 'finish' }
  ],
  edges: [
    { id: 'start-to-generate-video-package', from: 'start', to: 'generate-video-package' },
    { id: 'generate-video-package-to-finish', from: 'generate-video-package', to: 'finish' }
  ]
};

export const voluviaVideoPackageGenerationAiWorkflowV2: WorkflowDefinition<typeof VOLUVIA_VIDEO_PACKAGE_WORKFLOW_ID, VoluviaVideoPackageStepId> = {
  id: VOLUVIA_VIDEO_PACKAGE_WORKFLOW_ID, version: VOLUVIA_VIDEO_PACKAGE_WORKFLOW_V2_VERSION,
  name: 'Voluvia Video Package Generation AI Workflow v2', startStepId: 'start', finishStepId: 'finish',
  steps: [
    { id: 'start', name: 'Start', kind: 'start' },
    { id: 'generate-video-package', name: 'Generate Video Package', kind: 'action', operation: VOLUVIA_VIDEO_PACKAGE_OPERATION_V2_ID },
    { id: 'finish', name: 'Finish', kind: 'finish' }
  ],
  edges: [
    { id: 'start-to-generate-video-package', from: 'start', to: 'generate-video-package' },
    { id: 'generate-video-package-to-finish', from: 'generate-video-package', to: 'finish' }
  ]
};
