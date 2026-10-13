import type { TeyvatGameState } from '@/models/teyvat/state';
import type { CourierSystem } from '@/models/teyvat/courier';
import type { NPC记录 } from '@/models/npc';
import { applyLegacyNpcRecords, mapTeyvatNpcsToLegacy } from '@/hooks/useGameState';
import { applyCourierReplyMemoryIfLive, applyCourierReplyMessageIfLive } from '@/utils/courierReplyCommit';
import { appendPhoneDeliveryMemories, buildCourierSenderNpcRecords, isCourierReplySenderLive, mergeCourierSystemUpdates, resolveCourierContactNpc } from '@/services/ai/courierService';

/** 即时揭示和后台回信共用的活体根提交，不持有另一份游戏状态。 */
export function applyCourierReplyTaskResult(current: TeyvatGameState, input: {
  baseCourier: CourierSystem;
  resultCourier: CourierSystem;
  baseNpcs: NPC记录[];
  expectedSessionId: number;
  currentSessionId: number;
  messagesAlreadyRevealed?: boolean;
}): TeyvatGameState {
  if (input.expectedSessionId !== input.currentSessionId) return current;
  let courier = current.手机;
  const originalNpcs = mapTeyvatNpcsToLegacy(current);
  let npcs = originalNpcs;
  for (const conversation of input.resultCourier.conversations) {
    const base = input.baseCourier.conversations.find(item => item.id === conversation.id);
    if (!base) continue;
    const originalIds = new Set(base.messages.map(message => message.id));
    const newMessages = conversation.messages.filter(message => !originalIds.has(message.id)
      && message.senderId !== 'player' && message.replyToMessageIds?.length);
    const batches = new Map<string, readonly string[]>();
    for (const message of newMessages) {
      const messageIds = message.replyToMessageIds!;
      batches.set(JSON.stringify(messageIds), messageIds);
      if (!input.messagesAlreadyRevealed) courier = applyCourierReplyMessageIfLive({
        current: courier, conversationId: conversation.id, messageIds, message,
        expectedSessionId: input.expectedSessionId, currentSessionId: input.currentSessionId,
        expectedContact: input.baseCourier.contacts.find(contact => contact.id === message.senderId || contact.npcId === message.senderId),
      });
    }
    for (const messageIds of batches.values()) npcs = applyCourierReplyMemoryIfLive({
      current: courier, base: input.baseCourier, result: input.resultCourier, npcs, baseNpcs: input.baseNpcs,
      conversationId: conversation.id, messageIds,
      expectedSessionId: input.expectedSessionId, currentSessionId: input.currentSessionId,
    });
  }
  const withMessages = courier === current.手机 ? current : { ...current, 手机: courier };
  return npcs === originalNpcs ? withMessages : applyLegacyNpcRecords(withMessages, npcs);
}

/** 没有新消息的清理也要写回；迟到来信的记忆只根据实际接收结果重建。 */
export function applyCourierDeliveryTaskResult(current: TeyvatGameState, input: {
  baseCourier: CourierSystem;
  resultCourier: CourierSystem;
  baseNpcs: NPC记录[];
  expectedSessionId: number;
  currentSessionId: number;
}): TeyvatGameState {
  if (input.expectedSessionId !== input.currentSessionId) return current;
  const courier = mergeCourierSystemUpdates(current.手机, input.baseCourier, input.resultCourier);
  const originalNpcs = mapTeyvatNpcsToLegacy(current);
  const baseSeeds = new Map(input.baseCourier.deliverySeeds.map(seed => [seed.id, seed]));
  const receivedSeeds = input.resultCourier.deliverySeeds.filter(seed => {
    if (seed.status !== 'generated' || (baseSeeds.has(seed.id) && baseSeeds.get(seed.id)?.status !== 'pending')) return false;
    const conversation = courier.conversations.find(item => item.messages.some(message => message.sourceSeedId === seed.id));
    const message = conversation?.messages.find(item => item.sourceSeedId === seed.id);
    if (!conversation || !message || !isCourierReplySenderLive(courier, conversation.id, message.senderId,
      input.baseCourier.contacts.find(contact => contact.id === message.senderId || contact.npcId === message.senderId))) return false;
    const contact = courier.contacts.find(item => item.id === message.senderId || item.npcId === message.senderId);
    const existed = resolveCourierContactNpc(input.baseNpcs, { contactId: message.senderId, npcId: contact?.npcId, name: contact?.name ?? message.senderName, turn: message.turn });
    return !existed || originalNpcs.some(npc => npc.id === existed.id);
  });
  let npcs = originalNpcs;
  if (receivedSeeds.length) {
    const firstSeedId = receivedSeeds[0]!.id;
    const turn = courier.conversations.find(item => item.messages.some(message => message.sourceSeedId === firstSeedId))
      ?.messages.find(message => message.sourceSeedId === firstSeedId)?.turn ?? current.turnCount;
    const newRecords = buildCourierSenderNpcRecords({ dueSeeds: receivedSeeds, contacts: courier.contacts, npcs, turn });
    if (newRecords.length) npcs = [...npcs, ...newRecords];
    npcs = appendPhoneDeliveryMemories(npcs, courier, receivedSeeds, turn);
  }
  const withMessages = { ...current, 手机: courier };
  return npcs === originalNpcs ? withMessages : applyLegacyNpcRecords(withMessages, npcs);
}
