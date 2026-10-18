import { describe, expect, it, vi } from 'vitest';
import { createCore2NarrativeModel } from '@/services/ai/core2NarrativeModel';
import type { API配置项 } from '@/models/settings';
import { makeSeed } from './fixtures';
const config: API配置项 = { id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://invalid.example', apiKey: 'test-only', model: 'test', createdAt: 0, updatedAt: 0, maxTokens: 1024, retryCount: 0, topP: 0 };
const raw = (text: string) => JSON.stringify({ body: [{ kind: 'narration', text }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } });
describe('core2 shared main request policy', () => {
  it('preserves preset long-form output capacity and performs the existing bounded rewrite rather than publishing two bodies', async () => {
    const seed = makeSeed(), signal = new AbortController().signal;
    const complete = vi.fn().mockResolvedValueOnce(raw('安柏' + '文'.repeat(800))).mockResolvedValueOnce(raw('安柏' + '文'.repeat(3000)));
    const result = await createCore2NarrativeModel(complete)({ config, signal, snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, context: { systemPrompt: 'test', messages: [{ role: 'user', content: '问候' }], validation: { wordCountTarget: 3000, partyNpcIds: ['npc-amber'] } } });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result).toContain('文'.repeat(3000));
    expect(complete.mock.calls[0]?.[1]).toMatchObject({ maxTokens: 4800, signal, purpose: 'main', topP: 0 });
    expect(complete.mock.calls[1]?.[1].messages.at(-1).content).toContain('3000');
  });
  it('does not retry an explicit non-retryable provider error', async () => {
    const seed = makeSeed(); const complete = vi.fn().mockRejectedValue(Object.assign(Error('configuration'), { nonRetryable: true }));
    await expect(createCore2NarrativeModel(complete)({ config, snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, context: { systemPrompt: '', messages: [], validation: { wordCountTarget: null, partyNpcIds: ['npc-amber'] } } })).rejects.toThrow('configuration');
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
