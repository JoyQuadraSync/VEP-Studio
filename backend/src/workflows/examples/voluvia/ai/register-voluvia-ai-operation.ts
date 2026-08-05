import { AiScriptGenerationClient } from '../../../../integrations/ai/ai-script-generation-client';
import { OperationRegistry } from '../../../runtime/operation-registry';
import { VOLUVIA_AI_SCRIPT_OPERATION_ID } from './voluvia-ai-script-contracts';
import { createVoluviaAiScriptOperation } from './voluvia-ai-script.operation';

export function registerVoluviaAiOperation(
  registry: OperationRegistry,
  client: AiScriptGenerationClient
): void {
  registry.register(VOLUVIA_AI_SCRIPT_OPERATION_ID, createVoluviaAiScriptOperation(client));
}
