import { ContentPlanningClient } from '../../../../integrations/ai/content-planning-client';
import { OperationRegistry } from '../../../runtime/operation-registry';
import { VOLUVIA_CONTENT_PLAN_OPERATION_ID } from './voluvia-content-planner-contracts';
import { createVoluviaContentPlanOperation } from './voluvia-content-plan.operation';

export function registerVoluviaContentPlannerOperation(
  registry: OperationRegistry,
  client: ContentPlanningClient
): void {
  registry.register(
    VOLUVIA_CONTENT_PLAN_OPERATION_ID,
    createVoluviaContentPlanOperation(client)
  );
}
