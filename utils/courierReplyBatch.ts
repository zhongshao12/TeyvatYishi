import type { CourierConversation, CourierMessage } from '@/models/teyvat/courier';

let fallbackMessageSequence = 0;

/** Keep two sends distinct even when Date.now() has not advanced. */
export function createCourierPlayerMessageId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `courier_player_${randomId}`
    : `courier_player_${Date.now()}_${++fallbackMessageSequence}`;
}

/** A virtual generation input; never append it to the stored conversation. */
export function buildCourierPlayerBatch(
  conversation: CourierConversation,
  messageIds: readonly string[],
): CourierMessage | null {
  const requestedIds = new Set(messageIds.filter(Boolean));
  if (!requestedIds.size) return null;

  const selected: CourierMessage[] = [];
  for (const message of conversation.messages) {
    if (!requestedIds.has(message.id)) continue;
    if (message.senderId !== 'player' || !message.content.trim()) return null;
    selected.push(message);
  }
  if (selected.length !== requestedIds.size) return null;

  const last = selected.at(-1);
  if (!last) return null;
  return {
    ...last,
    content: selected.map((message, index) => `${index + 1}. ${message.content.trim()}`).join('\n'),
  };
}
