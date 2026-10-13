import type { CourierContact, CourierMessage, CourierSystem } from '@/models/teyvat/courier';
import type { NPC记录 } from '@/models/npc';
import { appendCourierMessage, appendPhoneExchangeMemory, ensureCourierContactNpcRecord, isCourierReplySenderLive, resolveCourierContactNpc } from '@/services/ai/courierService';
import { buildCourierPlayerBatch } from './courierReplyBatch';

/** A reply can only target a still-existing non-system conversation and its original player messages. */
export function isCourierReplyTargetLive(
  courier: CourierSystem,
  conversationId: string,
  messageIds: readonly string[],
): boolean {
  const conversation = courier.conversations.find((item) => item.id === conversationId);
  if (!conversation || conversation.type === 'system' || !messageIds.length) return false;
  const playerIds = new Set(conversation.messages.filter((message) => message.senderId === 'player').map((message) => message.id));
  return messageIds.every((id) => Boolean(id) && playerIds.has(id));
}

/** 给通知/失败提示提供真正接收的回执，排除旧消息与已失效发送者。 */
export function getCommittedCourierMessages(base: CourierSystem, result: CourierSystem, current: CourierSystem): CourierMessage[] {
  return result.conversations.flatMap(conversation => {
    const original = base.conversations.find(item => item.id === conversation.id);
    const live = current.conversations.find(item => item.id === conversation.id);
    const originalIds = new Set(original?.messages.map(message => message.id));
    return conversation.messages.filter(message => message.senderId !== 'player' && !originalIds.has(message.id)
      && live?.messages.some(received => received.id === message.id && received.senderId === message.senderId)
      && isCourierReplySenderLive(current, conversation.id, message.senderId,
        base.contacts.find(contact => contact.id === message.senderId || contact.npcId === message.senderId)));
  });
}

export function applyCourierReplyMessageIfLive(input: {
  current: CourierSystem;
  currentSessionId: number;
  expectedSessionId: number;
  conversationId: string;
  messageIds: readonly string[];
  message: CourierMessage;
  expectedContact?: CourierContact;
}): CourierSystem {
  if (input.currentSessionId !== input.expectedSessionId
    || !isCourierReplyTargetLive(input.current, input.conversationId, input.messageIds)
    || !isCourierReplySenderLive(input.current, input.conversationId, input.message.senderId, input.expectedContact)) return input.current;
  return appendCourierMessage(input.current, input.conversationId, input.message);
}

/** 只结算活体会话确实收到的气泡；模型快照中的NPC切片不是写回来源。 */
export function applyCourierReplyMemoryIfLive(input: {
  current: CourierSystem;
  base: CourierSystem;
  result: CourierSystem;
  npcs: NPC记录[];
  baseNpcs: NPC记录[];
  conversationId: string;
  messageIds: readonly string[];
  expectedSessionId: number;
  currentSessionId: number;
}): NPC记录[] {
  if (input.currentSessionId !== input.expectedSessionId
    || !isCourierReplyTargetLive(input.current, input.conversationId, input.messageIds)) return input.npcs;
  const baseConversation = input.base.conversations.find(item => item.id === input.conversationId);
  const produced = input.result.conversations.find(item => item.id === input.conversationId);
  const current = input.current.conversations.find(item => item.id === input.conversationId);
  const player = baseConversation && buildCourierPlayerBatch(baseConversation, input.messageIds);
  if (!baseConversation || !produced || !current || !player) return input.npcs;
  const originalIds = new Set(baseConversation.messages.map(message => message.id));
  const liveById = new Map(current.messages.map(message => [message.id, message]));
  const receivedBySender = new Map<string, CourierMessage[]>();
  for (const message of produced.messages) {
    const received = liveById.get(message.id);
    if (originalIds.has(message.id) || message.senderId === 'player' || received?.senderId !== message.senderId
      || JSON.stringify(message.replyToMessageIds) !== JSON.stringify(input.messageIds)) continue;
    const expectedContact = input.base.contacts.find(contact => contact.id === message.senderId || contact.npcId === message.senderId);
    if (!isCourierReplySenderLive(input.current, input.conversationId, message.senderId, expectedContact)) continue;
    receivedBySender.set(message.senderId, [...(receivedBySender.get(message.senderId) ?? []), received]);
  }
  let updated = input.npcs;
  for (const [senderId, messages] of receivedBySender) {
    const contact = input.current.contacts.find(item => item.id === senderId) ?? input.current.contacts.find(item => item.npcId === senderId);
    if (!contact) continue;
    const registration = { contactId: contact.id, npcId: contact.npcId, name: contact.name, turn: messages[0]!.turn };
    const existed = resolveCourierContactNpc(input.baseNpcs, registration);
    // 生成期间删除的已有角色不能借手机记忆复活；首次联系才允许正常建档。
    if (existed && !updated.some(npc => npc.id === existed.id)) continue;
    updated = ensureCourierContactNpcRecord(updated, registration);
    const npc = resolveCourierContactNpc(updated, registration);
    if (!npc) continue;
    updated = appendPhoneExchangeMemory(updated, {
      npcId: npc.id, conversationId: current.id,
      exchangeId: current.type === 'group' ? `${player.id}_${senderId}` : player.id,
      turn: messages[0]!.turn,
      playerText: input.messageIds.length === 1 ? baseConversation.messages.find(message => message.id === player.id)?.content : player.content,
      replyTexts: messages.map(message => message.content),
      ...(current.type === 'group' ? { relatedNpcIds: current.participantIds.filter(id => id !== 'player' && id !== senderId) } : {}),
      worldMoment: messages[0]!.worldMoment,
    });
  }
  return updated.length !== input.npcs.length || updated.some((npc, index) => npc !== input.npcs[index]) ? updated : input.npcs;
}
