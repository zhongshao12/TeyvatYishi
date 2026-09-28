import { describe, expect, it } from 'vitest';
import { createEmptyCourierSystem, normalizeCourierSystem } from '@/models/teyvat/courier';
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
});
