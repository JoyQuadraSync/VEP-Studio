import { assertTikTokAccountConnectionId, TikTokAccountConnectionId } from './tiktok-account-connection-id';
import { TikTokAccountCredentialStore } from './tiktok-account-credential-store';

export interface TikTokAccountDisconnectService {
  disconnect(connectionId: TikTokAccountConnectionId): Promise<void>;
}

export class OfflineTikTokAccountDisconnectService implements TikTokAccountDisconnectService {
  constructor(private readonly store: TikTokAccountCredentialStore) {}
  async disconnect(connectionId: TikTokAccountConnectionId): Promise<void> {
    assertTikTokAccountConnectionId(connectionId);
    await this.store.revoke(connectionId);
  }
}
