import { afterEach, describe, expect, it, vi } from 'vitest';
import type { API配置项 } from '@/models/settings';
import { chatCompletion } from '@/services/ai/chatCompletionClient';

vi.mock('@/services/ai/apiErrorReportService', () => ({ appendApiErrorReport: vi.fn(async () => undefined) }));
afterEach(() => vi.unstubAllGlobals());

describe('HTTP 200 protocol stream failures', () => {
  it.each([
    ['openai_compatible', 'story', { choices: [{ delta: { content: 'partial story' } }] }, { error: { message: 'overloaded', code: 'overloaded_error' } }],
    ['claude', 'claude-story', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial story' } }, { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } }],
    ['gemini', 'gemini-story', { candidates: [{ content: { parts: [{ text: 'partial story' }] } }] }, { error: { code: 503, message: 'overloaded', status: 'UNAVAILABLE' } }],
    ['opencode', 'gpt-story', { type: 'response.output_text.delta', delta: 'partial story' }, { type: 'response.failed', response: { error: { code: 'overloaded_error', message: 'overloaded' } } }],
    ['opencode', 'claude-story', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial story' } }, { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } }],
    ['opencode', 'gemini-story', { candidates: [{ content: { parts: [{ text: 'partial story' }] } }] }, { error: { message: 'overloaded' } }],
  ] as const)('rejects %s / %s after a visible delta without successful completion', async (provider, model, partial, error) => {
    const config: API配置项 = { id: 'protocol-error', name: 'test', provider, model,
      baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', createdAt: 1, updatedAt: 1 };
    vi.stubGlobal('fetch', async () => new Response([partial, error].map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
      { headers: { 'Content-Type': 'text/event-stream' } }));
    const callbacks = { onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    await expect(chatCompletion(config, { messages: [{ role: 'user', content: 'story' }], deepSeekRecovery: 'disabled' }, callbacks))
      .rejects.toThrow('overloaded');
    expect(callbacks.onDelta).toHaveBeenCalledWith('partial story');
    expect(callbacks.onDone).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledOnce();
  });
});
