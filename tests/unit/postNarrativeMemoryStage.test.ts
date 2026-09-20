import { describe, expect, it } from 'vitest';

import { settlePostNarrativeMemory } from '@/hooks/useGame/postNarrativeMemoryStage';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建默认记忆系统设置, type API配置项 } from '@/models/settings';
import { createEmptyIrminsulMemory } from '@/models/teyvat/irminsul';

describe('post-narrative memory stage', () => {
  it('adds immediate memory, archives compression output, and reports model success', async () => {
    const result = await settlePostNarrativeMemory({
      memory: 创建空记忆系统(),
      irminsul: createEmptyIrminsulMemory(),
      userInput: '去找安柏。',
      narrativeSummary: '旅行者抵达蒙德城门。',
      body: '【旁白】安柏在城门前挥手。',
      turn: 6,
      settings: 创建默认记忆系统设置(),
      mainConfig: {} as API配置项,
      compress: async (memory) => ({
        memory,
        archives: [{
          id: 'archive-6',
          title: '第六回纪要',
          archiveType: 'short',
          summary: '安柏在城门迎接旅行者。',
          sourceText: '城门相遇',
          keywords: ['安柏', '蒙德'],
          sourceTurns: [6],
          turn: 6,
          recordedAt: '第6回',
        }],
        failures: [],
        usedFallback: false,
        usedModel: true,
        usedLocal: false,
      }),
    });

    expect(result.memory.即时记忆[0]).toContain('玩家输入：去找安柏。');
    expect(result.memory.即时记忆[0]).toContain('本回合小结：旅行者抵达蒙德城门。');
    expect(result.irminsul.entries.map((entry) => entry.id)).toEqual(['archive-6']);
    expect(result.feedback.status).toBe('success');
    expect(result.feedback.detail).toContain('记忆总结 API');
  });

  it('preserves the memory result and exposes retry feedback when compression fails', async () => {
    const result = await settlePostNarrativeMemory({
      memory: 创建空记忆系统(),
      irminsul: createEmptyIrminsulMemory(),
      userInput: '继续。',
      narrativeSummary: '',
      body: '【旁白】旅途继续。',
      turn: 7,
      settings: 创建默认记忆系统设置(),
      mainConfig: {} as API配置项,
      compress: async (memory) => ({
        memory,
        archives: [],
        failures: [{ id: 'failed-draft' }] as never[],
        usedFallback: true,
        usedModel: false,
        usedLocal: true,
      }),
    });

    expect(result.memory.即时记忆[0]).toContain('剧情回应：【旁白】旅途继续。');
    expect(result.feedback.status).toBe('failed');
    expect(result.feedback.failCount).toBe(1);
    expect(result.feedback.retryHint).toContain('失败草稿');
  });
});
