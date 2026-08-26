const planner = require('../../dist/workflows/examples/voluvia/planner/voluvia-content-planner-contracts');
const plannerPrompt = require('../../dist/prompts/voluvia/de/content-planner-v2.prompt');
const packagePrompt = require('../../dist/prompts/voluvia/de/video-package-generator-v4.prompt');
const packagePromptV5 = require('../../dist/prompts/voluvia/de/video-package-generator-v5.prompt');

const fact = (factId) => ({ factId, displayValue: planner.APPROVED_PRODUCT_FACT_VALUES[factId] });
function plannerResult() {
  const facts = [fact('clip-count-3'), fact('base-lightweight-hand-knotted-lace')];
  return {
    reviewStatus: 'pending_manual_review',
    plan: {
      audience: { gender: 'women', primaryConcern: 'hair-topper-unawareness', awarenessLevel: 'unaware' },
      strategy: { primaryProblem: 'hair-topper-unawareness', purchaseTrigger: 'alternative-to-full-wig', contentFocus: 'what-is-a-hair-topper', contentAngle: 'education', emotionalGoal: 'product-awareness', desiredAction: 'learn-more' },
      production: { recommendedVideoStyle: 'educational-explainer', recommendedHookStrategy: 'common-question', targetDurationSeconds: 30, visualProofRequired: false, suggestedScenes: ['product-close-up', 'lace-base-close-up'] },
      brandSafety: { approvedFacts: facts, forbiddenClaims: ['hair regrowth'], prohibitedTone: ['medical', 'fake-urgency'], manualReviewRequired: true }
    },
    generation: { provider: 'openai', model: 'offline-model', operationId: 'voluvia.content.plan.ai', schemaVersion: 1, promptId: 'voluvia.tiktok.content-planner.de', promptVersion: 2, promptContentHash: plannerPrompt.VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256, responseId: 'planner-response', inputTokens: 1, outputTokens: 2, totalTokens: 3 }
  };
}
function input() {
  return {
    reviewedPlannerResult: { workflowId: 'voluvia.tiktok.contentplanning.ai.workflow', workflowVersion: 1, operationId: 'voluvia.content.plan.ai', plannerPrompt: { promptId: 'voluvia.tiktok.content-planner.de', promptVersion: 2, promptContentHash: plannerPrompt.VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256 }, plannerReviewDecision: 'approved_for_package_generation', result: plannerResult() },
    approvedProductFacts: [fact('clip-count-3'), fact('base-lightweight-hand-knotted-lace')],
    brandPolicy: { tone: ['premium', 'calm'], prohibitedTone: ['medical', 'fake-urgency'], forbiddenClaims: ['hair regrowth'] },
    videoControls: { targetLanguage: 'de-DE', platform: 'TikTok', targetDurationSeconds: 30, presenterMode: 'product-only', voiceStyle: 'calm', subtitleMode: 'burn-in-ready', priceMayBeFeatured: false, shippingMayBeFeatured: false, realBeforeAfterEvidenceAvailable: false, desiredAction: 'learn-more' },
    availableAssetIds: ['product-front', 'lace-base-close-up']
  };
}
function candidate() {
  return {
    hook: { spokenHook: 'Was ist eigentlich ein Hair Topper?', onScreenHook: 'Hair Topper einfach erklärt', visualHookInstruction: 'Zeige das Produkt ruhig aus der Nähe.' },
    voiceover: { segments: [
      { sourceScene: 'product-close-up', spokenText: 'Ein Hair Topper ergänzt das eigene Haar sanft und zeigt seine leichte Lace Basis ganz aus der Nähe.', proposedFactIds: ['base-lightweight-hand-knotted-lace'] },
      { sourceScene: 'lace-base-close-up', spokenText: 'Danach siehst du drei Clips und erfährst ruhig wie das Produkt im Alltag eingesetzt werden kann.', proposedFactIds: ['clip-count-3'] }
    ] },
    scenes: [
      { sourceSuggestedScene: 'product-close-up', durationSeconds: 15, cameraFraming: 'close-up', visualAction: 'Produkt ruhig von vorne zeigen.', requiredAssetIds: ['product-front'], onScreenTextKeys: ['intro'], productionNotes: 'Ruhiges Licht verwenden.', visualProofRole: 'product-detail', transitionType: 'cut' },
      { sourceSuggestedScene: 'lace-base-close-up', durationSeconds: 15, cameraFraming: 'macro', visualAction: 'Lace Basis und Clips im Detail zeigen.', requiredAssetIds: ['lace-base-close-up'], onScreenTextKeys: ['basis'], productionNotes: 'Details scharf und neutral filmen.', visualProofRole: 'product-detail', transitionType: 'fade' }
    ],
    onScreenText: [
      { key: 'intro', sourceScene: 'product-close-up', text: 'Hair Topper erklärt', startOffsetSecond: 0, endOffsetSecond: 4, proposedFactIds: [], styleRole: 'hook' },
      { key: 'basis', sourceScene: 'lace-base-close-up', text: 'Leichte Lace Basis', startOffsetSecond: 1, endOffsetSecond: 6, proposedFactIds: ['base-lightweight-hand-knotted-lace'], styleRole: 'product-fact' }
    ],
    cover: { coverTitle: 'Was ist ein Hair Topper?', coverSubtitle: 'Ruhig erklärt', selectedCoverScene: 'product-close-up', requiredAssetIds: ['product-front'] },
    caption: { text: 'Entdecke in Ruhe, wie ein Hair Topper aufgebaut ist.', callToAction: 'Mehr erfahren', proposedFactIds: [] },
    hashtags: ['#voluvia', '#haartopper', '#echthaar'],
    assetUsageProposal: [
      { assetId: 'product-front', sourceScenes: ['product-close-up'], productionInstruction: 'Produkt mittig platzieren.' },
      { assetId: 'lace-base-close-up', sourceScenes: ['lace-base-close-up'], productionInstruction: 'Lace Basis nah zeigen.' }
    ]
  };
}
function clientResult() {
  return { candidate: candidate(), provenance: { provider: 'fake', model: 'offline-model', promptId: 'voluvia.video.package-generator.de', promptVersion: 4, promptContentHash: packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256 }, diagnostics: { provider: 'fake', model: 'offline-model', requestAttempted: true, responseId: 'safe-response', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } } };
}
function clientResultV5() {
  const value = candidate();
  value.voiceover.segments[0].spokenText = 'Ein Hair Topper ergänzt\ndein eigenes Haar sanft.\nDie leichte Lace Basis\nganz nah zu sehen.';
  value.voiceover.segments[1].spokenText = 'Drei Clips siehst du\nruhig und klar im Bild.\nDu siehst den Einsatz\nim Alltag ruhig und klar.';
  return { candidate: value, provenance: { provider: 'fake', model: 'offline-model',
    promptId: 'voluvia.video.package-generator.de', promptVersion: 5,
    promptContentHash: packagePromptV5.VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_SHA256 },
    diagnostics: { provider: 'fake', model: 'offline-model', requestAttempted: true,
      responseId: 'safe-response-v5', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } } };
}
module.exports = { input, clientResult, clientResultV5 };
