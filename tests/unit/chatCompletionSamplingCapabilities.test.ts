import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletion, chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import type { API配置项 } from '@/models/settings';
vi.mock('@/services/ai/apiErrorReportService', () => ({ appendApiErrorReport: vi.fn(async () => undefined) }));
afterEach(() => vi.unstubAllGlobals());
const original: API配置项 = { id: 'sampling', name: 'sampling', provider: 'openai', model: 'gpt-test',
  baseUrl: 'https://api.openai.com/v1', apiKey: 'test-key', repetitionPenalty: 1.2, maxContext: 1,
  topP: 0.7, frequencyPenalty: 0.3, presencePenalty: 0.4, maxTokens: 2500, createdAt: 1, updatedAt: 1 };

describe('sampling parameter capability boundary', () => {
  it.each(['stream', 'non-stream'] as const)('omits unverified extensions for native OpenAI and unknown gateways (%s)', async (mode) => {
    for (const config of [original, { ...original, provider: 'openai_compatible' as const, baseUrl: 'https://example.invalid/v1' },
      { ...original, provider: 'openai_compatible' as const, baseUrl: 'https://openrouter.ai.example.invalid/api/v1' }]) {
      let body: Record<string, unknown> = {};
      vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return mode === 'stream' ? new Response('data: {"choices":[{"delta":{"content":"done"}}]}\n\n')
          : Response.json({ choices: [{ message: { content: 'done' } }] });
      });
      const request = { messages: [{ role: 'user', content: '长材料'.repeat(400) }], deepSeekRecovery: 'disabled' as const };
      await (mode === 'stream' ? chatCompletion(config, request, { onDelta: () => {}, onDone: () => {}, onError: () => {} })
        : chatCompletionNonStream(config, request));
      expect(body).not.toHaveProperty('repetition_penalty');
      expect(body).not.toHaveProperty('max_context_tokens');
      expect(body).toMatchObject({ top_p: 0.7, frequency_penalty: 0.3, presence_penalty: 0.4, max_tokens: 2500 });
      expect(body.messages).toEqual(request.messages); // maxContext is not a send-blocking or truncation ceiling.
      expect(config.repetitionPenalty).toBe(1.2);
      expect(config.maxContext).toBe(1);
    }
  });

  it('sends only the documented repetition extension to the explicit OpenRouter endpoint', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { body = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: 'done' } }] }); });
    await chatCompletionNonStream({ ...original, provider: 'openai_compatible', baseUrl: 'https://openrouter.ai/api/v1' },
      { messages: [], deepSeekRecovery: 'disabled' });
    expect(body.repetition_penalty).toBe(1.2);
    expect(body).not.toHaveProperty('max_context_tokens');
  });

  it.each(['gemini', 'opencode'] as const)('omits repetitionPenalty from %s GenerationConfig', async (provider) => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      body = provider === 'opencode' ? payload.body : payload;
      return new Response('data: {"candidates":[{"content":{"parts":[{"text":"done"}]}}]}\n\n');
    });
    await chatCompletion({ ...original, provider, model: 'gemini-test' }, { messages: [], deepSeekRecovery: 'disabled' },
      { onDelta: () => {}, onDone: () => {}, onError: () => {} });
    expect(body.generationConfig).not.toHaveProperty('repetitionPenalty');
    expect(body.generationConfig).toMatchObject({ topP: 0.7, frequencyPenalty: 0.3, presencePenalty: 0.4 });
  });
});
