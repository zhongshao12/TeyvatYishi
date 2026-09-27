import type { PromptDeliveryTarget } from '@/models/prompts';
import { estimateTextTokens } from '@/utils/tokenEstimate';

export type RequestPurpose = PromptDeliveryTarget | 'other';

export interface RequestMetadata {
  target: RequestPurpose;
  model: string;
  estimatedInputTokens: number;
  segments: Array<{ label: string; estimatedTokens: number }>;
  windowRatio?: number;
  sentAt: number;
  actualInputTokens?: number;
}

const lastByTarget = new Map<RequestPurpose, RequestMetadata>();

export function createRequestMetadata(input: {
  target: RequestPurpose;
  model: string;
  systemPrompt?: string;
  prefixContent?: string;
  messages: ReadonlyArray<{ role: string; content: string }>;
  configuredWindow?: number;
}): RequestMetadata {
  const segments = [
    { label: 'system', estimatedTokens: estimateTextTokens(input.systemPrompt ?? '') },
    ...input.messages.map((message, index) => ({
      label: `${message.role} ${index + 1}`,
      estimatedTokens: estimateTextTokens(message.content),
    })),
    ...(input.prefixContent ? [{ label: 'assistant prefix', estimatedTokens: estimateTextTokens(input.prefixContent) }] : []),
  ];
  const estimatedInputTokens = segments.reduce((total, segment) => total + segment.estimatedTokens, 0);
  return {
    target: input.target,
    model: input.model,
    segments,
    estimatedInputTokens,
    ...(input.configuredWindow && input.configuredWindow > 0 && Number.isFinite(input.configuredWindow)
      ? { windowRatio: estimatedInputTokens / input.configuredWindow } : {}),
    sentAt: Date.now(),
  };
}

export function rememberRequestMetadata(record: RequestMetadata): void {
  lastByTarget.set(record.target, record);
}

export function updateRequestUsage(record: RequestMetadata, actualInputTokens: number): void {
  if (!Number.isFinite(actualInputTokens) || actualInputTokens < 0) return;
  if (lastByTarget.get(record.target) === record) record.actualInputTokens = actualInputTokens;
}

export function readLastRequestMetadata(target: RequestPurpose): RequestMetadata | undefined {
  const record = lastByTarget.get(target);
  return record ? { ...record, segments: record.segments.map((segment) => ({ ...segment })) } : undefined;
}
