import { afterEach, describe, expect, it, vi } from 'vitest';
import type { API配置项 } from '@/models/settings';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';

function config(topP: number): API配置项 {
  return {
    id: 'top-p-test', name: 'top-p test', provider: 'openai_compatible',
    baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', model: 'test-model',
    topP, createdAt: 1, updatedAt: 1,
  };
}

const request = { messages: [{ role: 'user', content: '你好' }], deepSeekRecovery: 'disabled' as const };

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI-compatible top_p request boundary', () => {
  it.each([0, -0.1, 1.1, Number.NaN])('omits invalid configured top_p %s so a rejecting API can answer', async (topP) => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      if ('top_p' in body) {
        return new Response(JSON.stringify({ error: { message: 'Invalid top_p value, the valid range of top_p is (0, 1.0]' } }), { status: 400 });
      }
      return Response.json({ choices: [{ message: { content: '可以继续' } }] });
    }));

    await expect(chatCompletionNonStream(config(topP), request)).resolves.toBe('可以继续');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('top_p');
  });

  it('retains a valid explicitly requested top_p', async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({ choices: [{ message: { content: '可以继续' } }] });
    }));

    await expect(chatCompletionNonStream(config(0), { ...request, topP: 0.72 })).resolves.toBe('可以继续');
    expect(body?.top_p).toBe(0.72);
  });
});
