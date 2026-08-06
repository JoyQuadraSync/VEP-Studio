import { TikTokAccountConnectionId } from '../authorization/tiktok-account-connection-id';
import { TikTokAccountProfileSource } from '../contracts/tiktok-account-profile-source';
import { TikTokAccountVideoPageSource, TikTokAccountVideoSource } from '../contracts/tiktok-account-video-source';

export interface TikTokAccountDataClient {
  getProfile(connectionId: TikTokAccountConnectionId): Promise<TikTokAccountProfileSource>;
  listVideosPage(connectionId: TikTokAccountConnectionId, cursor?: string): Promise<TikTokAccountVideoPageSource>;
  getVideosByIds(connectionId: TikTokAccountConnectionId, ids: readonly string[]): Promise<readonly TikTokAccountVideoSource[]>;
}
