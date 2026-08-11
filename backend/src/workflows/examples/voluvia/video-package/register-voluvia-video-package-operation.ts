import { VideoPackageGenerationClient } from '../../../../integrations/ai/video-package-generation-client';
import { Clock } from '../../../../runtime/services/clock';
import { OperationRegistry } from '../../../runtime/operation-registry';
import { VideoPackageOperationDiagnostic, VOLUVIA_VIDEO_PACKAGE_OPERATION_ID } from './voluvia-video-package-contracts';
import { createVoluviaVideoPackageOperation } from './voluvia-video-package.operation';

export function registerVoluviaVideoPackageOperation(
  registry: OperationRegistry,
  client: VideoPackageGenerationClient,
  clock: Clock,
  onDiagnostics?: (diagnostics: VideoPackageOperationDiagnostic) => void
): void {
  registry.register(VOLUVIA_VIDEO_PACKAGE_OPERATION_ID,
    createVoluviaVideoPackageOperation(client, clock, onDiagnostics));
}
