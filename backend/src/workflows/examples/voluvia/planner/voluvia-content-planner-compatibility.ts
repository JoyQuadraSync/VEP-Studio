import {
  ApprovedProductFactId,
  AudienceConcern,
  ContentAngle,
  ContentFocus,
  DesiredAction,
  HookStrategy,
  PurchaseTrigger,
  SuggestedScene,
  VideoStyle,
  CONTENT_ANGLES
} from './voluvia-content-planner-contracts';

const frozen = <T extends string>(values: readonly T[]): readonly T[] => Object.freeze([...values]);

export const CONCERN_PURCHASE_TRIGGERS: Readonly<Record<AudienceConcern, readonly PurchaseTrigger[]>> = Object.freeze({
  'visible-thinning-crown': frozen(['naturally-fuller-looking-hair', 'greater-social-confidence']),
  'wide-hair-parting': frozen(['less-visible-wide-parting', 'discreet-natural-appearance']),
  'lack-of-volume': frozen(['naturally-fuller-looking-hair', 'greater-social-confidence']),
  'naturalness-uncertainty': frozen(['discreet-natural-appearance']),
  'hair-topper-unawareness': frozen(['alternative-to-full-wig', 'naturally-fuller-looking-hair']),
  'fake-appearance-concern': frozen(['discreet-natural-appearance']),
  'application-complexity': frozen(['easy-daily-application']),
  'small-grey-area-coverage': frozen(['cover-small-grey-areas']),
  'color-selection': frozen(['find-suitable-color'])
});

export const FOCUS_STYLES: Readonly<Record<ContentFocus, readonly VideoStyle[]>> = Object.freeze({
  'what-is-a-hair-topper': frozen(['educational-explainer', 'product-only']),
  'natural-appearance': frozen(['close-up-product-demo', 'mirror-demo']),
  'lightweight-construction': frozen(['close-up-product-demo', 'educational-explainer', 'product-only']),
  'easy-application': frozen(['hands-on-demo', 'mirror-demo', 'morning-routine']),
  'human-hair-styling': frozen(['styling-demo', 'close-up-product-demo', 'morning-routine']),
  'fuller-looking-crown': frozen(['before-after', 'mirror-demo']),
  'visible-parting-coverage': frozen(['before-after', 'mirror-demo']),
  'small-grey-area-coverage': frozen(['mirror-demo', 'close-up-product-demo']),
  'available-colors': frozen(['product-only', 'close-up-product-demo']),
  'german-shipping': frozen(['product-only', 'educational-explainer'])
});

export const FOCUS_SCENES: Readonly<Record<ContentFocus, readonly SuggestedScene[]>> = Object.freeze({
  'what-is-a-hair-topper': frozen(['product-close-up', 'lace-base-close-up', 'clip-demonstration', 'package-and-product']),
  'natural-appearance': frozen(['product-close-up', 'mirror-application', 'finished-natural-look']),
  'lightweight-construction': frozen(['product-close-up', 'lace-base-close-up', 'clip-demonstration']),
  'easy-application': frozen(['product-close-up', 'clip-demonstration', 'mirror-application', 'finished-natural-look']),
  'human-hair-styling': frozen(['product-close-up', 'mirror-application', 'human-hair-styling', 'finished-natural-look']),
  'fuller-looking-crown': frozen(['crown-before-view', 'crown-after-view', 'parting-before-view', 'parting-after-view', 'mirror-application', 'finished-natural-look']),
  'visible-parting-coverage': frozen(['parting-before-view', 'parting-after-view', 'crown-before-view', 'crown-after-view', 'mirror-application', 'finished-natural-look']),
  'small-grey-area-coverage': frozen(['product-close-up', 'mirror-application', 'finished-natural-look']),
  'available-colors': frozen(['product-close-up', 'color-comparison', 'package-and-product']),
  'german-shipping': frozen(['package-and-product', 'product-close-up'])
});

export const STYLE_SCENES: Readonly<Record<VideoStyle, readonly SuggestedScene[]>> = Object.freeze({
  'before-after': frozen(['parting-before-view', 'parting-after-view', 'crown-before-view', 'crown-after-view', 'finished-natural-look']),
  'hands-on-demo': frozen(['product-close-up', 'lace-base-close-up', 'clip-demonstration', 'mirror-application', 'finished-natural-look']),
  'mirror-demo': frozen(['product-close-up', 'mirror-application', 'finished-natural-look', 'parting-before-view', 'parting-after-view', 'crown-before-view', 'crown-after-view']),
  'educational-explainer': frozen(['product-close-up', 'lace-base-close-up', 'clip-demonstration', 'package-and-product']),
  'morning-routine': frozen(['product-close-up', 'mirror-application', 'human-hair-styling', 'finished-natural-look']),
  'close-up-product-demo': frozen(['product-close-up', 'lace-base-close-up', 'clip-demonstration', 'human-hair-styling', 'finished-natural-look', 'color-comparison']),
  'styling-demo': frozen(['product-close-up', 'mirror-application', 'human-hair-styling', 'finished-natural-look']),
  'product-only': frozen(['product-close-up', 'lace-base-close-up', 'clip-demonstration', 'color-comparison', 'package-and-product'])
});

export const ANGLE_HOOK_STRATEGIES: Readonly<Record<ContentAngle, readonly HookStrategy[]>> = Object.freeze({
  education: frozen(['common-question', 'misconception', 'product-discovery']),
  'product-demonstration': frozen(['product-demonstration', 'simple-how-to', 'naturalness-proof']),
  'daily-routine': frozen(['simple-how-to', 'problem-recognition']),
  styling: frozen(['simple-how-to', 'product-demonstration']),
  'objection-handling': frozen(['misconception', 'common-question', 'naturalness-proof']),
  'product-discovery': frozen(['product-discovery', 'common-question']),
  'before-after': frozen(['visual-transformation', 'problem-recognition', 'naturalness-proof'])
});

export const DESIRED_ACTION_ANGLES: Readonly<Record<DesiredAction, readonly ContentAngle[]>> = Object.freeze({
  'learn-more': frozen(['education', 'product-discovery', 'objection-handling']),
  'view-product': frozen(CONTENT_ANGLES),
  'compare-colors': frozen(['product-discovery', 'product-demonstration']),
  'explore-how-it-works': frozen(['education', 'product-demonstration', 'daily-routine']),
  'save-for-later': frozen(CONTENT_ANGLES),
  'visit-shop': frozen(['product-discovery', 'product-demonstration', 'styling', 'before-after'])
});

export const FOCUS_REQUIRED_FACTS: Readonly<Partial<Record<ContentFocus, readonly ApprovedProductFactId[]>>> = Object.freeze({
  'natural-appearance': frozen(['material-remy-human-hair-100-percent', 'base-lightweight-hand-knotted-lace']),
  'lightweight-construction': frozen(['base-lightweight-hand-knotted-lace']),
  'easy-application': frozen(['clip-count-3']),
  'human-hair-styling': frozen(['material-remy-human-hair-100-percent']),
  'fuller-looking-crown': frozen(['base-lightweight-hand-knotted-lace']),
  'visible-parting-coverage': frozen(['base-lightweight-hand-knotted-lace']),
  'available-colors': frozen(['color-honig-blond', 'color-hell-blond', 'color-mittel-braun']),
  'german-shipping': frozen(['ships-from-germany'])
});
