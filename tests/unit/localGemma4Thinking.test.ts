import { afterEach, expect, it, vi } from 'vitest';
import { chatCompletion, chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import { LOCAL_GEMMA4_128K_PROFILE } from '@/data/localTextModelPresets';
import type { API配置项 } from '@/models/settings';

afterEach(() => vi.unstubAllGlobals());
const base = { ...LOCAL_GEMMA4_128K_PROFILE, id: 'local-thinking-test', createdAt: 1, updatedAt: 1 };
it.each(['stream', 'non-stream'] as const)('sends the chosen thinking switch to local Ollama in %s mode and excludes reasoning from visible replies', async mode => {
  for (const [thinking, expected] of [[false, 'none'], [true, 'high']] as const) {
    let body: Record<string, unknown> = {}, visible = '';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return mode === 'stream' ? new Response('data: {"choices":[{"delta":{"reasoning":"private internal text"}}]}\n\ndata: {"choices":[{"delta":{"content":"你好，旅行者。"}}]}\n\ndata: [DONE]\n\n')
        : Response.json({ choices: [{ message: { content: '你好，旅行者。', reasoning: 'private internal text' } }] });
    });
    const config = { ...base, ollamaThinking: thinking }, request = { messages: [{ role: 'user', content: '你好' }], deepSeekRecovery: 'disabled' as const };
    if (mode === 'stream') await chatCompletion(config, request, { onDelta: delta => { visible += delta; }, onDone: () => {}, onError: error => { throw error; } });
    else visible = await chatCompletionNonStream(config, request);
    expect(body.reasoning_effort).toBe(expected); expect(body).not.toHaveProperty('think'); expect(visible).toBe('你好，旅行者。');
  }
});
it('does not leak the local switch to remote APIs or unsupported models, and leaves the model default untouched when unset', async () => {
  for (const config of [base, { ...base, ollamaThinking: false, baseUrl: 'https://example.invalid/v1' }, { ...base, ollamaThinking: true, baseUrl: 'http://localhost.attacker.invalid:11434/v1' }, { ...base, ollamaThinking: false, model: 'unverified-model' }] satisfies API配置项[]) {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return Response.json({ choices: [{ message: { content: 'ok' } }] }); });
    expect(await chatCompletionNonStream(config, { messages: [], deepSeekRecovery: 'disabled' })).toBe('ok');
    expect(body).not.toHaveProperty('reasoning_effort');
  }
});
