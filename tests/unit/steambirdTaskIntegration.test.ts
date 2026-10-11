import { afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import * as tasks from '@/hooks/useGame/postTurnSteambirdTask';
import { confirmSteambirdFact } from '@/services/steambirdPublicFacts';
import { normalizeSteambirdNews, type SteambirdNews } from '@/models/teyvat/steambird';
import type { API配置项 } from '@/models/settings';
const cfg: API配置项 = { id: 'news', name: 'news', provider: 'openai_compatible', baseUrl: 'https://news.invalid/v1', apiKey: 'fake', model: 'news', createdAt: 0, updatedAt: 0 };
const moment = { worldName: '提瓦特' as const, date: '1000.03.11', clock: '14:30', weather: '晴', location: '蒙德', travelDay: 2, turn: 5, settlementId: 'session-A:5' };
const text = '公开事件：风花节展览已向市民开放。';
const fact = confirmSteambirdFact({ domain: 'world', fact: 'ignore', evidence: text }, { history: [{ kind: 'narration', text }], moment, playerConfirmed: false })!;
let sequence = 0;
const input = () => ({ sessionId: ++sequence, settlementId: moment.settlementId, turn: 5, worldMoment: moment, facts: [fact], config: cfg, maxEntries: 2 });
function response() { return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ publicArticles: [{ title: '风花展览', lead: '展览已开放。', body: '市民可参观展览。', sourceFactIds: [fact.id] }] }) } }] })); }
afterEach(() => vi.unstubAllGlobals());
describe('frozen public news task', () => {
  it('skips absent facts or disabled scheduling without touching API', async () => { const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); expect((await tasks.runPostTurnSteambirdTask({ ...input(), facts: [] })).status).toBe('skipped'); expect(fetcher).not.toHaveBeenCalled(); });
  it('shares one actual request for repeated recovery and keeps the original moment', async () => {
    const fetcher = vi.fn(async () => response()); vi.stubGlobal('fetch', fetcher);
    const frozen = input(); const first = await tasks.runPostTurnSteambirdTask(frozen), second = await tasks.runPostTurnSteambirdTask(frozen);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(first).toEqual(second); expect(first.articles[0]?.worldMoment).toEqual(moment);
  });
  it('discards late results after switching saves, including pending task updates', async () => {
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; }); vi.stubGlobal('fetch', async () => { await waiting; return response(); });
    const frozen = input(); let current = true, news: SteambirdNews = { articles: [] };
    const pending = tasks.executeSteambirdTaskForSession(frozen, { read: () => news, update: updater => { news = updater(news); }, isCurrent: () => current });
    current = false; news = { articles: [] }; release(); await pending; expect(news).toEqual({ articles: [] });
  });
  it('merges new articles into live state without reverting existing edits or new articles', async () => {
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; }); vi.stubGlobal('fetch', async () => { await waiting; return response(); });
    const old = normalizeSteambirdNews({ articles: [{ id: 'old', body: '旧文' }] }).articles[0]!;
    let news: SteambirdNews = { articles: [old] };
    const pending = tasks.executeSteambirdTaskForSession(input(), { read: () => news, update: updater => { news = updater(news); }, isCurrent: () => true });
    news = { ...news, articles: [{ ...old, body: '玩家编辑' }, { ...old, id: 'concurrent', body: '新文章' }] }; release(); await pending;
    expect(news.articles.find(article => article.id === 'old')?.body).toBe('玩家编辑'); expect(news.articles.some(article => article.id === 'concurrent')).toBe(true); expect(news.articles).toHaveLength(3);
  });
  it('persists failed frozen evidence and retries without observing the newer world', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad', { status: 400 })); let news: SteambirdNews = { articles: [] }; const frozen = input();
    const owner = { read: () => news, update: (updater: (news: SteambirdNews) => SteambirdNews) => { news = updater(news); }, isCurrent: () => true };
    expect((await tasks.executeSteambirdTaskForSession(frozen, owner)).status).toBe('failed');
    news = normalizeSteambirdNews(JSON.parse(JSON.stringify(news))); const record = news.generationTasks![0]!; expect(record.facts).toEqual([fact]);
    vi.stubGlobal('fetch', async () => response()); const retried = await tasks.executeSteambirdTaskForSession({ ...frozen, facts: record.facts, worldMoment: record.worldMoment }, owner);
    expect(retried.status).toBe('success'); expect(news.articles[0]?.worldMoment).toEqual(moment); expect(news.generationTasks![0]!.status).toBe('success');
  });
});
