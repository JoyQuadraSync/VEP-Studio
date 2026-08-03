import { WorkflowDefinition } from '../workflow-definition';

export type CustomerCommentStepId =
  | 'start'
  | 'process-comment'
  | 'audit-comment'
  | 'finish';

export const customerCommentWorkflow: WorkflowDefinition<
  'customer.comment.workflow',
  CustomerCommentStepId
> = {
  id: 'customer.comment.workflow',
  version: 1,
  name: 'Customer Comment Workflow',
  startStepId: 'start',
  finishStepId: 'finish',
  steps: [
    { id: 'start', name: 'Start', kind: 'start' },
    {
      id: 'process-comment',
      name: 'Process customer comment',
      kind: 'action',
      operation: 'comment.process'
    },
    {
      id: 'audit-comment',
      name: 'Audit customer comment',
      kind: 'action',
      operation: 'comment.audit'
    },
    { id: 'finish', name: 'Finish', kind: 'finish' }
  ],
  edges: [
    { id: 'start-to-process', from: 'start', to: 'process-comment' },
    { id: 'process-to-audit', from: 'process-comment', to: 'audit-comment' },
    { id: 'audit-to-finish', from: 'audit-comment', to: 'finish' }
  ]
};
