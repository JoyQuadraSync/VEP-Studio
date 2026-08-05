import {
  VoluviaAiScriptClientResult,
  VoluviaAiScriptRequest
} from '../../workflows/examples/voluvia/ai/voluvia-ai-script-contracts';

export interface AiScriptGenerationClient {
  generate(input: VoluviaAiScriptRequest): Promise<VoluviaAiScriptClientResult>;
}
