export interface TikTokAccountProfileSource {
  readonly providerAccountId: string;
  readonly displayName?: string;
  readonly avatarUrl?: string;
  readonly biography?: string;
  readonly profileUrl?: string;
  readonly sourceUpdatedAt?: string;
}
