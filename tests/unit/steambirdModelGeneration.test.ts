import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as model from '@/services/ai/steambirdModel';
import { confirmSteambirdFact } from '@/services/steambirdPublicFacts';
import { 创建空蒸汽鸟报API覆盖, type API配置项 } from '@/models/settings';
import { DEFAULT_STREAM_FIRST_BYTE_TIMEOUT_MS } from '@/services/ai/chatCompletionClient';
const config: API配置项 = { id: 'main', name: 'main', provider: 'openai_compatible', baseUrl: 'https://main.invalid/v1', model: 'main', apiKey: 'fake', createdAt: 1, updatedAt: 1 };
const text = '公开事件：风花节公开展览已开幕。';
const fact = confirmSteambirdFact({ domain: 'world', fact: 'ignored', evidence: text }, { history: [{ kind: 'narration', text }], moment: { worldName: '提瓦特', date: '1000.03.11', clock: '14:30', weather: '晴', location: '蒙德', travelDay: 2, turn: 7, settlementId: 'A:7' }, playerConfirmed: false })!;
const draft = () => ({ title: '风花节开幕', lead: '蒙德公开展览开幕。', body: '市民可前往展览参观。', sourceFactIds: [fact.id] });
function reply(data: unknown) { return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }] }), { headers: { 'content-type': 'application/json' } }); }
function generate(overrides: Partial<Parameters<typeof model.generateSteambirdArticles>[1]> = {}) { return model.generateSteambirdArticles(config, { publicFacts: [fact], maxEntries: 2, ...overrides }); }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('independent steambird model', () => {
  it('inherits empty fields, preserves explicit zero and rejects incomplete config', () => {
    expect(model.resolveSteambirdApiConfig({ ...创建空蒸汽鸟报API覆盖(), temperature: 0, retryCount: 0 }, config)).toMatchObject({ baseUrl: config.baseUrl, model: config.model, apiKey: 'fake', temperature: 0, retryCount: 0 });
    expect(model.resolveSteambirdApiConfig(创建空蒸汽鸟报API覆盖(), null)).toBeNull();
  });
  it('uses actual override URL/model and only whitelisted confirmed facts', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => reply({ publicArticles: [draft()] })); vi.stubGlobal('fetch', fetcher);
    const selected = model.resolveSteambirdApiConfig({ ...创建空蒸汽鸟报API覆盖(), baseUrl: 'https://news.invalid/v1', model: 'news' }, config)!;
    const phases: string[] = [];
    expect(await model.generateSteambirdArticles(selected, { publicFacts: [{ ...fact, fullState: 'SECRET', phone: 'PRIVATE' }], maxEntries: 2, onPhase: phase => { phases.push(phase); } })).toEqual([draft()]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0]?.[0]).toBe('https://news.invalid/v1/chat/completions');
    const payload = String((fetcher.mock.calls[0]?.[1] as RequestInit).body);
    expect(payload).toContain('news'); expect(payload).toContain(fact.id); expect(payload).not.toMatch(/SECRET|PRIVATE|fullState|phone/);
    expect(phases).toEqual(['connecting', 'receiving', 'validating']);
  });
  it.each([
    { publicArticles: [] }, { publicArticles: [{ ...draft(), sourceFactIds: [] }] }, { publicArticles: [{ ...draft(), sourceFactIds: ['unknown'] }] },
    { publicArticles: [draft()], privateFacts: [] }, { publicArticles: [{ ...draft(), fullState: {} }] },
    ...(['title', 'lead', 'body'] as const).map((field, index) => ({ publicArticles: [{ ...draft(), [field]: '字'.repeat([41, 181, 601][index]!) }] })),
  ])('rejects malformed/private/overlong output %j', async data => { vi.stubGlobal('fetch', async () => reply(data)); await expect(generate()).rejects.toThrow(); });
  it('accepts exact character limits and ignores failing phase diagnostics', async () => {
    const article = { ...draft(), title: '字'.repeat(40), lead: '字'.repeat(180), body: '字'.repeat(600) };
    vi.stubGlobal('fetch', async () => reply({ publicArticles: [article] }));
    expect(await generate({ onPhase: () => { throw new Error('diagnostics only'); } })).toEqual([article]);
  });
  it('surfaces provider 400 rather than local fallback success', async () => { vi.stubGlobal('fetch', async () => new Response('bad request', { status: 400 })); await expect(generate()).rejects.toThrow(/400/); });
  it('does not send pre-aborted requests', async () => { const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const controller = new AbortController(); controller.abort(); await expect(generate({ signal: controller.signal })).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); });
  it('cancels or times out a body that stalls after headers', async () => {
    vi.useFakeTimers(); let cancelled = false;
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ cancel: () => { cancelled = true; } })));
    const controller = new AbortController(); const pending = generate({ signal: controller.signal }); const observed = expect(pending).rejects.toThrow(); await vi.advanceTimersByTimeAsync(0); controller.abort(); await observed; expect(cancelled).toBe(true);
    cancelled = false; const stalled = generate(); const timed = expect(stalled).rejects.toThrow(/超|timeout/i); await vi.advanceTimersByTimeAsync(DEFAULT_STREAM_FIRST_BYTE_TIMEOUT_MS + 1); await timed; expect(cancelled).toBe(true);
  });
});
