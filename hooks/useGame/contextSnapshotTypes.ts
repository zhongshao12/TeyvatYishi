import type { PromptDeliveryTarget } from '@/models/prompts';
import type { PromptDeliveryReason } from '@/services/promptDelivery';

export interface ContextSection {
  id: string;
  title: string;
  category: string;
  order: number;
  content: string;
  estimatedTokens: number;
  upload?: boolean;
  diagnostic?: boolean;
}

export type ContextSnapshotKind = 'main' | 'variable' | 'courier' | 'steambird' | 'irminsul' | 'codex';

export interface ContextSnapshot {
  kind: ContextSnapshotKind;
  title: string;
  sections: ContextSection[];
  fullText: string;
  estimatedTokens: number;
  uploadEstimatedTokens: number;
  diagnosticEstimatedTokens: number;
  createdAt: number;
  sourceInput: string;
  deliveryDecisions?: Array<{ id: string; title: string; source: string; target: PromptDeliveryTarget; reason: PromptDeliveryReason; estimatedTokens: number }>;
}
