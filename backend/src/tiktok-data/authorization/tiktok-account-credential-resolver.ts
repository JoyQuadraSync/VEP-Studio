import { TikTokAccountConnectionId } from './tiktok-account-connection-id';

export interface TikTokTrustedAdapterCredentialStatus {
  readonly providerAccountId: string;
  readonly expiresAt: string;
}

export interface TikTokAccountTrustedAdapterCapability {
  verifyCredential(connectionId: TikTokAccountConnectionId): Promise<TikTokTrustedAdapterCredentialStatus>;
}
