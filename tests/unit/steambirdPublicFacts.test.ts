import { describe, expect, it } from 'vitest';
import { confirmSteambirdFact, selectUnreportedPublicFacts } from '@/services/steambirdPublicFacts';
import { normalizeSteambirdNews } from '@/models/teyvat/steambird';
import type { StoryBlock } from '@/models/teyvat/narrativeTurn';
import type { WorldMoment } from '@/models/teyvat/worldMoment';

const moment: WorldMoment = { worldName: '提瓦特', date: '1000.03.11', clock: '14:30', weather: '晴', location: '蒙德', travelDay: 2, turn: 7, settlementId: 'session-A:7' };
function confirm(text: string, options: { kind?: StoryBlock['kind']; playerConfirmed?: boolean; evidence?: string; moment?: WorldMoment | null } = {}) {
  return confirmSteambirdFact({ domain: 'world', fact: '夹带的秘密：玩家私聊', evidence: options.evidence ?? text }, {
    history: [{ kind: options.kind ?? 'narration', text }], moment: options.moment === undefined ? moment : options.moment, playerConfirmed: options.playerConfirmed ?? false,
  });
}
describe('steambird public evidence boundary', () => {
  it.each(['丽莎在图书馆私下告诉玩家秘密。', '安柏在公共广场小声与玩家私谈。', '旁白：玩家心里知道了计划。', '公开事件：骑士团计划明天公开调查结果。', '公开公告：骑士团没有公开调查结果。', '公开事件：假如骑士团公开了调查结果，市民会安心。', '公开公告：琴说她打算公开调查结果。'])('does not promote private/uncertain text: %s', text => expect(confirm(text)).toBeNull());
  it.each(['dialogue', 'system'] as const)('rejects marker in %s blocks', kind => expect(confirm('公开公告：骑士团发布了解除戒严的通知。', { kind })).toBeNull());
  it('requires literal evidence and a known committed moment', () => {
    expect(confirm('公开事件：市民参加了风花节。', { evidence: '玩家的秘密' })).toBeNull();
    expect(confirm('公开事件：市民参加了风花节。', { moment: null })).toBeNull();
    expect(confirm('公开事件：市民参加了风花节。', { moment: { ...moment, date: null } })).toBeNull();
  });
  it('derives confirmed details from validated evidence, never candidate private fields', () => {
    const result = confirm('公开公告：骑士团发布了解除戒严的通知。')!;
    expect(result.detail).toBe('骑士团发布了解除戒严的通知。');
    expect(result.title).not.toContain('秘密');
    expect(result.channel).toBe('public_announcement');
    expect(result.worldMoment).toEqual(moment);
    expect(Object.keys(result).sort()).toEqual(['channel', 'confirmation', 'detail', 'evidence', 'id', 'settlementId', 'title', 'turn', 'worldMoment'].sort());
  });
  it('permits deliberate player confirmation, not dialogue or injected evidence', () => {
    expect(confirm('市民参加了风花节。', { playerConfirmed: true })?.confirmation).toBe('player');
    expect(confirm('玩家心里打算公开此事。', { playerConfirmed: true })).toBeNull();
    expect(confirm('你好', { playerConfirmed: true, evidence: '秘密' })).toBeNull();
  });
  it('isolates identical evidence by settlement and normalizes without private extras', () => {
    const a = confirm('公开事件：市民参加了风花节。')!;
    const b = confirm('公开事件：市民参加了风花节。', { moment: { ...moment, settlementId: 'session-B:7' } })!;
    expect(a.id).not.toBe(b.id);
    const news = normalizeSteambirdNews({ articles: [{ id: 'old', body: '旧文章' }], confirmedFacts: [{ ...a, phone: 'secret', fullState: {} }, a, { ...a, id: 'bad', confirmation: 'guess' }] });
    expect(news.articles[0]?.body).toBe('旧文章');
    expect(news.articles[0]?.sourceFactIds).toBeUndefined();
    expect(news.confirmedFacts).toEqual([a]);
    expect(normalizeSteambirdNews(JSON.parse(JSON.stringify(news)))).toEqual(news);
    expect(selectUnreportedPublicFacts(news, { firstTurn: 6, lastTurn: 7 })).toEqual([a]);
    expect(selectUnreportedPublicFacts({ ...news, articles: [{ ...news.articles[0]!, sourceFactIds: [a.id] }] }, { firstTurn: 6, lastTurn: 7 })).toEqual([]);
  });
});
