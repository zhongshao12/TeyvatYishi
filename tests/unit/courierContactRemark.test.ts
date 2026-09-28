import { describe, expect, it } from 'vitest';
import { createEmptyCourierSystem, normalizeCourierSystem } from '@/models/teyvat/courier';
import { 创建NPC记录 } from '@/models/npc';
import { appendCourierMessage, selectGroupReplyMembers } from '@/services/ai/courierService';
import { buildMomentCommentPrompt } from '@/services/ai/courierMomentComments';
import { appendMomentComment, createMoment, deleteMoment, editMoment, selectMomentCommenters } from '@/services/courierMoments';
import { displayCourierContactName, setCourierContactRemark } from '@/services/courierContactRemark';

describe('phone contact remarks', () => {
  it('remark_survives_normalization_without_renaming_npc', () => {
    const original = { ...createEmptyCourierSystem(), contacts: [{ id: 'amber-contact', npcId: 'amber', name: '安柏', available: true }] };
    const updated = setCourierContactRemark(original, 'amber-contact', '侦察骑士');
    const restored = normalizeCourierSystem(JSON.parse(JSON.stringify(updated)));
    expect(restored.contacts[0]).toMatchObject({ id: 'amber-contact', npcId: 'amber', name: '安柏', remark: '侦察骑士' });
    expect(displayCourierContactName(restored.contacts[0]!)).toBe('侦察骑士');
    expect(original.contacts[0]).not.toHaveProperty('remark');
  });

  it('same_name_contacts_keep_distinct_remarks', () => {
    const original = { ...createEmptyCourierSystem(), contacts: [
      { id: 'npc-a-contact', npcId: 'npc-a', name: '阿明', available: true },
      { id: 'npc-b-contact', npcId: 'npc-b', name: '阿明', available: true },
    ] };
    const updated = setCourierContactRemark(original, 'npc-b-contact', '图书馆的阿明');
    const restored = normalizeCourierSystem(JSON.parse(JSON.stringify(updated)));
    expect(restored.contacts).toHaveLength(2);
    expect(restored.contacts.find((contact) => contact.id === 'npc-a-contact')?.remark).toBeUndefined();
    expect(restored.contacts.find((contact) => contact.id === 'npc-b-contact')?.remark).toBe('图书馆的阿明');
  });

  it('clears a remark without changing the canonical name', () => {
    const original = { ...createEmptyCourierSystem(), contacts: [{ id: 'amber', npcId: 'amber', name: '安柏', remark: '侦察骑士', available: true }] };
    const updated = setCourierContactRemark(original, 'amber', '   ');
    expect(updated.contacts[0]?.remark).toBeUndefined();
    expect(displayCourierContactName(updated.contacts[0]!)).toBe('安柏');
    expect(updated.contacts[0]?.name).toBe('安柏');
  });

  it('keeps comment persona and group @ matching on canonical NPC name after a remark', () => {
    const npc = { ...创建NPC记录({ 姓名: '安柏', 初见回合: 1 }), id: 'amber-npc', 好感度: 101 };
    const contact = { id: 'amber-contact', npcId: npc.id, name: npc.姓名, remark: '侦察骑士', available: true };
    const moment = createMoment(createEmptyCourierSystem(), { id: 'post', content: '巡逻结束了！', turn: 1, now: 1 }).moments![0]!;
    const prompt = buildMomentCommentPrompt({ post: moment, npc, profile: { name: npc.姓名, personality: '热情' } });
    expect(prompt).toContain('你是安柏');
    expect(prompt).not.toContain(contact.remark);
    expect(selectMomentCommenters('post', [contact], [npc]).map((item) => item.id)).toEqual([npc.id]);
    const group = { id: 'group', participantIds: ['player', contact.id, 'lisa', 'jean', 'kaeya'] };
    const contacts = [contact, ...['lisa', 'jean', 'kaeya'].map((id) => ({ id, name: id, available: true }))];
    const selected = selectGroupReplyMembers(group, { id: 'message-1', content: '@安柏 一起巡逻' }, 3, contacts);
    expect(selected).toContain(contact.id);
    expect(selected).toHaveLength(3);
    expect(selectGroupReplyMembers(group, { id: 'message-2', content: '@侦察骑士 一起巡逻' }, 3, contacts)).toHaveLength(4);
  });

  it('keeps incoming phone messages when a moment is edited or deleted during delivery', () => {
    const initial = createMoment({
      ...createEmptyCourierSystem(),
      contacts: [{ id: 'amber', npcId: 'amber-npc', name: '安柏', remark: '侦察骑士', available: true }],
      conversations: [{ id: 'private', title: '安柏', participantIds: ['player', 'amber'], messages: [], unread: 0, type: 'private', typingMemberIds: [], updatedAt: 1 }],
    }, { id: 'post', content: '第一次动态', turn: 1, now: 1 });
    const message = { id: 'letter', senderId: 'amber', senderName: '安柏', role: 'contact', content: '明天见！', turn: 2, timestamp: 2, readBy: [] };
    const withLetter = appendCourierMessage(initial, 'private', message);
    const edited = editMoment(withLetter, 'post', '修改后的动态', 3);
    const stale = appendMomentComment(edited, 'post', 1, { id: 'stale', npcId: 'amber-npc', npcName: '安柏', content: '旧评论', createdAt: 2 });
    expect(stale.moments?.[0]?.comments).toEqual([]);
    expect(stale.conversations[0]?.messages).toEqual([message]);
    expect(stale.contacts[0]?.remark).toBe('侦察骑士');
    const deleted = deleteMoment(stale, 'post');
    const restored = normalizeCourierSystem(JSON.parse(JSON.stringify(deleted)));
    expect(restored.moments).toEqual([]);
    expect(restored.conversations[0]?.messages).toMatchObject([{ id: 'letter', senderName: '安柏' }]);
    expect(restored.contacts[0]?.remark).toBe('侦察骑士');
  });
});
