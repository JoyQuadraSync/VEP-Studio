import { HookStrategy, SuggestedScene, VideoStyle } from '../planner/voluvia-content-planner-contracts';
import { VideoCameraFraming, VideoPresenterMode, VideoTextStyleRole, VideoTransitionType, VideoVisualProofRole, VoluviaVideoAssetId } from './voluvia-video-package-contracts';

const frozen = <T extends string>(values: readonly T[]): readonly T[] => Object.freeze([...values]);
export const VOLUVIA_VIDEO_HASHTAG_ALLOWLIST = frozen([
  '#voluvia', '#haartopper', '#echthaar', '#remyechthaar', '#hairtopper',
  '#lacehairtopper', '#haarvolumen'
]);
export const VIDEO_SCENE_ASSETS: Readonly<Record<SuggestedScene, readonly VoluviaVideoAssetId[]>> = Object.freeze({
  'product-close-up': frozen(['product-front']), 'lace-base-close-up': frozen(['lace-base-close-up']),
  'clip-demonstration': frozen(['clip-close-up']), 'parting-before-view': frozen(['parting-before-view']),
  'parting-after-view': frozen(['parting-after-view']), 'crown-before-view': frozen(['crown-before-view']),
  'crown-after-view': frozen(['crown-after-view']), 'mirror-application': frozen(['mirror-application']),
  'color-comparison': frozen(['color-comparison']), 'human-hair-styling': frozen(['human-hair-styling']),
  'finished-natural-look': frozen(['finished-natural-look']), 'package-and-product': frozen(['package-and-product'])
});
export const VIDEO_SCENE_FRAMINGS: Readonly<Record<SuggestedScene, readonly VideoCameraFraming[]>> = Object.freeze({
  'product-close-up': frozen(['macro', 'close-up', 'product-tabletop']), 'lace-base-close-up': frozen(['macro', 'close-up']),
  'clip-demonstration': frozen(['macro', 'close-up']), 'parting-before-view': frozen(['close-up', 'mirror']),
  'parting-after-view': frozen(['close-up', 'mirror']), 'crown-before-view': frozen(['close-up', 'mirror']),
  'crown-after-view': frozen(['close-up', 'mirror']), 'mirror-application': frozen(['medium', 'mirror']),
  'color-comparison': frozen(['close-up', 'product-tabletop']), 'human-hair-styling': frozen(['close-up', 'medium', 'mirror']),
  'finished-natural-look': frozen(['close-up', 'medium', 'mirror']), 'package-and-product': frozen(['overhead', 'product-tabletop'])
});
export const VIDEO_SCENE_TEXT_ROLES: Readonly<Record<SuggestedScene, readonly VideoTextStyleRole[]>> = Object.freeze(Object.fromEntries([
  'product-close-up','lace-base-close-up','clip-demonstration','parting-before-view','parting-after-view','crown-before-view','crown-after-view','mirror-application','color-comparison','human-hair-styling','finished-natural-look','package-and-product'
].map((scene) => [scene, frozen(['hook', 'product-fact', 'educational-label', 'CTA', 'disclaimer'])])) as Record<SuggestedScene, readonly VideoTextStyleRole[]>);
export const VIDEO_STYLE_TRANSITIONS: Readonly<Record<VideoStyle, readonly VideoTransitionType[]>> = Object.freeze(Object.fromEntries([
  'before-after','hands-on-demo','mirror-demo','educational-explainer','morning-routine','close-up-product-demo','styling-demo','product-only'
].map((style) => [style, frozen(['cut', 'match-cut', 'fade', 'none'])])) as Record<VideoStyle, readonly VideoTransitionType[]>);
export const PRESENTER_ASSETS: Readonly<Record<VideoPresenterMode, readonly VoluviaVideoAssetId[]>> = Object.freeze({ 'product-only': frozen([]), 'presenter-plus-product': frozen(['presenter-avatar', 'presenter-voice']) });
export const VISUAL_PROOF_ASSETS: Readonly<Partial<Record<VideoVisualProofRole, readonly VoluviaVideoAssetId[]>>> = Object.freeze({ 'before-evidence': frozen(['crown-before-view', 'parting-before-view']), 'after-evidence': frozen(['crown-after-view', 'parting-after-view']) });
export const VIDEO_SCENE_DURATION = Object.freeze({ minimumSeconds: 3, maximumSeconds: 25 });
export const HOOK_COPY_CONSTRAINTS: Readonly<Record<HookStrategy, readonly string[]>> = Object.freeze({
  'product-discovery': frozen(['introduce-product']),
  'visual-transformation': frozen(['visual-first']),
  'common-question': frozen(['question-form']),
  misconception: frozen(['correct-misconception']),
  'problem-recognition': frozen(['respectful-concern']),
  'product-demonstration': frozen(['demonstrate-product']),
  'naturalness-proof': frozen(['approved-visual-proof']),
  'simple-how-to': frozen(['explain-steps'])
});
export const VIDEO_COMPATIBILITY_TABLES = Object.freeze({
  sceneAssets: VIDEO_SCENE_ASSETS,
  sceneFramings: VIDEO_SCENE_FRAMINGS,
  sceneTextRoles: VIDEO_SCENE_TEXT_ROLES,
  styleTransitions: VIDEO_STYLE_TRANSITIONS,
  presenterAssets: PRESENTER_ASSETS,
  visualProofAssets: VISUAL_PROOF_ASSETS,
  sceneDuration: VIDEO_SCENE_DURATION,
  hookCopyConstraints: HOOK_COPY_CONSTRAINTS
});
export const VIDEO_COMPATIBILITY_PROMPT_MARKER = JSON.stringify(VIDEO_COMPATIBILITY_TABLES);
