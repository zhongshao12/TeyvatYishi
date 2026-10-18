import { expect, it, vi } from 'vitest';
import { createCore2MemoryModel } from '@/services/ai/core2MemoryModel';
import { 创建默认记忆系统设置 } from '@/models/settings';
it('never reports a local fallback as a successful model summary', async () => {
  const summarize = vi.fn(async () => ({ summary: 'fallback preview', usedFallback: true, usedModel: false, usedLocal: false, failureCode: 'empty_output' as const, failureMessage: '模型为空' }));
  const model = createCore2MemoryModel({ id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://invalid.example', apiKey: 'test-only', model: 'test', createdAt: 0, updatedAt: 0 }, 创建默认记忆系统设置(), summarize);
  expect(await model({ items: ['明确事件'], turn: 1, layer: 'short', prompt: '归纳' })).toEqual({ kind: 'failed', code: 'empty_output', detail: '模型为空' });
});
