import { VideoPackageClientResult, VideoPackageProviderDiagnosticCategory, VideoPackageProviderInput } from '../../workflows/examples/voluvia/video-package/voluvia-video-package-contracts';

export class VideoPackageProviderFailure {
  readonly name: string = 'VideoPackageProviderFailure';
  constructor(
    readonly category: VideoPackageProviderDiagnosticCategory,
    readonly requestAttempted: boolean,
    readonly status?: number,
    readonly responseId?: string
  ) {}
}

export interface VideoPackageGenerationClient {
  generatePackageCandidate(input: VideoPackageProviderInput): Promise<VideoPackageClientResult>;
}
