import type { 记忆系统 } from '@/models/memory';
import type { API配置项, 记忆系统设置 } from '@/models/settings';
import type { IrminsulMemory } from '@/models/teyvat/irminsul';
import { promoteIrminsulEntry } from '@/services/irminsulPromotion';
import {
  addImmediateMemory,
  autoCompressMemorySystemWithArchivesAsync,
  buildImmediateMemory,
} from './memoryUtils';

type MemoryCompressionResult = Awaited<ReturnType<typeof autoCompressMemorySystemWithArchivesAsync>>;
type MemoryCompressor = (
  memory: 记忆系统,
  turn: number,
  settings: 记忆系统设置,
  mainConfig: API配置项,
  signal?: AbortSignal,
  irminsul?: IrminsulMemory,
) => Promise<MemoryCompressionResult>;

export interface PostNarrativeMemoryFeedback {
  status: 'success' | 'failed';
  detail: string;
  failCount?: number;
  retryHint?: string;
}

export interface PostNarrativeMemoryStageInput {
  memory: 记忆系统;
  irminsul: IrminsulMemory;
  userInput: string;
  narrativeSummary: string;
  body: string;
  turn: number;
  settings: 记忆系统设置;
  mainConfig: API配置项;
  signal?: AbortSignal;
  compress?: MemoryCompressor;
}

export interface PostNarrativeMemoryStageResult {
  memory: 记忆系统;
  irminsul: IrminsulMemory;
  feedback: PostNarrativeMemoryFeedback;
}

export async function settlePostNarrativeMemory(
  input: PostNarrativeMemoryStageInput,
): Promise<PostNarrativeMemoryStageResult> {
  const rawMemory = buildImmediateMemory(input.userInput, [
    input.narrativeSummary ? `本回合小结：${input.narrativeSummary}` : '',
    input.body,
  ].filter(Boolean).join('\n\n'));
  const memoryWithImmediate = addImmediateMemory(input.memory, rawMemory, input.turn);
  const compress = input.compress ?? autoCompressMemorySystemWithArchivesAsync;
  const compression = await compress(
    memoryWithImmediate,
    input.turn,
    input.settings,
    input.mainConfig,
    input.signal,
    input.irminsul,
  );
  const irminsul = compression.archives.reduce(promoteIrminsulEntry, input.irminsul);
  const failureCount = compression.failures.length;
  const detail = failureCount > 0
    ? `记忆总结有 ${failureCount} 批 API 失败，已保留完整失败草稿；当前回合继续使用本地 fallback。`
    : compression.usedModel
      ? '即时/短期/中期/长期记忆已调用记忆总结 API 完成整理。'
      : '即时/短期/中期/长期记忆已使用本地摘要完成整理。';

  return {
    memory: compression.memory,
    irminsul,
    feedback: failureCount > 0
      ? {
          status: 'failed',
          detail,
          failCount: failureCount,
          retryHint: '打开记忆系统的“失败草稿”页重新总结。',
        }
      : { status: 'success', detail },
  };
}
