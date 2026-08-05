export interface PromptReference {
  readonly promptId: string;
  readonly promptVersion: number;
}

export interface ResolvedPrompt extends PromptReference {
  readonly content: string;
  readonly sha256: string;
}
