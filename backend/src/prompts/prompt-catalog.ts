import { createHash } from 'node:crypto';
import { PromptReference, ResolvedPrompt } from './prompt-reference';
import {
  VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT,
  VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT_ID,
  VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT_SHA256,
  VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT_VERSION
} from './voluvia/de/script-v1.prompt';
import {
  VOLUVIA_CONTENT_PLANNER_DE_PROMPT,
  VOLUVIA_CONTENT_PLANNER_DE_PROMPT_ID,
  VOLUVIA_CONTENT_PLANNER_DE_PROMPT_SHA256,
  VOLUVIA_CONTENT_PLANNER_DE_PROMPT_VERSION
} from './voluvia/de/content-planner-v1.prompt';
import {
  VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT,
  VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_ID,
  VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256,
  VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_VERSION
} from './voluvia/de/content-planner-v2.prompt';
import {
  VOLUVIA_VIDEO_PACKAGE_DE_PROMPT,
  VOLUVIA_VIDEO_PACKAGE_DE_PROMPT_ID,
  VOLUVIA_VIDEO_PACKAGE_DE_PROMPT_SHA256,
  VOLUVIA_VIDEO_PACKAGE_DE_PROMPT_VERSION
} from './voluvia/de/video-package-generator-v1.prompt';
import {
  VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT,
  VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT_ID,
  VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT_SHA256,
  VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT_VERSION
} from './voluvia/de/video-package-generator-v2.prompt';
import {
  VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT,
  VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT_ID,
  VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT_SHA256,
  VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT_VERSION
} from './voluvia/de/video-package-generator-v3.prompt';
import {
  VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT,
  VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_ID,
  VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256,
  VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_VERSION
} from './voluvia/de/video-package-generator-v4.prompt';
import {
  VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT,
  VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_ID,
  VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_SHA256,
  VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_VERSION
} from './voluvia/de/video-package-generator-v5.prompt';

export interface PromptCatalog {
  resolve(reference: PromptReference): ResolvedPrompt | undefined;
}

export function canonicalizePromptContent(content: string): string {
  const withoutBom = content.startsWith('\uFEFF') ? content.slice(1) : content;
  return withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function hashPromptContent(content: string): string {
  return createHash('sha256')
    .update(Buffer.from(canonicalizePromptContent(content), 'utf8'))
    .digest('hex');
}

export class StaticPromptCatalog implements PromptCatalog {
  private readonly prompts: ReadonlyMap<string, ResolvedPrompt>;

  constructor() {
    const sha256 = hashPromptContent(VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT);

    if (sha256 !== VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT_SHA256) {
      throw new Error('Prompt content does not match its pinned SHA-256 hash.');
    }

    const prompt = Object.freeze({
      promptId: VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT_ID,
      promptVersion: VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT_VERSION,
      content: canonicalizePromptContent(VOLUVIA_TIKTOK_SCRIPT_DE_PROMPT),
      sha256
    });
    const plannerSha256 = hashPromptContent(VOLUVIA_CONTENT_PLANNER_DE_PROMPT);
    if (plannerSha256 !== VOLUVIA_CONTENT_PLANNER_DE_PROMPT_SHA256) {
      throw new Error('Planner prompt content does not match its pinned SHA-256 hash.');
    }
    const plannerPrompt = Object.freeze({
      promptId: VOLUVIA_CONTENT_PLANNER_DE_PROMPT_ID,
      promptVersion: VOLUVIA_CONTENT_PLANNER_DE_PROMPT_VERSION,
      content: canonicalizePromptContent(VOLUVIA_CONTENT_PLANNER_DE_PROMPT),
      sha256: plannerSha256
    });
    const plannerV2Sha256 = hashPromptContent(VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT);
    if (plannerV2Sha256 !== VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_SHA256) {
      throw new Error('Planner v2 prompt content does not match its pinned SHA-256 hash.');
    }
    const plannerV2Prompt = Object.freeze({
      promptId: VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_ID,
      promptVersion: VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT_VERSION,
      content: canonicalizePromptContent(VOLUVIA_CONTENT_PLANNER_DE_V2_PROMPT),
      sha256: plannerV2Sha256
    });
    const videoPackageSha256 = hashPromptContent(VOLUVIA_VIDEO_PACKAGE_DE_PROMPT);
    if (videoPackageSha256 !== VOLUVIA_VIDEO_PACKAGE_DE_PROMPT_SHA256) {
      throw new Error('Video package prompt content does not match its pinned SHA-256 hash.');
    }
    const videoPackagePrompt = Object.freeze({
      promptId: VOLUVIA_VIDEO_PACKAGE_DE_PROMPT_ID,
      promptVersion: VOLUVIA_VIDEO_PACKAGE_DE_PROMPT_VERSION,
      content: canonicalizePromptContent(VOLUVIA_VIDEO_PACKAGE_DE_PROMPT),
      sha256: videoPackageSha256
    });
    const videoPackageV2Sha256 = hashPromptContent(VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT);
    if (videoPackageV2Sha256 !== VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT_SHA256) {
      throw new Error('Video package v2 prompt content does not match its pinned SHA-256 hash.');
    }
    const videoPackageV2Prompt = Object.freeze({
      promptId: VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT_ID,
      promptVersion: VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT_VERSION,
      content: canonicalizePromptContent(VOLUVIA_VIDEO_PACKAGE_DE_V2_PROMPT),
      sha256: videoPackageV2Sha256
    });
    const videoPackageV3Sha256 = hashPromptContent(VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT);
    if (videoPackageV3Sha256 !== VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT_SHA256) {
      throw new Error('Video package v3 prompt content does not match its pinned SHA-256 hash.');
    }
    const videoPackageV3Prompt = Object.freeze({
      promptId: VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT_ID,
      promptVersion: VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT_VERSION,
      content: canonicalizePromptContent(VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT),
      sha256: videoPackageV3Sha256
    });
    const videoPackageV4Sha256 = hashPromptContent(VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT);
    if (videoPackageV4Sha256 !== VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256) {
      throw new Error('Video package v4 prompt content does not match its pinned SHA-256 hash.');
    }
    const videoPackageV4Prompt = Object.freeze({
      promptId: VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_ID,
      promptVersion: VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_VERSION,
      content: canonicalizePromptContent(VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT),
      sha256: videoPackageV4Sha256
    });
    const videoPackageV5Sha256 = hashPromptContent(VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT);
    if (videoPackageV5Sha256 !== VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_SHA256) {
      throw new Error('Video package v5 prompt content does not match its pinned SHA-256 hash.');
    }
    const videoPackageV5Prompt = Object.freeze({
      promptId: VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_ID,
      promptVersion: VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_VERSION,
      content: canonicalizePromptContent(VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT),
      sha256: videoPackageV5Sha256
    });
    this.prompts = new Map<string, ResolvedPrompt>([
      [this.key(prompt), prompt],
      [this.key(plannerPrompt), plannerPrompt],
      [this.key(plannerV2Prompt), plannerV2Prompt],
      [this.key(videoPackagePrompt), videoPackagePrompt],
      [this.key(videoPackageV2Prompt), videoPackageV2Prompt],
      [this.key(videoPackageV3Prompt), videoPackageV3Prompt],
      [this.key(videoPackageV4Prompt), videoPackageV4Prompt],
      [this.key(videoPackageV5Prompt), videoPackageV5Prompt]
    ]);
  }

  resolve(reference: PromptReference): ResolvedPrompt | undefined {
    return this.prompts.get(this.key(reference));
  }

  private key(reference: PromptReference): string {
    return `${reference.promptId}\u0000${reference.promptVersion}`;
  }
}
