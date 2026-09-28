import type { CourierContact, CourierConversation, CourierSystem } from '@/models/teyvat/courier';

export const MAX_COURIER_CONTACT_REMARK_LENGTH = 40;

export function normalizeCourierContactRemark(value: string): string {
  return Array.from(value.trim()).slice(0, MAX_COURIER_CONTACT_REMARK_LENGTH).join('');
}

export function setCourierContactRemark(system: CourierSystem, contactId: string, remark: string): CourierSystem {
  const nextRemark = normalizeCourierContactRemark(remark);
  if (!system.contacts.some((contact) => contact.id === contactId)) return system;
  return {
    ...system,
    contacts: system.contacts.map((contact) => {
      if (contact.id !== contactId) return contact;
      const { remark: _previousRemark, ...withoutRemark } = contact;
      return nextRemark ? { ...withoutRemark, remark: nextRemark } : withoutRemark;
    }),
  };
}

export function displayCourierContactName(contact: CourierContact): string {
  return contact.remark?.trim() || contact.name;
}

export function displayCourierConversationTitle(conversation: CourierConversation, contacts: CourierContact[]): string {
  if (conversation.type !== 'private') return conversation.title;
  const contact = contacts.find((item) => conversation.participantIds.includes(item.id) || Boolean(item.npcId && conversation.participantIds.includes(item.npcId)));
  return contact ? displayCourierContactName(contact) : conversation.title;
}
