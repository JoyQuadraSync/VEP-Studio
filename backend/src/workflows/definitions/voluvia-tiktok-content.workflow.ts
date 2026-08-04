import { WorkflowDefinition } from '../workflow-definition';
import { VOLUVIA_OPERATION_IDS } from '../examples/voluvia/voluvia-operation-contracts';

export type VoluviaTikTokContentStepId =
  | 'start'
  | 'normalize-product'
  | 'generate-script'
  | 'mock-editorial-review'
  | 'review-decision'
  | 'content-fork'
  | 'generate-cover-metadata'
  | 'generate-hashtags'
  | 'generate-mock-subtitles'
  | 'generate-mock-video'
  | 'content-join'
  | 'build-publishing-package'
  | 'mock-final-approval'
  | 'final-decision'
  | 'finish';

export const voluviaTikTokContentWorkflow: WorkflowDefinition<
  'voluvia.tiktok.content.workflow',
  VoluviaTikTokContentStepId
> = {
  id: 'voluvia.tiktok.content.workflow',
  version: 1,
  name: 'Voluvia TikTok Content Workflow v1',
  startStepId: 'start',
  finishStepId: 'finish',
  steps: [
    { id: 'start', name: 'Start', kind: 'start' },
    {
      id: 'normalize-product',
      name: 'Normalize Product',
      kind: 'action',
      operation: VOLUVIA_OPERATION_IDS.normalizeProduct
    },
    {
      id: 'generate-script',
      name: 'Generate TikTok Script',
      kind: 'action',
      operation: VOLUVIA_OPERATION_IDS.generateScript
    },
    {
      id: 'mock-editorial-review',
      name: 'Mock Editorial Review',
      kind: 'action',
      operation: VOLUVIA_OPERATION_IDS.editorialReview
    },
    { id: 'review-decision', name: 'Editorial Review Decision', kind: 'decision' },
    {
      id: 'content-fork',
      name: 'Generate Content Assets',
      type: 'fork',
      joinStepId: 'content-join'
    },
    {
      id: 'generate-cover-metadata',
      name: 'Generate Cover Metadata',
      kind: 'action',
      operation: VOLUVIA_OPERATION_IDS.generateCoverMetadata
    },
    {
      id: 'generate-hashtags',
      name: 'Generate Hashtags',
      kind: 'action',
      operation: VOLUVIA_OPERATION_IDS.generateHashtags
    },
    {
      id: 'generate-mock-subtitles',
      name: 'Generate Mock Subtitles',
      kind: 'action',
      operation: VOLUVIA_OPERATION_IDS.generateSubtitles
    },
    {
      id: 'generate-mock-video',
      name: 'Generate Mock Video',
      kind: 'action',
      operation: VOLUVIA_OPERATION_IDS.generateVideo
    },
    {
      id: 'content-join',
      name: 'Collect Content Assets',
      type: 'join',
      forkStepId: 'content-fork'
    },
    {
      id: 'build-publishing-package',
      name: 'Build Publishing Package',
      kind: 'action',
      operation: VOLUVIA_OPERATION_IDS.buildPackage
    },
    {
      id: 'mock-final-approval',
      name: 'Mock Final Approval',
      kind: 'action',
      operation: VOLUVIA_OPERATION_IDS.finalReview
    },
    { id: 'final-decision', name: 'Final Approval Decision', kind: 'decision' },
    { id: 'finish', name: 'Finish', kind: 'finish' }
  ],
  edges: [
    { id: 'start-to-normalize', from: 'start', to: 'normalize-product' },
    { id: 'normalize-to-script', from: 'normalize-product', to: 'generate-script' },
    {
      id: 'script-to-editorial-review',
      from: 'generate-script',
      to: 'mock-editorial-review'
    },
    {
      id: 'editorial-review-to-decision',
      from: 'mock-editorial-review',
      to: 'review-decision'
    },
    {
      id: 'review-approved',
      from: 'review-decision',
      to: 'content-fork',
      condition: {
        operator: 'equals',
        left: {
          kind: 'reference',
          reference: {
            source: 'current_step_input',
            path: ['editorialReview', 'approved']
          }
        },
        right: { kind: 'literal', value: true }
      }
    },
    {
      id: 'review-rejected',
      from: 'review-decision',
      to: 'finish',
      default: true
    },
    {
      id: 'fork-to-video',
      type: 'parallel',
      sourceStepId: 'content-fork',
      targetStepId: 'generate-mock-video',
      branchId: 'video'
    },
    {
      id: 'fork-to-cover',
      type: 'parallel',
      sourceStepId: 'content-fork',
      targetStepId: 'generate-cover-metadata',
      branchId: 'cover'
    },
    {
      id: 'fork-to-subtitles',
      type: 'parallel',
      sourceStepId: 'content-fork',
      targetStepId: 'generate-mock-subtitles',
      branchId: 'subtitles'
    },
    {
      id: 'fork-to-hashtags',
      type: 'parallel',
      sourceStepId: 'content-fork',
      targetStepId: 'generate-hashtags',
      branchId: 'hashtags'
    },
    {
      id: 'cover-to-join',
      from: 'generate-cover-metadata',
      to: 'content-join'
    },
    { id: 'hashtags-to-join', from: 'generate-hashtags', to: 'content-join' },
    {
      id: 'subtitles-to-join',
      from: 'generate-mock-subtitles',
      to: 'content-join'
    },
    { id: 'video-to-join', from: 'generate-mock-video', to: 'content-join' },
    {
      id: 'join-to-package',
      from: 'content-join',
      to: 'build-publishing-package'
    },
    {
      id: 'package-to-final-review',
      from: 'build-publishing-package',
      to: 'mock-final-approval'
    },
    {
      id: 'final-review-to-decision',
      from: 'mock-final-approval',
      to: 'final-decision'
    },
    {
      id: 'final-approved',
      from: 'final-decision',
      to: 'finish',
      condition: {
        operator: 'equals',
        left: {
          kind: 'reference',
          reference: {
            source: 'current_step_input',
            path: ['finalReview', 'approved']
          }
        },
        right: { kind: 'literal', value: true }
      }
    },
    { id: 'final-rejected', from: 'final-decision', to: 'finish', default: true }
  ]
};
