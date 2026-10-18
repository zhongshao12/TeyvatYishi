import type { API配置项, 记忆系统设置 } from '@/models/settings';
import { summarizeMemoryBatch } from '@/services/memoryCompression';
import type { CoreSummaryRequest, CoreMemoryTextResult } from '@/core/memory/turnSummary';
import { core2TextCompletion } from './core2TextCompletion';

/** Keep the existing provider/retry client, but never publish its fallback as model success. */
export function createCore2MemoryModel(config: API配置项, settings: 记忆系统设置, summarize = summarizeMemoryBatch) {
  const ownedConfig = structuredClone(config), ownedSettings = structuredClone(settings);
  return async (request: CoreSummaryRequest): Promise<CoreMemoryTextResult> => {
    const result = await summarize({ kind: request.layer, turn: request.turn, items: [...request.items], prompt: request.prompt }, { ...ownedSettings, 启用中短长期API总结: true }, ownedConfig, request.signal, ownedConfig.retryCount ?? 2, core2TextCompletion);
    if (result.usedFallback || !result.usedModel) return { kind: 'failed', code: result.failureCode ?? 'CORE2_MEMORY_MODEL_NOT_USED', detail: result.failureMessage ?? '模型没有生成有效摘要，原始记录已保留。' };
    return { kind: 'model', text: result.summary };
  };
}
