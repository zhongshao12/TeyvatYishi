import { describe, expect, it, vi } from 'vitest';
import { createEmptyCourierSystem, type CourierMessage, type CourierSystem } from '@/models/teyvat/courier';
import { applyCourierReplyMessageIfLive } from '@/utils/courierReplyCommit';
import { mergeCourierSystemUpdates, removeCourierContact, updateCourierGroupConversation } from '@/services/ai/courierService';
import { runCourierReplyPass } from '@/hooks/useGame/courierBackgroundJobs';
import type { API配置项 } from '@/models/settings';

const base: CourierSystem = {
  ...createEmptyCourierSystem(), contacts: ['a', 'b'].map(id => ({ id, npcId: `npc_${id}`, name: '同名向导', available: true })),
  conversations: [{ id: 'group', title: '茶会', type: 'group', participantIds: ['player', 'a', 'b'], messages: [{ id: 'p1', senderId: 'player', senderName: '旅人', role: 'user', content: '谢谢', turn: 1, timestamp: 1, readBy: ['player'] }], unread: 0, typingMemberIds: [], updatedAt: 1 }],
};
const reply = (id = 'a'): CourierMessage => ({ id: `reply_${id}`, senderId: id, senderName: '同名向导', role: 'contact', content: `${id}收到。`, replyToMessageIds: ['p1'], turn: 1, timestamp: 2, readBy: [] });
const commit = (current: CourierSystem) => applyCourierReplyMessageIfLive({ current, currentSessionId: 1, expectedSessionId: 1, conversationId: 'group', messageIds: ['p1'], message: reply() });

describe('reply sender eligibility at each bubble commit', () => {
  it('rejects a late reply from a member removed while the model was running', () => {
    const live = updateCourierGroupConversation(base, 'group', { title: '新群名', memberIds: ['b'] });
    expect(commit(live)).toBe(live);
  });
  it('rejects a reply after deleting the contact even if old roster messages remain', () => {
    const live = removeCourierContact(base, 'a');
    expect(commit(live)).toBe(live);
  });
  it.each([{ available: false }, { available: true, status: 'story_locked' as const }])('rejects unavailable/locked senders: %j', (lock) => {
    const live = { ...base, contacts: base.contacts.map(contact => contact.id === 'a' ? { ...contact, ...lock } : contact) };
    expect(commit(live)).toBe(live);
  });
  it('does not rebind a generated reply after the same contact ID is assigned to another NPC', () => {
    const live = { ...base, contacts: base.contacts.map(contact => contact.id === 'a' ? { ...contact, npcId: 'npc_other' } : contact) };
    const input = { current: live, currentSessionId: 1, expectedSessionId: 1, conversationId: 'group', messageIds: ['p1'], message: reply(), expectedContact: base.contacts[0] };
    expect(applyCourierReplyMessageIfLive(input)).toBe(live);
  });
  it('still accepts another present member without resolving by their shared display name', () => {
    const live = updateCourierGroupConversation(base, 'group', { title: '茶会', memberIds: ['b'] });
    const next = applyCourierReplyMessageIfLive({ current: live, currentSessionId: 1, expectedSessionId: 1, conversationId: 'group', messageIds: ['p1'], message: reply('b') });
    expect(next.conversations[0]?.messages.at(-1)?.senderId).toBe('b');
  });
  it('background merge rejects removed senders and preserves the live roster/title', () => {
    const live = updateCourierGroupConversation(base, 'group', { title: '已编辑', memberIds: ['b'] });
    const result = { ...base, conversations: [{ ...base.conversations[0]!, messages: [...base.conversations[0]!.messages, reply(), reply('b')], unread: 2 }] };
    const next = mergeCourierSystemUpdates(live, base, result);
    expect(next.conversations[0]?.messages.map(message => message.id)).toEqual(['p1', 'reply_b']);
    expect(next.conversations[0]).toMatchObject({ title: '已编辑', participantIds: ['player', 'b'], unread: 1 });
  });
  it('background merge cannot re-enable a locked contact using its old task snapshot', () => {
    const live = { ...base, contacts: base.contacts.map(contact => contact.id === 'a' ? { ...contact, available: false } : contact) };
    const next = mergeCourierSystemUpdates(live, base, base);
    expect(next.contacts[0]?.available).toBe(false);
  });
  it('a retry does not request a former member merely because old proof lists them', async () => {
    const existing = { ...reply('b'), id: 'courier_group_reply_p1_b', expectedReplyIds: ['courier_group_reply_p1_a', 'courier_group_reply_p1_b'] };
    const live = updateCourierGroupConversation({ ...base, conversations: [{ ...base.conversations[0]!, messages: [...base.conversations[0]!.messages, existing] }] }, 'group', { title: '茶会', memberIds: ['b'] });
    const generate = vi.fn(async () => '收到。');
    const config: API配置项 = { id: 'fake', name: 'fake', provider: 'openai_compatible', baseUrl: 'https://invalid.example', apiKey: 'unused', model: 'fake', createdAt: 1, updatedAt: 1 };
    const result = await runCourierReplyPass({ courier: live, npcs: [], turn: 2, letterApiConfig: config, groupReplyGenerator: generate,
      replyBatch: { conversationId: 'group', messageIds: ['p1'] } });
    expect(generate).not.toHaveBeenCalled();
    expect(result.npcs).toEqual([]);
  });
  it('does not generate a private reply for a locked contact even before async commit', async () => {
    const live = { ...base, contacts: base.contacts.map(contact => ({ ...contact, available: false })), conversations: [{ ...base.conversations[0]!, type: 'private' as const, participantIds: ['player', 'a'] }] };
    const result = await runCourierReplyPass({ courier: live, npcs: [], turn: 2, letterApiConfig: null });
    expect(result.replied).toBe(0);
    expect(result.npcs).toEqual([]);
  });
});
