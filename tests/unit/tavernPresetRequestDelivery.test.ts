import { afterEach, describe, expect, it, vi } from 'vitest';
import type { API配置项 } from '@/models/settings';
import { 创建默认游戏设置 } from '@/models/settings';
import { parseSTPresetV2 } from '@/utils/stPresetParser';
import { buildTavernMessageChain } from '@/hooks/useGame/tavernMessageChainBuilder';
import { chatCompletion, chatCompletionNonStream } from '@/services/ai/chatCompletionClient';

// Minimal, non-private fixture exercising the variable-based length/format pattern
// used by MoM exports. Do not bundle the user's third-party preset or credentials.
function presetMessages() {
  const parsed = parseSTPresetV2(JSON.stringify({
    prompts: [
      { identifier: 'init', role: 'system', content: '{{setvar::字数要求:: }}' },
      { identifier: 'length', role: 'system', content: '{{setvar::字数要求::至少3000}}' },
      { identifier: 'style', role: 'system', content: '采用轻松吐槽文风，使用短句和生活细节。' },
      { identifier: 'length-rule', role: 'system', content: '正文<content>内容需`{{getvar::字数要求}}`字' },
      { identifier: 'unused', role: 'system', content: '未启用的文风不得发送' },
    ],
    prompt_order: [{ character_id: 100001, order: [
      ...['init', 'length', 'style', 'length-rule', 'chatHistory'].map(identifier => ({ identifier, enabled: true })),
      { identifier: 'unused', enabled: false },
    ] }],
  }));
  expect(parsed.preset).not.toBeNull();
  const settings = 创建默认游戏设置();
  return buildTavernMessageChain({
    settings, preset: parsed.preset!, characterId: 100001, chatHistory: [],
    latestUserInput: '去蒙德城散步', playerName: '云', playerRole: null,
    includeNativeNarrative: false, includeNativeContextInWorldbook: false,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('imported Tavern preset actual provider payload', () => {
  it.each([
    ['gemini', 'stream'], ['gemini', 'non-stream'],
    ['opencode', 'stream'], ['opencode', 'non-stream'],
    ['openai_compatible', 'non-stream'],
  ] as const)('delivers resolved style and length through %s %s', async (provider, mode) => {
    const bodies: Record<string, any>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const result = provider === 'openai_compatible'
        ? { choices: [{ message: { content: '回应' } }] }
        : { candidates: [{ content: { parts: [{ text: '回应' }] }, finishReason: 'STOP' }] };
      if (mode === 'non-stream' && provider !== 'gemini') return Response.json(result);
      return new Response(`data: ${JSON.stringify(result)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    const config: API配置项 = {
      id: 'preset-test', name: 'preset-test', provider, model: 'gemini-test',
      baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', createdAt: 1, updatedAt: 1,
    };
    const request = { systemPrompt: '游戏底座与 NarrativeTurn JSON 合同', messages: presetMessages(), deepSeekRecovery: 'disabled' as const };
    const result = mode === 'stream'
      ? await chatCompletion(config, request, { onDelta: () => {}, onDone: () => {}, onError: () => {} })
      : await chatCompletionNonStream(config, request);
    expect(result).toBe('回应');
    expect(bodies).toHaveLength(1);
    const body = provider === 'opencode' ? bodies[0]!.body : bodies[0]!;
    // Assert on the real transport output, not the pre-provider preview.
    const delivered = provider === 'openai_compatible'
      ? body.messages.map((message: { content: string }) => message.content).join('\n')
      : body.systemInstruction.parts.map((part: { text: string }) => part.text).join('\n');
    expect(delivered).toContain('游戏底座与 NarrativeTurn JSON 合同');
    expect(delivered).toContain('采用轻松吐槽文风');
    expect(delivered).toContain('至少3000');
    expect(delivered).not.toContain('未启用的文风不得发送');
    expect(delivered).not.toContain('{{getvar::');
    expect(delivered).toContain('角色信息隔离硬约束');
    expect(delivered.indexOf('游戏底座与 NarrativeTurn JSON 合同')).toBeLessThan(delivered.indexOf('采用轻松吐槽文风'));
  });

  it('puts the resolved preset body requirements after native fallback format guards', () => {
    const messages = presetMessages();
    const lastSystem = messages.filter(message => message.role === 'system').at(-1)?.content ?? '';
    expect(lastSystem).toContain('酒馆预设执行要求');
    expect(lastSystem).toContain('至少3000');
    expect(lastSystem).toContain('NarrativeTurn.body');
    expect(lastSystem).toContain('优先于原生默认');
    expect(lastSystem.indexOf('# 酒馆预设执行要求')).toBeGreaterThan(lastSystem.indexOf('# NarrativeTurn 行动选项'));
  });
});
