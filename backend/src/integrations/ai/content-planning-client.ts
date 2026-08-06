import { PromptReference } from '../../prompts/prompt-reference';
import {
  ApprovedProductFact,
  ContentAngle,
  ContentFocus,
  ContentGoal,
  ContentPlanningCandidate,
  VoluviaContentPlannerInput
} from '../../workflows/examples/voluvia/planner/voluvia-content-planner-contracts';

export interface ContentPlanningClientRequest {
  readonly product: Omit<VoluviaContentPlannerInput['product'], 'price' | 'shipsFrom'> & {
    readonly price?: VoluviaContentPlannerInput['product']['price'];
    readonly shipsFrom?: VoluviaContentPlannerInput['product']['shipsFrom'];
  };
  readonly approvedProductFacts: readonly ApprovedProductFact[];
  readonly approvedSellingPoints: readonly ContentFocus[];
  readonly forbiddenClaims: readonly string[];
  readonly targetCustomer: VoluviaContentPlannerInput['targetCustomer'];
  readonly brand: VoluviaContentPlannerInput['brand'];
  readonly contentGoal: ContentGoal;
  readonly targetPlatform: 'TikTok';
  readonly targetLanguage: 'de-DE';
  readonly preferredVideoDurationSeconds: number;
  readonly plannerControls: {
    readonly preferredContentAngle?: ContentAngle;
    readonly preferredContentFocus?: ContentFocus;
    readonly excludedRecentlyUsedAngles: readonly ContentAngle[];
    readonly excludedRecentlyUsedFocuses: readonly ContentFocus[];
    readonly realBeforeAfterEvidenceAvailable: boolean;
  };
  readonly prompt: PromptReference;
}

export interface ContentPlanningClientResult {
  readonly candidate: ContentPlanningCandidate;
  readonly provider: string;
  readonly model: string;
  readonly responseId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly promptId: string;
  readonly promptVersion: number;
  readonly promptContentHash: string;
}

export interface ContentPlanningClient {
  generatePlan(request: ContentPlanningClientRequest): Promise<ContentPlanningClientResult>;
}
