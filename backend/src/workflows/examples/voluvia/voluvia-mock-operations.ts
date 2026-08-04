import { OperationHandler } from '../../runtime/operation-handler';
import {
  EditorialApprovedEnvelope,
  EditorialRejectedEnvelope,
  FinalRejectedEnvelope,
  NormalizedProductEnvelope,
  PublishingPackageEnvelope,
  ReadyEnvelope,
  ScriptEnvelope,
  VoluviaBranchOutput,
  VoluviaCoverMetadataAsset,
  VoluviaHashtagAsset,
  VoluviaMockVideoAsset,
  VoluviaNormalizedProduct,
  VoluviaPublishingPackage,
  VoluviaRawProduct,
  VoluviaShowcaseAsset,
  VoluviaShowcaseControls,
  VoluviaShowcaseInput,
  VoluviaSubtitleAsset,
  VoluviaTikTokScript
} from './voluvia-operation-contracts';

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function requiredRecord(value: unknown, name: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object.`);
  }

  return value;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string.`);
  }

  const normalized = value.trim().replace(/\s+/g, ' ');

  if (normalized.length === 0) {
    throw new Error(`${name} must not be empty.`);
  }

  return normalized;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }

  return value;
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean.`);
  }

  return value;
}

function parseControls(value: unknown): VoluviaShowcaseControls {
  const controls = requiredRecord(value, 'showcaseControls');
  return {
    editorialApproved: requiredBoolean(
      controls.editorialApproved,
      'showcaseControls.editorialApproved'
    ),
    finalApproved: requiredBoolean(
      controls.finalApproved,
      'showcaseControls.finalApproved'
    )
  };
}

function parseRawProduct(value: unknown): VoluviaRawProduct {
  const product = requiredRecord(value, 'product');
  const price = requiredRecord(product.price, 'product.price');

  if (
    typeof price.amount !== 'number' ||
    !Number.isFinite(price.amount) ||
    price.amount < 0
  ) {
    throw new Error('product.price.amount must be a finite non-negative number.');
  }

  return {
    title: requiredText(product.title, 'product.title'),
    description: requiredText(product.description, 'product.description'),
    color: requiredText(product.color, 'product.color'),
    length: requiredText(product.length, 'product.length'),
    price: {
      amount: price.amount,
      currency: requiredText(price.currency, 'product.price.currency')
    },
    audience: requiredText(product.audience, 'product.audience')
  };
}

function productKey(title: string): string {
  const key = title
    .trim()
    .replace(/[A-Z]/g, (character) => character.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (key.length === 0) {
    throw new Error('product.title must produce a non-empty ASCII product key.');
  }

  return key;
}

function parseNormalizedProduct(value: unknown): VoluviaNormalizedProduct {
  const product = requiredRecord(value, 'product');
  const parsed = parseRawProduct(product);
  const key = requiredText(product.productKey, 'product.productKey');

  if (key !== productKey(parsed.title)) {
    throw new Error('product.productKey is inconsistent with product.title.');
  }

  return { productKey: key, ...parsed };
}

function parseNormalizedEnvelope(value: unknown): NormalizedProductEnvelope {
  const envelope = requiredRecord(value, 'normalized product envelope');
  return {
    product: parseNormalizedProduct(envelope.product),
    showcaseControls: parseControls(envelope.showcaseControls)
  };
}

function parseScript(value: unknown): VoluviaTikTokScript {
  const script = requiredRecord(value, 'script');

  if (script.source !== 'deterministic_showcase_template') {
    throw new Error('script.source must identify the deterministic showcase template.');
  }

  return {
    hook: requiredText(script.hook, 'script.hook'),
    body: requiredText(script.body, 'script.body'),
    cta: requiredText(script.cta, 'script.cta'),
    source: 'deterministic_showcase_template'
  };
}

function parseScriptEnvelope(value: unknown): ScriptEnvelope {
  const envelope = requiredRecord(value, 'script envelope');
  const normalized = parseNormalizedEnvelope(envelope);
  return { ...normalized, script: parseScript(envelope.script) };
}

function parseEditorialApprovedEnvelope(value: unknown): EditorialApprovedEnvelope {
  const envelope = requiredRecord(value, 'editorial approved envelope');
  const scriptEnvelope = parseScriptEnvelope(envelope);
  const review = requiredRecord(envelope.editorialReview, 'editorialReview');

  if (
    review.approved !== true ||
    review.reviewNote !== 'Mock approval for showcase' ||
    review.reviewType !== 'editorial_mock'
  ) {
    throw new Error('editorialReview must contain the deterministic approval result.');
  }

  return {
    ...scriptEnvelope,
    editorialReview: {
      approved: true,
      reviewNote: 'Mock approval for showcase',
      reviewType: 'editorial_mock'
    }
  };
}

function hashtagToken(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join('');
}

function subtitleContent(script: VoluviaTikTokScript): string {
  return [
    '1',
    '00:00:00,000 --> 00:00:03,000',
    script.hook,
    '',
    '2',
    '00:00:03,000 --> 00:00:08,000',
    script.body,
    '',
    '3',
    '00:00:08,000 --> 00:00:11,000',
    script.cta,
    ''
  ].join('\n');
}

function cloneApprovedContext(context: EditorialApprovedEnvelope): EditorialApprovedEnvelope {
  return {
    product: {
      ...context.product,
      price: { ...context.product.price }
    },
    showcaseControls: { ...context.showcaseControls },
    script: { ...context.script },
    editorialReview: { ...context.editorialReview }
  };
}

function parseAsset(value: unknown): VoluviaShowcaseAsset {
  const asset = requiredRecord(value, 'asset');
  const assetId = requiredText(asset.assetId, 'asset.assetId');

  if (asset.assetKind === 'video') {
    if (
      asset.rendered !== false ||
      asset.provider !== 'deterministic_mock' ||
      typeof asset.uri !== 'string' ||
      !asset.uri.startsWith('mock://')
    ) {
      throw new Error('video asset must contain deterministic mock metadata.');
    }

    return {
      assetId,
      assetKind: 'video',
      mediaId: requiredText(asset.mediaId, 'asset.mediaId'),
      uri: asset.uri,
      rendered: false,
      provider: 'deterministic_mock'
    };
  }

  if (asset.assetKind === 'subtitles') {
    if (asset.format !== 'srt' || asset.language !== 'en') {
      throw new Error('subtitle asset must use the frozen SRT contract.');
    }

    return {
      assetId,
      assetKind: 'subtitles',
      format: 'srt',
      language: 'en',
      content: requiredString(asset.content, 'asset.content')
    };
  }

  if (asset.assetKind === 'hashtags') {
    if (!Array.isArray(asset.hashtags) || asset.hashtags.some((tag) => typeof tag !== 'string')) {
      throw new Error('hashtag asset must contain a string array.');
    }

    return {
      assetId,
      assetKind: 'hashtags',
      hashtags: asset.hashtags.map((tag) => requiredText(tag, 'asset.hashtags entry'))
    };
  }

  if (asset.assetKind === 'cover_metadata') {
    if (asset.layout !== 'showcase_portrait_v1') {
      throw new Error('cover asset must use the frozen layout.');
    }

    return {
      assetId,
      assetKind: 'cover_metadata',
      headline: requiredText(asset.headline, 'asset.headline'),
      productKey: requiredText(asset.productKey, 'asset.productKey'),
      backgroundColor: requiredText(asset.backgroundColor, 'asset.backgroundColor'),
      layout: 'showcase_portrait_v1'
    };
  }

  throw new Error('asset.assetKind is not supported.');
}

function parseBranchOutput(value: unknown): VoluviaBranchOutput {
  const output = requiredRecord(value, 'branch output');
  return {
    context: parseEditorialApprovedEnvelope(output.context),
    asset: parseAsset(output.asset)
  };
}

function semanticJsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => semanticJsonEqual(value, right[index]));
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();

    return leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) => key === rightKeys[index] && semanticJsonEqual(left[key], right[key])
      );
  }

  return false;
}

function validateAssetForBranch(
  branchId: string,
  output: VoluviaBranchOutput
): VoluviaShowcaseAsset {
  const expectedKind = {
    cover: 'cover_metadata',
    hashtags: 'hashtags',
    subtitles: 'subtitles',
    video: 'video'
  }[branchId];

  if (!expectedKind || output.asset.assetKind !== expectedKind) {
    throw new Error(`Branch ${branchId} contains an invalid asset discriminator.`);
  }

  const productKeyValue = output.context.product.productKey;
  const expectedAssetId = {
    cover: `${productKeyValue}.cover.v1`,
    hashtags: `${productKeyValue}.hashtags.v1`,
    subtitles: `${productKeyValue}.subtitles.en.v1`,
    video: `${productKeyValue}.video.v1`
  }[branchId];

  if (output.asset.assetId !== expectedAssetId) {
    throw new Error(`Branch ${branchId} contains an invalid asset identifier.`);
  }

  if (
    branchId === 'cover' &&
    output.asset.assetKind === 'cover_metadata' &&
    output.asset.productKey !== productKeyValue
  ) {
    throw new Error('Cover asset product key does not match its continuation context.');
  }

  return output.asset;
}

function parsePackage(value: unknown): VoluviaPublishingPackage {
  const packageValue = requiredRecord(value, 'publishingPackage');
  const caption = requiredRecord(packageValue.caption, 'publishingPackage.caption');
  const assets = requiredRecord(packageValue.assets, 'publishingPackage.assets');
  const target = requiredRecord(packageValue.target, 'publishingPackage.target');

  if (
    packageValue.status !== 'mock_package_ready_for_review' ||
    packageValue.publishable !== false ||
    target.platform !== 'tiktok' ||
    target.mode !== 'showcase_only'
  ) {
    throw new Error('publishingPackage does not satisfy the frozen showcase contract.');
  }

  const video = parseAsset(assets.video);
  const subtitles = parseAsset(assets.subtitles);
  const hashtags = parseAsset(assets.hashtags);
  const cover = parseAsset(assets.cover);

  if (
    video.assetKind !== 'video' ||
    subtitles.assetKind !== 'subtitles' ||
    hashtags.assetKind !== 'hashtags' ||
    cover.assetKind !== 'cover_metadata'
  ) {
    throw new Error('publishingPackage contains invalid asset kinds.');
  }

  return {
    status: 'mock_package_ready_for_review',
    productKey: requiredText(packageValue.productKey, 'publishingPackage.productKey'),
    caption: {
      hook: requiredText(caption.hook, 'publishingPackage.caption.hook'),
      body: requiredText(caption.body, 'publishingPackage.caption.body'),
      cta: requiredText(caption.cta, 'publishingPackage.caption.cta')
    },
    assets: { video, subtitles, hashtags, cover },
    target: { platform: 'tiktok', mode: 'showcase_only' },
    publishable: false
  };
}

function parsePackageEnvelope(value: unknown): PublishingPackageEnvelope {
  const envelope = requiredRecord(value, 'publishing package envelope');
  const context = parseEditorialApprovedEnvelope(envelope);
  const publishingPackage = parsePackage(envelope.publishingPackage);

  if (publishingPackage.productKey !== context.product.productKey) {
    throw new Error('publishingPackage.productKey does not match the normalized product.');
  }

  return { ...context, publishingPackage };
}

export const normalizeProductOperation: OperationHandler = ({ stepInput }) => {
  const input = requiredRecord(stepInput, 'showcase input');
  const product = parseRawProduct(input.product);
  const showcaseControls = parseControls(input.showcaseControls);

  return {
    product: { productKey: productKey(product.title), ...product },
    showcaseControls
  } satisfies NormalizedProductEnvelope;
};

export const generateScriptOperation: OperationHandler = ({ stepInput }) => {
  const input = parseNormalizedEnvelope(stepInput);
  return {
    product: { ...input.product, price: { ...input.product.price } },
    showcaseControls: { ...input.showcaseControls },
    script: {
      hook: `Meet the ${input.product.title} in ${input.product.color}.`,
      body: `${input.product.description} The ${input.product.length} silhouette is designed for ${input.product.audience}.`,
      cta: 'Discover the Voluvia collection.',
      source: 'deterministic_showcase_template'
    }
  } satisfies ScriptEnvelope;
};

export const mockEditorialReviewOperation: OperationHandler = ({ stepInput }) => {
  const input = parseScriptEnvelope(stepInput);
  const base: ScriptEnvelope = {
    product: { ...input.product, price: { ...input.product.price } },
    showcaseControls: { ...input.showcaseControls },
    script: { ...input.script }
  };

  if (input.showcaseControls.editorialApproved) {
    return {
      ...base,
      editorialReview: {
        approved: true,
        reviewNote: 'Mock approval for showcase',
        reviewType: 'editorial_mock'
      }
    } satisfies EditorialApprovedEnvelope;
  }

  return {
    ...base,
    editorialReview: {
      approved: false,
      reviewNote: 'Mock editorial rejection for showcase',
      reviewType: 'editorial_mock'
    },
    disposition: 'rejected',
    rejectionStage: 'editorial'
  } satisfies EditorialRejectedEnvelope;
};

export const generateMockVideoOperation: OperationHandler = ({ stepInput }) => {
  const context = parseEditorialApprovedEnvelope(stepInput);
  const key = context.product.productKey;
  return {
    context: cloneApprovedContext(context),
    asset: {
      assetId: `${key}.video.v1`,
      assetKind: 'video',
      mediaId: `mock-video-${key}`,
      uri: `mock://voluvia/video/${key}`,
      rendered: false,
      provider: 'deterministic_mock'
    }
  } satisfies VoluviaBranchOutput<VoluviaMockVideoAsset>;
};

export const generateMockSubtitlesOperation: OperationHandler = ({ stepInput }) => {
  const context = parseEditorialApprovedEnvelope(stepInput);
  return {
    context: cloneApprovedContext(context),
    asset: {
      assetId: `${context.product.productKey}.subtitles.en.v1`,
      assetKind: 'subtitles',
      format: 'srt',
      language: 'en',
      content: subtitleContent(context.script)
    }
  } satisfies VoluviaBranchOutput<VoluviaSubtitleAsset>;
};

export const generateHashtagsOperation: OperationHandler = ({ stepInput }) => {
  const context = parseEditorialApprovedEnvelope(stepInput);
  const candidates = [
    '#Voluvia',
    `#${hashtagToken(context.product.color)}`,
    `#${hashtagToken(context.product.length)}`,
    `#${hashtagToken(context.product.title)}`
  ];
  const hashtags = candidates.filter((value, index) => candidates.indexOf(value) === index);

  return {
    context: cloneApprovedContext(context),
    asset: {
      assetId: `${context.product.productKey}.hashtags.v1`,
      assetKind: 'hashtags',
      hashtags
    }
  } satisfies VoluviaBranchOutput<VoluviaHashtagAsset>;
};

export const generateCoverMetadataOperation: OperationHandler = ({ stepInput }) => {
  const context = parseEditorialApprovedEnvelope(stepInput);
  return {
    context: cloneApprovedContext(context),
    asset: {
      assetId: `${context.product.productKey}.cover.v1`,
      assetKind: 'cover_metadata',
      headline: `${context.product.color} ${context.product.length} Edit`,
      productKey: context.product.productKey,
      backgroundColor: context.product.color,
      layout: 'showcase_portrait_v1'
    }
  } satisfies VoluviaBranchOutput<VoluviaCoverMetadataAsset>;
};

export const buildPublishingPackageOperation: OperationHandler = ({ stepInput }) => {
  if (!Array.isArray(stepInput)) {
    throw new Error('Join output must be an array.');
  }

  const outputs = new Map<string, VoluviaBranchOutput>();
  const allowedBranches = ['cover', 'hashtags', 'subtitles', 'video'];

  for (const entryValue of stepInput) {
    const entry = requiredRecord(entryValue, 'join result');
    const branchId = requiredText(entry.branchId, 'join result branchId');

    if (!allowedBranches.includes(branchId) || outputs.has(branchId)) {
      throw new Error(`Join result contains an unknown or duplicate branch: ${branchId}`);
    }

    outputs.set(branchId, parseBranchOutput(entry.output));
  }

  if (outputs.size !== allowedBranches.length) {
    throw new Error('Join result is missing one or more required branches.');
  }

  const coverOutput = outputs.get('cover');
  const hashtagOutput = outputs.get('hashtags');
  const subtitleOutput = outputs.get('subtitles');
  const videoOutput = outputs.get('video');

  if (!coverOutput || !hashtagOutput || !subtitleOutput || !videoOutput) {
    throw new Error('Join result is missing one or more required branches.');
  }

  const commonContext = coverOutput.context;

  for (const output of outputs.values()) {
    if (!semanticJsonEqual(commonContext, output.context)) {
      throw new Error('Parallel branches contain inconsistent continuation contexts.');
    }
  }

  const cover = validateAssetForBranch('cover', coverOutput);
  const hashtags = validateAssetForBranch('hashtags', hashtagOutput);
  const subtitles = validateAssetForBranch('subtitles', subtitleOutput);
  const video = validateAssetForBranch('video', videoOutput);

  if (
    cover.assetKind !== 'cover_metadata' ||
    hashtags.assetKind !== 'hashtags' ||
    subtitles.assetKind !== 'subtitles' ||
    video.assetKind !== 'video'
  ) {
    throw new Error('Join result contains invalid branch assets.');
  }

  const publishingPackage: VoluviaPublishingPackage = {
    status: 'mock_package_ready_for_review',
    productKey: commonContext.product.productKey,
    caption: {
      hook: commonContext.script.hook,
      body: commonContext.script.body,
      cta: commonContext.script.cta
    },
    assets: { video, subtitles, hashtags, cover },
    target: { platform: 'tiktok', mode: 'showcase_only' },
    publishable: false
  };

  return {
    ...cloneApprovedContext(commonContext),
    publishingPackage
  } satisfies PublishingPackageEnvelope;
};

export const mockFinalReviewOperation: OperationHandler = ({ stepInput }) => {
  const input = parsePackageEnvelope(stepInput);
  const base: PublishingPackageEnvelope = {
    ...cloneApprovedContext(input),
    publishingPackage: input.publishingPackage
  };

  if (input.showcaseControls.finalApproved) {
    return {
      ...base,
      finalReview: {
        approved: true,
        reviewNote: 'Mock final approval for showcase',
        reviewType: 'final_mock'
      },
      disposition: 'ready'
    } satisfies ReadyEnvelope;
  }

  return {
    ...base,
    finalReview: {
      approved: false,
      reviewNote: 'Mock final rejection for showcase',
      reviewType: 'final_mock'
    },
    disposition: 'rejected',
    rejectionStage: 'final'
  } satisfies FinalRejectedEnvelope;
};
