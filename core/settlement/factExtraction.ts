import type { API配置项 } from '@/models/settings';
import type { 提示词模块 } from '@/models/prompts';
import type { FactCandidate, SourceRecord } from '../contracts/event';
import type { CoreSnapshot } from '../contracts/state';
import { validateCoreDto } from '../contracts/validation';
import { completeCore2VariableModel } from '@/services/ai/core2VariableModel';
import { withRetries } from '@/services/ai/retry';
import { buildIndependentPromptModulesSection } from '@/services/promptModuleScopes';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { CORE_FACT_PROTOCOL, decodeCoreCandidates } from './candidateProtocol';
import type { CoreStoryNode } from '../content/storyCatalog';

export interface FactExtractionInput {
  source: SourceRecord; snapshot: CoreSnapshot; config?: API配置项;
  promptModules?: 提示词模块[]; signal?: AbortSignal;
  storyCatalog?: readonly CoreStoryNode[];
}
export interface FactModelDependencies { complete?: typeof completeCore2VariableModel; retryDelayMs?: number }
export type FactExtractionResult =
  | { kind: 'extracted'; candidates: FactCandidate[]; attempts: number }
  | { kind: 'failed'; code: string; detail: string; attempts: number };

/** No repository dependency: proposing a fact cannot change live game state. */
export async function extractCoreFacts(input: FactExtractionInput, deps: FactModelDependencies = {}): Promise<FactExtractionResult> {
  let attempts = 0;
  const failed = (code: string, detail: string): FactExtractionResult => ({ kind: 'failed', code, detail, attempts });
  if (input.signal?.aborted) return failed('CORE2_FACT_CANCELLED', '变量提取已取消。');
  if (!input.config?.baseUrl.trim() || !input.config.model.trim()) return failed('CORE2_FACT_MODEL_UNCONFIGURED', '请先选择变量模型及接口地址。');
  if (!validateCoreDto('source', input.source).ok || !validateCoreDto('snapshot', input.snapshot).ok
    || input.source.scope.journeyId !== input.snapshot.head.scope.journeyId || input.source.scope.branchId !== input.snapshot.head.scope.branchId) {
    return failed('CORE2_FACT_INPUT_INVALID', '来源与当前存档不相符。');
  }
  // Own all mutable input before the first await. Never serialize credentials into the prompt.
  const source = structuredClone(input.source);
  const snapshot = structuredClone(input.snapshot);
  const storyCatalog = input.storyCatalog ? structuredClone(input.storyCatalog) : undefined;
  const config = structuredClone(input.config);
  const promptRules = buildIndependentPromptModulesSection(input.promptModules, 'variable');
  const state = snapshot.records.filter(record => record.domain !== 'courier' && record.domain !== 'news' && record.domain !== 'album' && record.domain !== 'doudizhu').map(record => record.domain === 'npc'
    ? { domain: record.domain, entityId: record.entityId, version: record.version, value: { name: record.value.姓名, aliases: record.value.aliases, affinity: record.value.affinity, relationship: record.value.relationship, travelingTogether: record.value.travelingTogether } }
    : record);
  try {
    const raw = await withRetries(async () => {
      attempts++;
      return (deps.complete ?? completeCore2VariableModel)(config, {
        systemPrompt: [promptRules, CORE_FACT_PROTOCOL, '角色基础中英文资料已固定：不要提出外貌、常用穿着或长期性格的 profile 改写。临时换装、表情与姿态留在正文，不改基础档案；英文生图资料只由显式准备入口管理。'].filter(Boolean).join('\n\n'),
        messages: [{ role: 'user', content: JSON.stringify({ source, state, ...(storyCatalog ? { storyCatalog } : {}) }) }],
        purpose: 'variable', signal: input.signal,
        maxTokens: config.maxTokens, temperature: config.temperature, topP: config.topP, topK: config.topK,
        topA: config.topA, minP: config.minP, repetitionPenalty: config.repetitionPenalty,
        frequencyPenalty: config.frequencyPenalty, presencePenalty: config.presencePenalty, maxContext: config.maxContext,
      });
    }, { retries: config.retryCount, signal: input.signal, delayMs: deps.retryDelayMs });
    if (input.signal?.aborted) return failed('CORE2_FACT_CANCELLED', '变量提取已取消。');
    if (!raw.trim()) return failed('CORE2_EMPTY_FACT_RESPONSE', '变量模型没有返回可用内容。');
    const decoded = decodeCoreCandidates(raw, source);
    return decoded.ok ? { kind: 'extracted', candidates: decoded.candidates, attempts } : failed('CORE2_INVALID_FACT_PROTOCOL', decoded.detail);
  } catch (error) {
    if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return failed('CORE2_FACT_CANCELLED', '变量提取已取消。');
    return failed('CORE2_FACT_MODEL_FAILED', sanitizeApiErrorReportText(error instanceof Error ? error.message : String(error)));
  }
}
