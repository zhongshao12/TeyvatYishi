import { describe, expect, it } from 'vitest';
import { normalizeCourierSystem, reconcileCourierContactsWithNpcs, type CourierContact } from '@/models/teyvat/courier';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { addNpcToCourierContacts } from '@/services/ai/courierService';
import { 创建NPC记录 } from '@/models/npc';

const npcs = normalizeTeyvatNpcRecords([{ id: 'npc_guide', 姓名: '向导', roleTier: 'companion', firstSeenTurn: 1, lastSeenTurn: 2 }]);

describe('contact availability is owned by explicit unlock actions', () => {
  it.each(['known_locked', 'story_locked', 'unavailable', 'hidden'] as const)('ordinary NPC sync preserves %s', (status) => {
    const system = normalizeCourierSystem({ contacts: [{ id: 'guide', npcId: 'npc_guide', name: '旧姓名', available: false, status }] });
    const contact = reconcileCourierContactsWithNpcs(system, npcs).contacts[0];
    expect(contact).toMatchObject({ name: '向导', available: false, status });
  });

  it.each(['story_locked', 'hidden'] as const)('a contradictory imported %s status cannot make a contact available', (status) => {
    expect(normalizeCourierSystem({ contacts: [{ id: 'guide', npcId: 'npc_guide', name: '向导', available: true, status }] }).contacts[0]?.available).toBe(false);
  });

  it('preserves explicit unavailable without a status and keeps normal contacts available', () => {
    const contacts: CourierContact[] = [{ id: 'guide', npcId: 'npc_guide', name: '旧姓名', available: false }];
    expect(reconcileCourierContactsWithNpcs({ contacts }, npcs).contacts[0]?.available).toBe(false);
    expect(reconcileCourierContactsWithNpcs({ contacts: [{ ...contacts[0], available: true }] }, npcs).contacts[0]?.available).toBe(true);
  });

  it('manual re-add is an explicit unlock, not ordinary synchronization', () => {
    const npc = { ...创建NPC记录({ 姓名: '向导', 初见回合: 1 }), id: 'npc_guide', 好感度: 20 };
    const locked = normalizeCourierSystem({ contacts: [{ id: 'guide', npcId: npc.id, name: npc.姓名, available: false, status: 'story_locked' }] });
    expect(addNpcToCourierContacts(locked, npc).contacts[0]).toMatchObject({ available: true, status: 'available' });
  });
  it('does not bind an ID-less legacy contact to the first of two namesakes', () => {
    const namesakes = normalizeTeyvatNpcRecords([{ id: 'first', 姓名: '阿林' }, { id: 'second', 姓名: '阿林' }]);
    const contact = reconcileCourierContactsWithNpcs({ contacts: [{ id: 'legacy', name: '阿林', available: true }] }, namesakes).contacts[0];
    expect(contact?.npcId).toBeUndefined();
  });
  it('an ambiguous legacy alias also cannot choose the first NPC', () => {
    const namesakes = normalizeTeyvatNpcRecords([{ id: 'first', 姓名: '向导甲', aliases: ['阿林'] }, { id: 'second', 姓名: '向导乙', aliases: ['阿林'] }]);
    const contact = reconcileCourierContactsWithNpcs({ contacts: [{ id: 'legacy', name: '阿林', available: true }] }, namesakes).contacts[0];
    expect(contact?.npcId).toBeUndefined();
  });
});
