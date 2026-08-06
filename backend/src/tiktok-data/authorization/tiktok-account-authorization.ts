import { TikTokAccountConnectionId } from './tiktok-account-connection-id';

export type TikTokAccountAuthorizationStatus = 'pending' | 'authorized' | 'revoked';

export interface TikTokAccountAuthorizationStateRecord {
  readonly stateId: string;
  readonly status: TikTokAccountAuthorizationStatus;
  readonly createdAt: string;
  readonly consumedAt?: string;
  readonly connectionId?: TikTokAccountConnectionId;
}

export interface TikTokAccountAuthorizationCallbackInput {
  readonly stateId: string;
  readonly authorizationCode: string;
}

export interface TikTokAccountAuthorizationCallbackService {
  completeAuthorization(
    input: TikTokAccountAuthorizationCallbackInput
  ): Promise<TikTokAccountConnectionId>;
}
