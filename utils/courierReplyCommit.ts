import type { CourierMessage, CourierSystem } from '@/models/teyvat/courier';
import { appendCourierMessage } from '@/services/ai/courierService';

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

export function applyCourierReplyMessageIfLive(input: {
  current: CourierSystem;
  currentSessionId: number;
  expectedSessionId: number;
  conversationId: string;
  messageIds: readonly string[];
  message: CourierMessage;
}): CourierSystem {
  if (input.currentSessionId !== input.expectedSessionId
    || !isCourierReplyTargetLive(input.current, input.conversationId, input.messageIds)) return input.current;
  return appendCourierMessage(input.current, input.conversationId, input.message);
}
