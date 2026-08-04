import { OperationRegistry } from '../../runtime/operation-registry';
import {
  buildPublishingPackageOperation,
  generateCoverMetadataOperation,
  generateHashtagsOperation,
  generateMockSubtitlesOperation,
  generateMockVideoOperation,
  generateScriptOperation,
  mockEditorialReviewOperation,
  mockFinalReviewOperation,
  normalizeProductOperation
} from './voluvia-mock-operations';
import { VOLUVIA_OPERATION_IDS } from './voluvia-operation-contracts';

export function registerVoluviaShowcaseOperations(registry: OperationRegistry): void {
  registry.register(VOLUVIA_OPERATION_IDS.normalizeProduct, normalizeProductOperation);
  registry.register(VOLUVIA_OPERATION_IDS.generateScript, generateScriptOperation);
  registry.register(VOLUVIA_OPERATION_IDS.editorialReview, mockEditorialReviewOperation);
  registry.register(VOLUVIA_OPERATION_IDS.generateVideo, generateMockVideoOperation);
  registry.register(VOLUVIA_OPERATION_IDS.generateSubtitles, generateMockSubtitlesOperation);
  registry.register(VOLUVIA_OPERATION_IDS.generateHashtags, generateHashtagsOperation);
  registry.register(
    VOLUVIA_OPERATION_IDS.generateCoverMetadata,
    generateCoverMetadataOperation
  );
  registry.register(VOLUVIA_OPERATION_IDS.buildPackage, buildPublishingPackageOperation);
  registry.register(VOLUVIA_OPERATION_IDS.finalReview, mockFinalReviewOperation);
}
