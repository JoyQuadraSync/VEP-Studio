import { assertTikTokAccountConnectionId, serializeTikTokAccountConnectionId, TikTokAccountConnectionId } from '../authorization/tiktok-account-connection-id';
import { TikTokAccountProfileSource } from '../contracts/tiktok-account-profile-source';
import { TikTokAccountVideoPageSource, TikTokAccountVideoSource } from '../contracts/tiktok-account-video-source';
import { TikTokAccountDataClient } from './tiktok-account-data-client';
import { isTikTokAccountDataFailure } from '../failures/tiktok-account-data-failure';
import { TikTokAccountDataValidator } from '../validation/tiktok-account-data-validator';
import { assertEnumerableDataProperties, canonicalizeTikTokValue, deepFreezeTikTokValue } from '../validation/tiktok-json-safety';

export interface FakeTikTokAccountDataClientOptions {
  readonly profile: TikTokAccountProfileSource;
  readonly pages: Readonly<Record<string, TikTokAccountVideoPageSource>>;
  readonly queriedVideos?: readonly TikTokAccountVideoSource[];
  readonly failures?: Readonly<Partial<Record<'getProfile' | 'listVideosPage' | 'getVideosByIds', unknown>>>;
  readonly rejectAfterCalls?: number;
}

export class FakeTikTokAccountDataClient implements TikTokAccountDataClient {
  private calls = 0;
  private readonly callsLog: Array<Readonly<{ method: string; connectionId: string; cursor?: string; ids?: readonly string[] }>> = [];
  private readonly options: FakeTikTokAccountDataClientOptions;
  constructor(options: FakeTikTokAccountDataClientOptions) {
    if (typeof options !== 'object' || options === null || Array.isArray(options) || Object.getPrototypeOf(options) !== Object.prototype) throw new TypeError('Fake client options must be a plain object.');
    canonicalizeTikTokValue(options);
    assertEnumerableDataProperties(options, ['profile','pages','queriedVideos','failures','rejectAfterCalls']);
    if (typeof options.pages !== 'object' || options.pages === null || Array.isArray(options.pages) || Object.getPrototypeOf(options.pages) !== Object.prototype) throw new TypeError('Fake pages must be a plain object.');
    assertEnumerableDataProperties(options.pages);
    const validator: TikTokAccountDataValidator = new TikTokAccountDataValidator(); validator.validateProfile(options.profile);
    for (const page of Object.values(options.pages)) validator.validatePage(page);
    for (const video of options.queriedVideos ?? []) validator.validateVideo(video);
    for (const failure of Object.values(options.failures ?? {})) if (!isTikTokAccountDataFailure(failure)) throw new TypeError('Fake failures must use the closed failure contract.');
    this.options = deepFreezeTikTokValue(structuredClone(options));
  }
  get callCount(): number { return this.calls; }
  get observedCalls(): readonly Readonly<{ method: string; connectionId: string; cursor?: string; ids?: readonly string[] }>[] { return structuredClone(this.callsLog); }

  async getProfile(connectionId: TikTokAccountConnectionId): Promise<TikTokAccountProfileSource> {
    assertTikTokAccountConnectionId(connectionId); this.observe({ method: 'getProfile', connectionId });
    return structuredClone(this.options.profile);
  }
  async listVideosPage(connectionId: TikTokAccountConnectionId, cursor?: string): Promise<TikTokAccountVideoPageSource> {
    assertTikTokAccountConnectionId(connectionId); this.observe({ method: 'listVideosPage', connectionId, ...(cursor === undefined ? {} : { cursor }) });
    const page = this.options.pages[cursor ?? ''];
    if (!page) throw new Error('Fake page was not configured.');
    return structuredClone(page);
  }
  async getVideosByIds(connectionId: TikTokAccountConnectionId, ids: readonly string[]): Promise<readonly TikTokAccountVideoSource[]> {
    assertTikTokAccountConnectionId(connectionId); this.observe({ method: 'getVideosByIds', connectionId, ids: [...ids] });
    const configured = this.options.queriedVideos;
    if (configured) return structuredClone(configured);
    const byId = new Map(Object.values(this.options.pages).flatMap((page) => page.videos).map((video) => [video.videoId, video]));
    return structuredClone(ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []));
  }
  private observe(call: { method: string; connectionId: TikTokAccountConnectionId; cursor?: string; ids?: readonly string[] }): void {
    this.calls += 1;
    this.callsLog.push(Object.freeze({ ...call, connectionId: serializeTikTokAccountConnectionId(call.connectionId) }));
    const failure = this.options.failures?.[call.method as keyof NonNullable<FakeTikTokAccountDataClientOptions['failures']>];
    if (failure !== undefined || (this.options.rejectAfterCalls !== undefined && this.calls > this.options.rejectAfterCalls)) {
      throw failure ?? new Error('Fake client rejected an additional call.');
    }
  }
}
