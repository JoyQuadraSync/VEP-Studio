import { WorkflowDefinition } from '../workflow-definition';
import { WorkflowRegistry } from '../workflow-registry';

export interface WorkflowDefinitionResolver {
  resolve(workflowId: string, workflowVersion: number): WorkflowDefinition | undefined;
}

export class RegistryWorkflowDefinitionResolver implements WorkflowDefinitionResolver {
  constructor(private readonly registry: WorkflowRegistry) {}

  resolve(workflowId: string, workflowVersion: number): WorkflowDefinition | undefined {
    return this.registry.get(workflowId, workflowVersion);
  }
}
