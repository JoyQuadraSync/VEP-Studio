function formatPlannerLiveFailure({
  providerCalls,
  safeDiagnostic,
  localValidationDiagnostic,
  operationId,
  configuredModel
}) {
  const concerns = new Set([
    'visible-thinning-crown', 'wide-hair-parting', 'lack-of-volume',
    'naturalness-uncertainty', 'hair-topper-unawareness', 'fake-appearance-concern',
    'application-complexity', 'small-grey-area-coverage', 'color-selection'
  ]);
  const triggers = new Set([
    'naturally-fuller-looking-hair', 'less-visible-wide-parting',
    'discreet-natural-appearance', 'alternative-to-full-wig',
    'easy-daily-application', 'greater-social-confidence',
    'cover-small-grey-areas', 'find-suitable-color'
  ]);
  const focuses = new Set([
    'what-is-a-hair-topper', 'natural-appearance', 'lightweight-construction',
    'easy-application', 'human-hair-styling', 'fuller-looking-crown',
    'visible-parting-coverage', 'small-grey-area-coverage', 'available-colors',
    'german-shipping'
  ]);
  const scenes = new Set([
    'product-close-up', 'lace-base-close-up', 'clip-demonstration',
    'package-and-product', 'mirror-application', 'finished-natural-look',
    'parting-before-view', 'parting-after-view', 'crown-before-view',
    'crown-after-view', 'human-hair-styling', 'color-comparison'
  ]);
  const isConcernTriggerDiagnostic =
    localValidationDiagnostic?.code === 'concern_trigger_incompatible' &&
    concerns.has(localValidationDiagnostic.context?.selectedConcern) &&
    triggers.has(localValidationDiagnostic.context?.selectedPurchaseTrigger);
  const selectedScenes = localValidationDiagnostic?.context?.selectedScenes;
  const isFocusSceneDiagnostic =
    localValidationDiagnostic?.code === 'focus_scene_incompatible' &&
    focuses.has(localValidationDiagnostic.context?.selectedFocus) &&
    Array.isArray(selectedScenes) && selectedScenes.length <= 5 &&
    selectedScenes.every((scene) => scenes.has(scene));
  return JSON.stringify({
    success: false,
    diagnosticCategory: localValidationDiagnostic === undefined
      ? (safeDiagnostic?.category ?? (providerCalls === 0 ? 'configuration' : 'local_validation'))
      : 'local_validation',
    ...(localValidationDiagnostic === undefined
      ? {}
      : { localValidationCode: localValidationDiagnostic.code }),
    ...(isConcernTriggerDiagnostic ? {
      selectedConcern: localValidationDiagnostic.context.selectedConcern,
      selectedPurchaseTrigger: localValidationDiagnostic.context.selectedPurchaseTrigger
    } : {}),
    ...(isFocusSceneDiagnostic ? {
      selectedFocus: localValidationDiagnostic.context.selectedFocus,
      selectedScenes: [...selectedScenes]
    } : {}),
    operationId,
    requestAttempted: providerCalls === 1,
    configuredModel,
    ...(safeDiagnostic?.status === undefined ? {} : { status: safeDiagnostic.status }),
    ...(safeDiagnostic?.requestId === undefined ? {} : { requestId: safeDiagnostic.requestId })
  });
}

module.exports = { formatPlannerLiveFailure };
