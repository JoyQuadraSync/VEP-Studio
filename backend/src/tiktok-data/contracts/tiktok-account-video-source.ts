export interface TikTokAccountVideoSource {
  readonly providerAccountId: string;
  readonly videoId: string;
  readonly createdAt: string;
  readonly title?: string;
  readonly description?: string;
  readonly durationSeconds?: number;
  readonly shareUrl?: string;
  readonly coverImageUrl?: string;
  readonly sourceUpdatedAt?: string;
  readonly viewCount?: number;
  readonly likeCount?: number;
  readonly commentCount?: number;
  readonly shareCount?: number;
}

export interface TikTokAccountVideoPageSource {
  readonly videos: readonly TikTokAccountVideoSource[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}
