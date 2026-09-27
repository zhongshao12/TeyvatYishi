import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequestMetadata, readLastRequestMetadata, rememberRequestMetadata, updateRequestUsage } from '@/services/ai/requestMetadata';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import type { API配置项 } from '@/models/settings';

afterEach(() => vi.unstubAllGlobals());

describe('request metadata', () => {
  it('records estimates without retaining request content or credentials', () => {
    const record = createRequestMetadata({
      target: 'main', model: 'example', systemPrompt: 'private prompt',
      messages: [{ role: 'user', content: 'secret input' }], configuredWindow: undefined,
    });
    expect(record.estimatedInputTokens).toBeGreaterThan(0);
    expect(JSON.stringify(record)).not.toMatch(/private prompt|secret input|apiKey/i);
    expect(record.windowRatio).toBeUndefined();
    rememberRequestMetadata(record);
    expect(readLastRequestMetadata('main')?.sentAt).toBe(record.sentAt);
  });

  it('only updates returned usage on the latest attempt for that target', () => {
    const input = { target: 'courier' as const, model: 'example', systemPrompt: 'a', messages: [] };
    const old = createRequestMetadata(input);
    const latest = createRequestMetadata(input);
    rememberRequestMetadata(old);
    rememberRequestMetadata(latest);
    updateRequestUsage(old, 90);
    expect(readLastRequestMetadata('courier')?.actualInputTokens).toBeUndefined();
    updateRequestUsage(latest, 42);
    expect(readLastRequestMetadata('courier')?.actualInputTokens).toBe(42);
  });

  it('captures a real text-client request attempt and provider usage without retaining secrets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 12, completion_tokens: 2 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const config: API配置项 = {
      id: 'test', name: 'test', provider: 'openai', baseUrl: 'https://example.invalid/v1',
      apiKey: 'hidden-key', model: 'test-model', createdAt: 0, updatedAt: 0,
    };
    await chatCompletionNonStream(config, {
      purpose: 'variable', systemPrompt: 'private system text',
      messages: [{ role: 'user', content: 'private user text' }],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const record = readLastRequestMetadata('variable');
    expect(record?.actualInputTokens).toBe(12);
    expect(record?.windowRatio).toBeUndefined();
    expect(JSON.stringify(record)).not.toMatch(/hidden-key|private system text|private user text/u);
  });
});
