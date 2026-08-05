const test = require('node:test');
const assert = require('node:assert/strict');

const liveEnabled = process.env.OPENAI_LIVE_TEST === 'true';

// This opt-in test makes one billable request. VEP Studio does not load .env files,
// and dotenv is intentionally not installed. OPENAI_API_KEY, OPENAI_MODEL, and
// OPENAI_LIVE_TEST=true must be supplied by PowerShell/the current process launcher.
// Generated German content and marketing claims require manual semantic review.

test('Voluvia OpenAI live script generation (one billable request)', { skip: !liveEnabled }, async () => {
  const { loadOpenAiConfig } = require('../dist/config/openai.config');
  const {
    OpenAiResponsesScriptGenerationClient
  } = require('../dist/integrations/openai/openai-responses-script-generation-client');
  const { StaticPromptCatalog } = require('../dist/prompts/prompt-catalog');
  const {
    VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE
  } = require('../dist/workflows/examples/voluvia/ai/voluvia-ai-script-contracts');

  const client = new OpenAiResponsesScriptGenerationClient(
    loadOpenAiConfig(),
    new StaticPromptCatalog()
  );
  const result = await client.generate({
    product: {
      title: 'Voluvia Satin Evening Dress',
      description: 'Satin evening dress with a flowing silhouette.',
      color: 'Emerald green',
      length: 'Maxi',
      price: { amount: 89, currency: 'EUR' },
      audience: 'Adults',
      productKey: 'voluvia-satin-evening-dress'
    },
    targetLanguage: 'de-DE',
    targetAudience: 'Erwachsene Kundinnen, die elegante Abendmode suchen',
    brandVoice: 'Elegant, klar und zurückhaltend',
    contentGoal: 'Das Kleid sachlich und ansprechend vorstellen',
    videoLengthTargetSeconds: 30,
    prohibitedClaims: ['garantierter Erfolg'],
    requiredProductFacts: ['Satin-Abendkleid', 'Farbe Smaragdgrün', 'Maxi-Länge'],
    prompt: VOLUVIA_AI_SCRIPT_PROMPT_REFERENCE
  });

  assert.equal(result.provider, 'openai');
  assert.equal(result.language, 'de-DE');
  process.stdout.write(`${JSON.stringify({
    provider: result.provider,
    model: result.model,
    responseId: result.responseId,
    usage: result.usage
  })}\n`);
});
