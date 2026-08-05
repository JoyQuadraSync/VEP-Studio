export interface OpenAiConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly maxRetries: 0;
  readonly timeoutMs: 60000;
  readonly maxOutputTokens: 800;
  readonly store: false;
}

export function loadOpenAiConfig(): OpenAiConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
  const model = process.env.OPENAI_MODEL?.trim() ?? '';

  if (apiKey.length === 0) {
    throw new Error('OPENAI_API_KEY must be configured with a non-blank value.');
  }

  if (model.length === 0) {
    throw new Error('OPENAI_MODEL must be configured with a non-blank value.');
  }

  return Object.freeze({
    apiKey,
    model,
    maxRetries: 0,
    timeoutMs: 60000,
    maxOutputTokens: 800,
    store: false
  });
}
