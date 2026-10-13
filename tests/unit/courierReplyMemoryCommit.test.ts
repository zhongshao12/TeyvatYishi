import { describe, expect, it } from 'vitest';
import { 创建NPC记录, type NPC记录 } from '@/models/npc';
import { createEmptyCourierSystem, type CourierSystem } from '@/models/teyvat/courier';
import * as commits from '@/utils/courierReplyCommit';
import { mergeCourierSystemUpdates, removeCourierContact, updateCourierGroupConversation } from '@/services/ai/courierService';
import { runCourierReplyPass } from '@/hooks/useGame/courierBackgroundJobs';

interface CommitInput {
  current: CourierSystem; base: CourierSystem; result: CourierSystem; npcs: NPC记录[]; baseNpcs: NPC记录[];
  conversationId: string; messageIds: readonly string[]; expectedSessionId: number; currentSessionId: number;
}
const commit = (input: CommitInput): NPC记录[] => {
  const fn = Reflect.get(commits, 'applyCourierReplyMemoryIfLive') as ((input: CommitInput) => NPC记录[]) | undefined;
  expect(fn).toBeTypeOf('function');
  return fn!(input);
};

async function fixture(type: 'group' | 'private' = 'group') {
  const npcs = ['a', 'b'].map(id => ({ ...创建NPC记录({ 姓名: '同名向导', 初见回合: 1 }), id: `npc_${id}`, 好感度: type === 'private' ? 120 : 20 }));
  const base: CourierSystem = { ...createEmptyCourierSystem(),
    contacts: ['a', 'b'].map(id => ({ id, npcId: `npc_${id}`, name: '同名向导', available: true })),
    conversations: [{ id: 'thread', title: '茶会', type, participantIds: type === 'group' ? ['player', 'a', 'b'] : ['player', 'a'],
      messages: [{ id: 'p1', senderId: 'player', senderName: '旅人', content: '谢谢，明天一起喝茶。', role: 'user', turn: 2, timestamp: 1, readBy: ['player'] }], unread: 0, typingMemberIds: [], updatedAt: 1 }] };
  const result = await runCourierReplyPass({ courier: base, npcs, turn: 2, letterApiConfig: null });
  return { npcs, base, result, input: { base, result: result.courier, npcs, baseNpcs: npcs, conversationId: 'thread', messageIds: ['p1'], expectedSessionId: 1, currentSessionId: 1 } };
}

describe('reply NPC settlement is based on committed bubbles', () => {
  it('settles only the remaining member after a background group reply', async () => {
    const state = await fixture();
    const removed = updateCourierGroupConversation(state.base, 'thread', { title: '茶会', memberIds: ['b'] });
    const current = mergeCourierSystemUpdates(removed, state.base, state.result.courier);
    const records = commit({ ...state.input, current });
    expect(records[0]).toBe(state.npcs[0]);
    expect(records[1]?.同行记忆).toHaveLength(1);
    expect(records[1]?.好感度).toBe(22);
  });
  it('does not write deleted contacts or NPC records back from the generation snapshot', async () => {
    const state = await fixture();
    const removed = removeCourierContact(state.base, 'a');
    const current = mergeCourierSystemUpdates(removed, state.base, state.result.courier);
    const records = commit({ ...state.input, current, npcs: [state.npcs[1]!] });
    expect(records.map(npc => npc.id)).toEqual(['npc_b']);
  });
  it('preserves live profile edits and unrelated memories and applies affinity only once', async () => {
    const state = await fixture();
    const current = mergeCourierSystemUpdates(state.base, state.base, state.result.courier);
    const changed = state.npcs.map(npc => ({ ...npc, 好感度: 50, 外貌: '最新的公开外貌', 同行记忆: [{ id: 'separate', 回合: 2, 摘要: '另一次观察' }] }));
    const records = commit({ ...state.input, current, npcs: changed });
    expect(records[0]).toMatchObject({ 外貌: '最新的公开外貌', 好感度: 52 });
    expect(records[0]?.同行记忆?.map(memory => memory.id)).toEqual(['separate', 'phone_thread_p1_a_npc_a']);
    expect(commit({ ...state.input, current, npcs: records })).toBe(records);
  });
  it('does not write any NPC memory before any bubble has actually been accepted', async () => {
    const state = await fixture();
    expect(commit({ ...state.input, current: state.base })).toBe(state.npcs);
  });
  it('records only received private lines rather than future unrevealed text', async () => {
    const state = await fixture('private');
    const generated = state.result.courier.conversations[0]!.messages.slice(1);
    expect(generated.length).toBeGreaterThan(1);
    const first = generated[0]!;
    const current = { ...state.base, conversations: [{ ...state.base.conversations[0]!, messages: [...state.base.conversations[0]!.messages, first] }] };
    const records = commit({ ...state.input, current });
    expect(records[0]?.同行记忆?.[0]?.原文).toContain(first.content);
    for (const future of generated.slice(1)) expect(records[0]?.同行记忆?.[0]?.原文).not.toContain(future.content);
  });
  it('does not transfer a reply memory to a re-bound namesake NPC', async () => {
    const state = await fixture();
    const current = { ...state.result.courier, contacts: state.base.contacts.map(contact => contact.id === 'a' ? { ...contact, npcId: 'npc_other' } : contact) };
    const records = commit({ ...state.input, current });
    expect(records[0]).toBe(state.npcs[0]);
    expect(records.some(npc => npc.id === 'npc_other')).toBe(false);
  });
  it('rejects a save switch and a deleted player-message anchor', async () => {
    const state = await fixture();
    expect(commit({ ...state.input, current: state.result.courier, currentSessionId: 2 })).toBe(state.npcs);
    const current = { ...state.result.courier, conversations: [{ ...state.result.courier.conversations[0]!, messages: state.result.courier.conversations[0]!.messages.filter(message => message.id !== 'p1') }] };
    expect(commit({ ...state.input, current })).toBe(state.npcs);
  });
  it('does not settle a produced message bound to a different player batch', async () => {
    const state = await fixture();
    const wrong = { ...state.result.courier, conversations: state.result.courier.conversations.map(conversation => ({ ...conversation,
      messages: conversation.messages.map(message => message.senderId === 'player' ? message : { ...message, replyToMessageIds: ['other-batch'] }) })) };
    expect(commit({ ...state.input, current: wrong, result: wrong })).toBe(state.npcs);
  });
  it('success feedback counts actual accepted messages, not rejected generated ones', async () => {
    const state = await fixture();
    const fn = Reflect.get(commits, 'getCommittedCourierMessages') as ((base: CourierSystem, result: CourierSystem, live: CourierSystem) => unknown[]) | undefined;
    expect(fn).toBeTypeOf('function');
    expect(fn!(state.base, state.result.courier, state.base)).toHaveLength(0);
    const removed = updateCourierGroupConversation(state.base, 'thread', { title: '茶会', memberIds: ['b'] });
    const current = mergeCourierSystemUpdates(removed, state.base, state.result.courier);
    expect(fn!(state.base, state.result.courier, current)).toHaveLength(1);
  });
});
