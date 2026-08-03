import { WorkflowDefinition } from './workflow-definition';

export interface WorkflowRegistry {
  register(definition: WorkflowDefinition): void;
  get(workflowId: string, version: number): WorkflowDefinition | undefined;
  getLatest(workflowId: string): WorkflowDefinition | undefined;
  list(): readonly WorkflowDefinition[];
}

export class InMemoryWorkflowRegistry implements WorkflowRegistry {
  private readonly definitions = new Map<string, Map<number, WorkflowDefinition>>();

  register(definition: WorkflowDefinition): void {
    const versions = this.definitions.get(definition.id) ?? new Map<number, WorkflowDefinition>();

    if (versions.has(definition.version)) {
      throw new Error(
        `Workflow ${definition.id} version ${definition.version} is already registered.`
      );
    }

    versions.set(definition.version, definition);
    this.definitions.set(definition.id, versions);
  }

  get(workflowId: string, version: number): WorkflowDefinition | undefined {
    return this.definitions.get(workflowId)?.get(version);
  }

  getLatest(workflowId: string): WorkflowDefinition | undefined {
    const versions = this.definitions.get(workflowId);

    if (!versions || versions.size === 0) {
      return undefined;
    }

    let latestVersion = Number.NEGATIVE_INFINITY;
    let latestDefinition: WorkflowDefinition | undefined;

    for (const [version, definition] of versions) {
      if (version > latestVersion) {
        latestVersion = version;
        latestDefinition = definition;
      }
    }

    return latestDefinition;
  }

  list(): readonly WorkflowDefinition[] {
    const definitions: WorkflowDefinition[] = [];

    for (const versions of this.definitions.values()) {
      definitions.push(...versions.values());
    }

    return definitions;
  }
}
