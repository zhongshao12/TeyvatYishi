import { beforeEach, describe, expect, it, vi } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { createEmptyCourierSystem, normalizeCourierSystem, reconcileCourierContactsWithNpcs, type CourierDeliverySeed, type CourierSystem } from '@/models/teyvat/courier';
import { runCourierDeliveryTask, runCourierReplyPass } from '@/hooks/useGame/courierBackgroundJobs';
import { chatCompletion } from '@/services/ai/chatCompletionClient';
import * as service from '@/services/ai/courierService';
import type { API配置项 } from '@/models/settings';
import { buildCourierReplyPrompt, buildCourierGroupReplyPrompt, generateCourierReply } from '@/services/ai/courierLetterModel';

// Only the external model transport is replaced; delivery, routing, normalization and memory are real.
vi.mock('@/services/ai/chatCompletionClient', () => ({ chatCompletion: vi.fn() }));
beforeEach(() => vi.mocked(chatCompletion).mockReset());
const config: API配置项 = { id: 'phone', name: 'phone', provider: 'openai_compatible', baseUrl: 'https://invalid.example', apiKey: 'unused', model: 'test', createdAt: 1, updatedAt: 1 };
const makeNpc = (id: string, name = '同名联系人') => ({ ...创建NPC记录({ 姓名: name, 初见回合: 1 }), id, 好感度: 120 });
const makeSeed = (senderId: string, overrides: Partial<CourierDeliverySeed> = {}): CourierDeliverySeed => ({
  id: `seed_${senderId}`, senderId, reason: '约定', turn: 2, source: 'memory', triggerType: 'quest', priority: 'normal', targetType: 'private', targetId: senderId, title: '近况', context: '下次见面一起喝茶。', relatedNpcIds: [senderId], status: 'pending', ...overrides,
});
const thread = (type: 'private' | 'group' = 'private') => ({ id: 'thread', title: '同名联系人', participantIds: ['player', 'contact_target'], messages: [{ id: 'player-1', senderId: 'player', senderName: '旅行者', role: 'user', content: '谢谢你', turn: 2, timestamp: 1, readBy: ['player'] }], unread: 0, type, typingMemberIds: [], updatedAt: 1 });

describe('October audit phone identity repairs', () => {
  it.each(['关于我对你的好感，我想当面告诉你。', '你必须记得：我一直相信你。'])('P07 preserves natural personal model replies: %s', async (speech) => {
    vi.mocked(chatCompletion).mockResolvedValue(speech);
    const conversation = thread();
    await expect(generateCourierReply(config, { conversation, playerMessage: conversation.messages[0]!, sender: { name: '安柏' } })).resolves.toBe(speech);
  });
  it('P07 sanitizes mixed model text before delivery and memory write', async () => {
    const npc = makeNpc('npc_amber', '安柏');
    const courier = { ...createEmptyCourierSystem(), contacts: [{ id: 'contact_amber', npcId: npc.id, name: npc.姓名, available: true }], deliverySeeds: [makeSeed(npc.id)] };
    vi.mocked(chatCompletion).mockResolvedValue('<char_seven>安柏 好感:120</char_seven>明天见，路上小心。\n主动联系理由：可低频投递。\n安柏Complete.');
    const result = await runCourierDeliveryTask({ enabled: true, autoGenerateSeeds: false, courier, npcs: [npc], turn: 2, now: 10, userInput: '', body: '', maxSeedsPerTurn: 1, contactCooldownTurns: 0, letterApiConfig: config });
    expect(result.courier.conversations[0]?.messages[0]?.content).toBe('明天见，路上小心。');
    expect(result.npcs[0]?.同行记忆?.[0]?.原文).toBe('安柏：明天见，路上小心。');
  });

  it('P07 nonrecoverable seeds never fabricate unfinished promises in local fallback', () => {
    const result = service.composeCourierLetterLocally({ seed: makeSeed('npc_amber', { context: '<char_seven>安柏 好感:120</char_seven>' }), sender: { name: '安柏', affinity: 120 } });
    expect(result).not.toMatch(/char_seven|好感|约定|说好|安排好了|上次|上回|一起走过/);
    expect(result.trim()).not.toBe('');
  });

  it('P07 history reads and new writes clean text without mutating old raw messages', () => {
    const raw = '<char_seven>好感:120</char_seven>明天见。';
    const oldThread = { ...thread(), messages: [{ ...thread().messages[0]!, content: raw }] };
    expect(service.buildCourierSenderProfile(makeNpc('npc_target'), oldThread).recentMessages).toEqual(['旅行者：明天见。']);
    expect(oldThread.messages[0]?.content).toBe(raw);
    const base = { ...createEmptyCourierSystem(), conversations: [oldThread] };
    const next = service.appendCourierMessage(base, 'thread', { ...thread().messages[0]!, id: 'new', content: raw });
    expect(next.conversations[0]?.messages.at(-1)?.content).toBe('明天见。');
    const records = service.appendPhoneExchangeMemory([makeNpc('npc_target')], { npcId: 'npc_target', conversationId: 'thread', exchangeId: 'new', turn: 2, replyTexts: [raw] });
    expect(records[0]?.同行记忆?.[0]?.原文).toBe('同名联系人：明天见。');
  });

  it('P07 unusable model text stays a visible failure without success or empty memory', async () => {
    const npc = makeNpc('npc_target');
    const courier = { ...createEmptyCourierSystem(), contacts: [{ id: 'contact_target', npcId: npc.id, name: npc.姓名, available: true }], conversations: [thread()] };
    vi.mocked(chatCompletion).mockResolvedValue('<char_seven>名分:40</char_seven>');
    await expect(runCourierReplyPass({ courier, npcs: [npc], letterApiConfig: config, turn: 2, fallbackPolicy: 'error' })).rejects.toThrow('REPLY_CONTAINS_META_TEXT');
    expect(courier.conversations[0]?.messages).toHaveLength(1);
    expect(npc.同行记忆 ?? []).toHaveLength(0);
    expect(service.appendPhoneExchangeMemory([npc], { npcId: npc.id, conversationId: 'thread', exchangeId: 'empty', turn: 2, replyTexts: ['<char_seven>秘密结算</char_seven>'] })[0]).toBe(npc);
  });

  it('P07 sender ledger facts are cleaned without losing real role-known third-person context', () => {
    const raw = '<变量事实>秘密结算</变量事实>安柏和旅行者在城门喝过茶。';
    const npc = { ...makeNpc('npc_amber', '安柏'), 最近互动: raw, 共同经历: [raw], 同行记忆: [{ id: 'old-memory', 回合: 1, 来源: '手机' as const, 摘要: raw, 原文: raw }] };
    const profile = service.buildCourierSenderProfile(npc);
    expect(JSON.stringify(profile)).not.toMatch(/变量事实|秘密结算/);
    expect(profile.recentInteraction).toBe('安柏和旅行者在城门喝过茶。');
    expect(npc.最近互动).toBe(raw);
  });

  it('P07 historic player messages are cleaned when read by private/group prompts and local quote fallback', () => {
    const conversation = thread();
    const playerMessage = { ...conversation.messages[0]!, content: '<char_seven>秘密结算</char_seven>明天一起喝茶。' };
    const context = { conversation, playerMessage, sender: { name: '安柏' } };
    for (const prompt of [buildCourierReplyPrompt(context), buildCourierGroupReplyPrompt(context), service.composeCourierGroupReplyLocally(context)]) {
      expect(prompt).not.toMatch(/char_seven|秘密结算/);
      expect(prompt).toContain('明天一起喝茶');
    }
  });
  it.each([['npc_amber', '安柏', 'contact_npc_amber'], ['npc_extra', '路人甲', 'contact_extra'], ['npc_old', '旧友', 'existing_contact']])('P01 delivers model text and sender memory across NPC/contact identities: %s', async (npcId, name, contactId) => {
    const npc = makeNpc(npcId, name);
    const courier = { ...createEmptyCourierSystem(), contacts: [{ id: contactId, npcId, name, available: true }], deliverySeeds: [makeSeed(npcId)] };
    vi.mocked(chatCompletion).mockResolvedValue('下次见面我请你喝茶。');
    const result = await runCourierDeliveryTask({ enabled: true, autoGenerateSeeds: false, courier, npcs: [npc], turn: 2, now: 10, userInput: '', body: '', maxSeedsPerTurn: 1, contactCooldownTurns: 0, letterApiConfig: config });
    expect(result.courier.conversations[0]?.messages.map((message) => message.content)).toEqual(['下次见面我请你喝茶。']);
    expect(result.courier.conversations[0]?.messages[0]?.senderId).toBe(contactId);
    expect(result.npcs[0]?.同行记忆?.[0]?.原文).toContain('下次见面我请你喝茶。');
    expect(service.appendPhoneDeliveryMemories(result.npcs, result.courier, courier.deliverySeeds, 2)[0]?.同行记忆).toHaveLength(1);
  });

  it.each(['private', 'group'] as const)('P02 known NPC ID wins over an earlier same-name NPC in %s replies', async (type) => {
    const result = await runCourierReplyPass({ courier: { ...createEmptyCourierSystem(), contacts: [{ id: 'contact_target', npcId: 'npc_target', name: '同名联系人', available: true }], conversations: [thread(type)] }, npcs: [makeNpc('npc_other'), makeNpc('npc_target')], letterApiConfig: null, turn: 2 });
    expect(result.npcs.find((npc) => npc.id === 'npc_other')?.好感度).toBe(120);
    expect(result.npcs.find((npc) => npc.id === 'npc_other')?.同行记忆 ?? []).toHaveLength(0);
    expect(result.npcs.find((npc) => npc.id === 'npc_target')?.好感度).toBe(122);
    expect(result.npcs.find((npc) => npc.id === 'npc_target')?.同行记忆).toHaveLength(1);
  });

  it('P02 a missing explicit NPC ID must create that record, not rebind to a namesake', () => {
    const records = service.ensureCourierContactNpcRecord([makeNpc('npc_other')], { contactId: 'contact_target', npcId: 'npc_target', name: '同名联系人', turn: 2 });
    expect(records.map((npc) => npc.id)).toEqual(['npc_other', 'npc_target']);
  });

  it('P02 seed sender registration does not treat a namesake as an explicit contact NPC', () => {
    const records = service.buildCourierSenderNpcRecords({ dueSeeds: [makeSeed('contact_target')], contacts: [{ id: 'contact_target', npcId: 'npc_target', name: '同名联系人', available: true }], npcs: [makeNpc('npc_other')], turn: 2 });
    expect(records.map((npc) => npc.id)).toEqual(['npc_target']);
  });

  it('P01 delivery reuses the NPC-backed contact even when its NPC catalog is temporarily absent', () => {
    const result = service.deliverDueCourierSeeds({ ...createEmptyCourierSystem(), contacts: [{ id: 'contact_target', npcId: 'npc_target', name: '旧友', available: true }], deliverySeeds: [makeSeed('npc_target')] }, 2, 10);
    expect(result.next.contacts.map((contact) => contact.id)).toEqual(['contact_target']);
    expect(result.next.conversations[0]?.messages[0]?.senderId).toBe('contact_target');
  });

  it('P02 a sender with a different explicit ID cannot hijack a same-name existing contact', () => {
    const result = service.deliverDueCourierSeeds({ ...createEmptyCourierSystem(), contacts: [{ id: 'contact_other', npcId: 'npc_other', name: '同名联系人', available: true }], deliverySeeds: [makeSeed('npc_target', { title: '同名联系人的来信' })] }, 2, 10);
    expect(result.next.conversations[0]?.messages[0]?.senderId).toBe('npc_target');
    expect(result.next.contacts).toHaveLength(2);
  });

  it('P02 an NPC ID cannot be hijacked by a preceding NPC whose name equals that ID', () => {
    const result = service.deliverDueCourierSeeds({ ...createEmptyCourierSystem(), deliverySeeds: [makeSeed('npc_target')] }, 2, 10, { npcs: [makeNpc('npc_other', 'npc_target'), makeNpc('npc_target', '正确联系人')] });
    expect(result.next.contacts[0]?.npcId).toBe('npc_target');
    expect(result.next.contacts[0]?.name).toBe('正确联系人');
  });

  it('P01 auto-created groups map related NPCs to contacts without duplicating the sender', () => {
    const result = service.deliverDueCourierSeeds({ ...createEmptyCourierSystem(), contacts: [
      { id: 'contact_target', npcId: 'npc_target', name: '寄件人', available: true },
      { id: 'contact_other', npcId: 'npc_other', name: '群成员', available: true },
    ], deliverySeeds: [makeSeed('npc_target', { targetType: 'group', context: '群聊公告：一起出发。', relatedNpcIds: ['npc_target', 'npc_other'] })] }, 2, 10, { npcs: [makeNpc('npc_target', '寄件人'), makeNpc('npc_other', '群成员')], allowStoryCreatedGroups: true });
    expect(result.next.conversations[0]?.participantIds).toEqual(['player', 'contact_target', 'contact_other']);
  });

  it.each([['group', 'private'], ['private', 'group']] as const)('P03 gives %s then %s independent IDs through JSON reload and merge', (first, second) => {
    const seeds = [makeSeed('npc_target', { id: 'first', targetType: first, targetId: 'group-target', context: '群聊公告：明天一起喝茶。', relatedNpcIds: ['npc_target', 'npc_other'] }), makeSeed('npc_target', { id: 'second', targetType: second, targetId: 'group-target', context: '群聊公告：明天一起喝茶。', relatedNpcIds: ['npc_target', 'npc_other'] })];
    const result = service.deliverDueCourierSeeds({ ...createEmptyCourierSystem(), deliverySeeds: seeds }, 2, 10, { allowStoryCreatedGroups: true }).next;
    expect(result.conversations).toHaveLength(2);
    expect(new Set(result.conversations.map((item) => item.id)).size).toBe(2);
    const loaded = normalizeCourierSystem(JSON.parse(JSON.stringify(result)));
    expect(service.mergeCourierSystemUpdates(loaded, loaded, loaded).conversations).toHaveLength(2);
    const updated = service.appendCourierMessage(loaded, loaded.conversations[0]!.id, { id: 'additional', senderId: 'player', senderName: '旅行者', role: 'user', content: '你好', turn: 2, timestamp: 20, readBy: ['player'] });
    expect(updated.conversations[1]?.messages.some((message) => message.id === 'additional')).toBe(false);
  });

  it('P03 reload repairs legacy duplicate IDs without discarding either conversation', () => {
    const loaded = normalizeCourierSystem(JSON.parse(JSON.stringify({ ...createEmptyCourierSystem(), conversations: [thread('group'), thread('private')] })));
    expect(new Set(loaded.conversations.map((item) => item.id)).size).toBe(2);
    expect(service.mergeCourierSystemUpdates(loaded, loaded, loaded).conversations.map((item) => item.type)).toEqual(['group', 'private']);
  });

  it('P04 a persisted group deletion rejects a task created from an older empty snapshot', () => {
    const empty = createEmptyCourierSystem();
    const oldResult = { ...empty, conversations: [{ ...thread('group'), creatorId: 'player' }] };
    const deleted = normalizeCourierSystem(JSON.parse(JSON.stringify(service.dissolveCourierGroupConversation(oldResult, 'thread'))));
    expect(service.mergeCourierSystemUpdates(deleted, empty, oldResult).conversations).toEqual([]);
  });

  it('P02 reloading a stale explicit contact NPC never silently adopts a same-name record', () => {
    const contact = { id: 'contact_target', npcId: 'npc_missing', name: '同名联系人', available: true };
    const npcs = normalizeTeyvatNpcRecords([{ id: 'npc_other', 姓名: '同名联系人' }]);
    expect(reconcileCourierContactsWithNpcs({ ...createEmptyCourierSystem(), contacts: [contact] }, npcs).contacts[0]?.npcId).toBe('npc_missing');
  });

  it('P04 a late task cannot resurrect a dissolved group or its removed pending seed', () => {
    const base: CourierSystem = { ...createEmptyCourierSystem(), conversations: [{ ...thread('group'), creatorId: 'player' }], deliverySeeds: [makeSeed('npc_target', { targetType: 'group', targetId: 'thread' })] };
    const deleted = service.dissolveCourierGroupConversation(base, 'thread');
    const merged = service.mergeCourierSystemUpdates(normalizeCourierSystem(JSON.parse(JSON.stringify(deleted))), base, base);
    expect(merged.conversations).toEqual([]);
    expect(merged.deliverySeeds).toEqual([]);
  });

  it('P04 accepts genuinely new background conversations', () => {
    const empty = createEmptyCourierSystem();
    expect(service.mergeCourierSystemUpdates(empty, empty, { ...empty, conversations: [thread()] }).conversations).toHaveLength(1);
  });

  it('P05 deleting canon contacts survives normalization, reconciliation and a late task, with explicit re-add allowed', () => {
    const npc = makeNpc('npc_amber', '安柏');
    const canonNpcs = normalizeTeyvatNpcRecords([{ id: 'npc_amber', 姓名: '安柏', roleTier: 'companion', canonical: true, firstSeenTurn: 1, lastSeenTurn: 1 }]);
    const base = { ...createEmptyCourierSystem(), contacts: [{ id: 'contact_npc_amber', npcId: 'npc_amber', name: '安柏', available: true }] };
    const remove = Reflect.get(service, 'removeCourierContact') as ((system: CourierSystem, id: string) => CourierSystem) | undefined;
    expect(remove, 'the UI deletion service must preserve user intent').toBeTypeOf('function');
    const deleted = normalizeCourierSystem(JSON.parse(JSON.stringify(remove!(base, 'contact_npc_amber'))));
    expect(reconcileCourierContactsWithNpcs(deleted, canonNpcs).contacts).toEqual([]);
    expect(service.mergeCourierSystemUpdates(deleted, base, base).contacts).toEqual([]);
    expect(service.deliverDueCourierSeeds({ ...deleted, deliverySeeds: [makeSeed('npc_amber')] }, 2, 10, { npcs: [npc] }).next.contacts).toEqual([]);
    expect(service.addNpcToCourierContacts(deleted, { ...npc, 阶位: 'companion' }).contacts.map((item) => item.npcId)).toEqual(['npc_amber']);
  });

  it('P05 blocked due seeds are dismissed instead of remaining perpetually pending', () => {
    const deleted = service.removeCourierContact({ ...createEmptyCourierSystem(), contacts: [{ id: 'contact_target', npcId: 'npc_target', name: '同名联系人', available: true }] }, 'contact_target');
    const result = service.deliverDueCourierSeeds({ ...deleted, deliverySeeds: [makeSeed('npc_target')] }, 2, 10);
    expect(result.next.deliverySeeds[0]?.status).toBe('dismissed');
    expect(result.next.unreadTotal).toBe(0);
  });

  it('P05 deleting an old ID-less canon contact survives NPC-ID reconciliation and seed delivery', () => {
    const npcs = normalizeTeyvatNpcRecords([{ id: 'npc_amber', 姓名: '安柏', roleTier: 'companion', canonical: true, firstSeenTurn: 1, lastSeenTurn: 1 }]);
    const deleted = service.removeCourierContact({ ...createEmptyCourierSystem(), contacts: [{ id: 'legacy_amber', name: '安柏', available: true }] }, 'legacy_amber');
    expect(reconcileCourierContactsWithNpcs(JSON.parse(JSON.stringify(deleted)), npcs).contacts).toEqual([]);
    const delivered = service.deliverDueCourierSeeds({ ...deleted, deliverySeeds: [makeSeed('npc_amber')] }, 2, 10, { npcs: [makeNpc('npc_amber', '安柏')] });
    expect(delivered.next.contacts).toEqual([]);
    expect(delivered.next.deliverySeeds[0]?.status).toBe('dismissed');
    expect(reconcileCourierContactsWithNpcs(service.addNpcToCourierContacts(deleted, { ...makeNpc('npc_amber', '安柏'), 阶位: 'companion' }), npcs).contacts).toHaveLength(1);
  });

  it('P05 stale contact deletion cannot append new bubbles or unread to its remaining thread', () => {
    const base = { ...createEmptyCourierSystem(), contacts: [{ id: 'contact_target', npcId: 'npc_target', name: '同名联系人', available: true }], conversations: [thread()] };
    const deleted = service.removeCourierContact(base, 'contact_target');
    const result = service.appendCourierMessage(base, 'thread', { id: 'late', senderId: 'contact_target', senderName: '同名联系人', role: 'contact', content: '迟到消息', turn: 2, timestamp: 10, readBy: [] });
    const merged = service.mergeCourierSystemUpdates(deleted, base, result);
    expect(merged.conversations[0]?.messages.map((message) => message.id)).toEqual(['player-1']);
    expect(merged.unreadTotal).toBe(0);
  });

  it('P06 local location letters never infer undisclosed environment from global state', () => {
    const seed = makeSeed('npc_remote', { triggerType: 'location_change' });
    const letter = service.composeCourierLetterLocally({ seed, sender: { name: '远方朋友' }, environment: { location: '玩家未公开的秘密密室', weather: '诡异紫色暴风雪' } });
    expect(letter).not.toContain('玩家未公开的秘密密室');
    expect(letter).not.toContain('诡异紫色暴风雪');
    expect(letter.trim()).not.toBe('');
  });
});
