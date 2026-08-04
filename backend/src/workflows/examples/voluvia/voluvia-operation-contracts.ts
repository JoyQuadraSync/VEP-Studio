export interface VoluviaShowcaseControls {
  readonly editorialApproved: boolean;
  readonly finalApproved: boolean;
}

export interface VoluviaRawProduct {
  readonly title: string;
  readonly description: string;
  readonly color: string;
  readonly length: string;
  readonly price: {
    readonly amount: number;
    readonly currency: string;
  };
  readonly audience: string;
}

export interface VoluviaNormalizedProduct extends VoluviaRawProduct {
  readonly productKey: string;
}

export interface VoluviaShowcaseInput {
  readonly product: VoluviaRawProduct;
  readonly showcaseControls: VoluviaShowcaseControls;
}

export interface VoluviaTikTokScript {
  readonly hook: string;
  readonly body: string;
  readonly cta: string;
  readonly source: 'deterministic_showcase_template';
}

export interface NormalizedProductEnvelope {
  readonly product: VoluviaNormalizedProduct;
  readonly showcaseControls: VoluviaShowcaseControls;
}

export interface ScriptEnvelope extends NormalizedProductEnvelope {
  readonly script: VoluviaTikTokScript;
}

export interface EditorialApprovedEnvelope extends ScriptEnvelope {
  readonly editorialReview: {
    readonly approved: true;
    readonly reviewNote: 'Mock approval for showcase';
    readonly reviewType: 'editorial_mock';
  };
}

export interface EditorialRejectedEnvelope extends ScriptEnvelope {
  readonly editorialReview: {
    readonly approved: false;
    readonly reviewNote: 'Mock editorial rejection for showcase';
    readonly reviewType: 'editorial_mock';
  };
  readonly disposition: 'rejected';
  readonly rejectionStage: 'editorial';
}

export interface VoluviaShowcaseAssetBase {
  readonly assetId: string;
  readonly assetKind: 'video' | 'subtitles' | 'hashtags' | 'cover_metadata';
}

export interface VoluviaMockVideoAsset extends VoluviaShowcaseAssetBase {
  readonly assetKind: 'video';
  readonly mediaId: string;
  readonly uri: string;
  readonly rendered: false;
  readonly provider: 'deterministic_mock';
}

export interface VoluviaSubtitleAsset extends VoluviaShowcaseAssetBase {
  readonly assetKind: 'subtitles';
  readonly format: 'srt';
  readonly language: 'en';
  readonly content: string;
}

export interface VoluviaHashtagAsset extends VoluviaShowcaseAssetBase {
  readonly assetKind: 'hashtags';
  readonly hashtags: readonly string[];
}

export interface VoluviaCoverMetadataAsset extends VoluviaShowcaseAssetBase {
  readonly assetKind: 'cover_metadata';
  readonly headline: string;
  readonly productKey: string;
  readonly backgroundColor: string;
  readonly layout: 'showcase_portrait_v1';
}

export type VoluviaShowcaseAsset =
  | VoluviaMockVideoAsset
  | VoluviaSubtitleAsset
  | VoluviaHashtagAsset
  | VoluviaCoverMetadataAsset;

export interface VoluviaBranchOutput<
  TAsset extends VoluviaShowcaseAsset = VoluviaShowcaseAsset
> {
  readonly context: EditorialApprovedEnvelope;
  readonly asset: TAsset;
}

export interface VoluviaPublishingPackage {
  readonly status: 'mock_package_ready_for_review';
  readonly productKey: string;
  readonly caption: {
    readonly hook: string;
    readonly body: string;
    readonly cta: string;
  };
  readonly assets: {
    readonly video: VoluviaMockVideoAsset;
    readonly subtitles: VoluviaSubtitleAsset;
    readonly hashtags: VoluviaHashtagAsset;
    readonly cover: VoluviaCoverMetadataAsset;
  };
  readonly target: {
    readonly platform: 'tiktok';
    readonly mode: 'showcase_only';
  };
  readonly publishable: false;
}

export interface PublishingPackageEnvelope extends EditorialApprovedEnvelope {
  readonly publishingPackage: VoluviaPublishingPackage;
}

export interface ReadyEnvelope extends PublishingPackageEnvelope {
  readonly finalReview: {
    readonly approved: true;
    readonly reviewNote: 'Mock final approval for showcase';
    readonly reviewType: 'final_mock';
  };
  readonly disposition: 'ready';
}

export interface FinalRejectedEnvelope extends PublishingPackageEnvelope {
  readonly finalReview: {
    readonly approved: false;
    readonly reviewNote: 'Mock final rejection for showcase';
    readonly reviewType: 'final_mock';
  };
  readonly disposition: 'rejected';
  readonly rejectionStage: 'final';
}

export const VOLUVIA_OPERATION_IDS = {
  normalizeProduct: 'voluvia.product.normalize',
  generateScript: 'voluvia.script.generate',
  editorialReview: 'voluvia.review.editorial.mock',
  generateVideo: 'voluvia.video.generate.mock',
  generateSubtitles: 'voluvia.subtitles.generate.mock',
  generateHashtags: 'voluvia.hashtags.generate',
  generateCoverMetadata: 'voluvia.cover.metadata.generate',
  buildPackage: 'voluvia.package.build',
  finalReview: 'voluvia.review.final.mock'
} as const;
