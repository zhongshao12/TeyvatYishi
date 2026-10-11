import { describe, expect, it } from 'vitest';
import { sanitizeCourierSeedFact, extractCourierSpeechEvent } from '@/services/ai/courierService';
import { displayCourierMessageText, sanitizeCourierMessageText } from '@/utils/courierTextSanitizer';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CourierConversationList } from '@/components/features/Courier/CourierConversationList';
import { CourierMessageTimeline } from '@/components/features/Courier/CourierMessageTimeline';
import type { CourierConversation } from '@/models/teyvat/courier';
import { MAX_COURIER_MESSAGES_PER_CONVERSATION, normalizeCourierConversation } from '@/models/teyvat/courier';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import { buildContextSnapshot } from '@/hooks/useGame/contextSnapshot';
import { buildSystemPrompt } from '@/hooks/useGame/systemPromptBuilder';
import { 创建空角色 } from '@/models/character';
import { 创建空世界状态 } from '@/models/world';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建默认游戏设置 } from '@/models/settings';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import { 创建NPC记录, 提取NPC同行记忆文本列表, buildNpcMemoryLedgerView, formatNpcLedgerForPrompt } from '@/models/npc';
import { composeCourierLetterLocally } from '@/services/ai/courierService';

describe('courier fact sanitation', () => {
  it.each([
    ['明天见。<char_seven>安柏 好感:120 信任:90</char_seven>路上小心。', '明天见。路上小心。'],
    ['<variables><fact>秘密结算记录</fact></variables>一起喝茶吧。', '一起喝茶吧。'],
    ['路上小心。\n<char_seven>\n安柏 好感:120\n内部结算', '路上小心。'],
    ['安柏Complete.\n明天见。', '明天见。'],
    ['七维关系状态\n安柏 | 好感 120 | 信任 90 | 尊重 80\n明天一起喝茶。', '明天一起喝茶。'],
    ['主动联系理由：好感足够，可低频投递。\n变量事实：char_seven 更新完成。\n明天见。', '明天见。'],
    ['<变量事实>秘密结算记录</变量事实><七维关系状态>名分:20</七维关系状态>明天见。', '明天见。'],
    ['<char_seven\n秘密数值', ''],
    ['秘密记录</char_seven>明天见。', '明天见。'],
    ['秘密结算：次日主动联系\n观察对象正在接受测试\n</char_seven>\n明天见。', '明天见。'],
    ['七维关系状态\n安柏 | 20 | 30 | 40 | 50 | 60 | 70 | 80\n环境很好，明天见。', '环境很好，明天见。'],
    ['本回合主动联系主动理由：关系触发。\n明天见。', '明天见。'],
    ['Complete your mission, then come home.', 'Complete your mission, then come home.'],
    ['名分|环境|利益|情欲|好感|接受度|经验\n安柏 | 20 | 30 | 40 | 50 | 60 | 70 | 80\n环境很好。', '环境很好。'],
    ['| 名分 | 环境 | 利益 | 情欲 | 好感 | 接受度 | 经验 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 安柏 | 20 | 30 | 40 | 50 | 60 | 70 | 80 |', ''],
  ])('removes metadata bodies without discarding natural chat: %s', (raw, expected) => {
    expect(sanitizeCourierSeedFact(raw)).toBe(expected);
  });

  it('does not turn a third-person relationship ledger into spoken events', () => {
    expect(extractCourierSpeechEvent('安柏对旅行者的长期印象：值得信赖，关系有所提升。')).toBeNull();
  });

  it('retains role-known third-person facts for model context', () => {
    expect(sanitizeCourierSeedFact('安柏与旅行者一起在城门喝过茶。')).toBe('安柏与旅行者一起在城门喝过茶。');
  });

  it.each(['名分', '环境', '利益', '情欲', '好感', '接受度', '经验'])('removes single internal numeric key %s', (key) => {
    expect(sanitizeCourierSeedFact(`${key}:40\n环境很好，明天见。`)).toBe('环境很好，明天见。');
  });

  it('uses different sanitation for factual context and spoken ledger narration', () => {
    const fact = '最近共同经历：安柏和旅行者在城门喝过茶。';
    expect(sanitizeCourierSeedFact(fact)).toContain('在城门喝过茶');
    expect(sanitizeCourierMessageText(fact)).toBe('');
    expect(sanitizeCourierMessageText('路上小心。\n安柏对旅行者的长期印象：值得信任。')).toBe('路上小心。');
    expect(displayCourierMessageText('<char_seven>秘密结算</char_seven>')).toBe('消息正文含内部记录，已隐藏。');
  });

  it.each(['关于我对你的好感，我想当面告诉你。', '你必须记得：我一直相信你。'])('retains natural personal speech even when it mentions ledger-like words: %s', (speech) => {
    expect(sanitizeCourierMessageText(speech)).toBe(speech);
  });

  it('renders historical timeline and list preview safely without rewriting history', () => {
    const raw = '<char_seven>秘密结算</char_seven>明天见。';
    const conversation: CourierConversation = { id: 'history', title: '安柏', participantIds: ['player', 'amber'], messages: [{ id: 'old', senderId: 'amber', senderName: '安柏', role: 'contact', content: raw, turn: 2, timestamp: 1, readBy: [] }], unread: 0, type: 'private', typingMemberIds: [], updatedAt: 1 };
    const list = renderToStaticMarkup(createElement(CourierConversationList, { conversations: [conversation], hiddenConversationCount: 0, onSelect: () => undefined, onShowMore: () => undefined }));
    const timeline = renderToStaticMarkup(createElement(CourierMessageTimeline, { selected: conversation, visibleMessages: conversation.messages, hiddenMessageCount: 0, contactNameById: new Map(), messageBottomRef: { current: null }, resolveSenderAvatar: () => undefined, onShowEarlier: () => undefined }));
    expect(list).not.toMatch(/char_seven|秘密结算/);
    expect(timeline).not.toMatch(/char_seven|秘密结算/);
    expect(list).toContain('明天见。');
    expect(timeline).toContain('明天见。');
    expect(conversation.messages[0]?.content).toBe(raw);
  });

  it('does not propagate old contaminated messages into newly generated archive summaries', () => {
    const raw = '<char_seven>秘密结算</char_seven>明天见。';
    const messages = Array.from({ length: MAX_COURIER_MESSAGES_PER_CONVERSATION + 1 }, (_, index) => ({ id: `old-${index}`, senderId: 'amber', senderName: '安柏', role: 'contact', content: raw, turn: 2, timestamp: index + 1, readBy: [] }));
    const normalized = normalizeCourierConversation({ id: 'archive', title: '安柏', type: 'private', participantIds: ['player', 'amber'], messages, unread: 0, typingMemberIds: [], updatedAt: 1 });
    expect(normalized?.localArchive?.entries[0]?.summary).not.toMatch(/char_seven|秘密结算/);
    expect(normalized?.localArchive?.entries[0]?.summary).toContain('明天见。');
    expect(messages[0]?.content).toBe(raw);
  });

  it('cleans old archive downstream reads non-destructively in context and prompt', () => {
    const raw = '已归档：<char_seven>秘密结算</char_seven>明天见。';
    const phone = { ...createEmptyCourierSystem(), conversations: [{ id: 'archive', title: '安柏', type: 'private' as const, participantIds: ['player', 'amber'], messages: [], unread: 0, typingMemberIds: [], updatedAt: 1, localArchive: { threshold: 400, entries: [], compressedSummaries: [raw] } }] };
    const settings = 创建默认游戏设置();
    const snapshot = buildContextSnapshot({ 手机: phone, chatHistory: [], gameSettings: settings } as unknown as UseGameStateReturn, 'courier');
    const prompt = buildSystemPrompt(创建空角色(), 创建空世界状态(), 创建空记忆系统(), settings, 2, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, phone).systemPrompt;
    expect(JSON.stringify(snapshot)).not.toMatch(/char_seven|秘密结算/);
    expect(prompt).not.toMatch(/char_seven|秘密结算/);
    expect(prompt).toContain('明天见。');
    expect(phone.conversations[0]?.localArchive.compressedSummaries[0]).toBe(raw);
  });

  it('rejects named third-person seed narration locally while keeping model facts', () => {
    const fact = '安柏在城门喝过茶。';
    expect(sanitizeCourierSeedFact(fact)).toBe(fact);
    expect(extractCourierSpeechEvent(fact)).toBeNull();
    const seed = { id: 'named', senderId: 'npc_amber', reason: '', turn: 2, source: 'memory' as const, triggerType: 'quest' as const, priority: 'normal' as const, targetType: 'private' as const, targetId: 'npc_amber', title: '', context: fact, relatedNpcIds: [], status: 'pending' as const };
    expect(composeCourierLetterLocally({ seed, sender: { name: '安柏' } })).not.toMatch(/安柏在|约定|说好|安排好/);
    expect(composeCourierLetterLocally({ seed: { ...seed, context: '阿明在城门喝过茶。' }, sender: { name: '阿明' } })).not.toContain('阿明在');
  });

  it('cleans legacy phone-source memory in all generic prompt readers while preserving story memory', () => {
    const raw = '<变量事实>秘密结算</变量事实><char_seven>名分:1.5 环境:25 利益:0 情欲:40 好感:100 接受度:100 经验:40</char_seven>明天见。';
    const story = '档案见到<古代符号>，铭文Complete your mission尚待解读。';
    const npc = { ...创建NPC记录({ 姓名: '安柏', 阶位: 'companion', 初见回合: 1 }), id: 'npc_amber', 同行: true, 最近互动: raw, 同行记忆: [{ id: 'phone-old', 回合: 1, 来源: '手机' as const, 摘要: raw, 原文: raw }, { id: 'story-old', 回合: 1, 来源: '正文' as const, 摘要: story }] };
    const ledger = buildNpcMemoryLedgerView(npc);
    expect(提取NPC同行记忆文本列表(npc)).toEqual(['明天见。', story]);
    expect(ledger.最近互动).toBe('明天见。');
    expect(formatNpcLedgerForPrompt({ npc, ledger, score: 1, reasons: [], fields: [], presentState: 'current' })).not.toMatch(/char_seven|变量事实|秘密结算|名分:1.5/);
    const prompt = buildSystemPrompt(创建空角色(), 创建空世界状态(), 创建空记忆系统(), 创建默认游戏设置(), 2, undefined, undefined, [npc]).systemPrompt;
    expect(prompt).not.toMatch(/char_seven|变量事实|秘密结算|名分:1.5/);
    expect(prompt).toContain(story);
    expect(npc.同行记忆[0]?.摘要).toBe(raw);
    expect(npc.最近互动).toBe(raw);
  });
});
