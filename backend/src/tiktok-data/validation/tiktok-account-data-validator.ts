import { TikTokAccountProfileSource } from '../contracts/tiktok-account-profile-source';
import { TikTokAccountVideoPageSource, TikTokAccountVideoSource } from '../contracts/tiktok-account-video-source';
import { assertEnumerableDataProperties, canonicalizeTikTokValue, isStrictTimestamp } from './tiktok-json-safety';

const PROFILE_KEYS = ['providerAccountId', 'displayName', 'avatarUrl', 'biography', 'profileUrl', 'sourceUpdatedAt'];
const VIDEO_KEYS = ['providerAccountId', 'videoId', 'createdAt', 'title', 'description', 'durationSeconds', 'shareUrl', 'coverImageUrl', 'sourceUpdatedAt', 'viewCount', 'likeCount', 'commentCount', 'shareCount'];

export class TikTokAccountDataValidator {
  validateProfile(value: unknown): asserts value is TikTokAccountProfileSource {
    this.requireRecord(value, PROFILE_KEYS);
    this.requireId(value.providerAccountId);
    this.optionalStrings(value, ['displayName', 'avatarUrl', 'biography', 'profileUrl']);
    if (value.sourceUpdatedAt !== undefined && !isStrictTimestamp(value.sourceUpdatedAt)) throw new TypeError('Profile source update timestamp is invalid.');
    canonicalizeTikTokValue(value);
  }

  validateVideo(value: unknown): asserts value is TikTokAccountVideoSource {
    this.requireRecord(value, VIDEO_KEYS);
    this.requireId(value.providerAccountId); this.requireId(value.videoId);
    if (!isStrictTimestamp(value.createdAt)) throw new TypeError('Video creation timestamp is invalid.');
    if (value.sourceUpdatedAt !== undefined && !isStrictTimestamp(value.sourceUpdatedAt)) throw new TypeError('Video source update timestamp is invalid.');
    this.optionalStrings(value, ['title', 'description', 'shareUrl', 'coverImageUrl']);
    if (value.durationSeconds !== undefined && (typeof value.durationSeconds !== 'number' || !Number.isFinite(value.durationSeconds) || value.durationSeconds < 0)) throw new TypeError('Video duration is invalid.');
    for (const key of ['viewCount', 'likeCount', 'commentCount', 'shareCount']) {
      const counter = value[key];
      if (counter !== undefined && (typeof counter !== 'number' || !Number.isSafeInteger(counter) || counter < 0)) throw new TypeError('Video counter is invalid.');
    }
    canonicalizeTikTokValue(value);
  }

  validatePage(value: unknown): asserts value is TikTokAccountVideoPageSource {
    this.requireRecord(value, ['videos', 'nextCursor', 'hasMore']);
    if (!Array.isArray(value.videos) || typeof value.hasMore !== 'boolean') throw new TypeError('Video page is invalid.');
    if (value.nextCursor !== undefined && (typeof value.nextCursor !== 'string' || !value.nextCursor || value.nextCursor !== value.nextCursor.trim())) throw new TypeError('Video page cursor is invalid.');
    if (value.hasMore && value.nextCursor === undefined) throw new TypeError('Continued video page requires a cursor.');
    if (!value.hasMore && value.nextCursor !== undefined) throw new TypeError('Terminal video page cannot contain a cursor.');
    value.videos.forEach((video) => this.validateVideo(video));
    canonicalizeTikTokValue(value);
  }

  private requireRecord(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Source value must be a plain object.');
    const names = assertEnumerableDataProperties(value, keys);
    for (const key of names) if (/token|authorization|secret|header|raw|payload|sdk/i.test(key)) throw new TypeError('Credential-shaped source fields are prohibited.');
  }
  private requireId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Provider identity is invalid.');
  }
  private optionalStrings(value: Record<string, unknown>, keys: readonly string[]): void {
    for (const key of keys) if (value[key] !== undefined && typeof value[key] !== 'string') throw new TypeError('Optional source text is invalid.');
  }
}
