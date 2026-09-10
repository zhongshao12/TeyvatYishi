import { describe, expect, it } from 'vitest';
import {
  buildCachePrefixDiagnostics,
  buildTurnTokenUsage,
} from '../../hooks/useGame/turnDiagnostics';

describe('turnDiagnostics', () => {
  it('prefers API token usage over local estimates', () => {
    const usage = buildTurnTokenUsage({
      apiUsage: {
        source: 'api',
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedTokens: 48,
        provider: 'deepseek',
        model: 'deepseek-chat',
      },
      systemPrompt: '系统提示',
      messages: [{ id: 'user-1', role: 'user', content: '你好', timestamp: 1 }],
      outputText: '回应',
      provider: 'fallback-provider',
      model: 'fallback-model',
    });

    expect(usage).toMatchObject({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedTokens: 48,
      source: 'api',
      provider: 'deepseek',
      model: 'deepseek-chat',
    });
    expect(usage.cacheHitRate).toBeCloseTo(0.4);
  });

  it('falls back to estimates and marks cache-only API data as mixed', () => {
    const estimated = buildTurnTokenUsage({
      systemPrompt: '请讲一个关于蒙德的短故事。',
      messages: [{ id: 'user-1', role: 'user', content: '从城门开始。', timestamp: 1 }],
      outputText: '风穿过城门。',
      provider: 'openai_compatible',
      model: 'story-model',
    });
    const mixed = buildTurnTokenUsage({
      apiUsage: { source: 'api', cachedTokens: 10 },
      systemPrompt: '固定前缀',
      messages: [],
      outputText: '新正文',
      provider: 'deepseek',
      model: 'deepseek-chat',
    });

    expect(estimated.source).toBe('estimate');
    expect(estimated.inputTokens).toBeGreaterThan(0);
    expect(estimated.outputTokens).toBeGreaterThan(0);
    expect(mixed.source).toBe('mixed');
    expect(mixed.cachedTokens).toBe(10);
    expect(mixed.uncachedTokens).toBeUndefined();
  });

  it('keeps cache-prefix diagnostics disabled unless a previous prompt exists', () => {
    expect(buildCachePrefixDiagnostics({
      enabled: false,
      systemPrompt: '固定',
      messages: [],
      previous: { systemPrompt: '固定', messages: [] },
    })).toBeUndefined();
    expect(buildCachePrefixDiagnostics({
      enabled: true,
      systemPrompt: '固定',
      messages: [],
    })).toBeUndefined();
  });

  it('locates the first changed prompt section', () => {
    const diagnostic = buildCachePrefixDiagnostics({
      enabled: true,
      systemPrompt: '# 身份\n你是旅行者。\n# 世界\n当前位于璃月港。',
      messages: [{ role: 'user', content: '去万民堂。' }],
      previous: {
        systemPrompt: '# 身份\n你是旅行者。\n# 世界\n当前位于蒙德城。',
        messages: [{ role: 'user', content: '去猎鹿人。' }],
      },
    });

    expect(diagnostic).toBeDefined();
    expect(diagnostic?.commonPrefixRate).toBeGreaterThan(0);
    expect(diagnostic?.commonPrefixRate).toBeLessThan(1);
    expect(diagnostic?.firstDiffCurrentSection).toBe('System Prompt / 世界');
    expect(diagnostic?.changedTailTokens).toBeGreaterThan(0);
  });
});
