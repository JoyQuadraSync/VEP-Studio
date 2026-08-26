const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const OpenAI = require('openai');
const contracts = require('../dist/workflows/examples/voluvia/video-package/voluvia-video-package-contracts');
const planner = require('../dist/workflows/examples/voluvia/planner/voluvia-content-planner-contracts');
const plannerPrompt = require('../dist/prompts/voluvia/de/content-planner-v2.prompt');
const packagePromptV1 = require('../dist/prompts/voluvia/de/video-package-generator-v1.prompt');
const packagePromptV2 = require('../dist/prompts/voluvia/de/video-package-generator-v2.prompt');
const packagePromptV3 = require('../dist/prompts/voluvia/de/video-package-generator-v3.prompt');
const packagePrompt = require('../dist/prompts/voluvia/de/video-package-generator-v4.prompt');
const packagePromptV5 = require('../dist/prompts/voluvia/de/video-package-generator-v5.prompt');
const compatibility = require('../dist/workflows/examples/voluvia/video-package/voluvia-video-package-compatibility');
const { StaticPromptCatalog, hashPromptContent } = require('../dist/prompts/prompt-catalog');
const { createVoluviaVideoPackageOperation, createVoluviaVideoPackageV2Operation } = require('../dist/workflows/examples/voluvia/video-package/voluvia-video-package.operation');
const { validateVideoPackageInput, validateVideoPackageClientResult,
  validateAndDeriveCandidate, validateFinalVideoPackage, deriveEffectiveVideoFacts,
  hashVideoPackageValue, VideoPackageLocalValidationFailure } = require('../dist/workflows/examples/voluvia/video-package/voluvia-video-package-validator');
const { OpenAiResponsesVideoPackageGenerationClient, OpenAiVideoPackageDiagnosticFailure } = require('../dist/integrations/openai/openai-responses-video-package-generation-client');
const { VideoPackageProviderFailure } = require('../dist/integrations/ai/video-package-generation-client');

function fact(factId) { return { factId, displayValue: planner.APPROVED_PRODUCT_FACT_VALUES[factId] }; }
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
function clientResult(overrides = {}) {
  return { candidate: candidate(), provenance: { provider: 'fake', model: 'offline-model', promptId: contracts.VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE.promptId, promptVersion: 4, promptContentHash: packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256 }, diagnostics: { provider: 'fake', model: 'offline-model', requestAttempted: true, responseId: 'safe-response', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } }, ...overrides };
}
function clientResultV5() {
  const result = clientResult();
  result.provenance = { ...result.provenance, promptVersion: 5,
    promptContentHash: packagePromptV5.VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_SHA256 };
  result.candidate.voiceover.segments[0].spokenText = 'Ein Hair Topper ergänzt\ndein eigenes Haar sanft.\nDie leichte Lace Basis\nganz nah zu sehen.';
  result.candidate.voiceover.segments[1].spokenText = 'Drei Clips siehst du\nruhig und klar im Bild.\nDu siehst den Einsatz\nim Alltag ruhig und klar.';
  return result;
}
async function run(value = input(), result = clientResult(), observer) {
  let calls = 0;
  const handler = createVoluviaVideoPackageOperation({ generatePackageCandidate: async () => { calls++; return structuredClone(result); } }, { now: () => new Date('2026-08-06T12:00:00.000Z') }, observer);
  const output = await handler({ executionId: 'x', workflowId: contracts.VOLUVIA_VIDEO_PACKAGE_WORKFLOW_ID, workflowVersion: 1, stepId: 'generate-video-package', workflowInput: value, stepInput: value });
  return { output, calls };
}
async function runV5(value = input(), result = clientResultV5(), observer) {
  let calls = 0;
  const handler = createVoluviaVideoPackageV2Operation({ generatePackageCandidate: async () => { calls++; return structuredClone(result); } },
    { now: () => new Date('2026-08-06T12:00:00.000Z') }, observer);
  const output = await handler({ executionId: 'x', workflowId: contracts.VOLUVIA_VIDEO_PACKAGE_WORKFLOW_ID,
    workflowVersion: 2, stepId: 'generate-video-package', workflowInput: value, stepInput: value });
  return { output, calls };
}

test('frozen identities, prompt hash and prompt compatibility marker are exact', () => {
  assert.equal(contracts.VOLUVIA_VIDEO_PACKAGE_OPERATION_ID, 'voluvia.video.package.generate.ai');
  assert.equal(contracts.VOLUVIA_VIDEO_PACKAGE_WORKFLOW_ID, 'voluvia.video.packagegeneration.ai.workflow');
  assert.equal(contracts.VOLUVIA_VIDEO_PACKAGE_WORKFLOW_VERSION, 1);
  assert.deepEqual(contracts.VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE,
    { promptId: 'voluvia.video.package-generator.de', promptVersion: 4 });
  assert.equal(hashPromptContent(packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT), packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256);
  assert.equal(hashPromptContent(packagePromptV3.VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT), packagePromptV3.VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT_SHA256);
  assert.equal(hashPromptContent(packagePromptV2.VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT), packagePromptV2.VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT_SHA256);
  assert.equal(hashPromptContent(packagePromptV1.VOLUVIA_VIDEO_PACKAGE_DE_PROMPT), packagePromptV1.VOLUVIA_VIDEO_PACKAGE_DE_PROMPT_SHA256);
  assert.equal(packagePromptV1.VOLUVIA_VIDEO_PACKAGE_DE_PROMPT_SHA256,
    'edca6b6d1845ff8807c688c41fd0274c0e9b9812120e3749fac38cb057083a6f');
  assert.equal(packagePromptV2.VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT_SHA256,
    'cdb6acecc04c6c57b60e34f9368fca11d4e029e5113cf577ff7e2d24d5635dac');
  assert.equal(packagePromptV3.VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT_SHA256,
    'eb9257ca80ea3a8b4b5556f3b001d7f1818e18be6c7e7fc9b724bbe2ee2f6e0c');
  const promptTables = JSON.parse(packagePrompt.VOLUVIA_VIDEO_PACKAGE_PROMPT_COMPATIBILITY_JSON);
  assert.deepEqual(promptTables, compatibility.VIDEO_COMPATIBILITY_TABLES);
  assert.deepEqual(Object.keys(promptTables), Object.keys(compatibility.VIDEO_COMPATIBILITY_TABLES));
  assert.ok(packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT.includes(packagePrompt.VOLUVIA_VIDEO_PACKAGE_PROMPT_COMPATIBILITY_JSON));
  assert.notEqual(packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256,
    '55c38ffaea668e1339073b8554c181a2b81a301eac5ad05a679f08b34aba3b93');
  const catalog = new StaticPromptCatalog();
  assert.equal(catalog.resolve(contracts.VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE).sha256, packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256);
  assert.equal(catalog.resolve({ promptId: 'voluvia.video.package-generator.de', promptVersion: 1 }).sha256,
    packagePromptV1.VOLUVIA_VIDEO_PACKAGE_DE_PROMPT_SHA256);
  assert.equal(catalog.resolve({ promptId: 'voluvia.video.package-generator.de', promptVersion: 2 }).sha256,
    packagePromptV2.VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT_SHA256);
  assert.equal(catalog.resolve({ promptId: 'voluvia.video.package-generator.de', promptVersion: 3 }).sha256,
    packagePromptV3.VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT_SHA256);
});

test('every frozen prompt compatibility family independently matches production', () => {
  const promptTables = JSON.parse(packagePrompt.VOLUVIA_VIDEO_PACKAGE_PROMPT_COMPATIBILITY_JSON);
  const families = [
    ['scene assets', 'sceneAssets'],
    ['scene camera framing', 'sceneFramings'],
    ['scene text roles', 'sceneTextRoles'],
    ['video-style transitions', 'styleTransitions'],
    ['presenter-mode required assets', 'presenterAssets'],
    ['visual-proof assets and evidence', 'visualProofAssets'],
    ['scene-duration limits', 'sceneDuration'],
    ['hook-strategy copy constraints', 'hookCopyConstraints']
  ];
  assert.deepEqual(Object.keys(promptTables), families.map(([, key]) => key));
  assert.deepEqual(Object.keys(compatibility.VIDEO_COMPATIBILITY_TABLES),
    families.map(([, key]) => key));
  for (const [name, key] of families) {
    assert.deepEqual(promptTables[key], compatibility.VIDEO_COMPATIBILITY_TABLES[key],
      `${name}: prompt must equal production`);
    assert.deepEqual(compatibility.VIDEO_COMPATIBILITY_TABLES[key], promptTables[key],
      `${name}: production must equal prompt`);
  }
});

test('video package prompt v4 preserves exact per-field attribution guidance and fact glossary', () => {
  const glossary = JSON.parse(packagePrompt.VOLUVIA_VIDEO_PACKAGE_PROMPT_FACT_GLOSSARY_JSON);
  assert.deepEqual(glossary, planner.APPROVED_PRODUCT_FACT_VALUES);
  assert.deepEqual(Object.keys(glossary), planner.APPROVED_PRODUCT_FACT_IDS);
  for (const phrase of [
    'pro Feld und pro Voiceover-Segment', 'jeden freigegebenen semantischen Fakt',
    'keine Fakt-ID', 'mehrere freigegebene Fakten', 'kanonischen Reihenfolge',
    'nicht faktische Sprache verwendet ein leeres Array'
  ]) assert.ok(packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT.includes(phrase), phrase);
  assert.ok(packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT.includes(
    packagePrompt.VOLUVIA_VIDEO_PACKAGE_PROMPT_FACT_GLOSSARY_JSON));
});

test('video package prompt v4 hashtag allowlist exactly matches production policy', () => {
  const promptAllowlist = JSON.parse(
    packagePrompt.VOLUVIA_VIDEO_PACKAGE_PROMPT_HASHTAG_ALLOWLIST_JSON);
  assert.deepEqual(promptAllowlist, compatibility.VOLUVIA_VIDEO_HASHTAG_ALLOWLIST);
  assert.deepEqual(compatibility.VOLUVIA_VIDEO_HASHTAG_ALLOWLIST, promptAllowlist);
  assert.ok(packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT.includes(
    packagePrompt.VOLUVIA_VIDEO_PACKAGE_PROMPT_HASHTAG_ALLOWLIST_JSON));
  for (const phrase of ['genau 3 bis 5', 'geschlossenen Liste',
    'kleingeschriebene kanonische Form', 'bewahre die Reihenfolge',
    'keine zusätzliche Faktenattribution']) {
    assert.ok(packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT.includes(phrase), phrase);
  }
});

test('video package prompt v4 freezes occupancy and safe narration-budget guidance', () => {
  const content = packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT;
  assert.ok(content.startsWith(packagePromptV3.VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT));
  for (const phrase of [
    'ceil(totalCanonicalWordCount / 2.25)',
    '20 s = 10–18 s (ungefähr 23–40 Wörter)',
    '30 s = 15–27 s (ungefähr 34–60 Wörter)',
    '45 s = 23–40 s (ungefähr 52–90 Wörter)',
    '20 s = 13–20 s (ungefähr 30–45 Wörter)',
    '30 s = 20–30 s (ungefähr 45–67 Wörter)',
    '45 s = 30–45 s (ungefähr 68–101 Wörter)',
    'ungefähr in der Mitte',
    'nicht auf dessen exaktes Minimum oder Maximum',
    'proportional zur Dauer der Planner-Szenen',
    'unter der lokalen Sprechkapazität seiner Szene',
    'leere Füllsätze', 'Wiederholungen', 'redundante Aussagen',
    'Faktenattribution, Hashtag-Regeln und alle Sicherheitsregeln bleiben unverändert'
  ]) assert.ok(content.includes(phrase), phrase);
  assert.ok(content.includes(packagePrompt.VOLUVIA_VIDEO_PACKAGE_PROMPT_FACT_GLOSSARY_JSON));
  assert.ok(content.includes(packagePrompt.VOLUVIA_VIDEO_PACKAGE_PROMPT_HASHTAG_ALLOWLIST_JSON));
  assert.ok(content.includes(packagePrompt.VOLUVIA_VIDEO_PACKAGE_PROMPT_COMPATIBILITY_JSON));
  assert.equal(packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256,
    '5a74157f539206fdbf18bbc7f199f154045bb14ec85059ea2255fa0b33be4532');
});

test('prompt v5 is immutable, catalog-resolvable, and preserves every prior prompt identity', () => {
  assert.equal(packagePromptV5.VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_ID, 'voluvia.video.package-generator.de');
  assert.equal(packagePromptV5.VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_VERSION, 5);
  assert.equal(hashPromptContent(packagePromptV5.VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT),
    '97fd628bfdf6e241ce25cefe1a3552fc0e42e05f935dfb8b5a998a77e1684731');
  assert.ok(packagePromptV5.VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT.startsWith(packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT));
  for (const phrase of ['einzige von dir verfasste Narrationsquelle', 'echte LF-Zeilenumbrüche',
    '1 bis 4 nichtleere Zeilen', '1 bis 42 Unicode-Skalare', 'keine Cue-Zeiten',
    'kein Reflow', 'keinen versteckten Fallback']) assert.ok(packagePromptV5.VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT.includes(phrase));
  const catalog = new StaticPromptCatalog();
  assert.equal(catalog.resolve(contracts.VOLUVIA_VIDEO_PACKAGE_V5_PROMPT_REFERENCE).sha256,
    packagePromptV5.VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_SHA256);
  assert.equal(catalog.resolve({ promptId: 'voluvia.video.package-generator.de', promptVersion: 6 }), undefined);
  for (const [version, expected] of [[1, packagePromptV1.VOLUVIA_VIDEO_PACKAGE_DE_PROMPT_SHA256],
    [2, packagePromptV2.VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT_SHA256],
    [3, packagePromptV3.VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT_SHA256],
    [4, packagePrompt.VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256]])
    assert.equal(catalog.resolve({ promptId: 'voluvia.video.package-generator.de', promptVersion: version }).sha256, expected);
});

test('v5 derives the exact explicit subtitle lines, canonical narration, timing, and distinct identities', async () => {
  const legacy = (await run()).output; const current = (await runV5()).output;
  assert.equal(current.operationId, 'voluvia.video.package.generate.ai.v2');
  assert.equal(current.schemaVersion, 1); assert.equal(current.provenance.promptVersion, 5);
  assert.equal(current.provenance.promptContentHash, packagePromptV5.VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_SHA256);
  assert.deepEqual(current.voiceover.segments.map(segment => segment.spokenText), [
    'Ein Hair Topper ergänzt dein eigenes Haar sanft. Die leichte Lace Basis ganz nah zu sehen.',
    'Drei Clips siehst du ruhig und klar im Bild. Du siehst den Einsatz im Alltag ruhig und klar.'
  ]);
  assert.equal(current.voiceover.fullScript, current.voiceover.segments.map(segment => segment.spokenText).join('\n'));
  assert.equal(current.narrationPackage.narrationText, current.voiceover.fullScript);
  assert.deepEqual(current.narrationPackage.subtitleLines, [
    { cueId: 'cue-01', sceneId: 'scene-01', lines: ['Ein Hair Topper ergänzt', 'dein eigenes Haar sanft.'], startSecond: 0, endSecond: 4.314 },
    { cueId: 'cue-02', sceneId: 'scene-01', lines: ['Die leichte Lace Basis', 'ganz nah zu sehen.'], startSecond: 4.314, endSecond: 8 },
    { cueId: 'cue-03', sceneId: 'scene-02', lines: ['Drei Clips siehst du', 'ruhig und klar im Bild.'], startSecond: 15, endSecond: 18.868 },
    { cueId: 'cue-04', sceneId: 'scene-02', lines: ['Du siehst den Einsatz', 'im Alltag ruhig und klar.'], startSecond: 18.868, endSecond: 23 }
  ]);
  assert.deepEqual(current.voiceover.segments.map(segment => segment.estimatedSeconds), [8, 8]);
  assert.equal(current.packageId, '21c3650c8cd020014b547919db451a49eabf01af94571dc668d0e66159652c94');
  assert.equal(hashVideoPackageValue(current), '42e9123d97a52c88c2f854136e86fbbf5ebd3f58190a2b7f27332e07e22348d1');
  assert.notEqual(current.packageId, legacy.packageId);
  assert.notEqual(hashVideoPackageValue(current), hashVideoPackageValue(legacy));
});

test('frozen v5 cue metric preconditions match the authoritative offline helper', () => {
  const helper = 'C:\\Users\\Jiayi\\AppData\\Local\\VEP-Studio\\toolchain\\install\\metrics\\frozen-font-metrics.exe';
  const cues = [
    [['Ein Hair Topper ergänzt', 'dein eigenes Haar sanft.'], 775, 164],
    [['Die leichte Lace Basis', 'ganz nah zu sehen.'], 681, 164],
    [['Drei Clips siehst du', 'ruhig und klar im Bild.'], 709, 164],
    [['Du siehst den Einsatz', 'im Alltag ruhig und klar.'], 766, 164]
  ];
  for (const [lines, expectedWidth, expectedHeight] of cues) {
    assert.ok(lines.length <= 2); assert.ok(lines.every(line => [...line].length <= 42));
    const result = spawnSync(helper, [], { shell: false, cwd: path.dirname(helper), windowsHide: true,
      input: lines.join('\n'), encoding: 'utf8', timeout: 5000, maxBuffer: 1024,
      env: { PATH: '', SystemRoot: 'C:\\Windows' } });
    assert.equal(result.status, 0); assert.equal(result.stderr, '');
    const match = result.stdout.match(/^VEP_FONT_METRIC_V1\t1\t([0-9]+)\t([0-9]+)\t2\r?\n$/u);
    assert.ok(match); assert.equal(Number(match[1]), expectedWidth); assert.equal(Number(match[2]), expectedHeight);
    assert.ok(expectedWidth + 48 <= 900); assert.ok(expectedHeight + 48 <= 320);
  }
});

test('v5 requires LF and rejects malformed explicit line structure without legacy fallback', () => {
  const derive = result => validateAndDeriveCandidate(validateVideoPackageClientResult(result, 'v5'),
    validateVideoPackageInput(input()), deriveEffectiveVideoFacts(validateVideoPackageInput(input())), 'v5');
  const rejected = [
    'No explicit line break here', 'line one\n', 'line one\n \nline three', ' line one\nline two',
    'line one \nline two', 'line\tone\nline two', 'line\u00a0one\nline two',
    'line one\u2028line two', 'line\u200bone\nline two', 'line\u200eone\nline two',
    'line\u2060one\nline two', 'a\nb\nc\nd\ne', `${'x'.repeat(43)}\nline two`
  ];
  for (const spokenText of rejected) {
    const result = clientResultV5(); result.candidate.voiceover.segments[0].spokenText = spokenText;
    assert.throws(() => derive(result), error => error instanceof VideoPackageLocalValidationFailure);
  }
  for (const separator of ['\r\n', '\r']) {
    const result = clientResultV5(); result.candidate.voiceover.segments[0].spokenText =
      result.candidate.voiceover.segments[0].spokenText.replaceAll('\n', separator);
    assert.deepEqual(derive(result).subtitles.slice(0, 2).map(cue => cue.lines), [
      ['Ein Hair Topper ergänzt', 'dein eigenes Haar sanft.'], ['Die leichte Lace Basis', 'ganz nah zu sehen.']]);
  }
  const repeatedSpaces = clientResultV5(); repeatedSpaces.candidate.voiceover.segments[0].spokenText =
    repeatedSpaces.candidate.voiceover.segments[0].spokenText.replace('Hair Topper', 'Hair   Topper');
  const normalized = derive(repeatedSpaces);
  assert.equal(normalized.segments[0].spokenText.includes('  '), false);
  assert.deepEqual(normalized.subtitles[0].lines, ['Ein Hair Topper ergänzt', 'dein eigenes Haar sanft.']);
});

test('v5 rejects U+2029 at the explicit whitespace boundary without normalization to space', () => {
  const result = clientResultV5();
  result.candidate.voiceover.segments[0].spokenText =
    'Ein Hair Topper ergänzt\ndein eigenes Haar sanft.\nDie leichte Lace\u2029Basis\nganz nah zu sehen.';
  const value = validateVideoPackageInput(input());
  const validated = validateVideoPackageClientResult(result, 'v5');
  assert.throws(
    () => validateAndDeriveCandidate(validated, value, deriveEffectiveVideoFacts(value), 'v5'),
    error => error instanceof VideoPackageLocalValidationFailure &&
      error.code === 'duration_invalid' && error.durationInvalidReason === 'other_duration_invalid'
  );
});

test('operation lineage matrix rejects cross-lineage provider provenance before derivation', async () => {
  const v5ForLegacy = clientResultV5();
  assert.throws(() => validateVideoPackageClientResult(v5ForLegacy, 'v4'),
    error => error instanceof VideoPackageLocalValidationFailure && error.code === 'local_validation');
  let legacyDiagnostic;
  await assert.rejects(() => run(input(), v5ForLegacy, value => { legacyDiagnostic = value; }),
    /^Error: AI video package generation failed\.$/u);
  assert.deepEqual(legacyDiagnostic, {
    diagnosticCategory: 'local_validation', localValidationCode: 'local_validation', requestAttempted: true
  });

  const v4ForV2 = clientResult();
  assert.throws(() => validateVideoPackageClientResult(v4ForV2, 'v5'),
    error => error instanceof VideoPackageLocalValidationFailure && error.code === 'local_validation');
  let v2Diagnostic;
  await assert.rejects(() => runV5(input(), v4ForV2, value => { v2Diagnostic = value; }),
    /^Error: AI video package generation failed\.$/u);
  assert.deepEqual(v2Diagnostic, {
    diagnosticCategory: 'local_validation', localValidationCode: 'local_validation', requestAttempted: true
  });

  assert.equal((await run()).output.provenance.promptVersion, 4);
  assert.equal((await runV5()).output.provenance.promptVersion, 5);
});

test('legacy v4 fixture retains its exact historical package and subtitle identities', async () => {
  const output = (await run()).output;
  assert.equal(output.packageId, '09ba11a21061d22c5596d8520ba01c9309c64c9145003c3dc7395d3c7ea93dbd');
  assert.deepEqual(output.narrationPackage.subtitleLines, [
    { cueId: 'cue-01', sceneId: 'scene-01', lines: ['Ein Hair Topper ergänzt das eigene Haar', 'sanft und zeigt seine leichte Lace Basis'], startSecond: 0, endSecond: 6.53 },
    { cueId: 'cue-02', sceneId: 'scene-01', lines: ['ganz aus der Nähe.'], startSecond: 6.53, endSecond: 8 },
    { cueId: 'cue-03', sceneId: 'scene-02', lines: ['Danach siehst du drei Clips und erfährst', 'ruhig wie das Produkt im Alltag eingesetzt'], startSecond: 15, endSecond: 21.989 },
    { cueId: 'cue-04', sceneId: 'scene-02', lines: ['werden kann.'], startSecond: 21.989, endSecond: 23 }
  ]);
  assert.equal(hashVideoPackageValue(output), '9312053a7ff046501ec1bac54487275df6fef4ac9cd3c08407d4a01445e4bc4d');
});

test('operation creates immutable deterministic business package and keeps diagnostics separate', async () => {
  let diagnostic; const first = await run(input(), clientResult(), (value) => { diagnostic = value; }); const second = await run();
  assert.equal(first.calls, 1); assert.equal(first.output.packageReviewStatus, 'pending_manual_review');
  assert.equal(first.output.safety.manualReviewRequired, true); assert.equal(first.output.packageId, second.output.packageId);
  assert.equal(first.output.voiceover.fullScript, first.output.narrationPackage.narrationText);
  assert.deepEqual(first.output.voiceover.segments.map((x) => x.segmentId), ['segment-01', 'segment-02']);
  assert.equal(first.output.narrationPackage.subtitleLines.every((cue) => cue.lines.every((line) => [...line].length <= 42)), true);
  assert.equal(Object.isFrozen(first.output), true); assert.equal('responseId' in first.output.provenance, false);
  assert.equal('usage' in first.output.provenance, false); assert.equal(diagnostic.responseId, 'safe-response');
});

test('review, source identity, unknown fields and caller source hash fail before client call', async () => {
  for (const mutate of [
    (v) => { v.reviewedPlannerResult.plannerReviewDecision = 'rejected'; },
    (v) => { v.reviewedPlannerResult.workflowId = 'wrong.workflow'; },
    (v) => { v.reviewedPlannerResult.plannerPrompt.promptContentHash = '0'.repeat(64); },
    (v) => { v.sourcePlanHash = '0'.repeat(64); }
  ]) {
    const value = input(); mutate(value); let calls = 0;
    const handler = createVoluviaVideoPackageOperation({ generatePackageCandidate: async () => { calls++; return clientResult(); } }, { now: () => new Date(0) });
    await assert.rejects(() => handler({ executionId: 'x', workflowId: 'x', workflowVersion: 1, stepId: 'x', workflowInput: value, stepInput: value }), /AI video package generation failed/);
    assert.equal(calls, 0);
  }
});

test('provider input omits disabled commerce, source hashes, diagnostics and internal state', async () => {
  let observed; const handler = createVoluviaVideoPackageOperation({ generatePackageCandidate: async (value) => { observed = value; return clientResult(); } }, { now: () => new Date(0) });
  await handler({ executionId: 'x', workflowId: 'x', workflowVersion: 1, stepId: 'x', workflowInput: input(), stepInput: input() });
  const serialized = JSON.stringify(observed);
  assert.equal(serialized.includes('price-49-eur'), false); assert.equal(serialized.includes('ships-from-germany'), false);
  assert.equal(serialized.includes('sourcePlanHash'), false); assert.equal(serialized.includes('diagnostics'), false);
  assert.equal(serialized.includes('responseId'), false);
});

test('scene reorder, segment mismatch, missing assets and invalid timing are rejected', async () => {
  for (const mutate of [
    (c) => c.scenes.reverse(),
    (c) => { c.voiceover.segments[0].sourceScene = 'lace-base-close-up'; },
    (c) => { c.scenes[0].requiredAssetIds = ['product-back']; },
    (c) => { c.scenes[0].durationSeconds = 14; }
  ]) {
    const result = clientResult(); mutate(result.candidate);
    await assert.rejects(() => run(input(), result), /AI video package generation failed/);
  }
});

test('presenter assets and before-after evidence are enforced before provider call', () => {
  const presenter = input(); presenter.videoControls.presenterMode = 'presenter-plus-product';
  assert.throws(() => validateVideoPackageInput(presenter), (error) => error instanceof VideoPackageLocalValidationFailure && error.code === 'asset_mismatch');
  const beforeAfter = input(); beforeAfter.reviewedPlannerResult.result.plan.production.suggestedScenes = ['crown-before-view', 'crown-after-view'];
  beforeAfter.reviewedPlannerResult.result.plan.production.recommendedVideoStyle = 'before-after'; beforeAfter.reviewedPlannerResult.result.plan.production.visualProofRequired = true;
  assert.throws(() => validateVideoPackageInput(beforeAfter));
});

test('occupancy boundaries and per-scene segment fit reject too short and too long copy', async () => {
  const short = clientResult(); short.candidate.voiceover.segments.forEach((segment) => { segment.spokenText = 'Kurzer Text.'; });
  await assert.rejects(() => run(input(), short), /AI video package generation failed/);
  const long = clientResult(); long.candidate.voiceover.segments[0].spokenText = Array(40).fill('Wort').join(' ');
  await assert.rejects(() => run(input(), long), /AI video package generation failed/);
});

test('copy, facts, commerce, hashtags and candidate root are strict', async () => {
  const variants = [
    (c) => { c.caption.text = 'Klinisch getestet.'; },
    (c) => { c.caption.proposedFactIds = ['price-49-eur']; },
    (c) => { c.hashtags = ['#voluvia', '#haartopper', '#haartopper']; },
    (c) => { c.rawResponse = {}; }
  ];
  for (const mutate of variants) { const result = clientResult(); mutate(result.candidate); await assert.rejects(() => run(input(), result)); }
});

test('canonical source hash changes with reviewed plan but package ID ignores diagnostics and clock', async () => {
  const a = await run(); const changedDiagnostics = clientResult(); changedDiagnostics.diagnostics.responseId = 'another-safe-id';
  const b = await run(input(), changedDiagnostics); assert.equal(a.output.packageId, b.output.packageId);
  const value = input(); value.reviewedPlannerResult.result.generation.responseId = 'different-planner-response';
  const c = await run(value); assert.notEqual(a.output.sourcePlan.sourcePlanHash, c.output.sourcePlan.sourcePlanHash);
});

function config() { return { apiKey: 'synthetic-test-key', model: 'configured-model', maxRetries: 0, timeoutMs: 60000, maxOutputTokens: 800, store: false }; }
function sdkFactory(parse, options = []) { return { create(value) { options.push(value); return { responses: { parse } }; } }; }
function response(overrides = {}) {
  const value = candidate();
  value.cover.coverSubtitle ??= null;
  value.caption.disclosureText ??= null;
  value.backgroundAssetId ??= null;
  return { id: 'safe-id', model: 'returned-model', status: 'completed', error: null,
    incomplete_details: null, output_parsed: value,
    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }, output: [], ...overrides };
}
test('OpenAI adapter uses one parse call, frozen SDK options and safe result separation', async () => {
  let calls = 0; const options = []; let request;
  const client = new OpenAiResponsesVideoPackageGenerationClient(config(), new StaticPromptCatalog(), sdkFactory(async (value) => { calls++; request = value; return response(); }, options));
  const result = await client.generatePackageCandidate({ audience: plannerResult().plan.audience, strategy: plannerResult().plan.strategy, production: plannerResult().plan.production, approvedProductFacts: input().approvedProductFacts, brandPolicy: input().brandPolicy, videoControls: input().videoControls, availableAssetIds: input().availableAssetIds, prompt: contracts.VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE });
  assert.equal(calls, 1); assert.deepEqual(options, [{ apiKey: 'synthetic-test-key', maxRetries: 0, timeout: 60000 }]);
  assert.equal(request.store, false); assert.equal(request.model, 'configured-model'); assert.equal('tools' in request, false);
  assert.equal(result.provenance.model, 'returned-model'); assert.equal(result.diagnostics.responseId, 'safe-id');
});

test('OpenAI adapter retains only response IDs matching the frozen safe grammar', async () => {
  for (const [id, expected] of [
    ['resp_safe-123', 'resp_safe-123'], ['bad id', undefined], ['bad\ncontrol', undefined],
    ['x'.repeat(201), undefined], ['', undefined]
  ]) {
    const client = new OpenAiResponsesVideoPackageGenerationClient(config(),
      new StaticPromptCatalog(), sdkFactory(async () => response({ id })));
    const result = await client.generatePackageCandidate({ audience: plannerResult().plan.audience,
      strategy: plannerResult().plan.strategy, production: plannerResult().plan.production,
      approvedProductFacts: input().approvedProductFacts, brandPolicy: input().brandPolicy,
      videoControls: input().videoControls, availableAssetIds: input().availableAssetIds,
      prompt: contracts.VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE });
    assert.equal(result.diagnostics.responseId, expected);
    assert.equal('responseId' in result.diagnostics, expected !== undefined);
  }
});

test('reviewed Planner snapshot revalidation rejects semantic drift before the client', async () => {
  const mutations = [
    (v) => { v.reviewedPlannerResult.result.plan.brandSafety.approvedFacts[0].displayValue = 'wrong'; },
    (v) => { v.reviewedPlannerResult.result.plan.brandSafety.approvedFacts.push(structuredClone(v.reviewedPlannerResult.result.plan.brandSafety.approvedFacts[0])); },
    (v) => { v.reviewedPlannerResult.result.plan.strategy.desiredAction = 'compare-colors'; },
    (v) => { v.reviewedPlannerResult.result.plan.strategy.purchaseTrigger = 'find-suitable-color'; }
  ];
  for (const mutate of mutations) {
    const value = input(); mutate(value); let calls = 0;
    const handler = createVoluviaVideoPackageOperation({ generatePackageCandidate: async () => {
      calls++; return clientResult();
    } }, { now: () => new Date(0) });
    await assert.rejects(() => handler({ executionId: 'x', workflowId: 'x', workflowVersion: 1,
      stepId: 'x', workflowInput: value, stepInput: value }));
    assert.equal(calls, 0);
  }
});

function directDerivation(value, result) {
  const validatedInput = validateVideoPackageInput(value);
  const effectiveFacts = deriveEffectiveVideoFacts(validatedInput);
  const validatedResult = validateVideoPackageClientResult(result);
  return { validatedInput, effectiveFacts, validatedResult,
    derived: validateAndDeriveCandidate(validatedResult, validatedInput, effectiveFacts) };
}

test('factual attribution is exact, canonical, and derived from actual text', () => {
  assert.doesNotThrow(() => directDerivation(input(), clientResult()));
  for (const mutate of [
    (c) => { c.voiceover.segments[0].proposedFactIds = []; },
    (c) => { c.voiceover.segments[0].proposedFactIds = ['clip-count-3']; },
    (c) => { c.caption.proposedFactIds = ['clip-count-3']; },
    (c) => { c.voiceover.segments[0].spokenText += ' und drei Clips'; }
  ]) {
    const result = clientResult(); mutate(result.candidate);
    assert.throws(() => directDerivation(input(), result),
      (error) => error instanceof VideoPackageLocalValidationFailure && error.code === 'unsupported_claim');
  }
});

test('EUR 49 fact attribution recognizes only frozen boundary-aware currency forms', () => {
  const supported = [
    '49 EUR', '49 eur', '49 €', '49€', '€49', '€ 49', 'EUR 49', 'eur 49',
    'Preis:   49 EUR.', 'Heute kostet es (49€).', 'ＥＵＲ　４９'
  ];
  for (const expression of supported) {
    const value = input();
    value.approvedProductFacts.push(fact('price-49-eur'));
    value.reviewedPlannerResult.result.plan.brandSafety.approvedFacts.push(fact('price-49-eur'));
    value.videoControls.priceMayBeFeatured = true;
    const result = clientResult();
    result.candidate.voiceover.segments[0].spokenText += ` Preisangabe ${expression}`;
    result.candidate.voiceover.segments[0].proposedFactIds = [
      'base-lightweight-hand-knotted-lace', 'price-49-eur'
    ];
    const derived = directDerivation(value, result).derived;
    assert.equal(derived.claimsUsed.filter((id) => id === 'price-49-eur').length, 1,
      expression);
  }
  for (const expression of ['149 EUR', '€490', '49 USD', '49']) {
    const value = input();
    value.approvedProductFacts.push(fact('price-49-eur'));
    value.reviewedPlannerResult.result.plan.brandSafety.approvedFacts.push(fact('price-49-eur'));
    value.videoControls.priceMayBeFeatured = true;
    const result = clientResult();
    result.candidate.voiceover.segments[0].spokenText += ` Referenz ${expression}`;
    const derived = directDerivation(value, result).derived;
    assert.equal(derived.claimsUsed.includes('price-49-eur'), false, expression);
  }
});

test('voiceover fact attribution remains exact across canonical facts and text variants', () => {
  function allFactsInput() {
    const value = input();
    const facts = planner.APPROVED_PRODUCT_FACT_IDS.map(fact);
    value.approvedProductFacts = structuredClone(facts);
    value.reviewedPlannerResult.result.plan.brandSafety.approvedFacts = structuredClone(facts);
    value.videoControls.priceMayBeFeatured = true;
    value.videoControls.shippingMayBeFeatured = true;
    return value;
  }
  function attributed(phrase, proposedFactIds) {
    const result = clientResult();
    result.candidate.voiceover.segments[0].spokenText =
      `${Array(20).fill('Wort').join(' ')} ${phrase}`;
    result.candidate.voiceover.segments[0].proposedFactIds = proposedFactIds;
    return result;
  }
  const canonicalCases = [
    ['１００％   Remy—Echthaar', ['material-remy-human-hair-100-percent']],
    ['Die Länge beträgt 32—cm.', ['length-32-cm']],
    ['Befestigung mit drei   Clips.', ['clip-count-3']],
    ['Leichte, handgeknüpfte Lace—Basis.', ['base-lightweight-hand-knotted-lace']],
    ['Farbe: Honig—Blond.', ['color-honig-blond']]
  ];
  for (const [phrase, ids] of canonicalCases) {
    assert.doesNotThrow(() => directDerivation(allFactsInput(), attributed(phrase, ids)), phrase);
  }
  assert.doesNotThrow(() => directDerivation(allFactsInput(), attributed(
    'Die Länge beträgt 32 cm und die Befestigung nutzt 3 Clips.',
    ['length-32-cm', 'clip-count-3'])));
  for (const [phrase, ids] of [
    ['Die Länge beträgt 32 cm.', []],
    ['Die Länge beträgt 32 cm.', ['clip-count-3']],
    ['Eine ruhige Beschreibung ohne Produktwert.', ['clip-count-3']],
    ['32 cm und 3 Clips.', ['clip-count-3', 'length-32-cm']],
    ['32 cm und 3 Clips.', ['length-32-cm', 'clip-count-3', 'clip-count-3']]
  ]) assert.throws(() => directDerivation(allFactsInput(), attributed(phrase, ids)));
  assert.doesNotThrow(() => directDerivation(allFactsInput(), attributed(
    'Eine ruhige Beschreibung ohne konkreten Produktwert.', [])));

  for (const [phrase, id] of [['49 EUR', 'price-49-eur'],
    ['Versand aus Deutschland', 'ships-from-germany']]) {
    const disabled = allFactsInput();
    disabled.videoControls.priceMayBeFeatured = false;
    disabled.videoControls.shippingMayBeFeatured = false;
    assert.throws(() => directDerivation(disabled, attributed(phrase, [id])));
  }
});

test('closed hashtag policy accepts only canonical ordered selections without deriving facts', async () => {
  const allowlist = compatibility.VOLUVIA_VIDEO_HASHTAG_ALLOWLIST;
  for (const hashtag of allowlist) {
    const selection = allowlist.filter((value) => value === hashtag ||
      value === '#voluvia' || value === '#haartopper').slice(0, 3);
    while (selection.length < 3) selection.push(allowlist[selection.length]);
    const canonical = allowlist.filter((value) => selection.includes(value));
    const result = clientResult(); result.candidate.hashtags = canonical;
    assert.doesNotThrow(() => directDerivation(input(), result), hashtag);
  }
  for (const values of [allowlist.slice(0, 3), allowlist.slice(0, 5)]) {
    const result = clientResult(); result.candidate.hashtags = [...values];
    assert.doesNotThrow(() => directDerivation(input(), result));
  }
  const base = await run();
  const safeTags = clientResult(); safeTags.candidate.hashtags =
    ['#voluvia', '#echthaar', '#remyechthaar'];
  const changed = await run(input(), safeTags);
  assert.deepEqual(changed.output.safety.claimsUsed, base.output.safety.claimsUsed);
});

test('closed hashtag policy rejects noncanonical, unsafe, invented, and spam tags safely', async () => {
  const rejected = [
    ['#voluvia', '#haartopper', '#haartopper'],
    ['#Voluvia', '#haartopper', '#echthaar'],
    ['#voluvia', '#echthaar', '#haartopper'],
    ['#voluvia', '#haartopper', '#unbekannt'],
    ['#voluvia', '#haartopper', '#medizinisch'],
    ['#voluvia', '#haartopper', '#haarwachstum'],
    ['#voluvia', '#haartopper', '#nurheute'],
    ['#voluvia', '#haartopper', '#limitiert'],
    ['#voluvia', '#haartopper', '#rabatt'],
    ['#voluvia', '#haartopper', '#beautyangst'],
    ['#voluvia', '#haartopper', '#trending'],
    ['#voluvia', '#haartopper', '#schnellelieferung'],
    ['#voluviaofficial', '#haartopper', '#echthaar']
  ];
  for (const hashtags of rejected) {
    const result = clientResult(); result.candidate.hashtags = hashtags; let observed;
    const handler = createVoluviaVideoPackageOperation({
      generatePackageCandidate: async () => result
    }, { now: () => new Date(0) }, (value) => { observed = value; });
    await assert.rejects(() => handler({ executionId: 'x', workflowId: 'x', workflowVersion: 1,
      stepId: 'x', workflowInput: input(), stepInput: input() }));
    assert.deepEqual(observed, { diagnosticCategory: 'local_validation',
      localValidationCode: 'unsupported_claim', requestAttempted: true,
      unsupportedClaimReason: 'prohibited_hashtag', textLocation: 'hashtag' });
    assert.equal(rejected.some((set) => JSON.stringify(observed).includes(set[2])), false);
  }
});

test('every provider-authored text location is covered by the M3 safety scan', () => {
  const mutations = [
    (c, p) => { c.hook.spokenHook = `${p}?`; },
    (c, p) => { c.hook.onScreenHook = p; },
    (c, p) => { c.hook.visualHookInstruction = p; },
    (c, p) => { c.voiceover.segments[0].spokenText = p; c.voiceover.segments[0].proposedFactIds = []; },
    (c, p) => { c.scenes[0].visualAction = p; },
    (c, p) => { c.scenes[0].productionNotes = p; },
    (c, p) => { c.onScreenText[0].text = p; c.onScreenText[0].proposedFactIds = []; },
    (c, p) => { c.cover.coverTitle = p; },
    (c, p) => { c.cover.coverSubtitle = p; },
    (c, p) => { c.caption.text = p; c.caption.proposedFactIds = []; },
    (c, p) => { c.caption.callToAction = p; },
    (c, p) => { c.caption.disclosureText = p; },
    (c) => { c.hashtags = ['#voluvia', '#klinisch', '#haartopper']; },
    (c, p) => { c.assetUsageProposal[0].productionInstruction = p; }
  ];
  for (const mutate of mutations) {
    const result = clientResult(); mutate(result.candidate, 'Jede Frau braucht dieses Produkt');
    assert.throws(() => directDerivation(input(), result),
      (error) => error instanceof VideoPackageLocalValidationFailure && error.code === 'unsupported_claim');
  }
});

function wordsForEstimate(seconds) {
  return Math.floor((seconds - 1) * 2.25) + 1;
}
function durationFixture(target, presenterMode, estimate) {
  const value = input(); value.videoControls.targetDurationSeconds = target;
  value.reviewedPlannerResult.result.plan.production.targetDurationSeconds = target;
  value.videoControls.presenterMode = presenterMode;
  if (presenterMode === 'presenter-plus-product') value.availableAssetIds.push('presenter-avatar', 'presenter-voice');
  const result = clientResult(); result.candidate.scenes[0].durationSeconds = Math.floor(target / 2);
  result.candidate.scenes[1].durationSeconds = target - result.candidate.scenes[0].durationSeconds;
  const count = wordsForEstimate(estimate);
  const firstCapacity = Math.floor(result.candidate.scenes[0].durationSeconds * 2.25);
  const secondCapacity = Math.floor(result.candidate.scenes[1].durationSeconds * 2.25);
  const first = Math.min(firstCapacity, Math.max(1, count - secondCapacity));
  result.candidate.voiceover.segments[0].spokenText = Array(first).fill('Wort').join(' ');
  result.candidate.voiceover.segments[0].proposedFactIds = [];
  result.candidate.voiceover.segments[1].spokenText = Array(count - first).fill('Wort').join(' ');
  result.candidate.voiceover.segments[1].proposedFactIds = [];
  return { value, result };
}

test('all frozen speaking-occupancy boundaries pass and adjacent values fail', () => {
  const policies = [
    ['product-only', 20, 10, 18], ['product-only', 30, 15, 27], ['product-only', 45, 23, 40],
    ['presenter-plus-product', 20, 13, 20], ['presenter-plus-product', 30, 20, 30],
    ['presenter-plus-product', 45, 30, 45]
  ];
  for (const [mode, target, minimum, maximum] of policies) {
    for (const estimate of [minimum, maximum]) {
      const fixture = durationFixture(target, mode, estimate);
      assert.equal(directDerivation(fixture.value, fixture.result).derived.estimatedSpokenSeconds, estimate);
    }
    for (const estimate of [minimum - 1, maximum + 1]) {
      const fixture = durationFixture(target, mode, estimate);
      assert.throws(() => directDerivation(fixture.value, fixture.result),
        (error) => error instanceof VideoPackageLocalValidationFailure && error.code === 'duration_invalid');
    }
  }
});

test('representative 30-second product-only narration passes at minimum and safe interior occupancy', () => {
  for (const estimate of [15, 19]) {
    const fixture = durationFixture(30, 'product-only', estimate);
    assert.equal(directDerivation(fixture.value, fixture.result).derived.estimatedSpokenSeconds,
      estimate);
  }
  const below = durationFixture(30, 'product-only', 14);
  assert.throws(() => directDerivation(below.value, below.result),
    (error) => error instanceof VideoPackageLocalValidationFailure &&
      error.code === 'duration_invalid' &&
      error.durationInvalidReason === 'narration_below_occupancy');
  const above = durationFixture(30, 'product-only', 28);
  assert.throws(() => directDerivation(above.value, above.result),
    (error) => error instanceof VideoPackageLocalValidationFailure &&
      error.code === 'duration_invalid' &&
      error.durationInvalidReason === 'narration_above_occupancy');
});

test('subtitle derivation is Unicode-aware, deterministic, and allocates exact milliseconds', () => {
  const exact = clientResult(); exact.candidate.voiceover.segments[0].spokenText = `${'ä'.repeat(20)} ${'ö'.repeat(21)}`;
  exact.candidate.voiceover.segments[0].proposedFactIds = [];
  exact.candidate.voiceover.segments[1].spokenText = Array(30).fill('Wort').join(' ');
  exact.candidate.voiceover.segments[1].proposedFactIds = [];
  const first = directDerivation(input(), exact).derived;
  const second = directDerivation(input(), exact).derived;
  assert.deepEqual(first.subtitles, second.subtitles);
  assert.equal([...first.subtitles[0].lines[0]].length, 42);
  const segmentCues = first.subtitles.filter((cue) => cue.sceneId === 'scene-01');
  assert.equal(segmentCues.at(-1).endSecond - segmentCues[0].startSecond,
    first.segments[0].estimatedSeconds);
  const wrapped = clientResult(); wrapped.candidate.voiceover.segments[0].spokenText = `${'a'.repeat(21)} ${'b'.repeat(21)}`;
  wrapped.candidate.voiceover.segments[0].proposedFactIds = [];
  wrapped.candidate.voiceover.segments[1].spokenText = Array(30).fill('Wort').join(' ');
  wrapped.candidate.voiceover.segments[1].proposedFactIds = [];
  assert.equal(directDerivation(input(), wrapped).derived.subtitles[0].lines.length, 2);
  const longToken = structuredClone(wrapped); longToken.candidate.voiceover.segments[0].spokenText = 'x'.repeat(43);
  assert.throws(() => directDerivation(input(), longToken));
});

test('strict final-package validator rejects independent structural and derived drift', async () => {
  const value = input(); const result = clientResult(); const valid = await run(value, result);
  const context = { input: validateVideoPackageInput(value),
    clientResult: validateVideoPackageClientResult(result),
    effectiveFacts: deriveEffectiveVideoFacts(validateVideoPackageInput(value)) };
  assert.doesNotThrow(() => validateFinalVideoPackage(valid.output, context));
  const mutations = [
    (v) => { v.extra = true; }, (v) => { v.summary.extra = true; },
    (v) => { v.packageId = '0'.repeat(64); }, (v) => { v.voiceover.fullScript += ' drift'; },
    (v) => { v.narrationPackage.narrationText += ' drift'; },
    (v) => { v.narrationPackage.subtitleLines[0].lines[0] = 'drift'; },
    (v) => { v.narrationPackage.subtitleLines[0].endSecond += 0.1; },
    (v) => { v.safety.unsupportedClaimScanPassed = false; },
    (v) => { v.safety.claimsUsed = []; }, (v) => { v.scenes[0].durationSeconds += 1; },
    (v) => { v.scenes[0].requiredAssetIds = ['product-back']; },
    (v) => { v.provenance.generatedAt = 'not-a-timestamp'; },
    (v) => { v.packageReviewStatus = 'approved'; }
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(valid.output); mutate(changed);
    assert.throws(() => validateFinalVideoPackage(changed, context));
  }
});

function beforeAfterFixture() {
  const value = input();
  value.approvedProductFacts = [fact('base-lightweight-hand-knotted-lace')];
  value.reviewedPlannerResult.result.plan.audience = {
    gender: 'women', primaryConcern: 'visible-thinning-crown', awarenessLevel: 'problem-aware'
  };
  value.reviewedPlannerResult.result.plan.strategy = {
    primaryProblem: 'visible-thinning-crown', purchaseTrigger: 'naturally-fuller-looking-hair',
    contentFocus: 'fuller-looking-crown', contentAngle: 'before-after',
    emotionalGoal: 'confidence', desiredAction: 'visit-shop'
  };
  value.reviewedPlannerResult.result.plan.production = {
    recommendedVideoStyle: 'before-after', recommendedHookStrategy: 'visual-transformation',
    targetDurationSeconds: 20, visualProofRequired: true,
    suggestedScenes: ['crown-before-view', 'crown-after-view']
  };
  value.reviewedPlannerResult.result.plan.brandSafety.approvedFacts =
    [fact('base-lightweight-hand-knotted-lace')];
  value.videoControls.targetDurationSeconds = 20;
  value.videoControls.desiredAction = 'visit-shop';
  value.videoControls.realBeforeAfterEvidenceAvailable = true;
  value.availableAssetIds = ['crown-before-view', 'crown-after-view'];
  const result = clientResult();
  result.candidate.hook = {
    spokenHook: 'Ein ruhiger Blick auf das Ergebnis', onScreenHook: 'Vorher und nachher'
  };
  result.candidate.voiceover.segments = [
    { sourceScene: 'crown-before-view', spokenText: Array(10).fill('Wort').join(' '), proposedFactIds: [] },
    { sourceScene: 'crown-after-view', spokenText: Array(11).fill('Wort').join(' '), proposedFactIds: [] }
  ];
  result.candidate.scenes = [
    { sourceSuggestedScene: 'crown-before-view', durationSeconds: 10,
      cameraFraming: 'close-up', visualAction: 'Den echten Ausgangszustand ruhig zeigen.',
      requiredAssetIds: ['crown-before-view'], onScreenTextKeys: [],
      productionNotes: 'Gleiches Licht verwenden.', visualProofRole: 'before-evidence', transitionType: 'cut' },
    { sourceSuggestedScene: 'crown-after-view', durationSeconds: 10,
      cameraFraming: 'close-up', visualAction: 'Das echte Ergebnis ruhig zeigen.',
      requiredAssetIds: ['crown-after-view'], onScreenTextKeys: [],
      productionNotes: 'Gleiche Perspektive verwenden.', visualProofRole: 'after-evidence', transitionType: 'match-cut' }
  ];
  result.candidate.onScreenText = [];
  result.candidate.cover = { coverTitle: 'Ein ruhiger Vergleich',
    selectedCoverScene: 'crown-after-view', requiredAssetIds: ['crown-after-view'] };
  result.candidate.caption = { text: 'Ein transparenter Blick auf beide Aufnahmen.',
    callToAction: 'Mehr erfahren', proposedFactIds: [] };
  result.candidate.assetUsageProposal = [
    { assetId: 'crown-before-view', sourceScenes: ['crown-before-view'], productionInstruction: 'Originalaufnahme verwenden.' },
    { assetId: 'crown-after-view', sourceScenes: ['crown-after-view'], productionInstruction: 'Originalaufnahme verwenden.' }
  ];
  return { value, result };
}

test('before-after evidence, assets, complete pairs, and proof roles fail at their intended boundaries', () => {
  const valid = beforeAfterFixture();
  assert.doesNotThrow(() => directDerivation(valid.value, valid.result));
  for (const [mutate, code] of [
    [(v) => { v.videoControls.realBeforeAfterEvidenceAvailable = false; }, 'source_plan_mismatch'],
    [(v) => { v.reviewedPlannerResult.result.plan.production.visualProofRequired = false; }, 'source_plan_mismatch'],
    [(v) => { v.availableAssetIds = ['crown-after-view']; }, 'asset_mismatch'],
    [(v) => { v.availableAssetIds = ['crown-before-view']; }, 'asset_mismatch'],
    [(v) => { v.reviewedPlannerResult.result.plan.production.suggestedScenes[1] = 'finished-natural-look'; }, 'source_plan_mismatch']
  ]) {
    const fixture = beforeAfterFixture(); mutate(fixture.value);
    assert.throws(() => validateVideoPackageInput(fixture.value),
      (error) => error instanceof VideoPackageLocalValidationFailure && error.code === code);
  }
  const wrongRole = beforeAfterFixture(); wrongRole.result.candidate.scenes[0].visualProofRole = 'product-detail';
  assert.throws(() => directDerivation(wrongRole.value, wrongRole.result),
    (error) => error instanceof VideoPackageLocalValidationFailure && error.code === 'scene_mismatch');
});

test('provider diagnostics cover every frozen category without raw provider state', async () => {
  const baseRequest = { audience: plannerResult().plan.audience, strategy: plannerResult().plan.strategy,
    production: plannerResult().plan.production, approvedProductFacts: input().approvedProductFacts,
    brandPolicy: input().brandPolicy, videoControls: input().videoControls,
    availableAssetIds: input().availableAssetIds,
    prompt: contracts.VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE };
  const configuration = new OpenAiResponsesVideoPackageGenerationClient(config(),
    { resolve: () => undefined }, sdkFactory(async () => response()));
  await assert.rejects(() => configuration.generatePackageCandidate(baseRequest),
    (error) => error.category === 'configuration' && error.requestAttempted === false);
  const notFound = syntheticSdkError(OpenAI.NotFoundError, { status: 404, message: 'model unavailable' });
  const modelClient = new OpenAiResponsesVideoPackageGenerationClient(config(),
    new StaticPromptCatalog(), sdkFactory(async () => { throw notFound; }));
  await assert.rejects(() => modelClient.generatePackageCandidate(baseRequest),
    (error) => error.category === 'model_unavailable');
  for (const [providerResponse, category] of [
    [response({ status: 'queued' }), 'response_incomplete'],
    [response({ output: [{ type: 'message', content: [{ type: 'refusal' }] }] }), 'response_refused'],
    [response({ output_parsed: { invalid: true } }), 'response_invalid']
  ]) {
    const client = new OpenAiResponsesVideoPackageGenerationClient(config(),
      new StaticPromptCatalog(), sdkFactory(async () => providerResponse));
    await assert.rejects(() => client.generatePackageCandidate(baseRequest),
      (error) => error.category === category);
  }
});

test('package identity excludes both safe diagnostics and injected clock time', async () => {
  const value = input(); const result = clientResult();
  const handler = (time, responseId) => createVoluviaVideoPackageOperation({
    generatePackageCandidate: async () => {
      const copy = structuredClone(result); copy.diagnostics.responseId = responseId; return copy;
    }
  }, { now: () => new Date(time) });
  const invoke = (operation) => operation({ executionId: 'x', workflowId: 'x', workflowVersion: 1,
    stepId: 'x', workflowInput: value, stepInput: value });
  const first = await invoke(handler('2026-08-06T00:00:00Z', 'safe-one'));
  const second = await invoke(handler('2026-08-07T00:00:00Z', 'safe-two'));
  assert.notEqual(first.provenance.generatedAt, second.provenance.generatedAt);
  assert.equal(first.packageId, second.packageId);
});

function syntheticSdkError(Type, fields = {}) { const value = Object.create(Type.prototype); Object.assign(value, fields); return value; }
test('OpenAI adapter maps closed provider diagnostics and rejects incomplete/refused/invalid responses', async () => {
  const cases = [
    [syntheticSdkError(OpenAI.AuthenticationError, { status: 401 }), 'authentication'],
    [syntheticSdkError(OpenAI.PermissionDeniedError, { status: 403 }), 'permission_denied'],
    [syntheticSdkError(OpenAI.RateLimitError, { status: 429 }), 'rate_limit'],
    [syntheticSdkError(OpenAI.APIConnectionTimeoutError), 'timeout'],
    [syntheticSdkError(OpenAI.APIConnectionError), 'network'],
    [syntheticSdkError(OpenAI.BadRequestError, { status: 400 }), 'invalid_request'],
    [syntheticSdkError(OpenAI.InternalServerError, { status: 500 }), 'provider_server'],
    [{ secret: 'must-not-escape' }, 'unknown']
  ];
  for (const [error, category] of cases) {
    const client = new OpenAiResponsesVideoPackageGenerationClient(config(), new StaticPromptCatalog(), sdkFactory(async () => { throw error; }));
    await assert.rejects(() => client.generatePackageCandidate({ ...input(), prompt: contracts.VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE }), (failure) => failure instanceof OpenAiVideoPackageDiagnosticFailure && failure.category === category && !JSON.stringify(failure).includes('must-not-escape'));
  }
  for (const value of [response({ status: 'queued' }), response({ output: [{ type: 'message', content: [{ type: 'refusal' }] }] }), response({ output_parsed: { bad: true } })]) {
    const client = new OpenAiResponsesVideoPackageGenerationClient(config(), new StaticPromptCatalog(), sdkFactory(async () => value));
    await assert.rejects(() => client.generatePackageCandidate({ ...input(), prompt: contracts.VOLUVIA_VIDEO_PACKAGE_PROMPT_REFERENCE }));
  }
});

test('operation observer exposes only closed provider and local failure diagnostics', async () => {
  const providerCategories = [
    'configuration', 'authentication', 'permission_denied', 'rate_limit', 'invalid_request',
    'model_unavailable', 'timeout', 'network', 'provider_server', 'response_incomplete',
    'response_refused', 'response_invalid', 'unknown'
  ];
  for (const category of providerCategories) {
    let observed;
    const handler = createVoluviaVideoPackageOperation({
      generatePackageCandidate: async () => {
        throw new VideoPackageProviderFailure(category, category !== 'configuration');
      }
    }, { now: () => new Date(0) }, (value) => { observed = value; });
    await assert.rejects(() => handler({ executionId: 'x', workflowId: 'x', workflowVersion: 1,
      stepId: 'x', workflowInput: input(), stepInput: input() }),
    /AI video package generation failed/);
    assert.deepEqual(observed, {
      diagnosticCategory: category === 'configuration' ? 'configuration' : 'provider',
      providerDiagnosticCategory: category,
      requestAttempted: category !== 'configuration'
    });
    assert.equal(JSON.stringify(observed).includes('message'), false);
    assert.equal(JSON.stringify(observed).includes('candidate'), false);
  }

  const localCodes = [
    'invalid_input', 'invalid_review_state', 'source_plan_mismatch',
    'prompt_identity_mismatch', 'prompt_hash_mismatch', 'strategy_mismatch',
    'scene_mismatch', 'asset_mismatch', 'duration_invalid', 'unsupported_claim',
    'commerce_control_violation', 'unsafe_json', 'unknown_field', 'local_validation'
  ];
  for (const code of localCodes) {
    let observed;
    const handler = createVoluviaVideoPackageOperation({
      generatePackageCandidate: async () => { throw new VideoPackageLocalValidationFailure(code); }
    }, { now: () => new Date(0) }, (value) => { observed = value; });
    await assert.rejects(() => handler({ executionId: 'x', workflowId: 'x', workflowVersion: 1,
      stepId: 'x', workflowInput: input(), stepInput: input() }),
    /AI video package generation failed/);
    assert.deepEqual(observed, { diagnosticCategory: 'local_validation',
      localValidationCode: code, requestAttempted: true });
  }
});

test('diagnostic observer failure cannot change operation or workflow failure semantics', async () => {
  const success = await run(input(), clientResult(), () => { throw new Error('observer secret'); });
  assert.equal(success.output.packageReviewStatus, 'pending_manual_review');
  const handler = createVoluviaVideoPackageOperation({
    generatePackageCandidate: async () => { throw new VideoPackageProviderFailure('rate_limit', true); }
  }, { now: () => new Date(0) }, () => { throw new Error('observer secret'); });
  await assert.rejects(() => handler({ executionId: 'x', workflowId: 'x', workflowVersion: 1,
    stepId: 'x', workflowInput: input(), stepInput: input() }),
  (error) => error.message === 'AI video package generation failed.' &&
      !JSON.stringify(error).includes('observer secret'));
});

test('unsupported-claim diagnostics expose only closed reason and location', async () => {
  async function observeCandidate(mutate) {
    const result = clientResult(); mutate(result.candidate); let observed;
    const handler = createVoluviaVideoPackageOperation({
      generatePackageCandidate: async () => result
    }, { now: () => new Date(0) }, (value) => { observed = value; });
    await assert.rejects(() => handler({ executionId: 'x', workflowId: 'x', workflowVersion: 1,
      stepId: 'x', workflowInput: input(), stepInput: input() }),
    (error) => error.message === 'AI video package generation failed.');
    return observed;
  }
  const cases = [
    [(c) => { c.voiceover.segments[0].proposedFactIds = []; },
      'fact_attribution_missing', 'voiceover_segment'],
    [(c) => { c.voiceover.segments[0].proposedFactIds = ['clip-count-3']; },
      'fact_attribution_mismatch', 'voiceover_segment'],
    [(c) => { c.hook.spokenHook = 'Klinisch getestet?'; },
      'prohibited_clinical_claim', 'spoken_hook'],
    [(c) => { c.cover.coverTitle = 'Mitleid ist kein Konzept'; },
      'prohibited_pity', 'cover_title'],
    [(c) => { c.scenes[0].visualAction = 'Besser als eine Vollperücke'; },
      'full_wig_degradation', 'scene_visual_action'],
    [(c) => { c.caption.callToAction = 'Jede Frau braucht das'; },
      'universal_need_claim', 'cta'],
    [(c) => { c.assetUsageProposal[0].productionInstruction = 'Lieferzeit nennen'; },
      'delivery_claim', 'asset_production_instruction']
  ];
  for (const [mutate, reason, location] of cases) {
    const observed = await observeCandidate(mutate);
    assert.deepEqual(observed, { diagnosticCategory: 'local_validation',
      localValidationCode: 'unsupported_claim', requestAttempted: true,
      unsupportedClaimReason: reason, textLocation: location });
    const serialized = JSON.stringify(observed);
    assert.equal(serialized.includes('Klinisch'), false);
    assert.equal(serialized.includes('Vollperücke'), false);
    assert.equal(serialized.includes('Lieferzeit'), false);
  }
});

test('forged or unrelated unsupported-claim context is discarded', async () => {
  for (const failure of [
    new VideoPackageLocalValidationFailure('unsupported_claim', 'forged-reason', 'forged-location'),
    new VideoPackageLocalValidationFailure('scene_mismatch', 'prohibited_pity', 'caption')
  ]) {
    let observed;
    const handler = createVoluviaVideoPackageOperation({
      generatePackageCandidate: async () => { throw failure; }
    }, { now: () => new Date(0) }, (value) => { observed = value; });
    await assert.rejects(() => handler({ executionId: 'x', workflowId: 'x', workflowVersion: 1,
      stepId: 'x', workflowInput: input(), stepInput: input() }));
    assert.equal('unsupportedClaimReason' in observed, false);
    assert.equal('textLocation' in observed, false);
    assert.equal(JSON.stringify(observed).includes('forged'), false);
  }
});

test('duration-invalid diagnostics map every reachable timing boundary to a closed reason', () => {
  function expectReason(value, result, reason) {
    assert.throws(() => directDerivation(value, result),
      (error) => error instanceof VideoPackageLocalValidationFailure &&
        error.code === 'duration_invalid' && error.durationInvalidReason === reason);
  }

  const sceneCount = clientResult(); sceneCount.candidate.scenes.push(structuredClone(sceneCount.candidate.scenes[1]));
  expectReason(input(), sceneCount, 'invalid_scene_count');

  for (const [duration, reason] of [
    [3.5, 'scene_duration_not_integer'],
    [2, 'scene_duration_below_minimum'],
    [26, 'scene_duration_above_maximum']
  ]) {
    const result = clientResult(); result.candidate.scenes[0].durationSeconds = duration;
    expectReason(input(), result, reason);
  }

  const sum = clientResult(); sum.candidate.scenes[0].durationSeconds = 14;
  expectReason(input(), sum, 'scene_duration_sum_mismatch');

  const segmentCount = clientResult(); segmentCount.candidate.voiceover.segments.pop();
  expectReason(input(), segmentCount, 'segment_count_mismatch');

  const segmentScene = clientResult(); segmentScene.candidate.voiceover.segments[0].sourceScene = 'lace-base-close-up';
  expectReason(input(), segmentScene, 'segment_scene_mismatch');

  const segmentFit = clientResult();
  segmentFit.candidate.voiceover.segments[0].spokenText = Array(34).fill('Wort').join(' ');
  segmentFit.candidate.voiceover.segments[0].proposedFactIds = [];
  expectReason(input(), segmentFit, 'segment_duration_exceeds_scene');

  for (const [mode, target, estimate, reason] of [
    ['product-only', 30, 14, 'narration_below_occupancy'],
    ['product-only', 30, 28, 'narration_above_occupancy'],
    ['presenter-plus-product', 30, 19, 'narration_below_occupancy']
  ]) {
    const fixture = durationFixture(target, mode, estimate);
    expectReason(fixture.value, fixture.result, reason);
  }

  const longSubtitle = clientResult();
  longSubtitle.candidate.voiceover.segments[0].spokenText = 'x'.repeat(43);
  longSubtitle.candidate.voiceover.segments[0].proposedFactIds = [];
  expectReason(input(), longSubtitle, 'subtitle_line_too_long');

  const zeroOnScreen = clientResult(); zeroOnScreen.candidate.onScreenText[0].endOffsetSecond = 0;
  expectReason(input(), zeroOnScreen, 'onscreen_text_timing_invalid');
  const reversedOnScreen = clientResult(); reversedOnScreen.candidate.onScreenText[0].startOffsetSecond = 5;
  expectReason(input(), reversedOnScreen, 'onscreen_text_duration_invalid');
  const outsideOnScreen = clientResult(); outsideOnScreen.candidate.onScreenText[0].endOffsetSecond = 16;
  expectReason(input(), outsideOnScreen, 'onscreen_text_timing_invalid');
});

test('subtitle wrapping accepts 42 code points and rejects 43 without exposing text', async () => {
  const accepted = clientResult();
  accepted.candidate.voiceover.segments[0].spokenText = 'ä'.repeat(42);
  accepted.candidate.voiceover.segments[0].proposedFactIds = [];
  accepted.candidate.voiceover.segments[1].spokenText = Array(33).fill('Wort').join(' ');
  accepted.candidate.voiceover.segments[1].proposedFactIds = [];
  assert.equal([...directDerivation(input(), accepted).derived.subtitles[0].lines[0]].length, 42);

  const rejected = structuredClone(accepted); rejected.candidate.voiceover.segments[0].spokenText = 'ä'.repeat(43);
  let observed;
  const handler = createVoluviaVideoPackageOperation({ generatePackageCandidate: async () => rejected },
    { now: () => new Date(0) }, (value) => { observed = value; });
  await assert.rejects(() => handler({ executionId: 'x', workflowId: 'x', workflowVersion: 1,
    stepId: 'x', workflowInput: input(), stepInput: input() }), /AI video package generation failed/);
  assert.deepEqual(observed, { diagnosticCategory: 'local_validation',
    localValidationCode: 'duration_invalid', requestAttempted: true,
    durationInvalidReason: 'subtitle_line_too_long' });
  assert.equal(JSON.stringify(observed).includes('ä'), false);
});

test('duration diagnostics expose only validated reasons and safe integer context', async () => {
  const validFailure = new VideoPackageLocalValidationFailure('duration_invalid', undefined, undefined,
    'narration_below_occupancy', {
      targetDurationSeconds: 30, estimatedSpokenSeconds: 14,
      minimumAllowedSeconds: 15, maximumAllowedSeconds: 27, sceneCount: 2
    });
  const forgedFailure = new VideoPackageLocalValidationFailure('duration_invalid', undefined, undefined,
    'forged-duration-reason', {
      targetDurationSeconds: -1, estimatedSpokenSeconds: Number.NaN,
      minimumAllowedSeconds: 1.5, maximumAllowedSeconds: Number.POSITIVE_INFINITY,
      sceneCount: 2
    });
  const unrelatedFailure = new VideoPackageLocalValidationFailure('scene_mismatch', undefined, undefined,
    'narration_below_occupancy', { targetDurationSeconds: 30, sceneCount: 2 });

  for (const [failure, expected] of [
    [validFailure, { diagnosticCategory: 'local_validation', localValidationCode: 'duration_invalid',
      requestAttempted: true, durationInvalidReason: 'narration_below_occupancy',
      targetDurationSeconds: 30, estimatedSpokenSeconds: 14,
      minimumAllowedSeconds: 15, maximumAllowedSeconds: 27, sceneCount: 2 }],
    [forgedFailure, { diagnosticCategory: 'local_validation', localValidationCode: 'duration_invalid',
      requestAttempted: true, sceneCount: 2 }],
    [unrelatedFailure, { diagnosticCategory: 'local_validation', localValidationCode: 'scene_mismatch',
      requestAttempted: true }]
  ]) {
    let observed;
    const handler = createVoluviaVideoPackageOperation({ generatePackageCandidate: async () => { throw failure; } },
      { now: () => new Date(0) }, (value) => { observed = value; });
    await assert.rejects(() => handler({ executionId: 'x', workflowId: 'x', workflowVersion: 1,
      stepId: 'x', workflowInput: input(), stepInput: input() }));
    assert.deepEqual(observed, expected);
    const serialized = JSON.stringify(observed);
    assert.equal(serialized.includes('forged-duration-reason'), false);
    assert.equal(serialized.includes('spokenText'), false);
    assert.equal(serialized.includes('candidate'), false);
  }
});

module.exports = { input, clientResult };
