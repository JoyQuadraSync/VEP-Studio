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
    this.prompts = new Map<string, ResolvedPrompt>([
      [this.key(prompt), prompt],
      [this.key(plannerPrompt), plannerPrompt],
      [this.key(plannerV2Prompt), plannerV2Prompt]
    ]);
  }

  resolve(reference: PromptReference): ResolvedPrompt | undefined {
    return this.prompts.get(this.key(reference));
  }

  private key(reference: PromptReference): string {
    return `${reference.promptId}\u0000${reference.promptVersion}`;
  }
}
