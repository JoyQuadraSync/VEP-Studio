import { OperationHandler } from './operation-handler';

export interface OperationRegistry {
  register(operationId: string, handler: OperationHandler): void;
  resolve(operationId: string): OperationHandler | undefined;
}

export class InMemoryOperationRegistry implements OperationRegistry {
  private readonly handlers = new Map<string, OperationHandler>();

  register(operationId: string, handler: OperationHandler): void {
    if (operationId.trim().length === 0) {
      throw new Error('Operation id must not be empty.');
    }

    if (this.handlers.has(operationId)) {
      throw new Error(`Operation ${operationId} is already registered.`);
    }

    this.handlers.set(operationId, handler);
  }

  resolve(operationId: string): OperationHandler | undefined {
    return this.handlers.get(operationId);
  }
}
