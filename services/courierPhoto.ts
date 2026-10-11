import type { CourierSystem, CourierPhotoReference, CourierMessage, CourierConversation } from '../models/teyvat/courier';
import type { TeyvatGameState } from '../models/teyvat/state';
import type { 相册条目, 图片资源 } from '../models/imageGeneration';
import { normalizeJourneyAlbum } from '../models/teyvat/runtimeSlices';
import { sanitizeCourierMessageText } from '../utils/courierTextSanitizer';

export interface CourierPhotoTarget {
  conversationId: string;
  messageId: string;
  senderId: string;
  npcId: string;
  messageContent: string;
  turn: number;
  timestamp: number;
  /** Freeze both batch identity and original requests; deleted/rebound requests invalidate preview. */
  requestFingerprint?: string;
}
export function sameCourierPhotoTarget(left: CourierPhotoTarget, right: CourierPhotoTarget): boolean {
  return left.conversationId === right.conversationId && left.messageId === right.messageId && left.senderId === right.senderId
    && left.npcId === right.npcId && left.messageContent === right.messageContent && left.turn === right.turn && left.timestamp === right.timestamp
    && left.requestFingerprint === right.requestFingerprint;
}
export function resolveCourierPhotoTarget<N extends { id: string; 姓名: string }>(phone: CourierSystem, npcs: readonly N[], conversationId: string, messageId: string): { target: CourierPhotoTarget; npc: N } | null {
  const conversation = phone.conversations.find((item) => item.id === conversationId);
  if (!conversation || conversation.type === 'system') return null;
  return resolvePhotoTargetInConversation(phone, npcs, conversation, messageId, createPhotoLookup(conversation.messages));
}

function resolvePhotoTargetInConversation<N extends { id: string; 姓名: string }>(phone: CourierSystem, npcs: readonly N[], conversation: CourierConversation, messageId: string, lookup: ReturnType<typeof createPhotoLookup>): { target: CourierPhotoTarget; npc: N } | null {
  const replyIndex = lookup.indexById.get(messageId) ?? -1;
  const message = conversation.messages[replyIndex];
  if (!message || !['assistant', 'contact'].includes(message.role) || message.senderId === 'player' || message.photo) return null;
  const requests = lookup.requestsFor(replyIndex);
  if (requests === null) return null;
  const proof = lookup.proofFor(replyIndex);
  if (!proof.complete) return null;
  const contact = phone.contacts.find((item) => item.id === message.senderId);
  if (!contact?.npcId || !contact.available || (contact.status && contact.status !== 'available') || !conversation.participantIds.includes(contact.id)) return null;
  const npc = npcs.find((item) => item.id === contact.npcId);
  if (!npc) return null;
  return { npc, target: { conversationId: conversation.id, messageId, senderId: message.senderId, npcId: npc.id, messageContent: message.content, turn: message.turn, timestamp: message.timestamp,
    ...(requests ? { requestFingerprint: JSON.stringify({ requests: requests.map(request => [request.id, request.content, request.turn, request.timestamp]), expected: proof.expected }) } : {}) } };
}

export function attachCourierPhoto(phone: CourierSystem, target: CourierPhotoTarget, photo: CourierPhotoReference): CourierSystem {
  const resolved = resolveCourierPhotoTarget(phone, [{ id: target.npcId, 姓名: '' }], target.conversationId, target.messageId);
  if (!resolved || !photo.assetId || !photo.entryId || photo.npcId !== target.npcId || !sameCourierPhotoTarget(resolved.target, target)) return phone;
  return { ...phone, conversations: phone.conversations.map((conversation) => conversation.id !== target.conversationId ? conversation : {
    ...conversation, messages: conversation.messages.map((message) => message.id !== target.messageId ? message : { ...message, photo }),
  }) };
}

/** One root-state transaction: neither a late image nor its reference may land alone. */
export function commitCourierPhotoToGame(game: TeyvatGameState, target: CourierPhotoTarget, image: { asset: 图片资源; entry: 相册条目 }, taskId?: string): TeyvatGameState {
  if (!game.NPC.some((npc) => npc.id === target.npcId) || image.asset.nsfw || image.entry.nsfw || image.entry.assetId !== image.asset.id || image.entry.targetId !== target.npcId) return game;
  const phone = attachCourierPhoto(game.手机, target, { entryId: image.entry.id, assetId: image.asset.id, npcId: target.npcId });
  if (phone === game.手机) return game;
  const album = normalizeJourneyAlbum({ ...game.相册,
    assets: [image.asset, ...game.相册.assets.filter((asset) => asset.id !== image.asset.id)],
    entries: [{ ...image.entry, kind: 'character', url: '', prompt: image.asset.prompt ?? '', description: image.entry.title, turn: target.turn }, ...game.相册.entries.filter((entry) => entry.id !== image.entry.id)],
    generationTasks: game.相册.generationTasks.map((task) => task.id === taskId ? { ...task, status: 'success', resultAssetId: image.asset.id, finishedAt: Date.now() } : task),
  });
  return { ...game, 手机: phone, 相册: album };
}

/** Generated IDs correlate requests even when old replies arrive after a newer player input. */
function repliesTo(message: CourierMessage, player: CourierMessage): boolean {
  if (message.id.startsWith('courier_reply_')) {
    const prefix = `courier_reply_${player.id}_`;
    return message.id.startsWith(prefix) && /^\d+$/u.test(message.id.slice(prefix.length));
  }
  if (message.id.startsWith('courier_group_reply_')) return message.id === `courier_group_reply_${player.id}_${message.senderId}`;
  return message.turn === player.turn && message.timestamp >= player.timestamp;
}

/** Call-local indexes: no cache survives an in-place delete/edit or a session change. */
function createPhotoLookup(messages: readonly CourierMessage[]) {
  type Requests = CourierMessage[] | null | undefined;
  type Proof = { complete: boolean; expected?: string[] };
  const indexById = new Map<string, number>();
  const previousPlayers: number[] = [];
  const olderSameTurnPlayers: number[] = [];
  const turnCounts = new Map<number, number>();
  let previousPlayer = -1;
  messages.forEach((message, index) => {
    const id = message.id;
    indexById.set(id, indexById.has(id) ? -1 : index);
    previousPlayers[index] = previousPlayer;
    if (message.senderId === 'player' && message.role === 'user') {
      olderSameTurnPlayers[index] = turnCounts.get(message.turn) ?? 0;
      turnCounts.set(message.turn, olderSameTurnPlayers[index]! + 1);
      previousPlayer = index;
    }
  });
  const requestsCache = new Map<number, Requests>();
  const requestsFor = (replyIndex: number): Requests => {
    if (requestsCache.has(replyIndex)) return requestsCache.get(replyIndex);
    const reply = messages[replyIndex];
    const result: Requests = (() => {
      if (!reply || reply.sourceSeedId) return undefined;
      if (reply.replyToMessageIds !== undefined) {
        const ids = reply.replyToMessageIds;
        if (!ids.length || new Set(ids).size !== ids.length) return null;
        const requests: CourierMessage[] = [];
        let previousIndex = -1;
        for (const id of ids) {
          const index = indexById.get(id) ?? -1;
          const player = messages[index];
          if (!player || index <= previousIndex || index >= replyIndex || player.senderId !== 'player' || player.role !== 'user') return null;
          requests.push(player); previousIndex = index;
        }
        return repliesTo(reply, requests.at(-1)!) ? requests : null;
      }
      const id = reply.id;
      let playerId: string | undefined;
      if (id.startsWith('courier_group_reply_')) {
        const suffix = `_${reply.senderId}`;
        playerId = id.endsWith(suffix) ? id.slice('courier_group_reply_'.length, -suffix.length) : '';
      } else if (id.startsWith('courier_reply_')) playerId = id.match(/^courier_reply_(.+)_\d+$/u)?.[1] ?? '';
      if (playerId !== undefined) {
        const index = indexById.get(playerId) ?? -1;
        const player = messages[index];
        return player && index < replyIndex && player.senderId === 'player' && player.role === 'user' && repliesTo(reply, player) ? [player] : null;
      }
      const playerIndex = previousPlayers[replyIndex] ?? -1;
      const player = messages[playerIndex];
      // Unknown IDs cannot prove any earlier same-turn request has finished.
      return player && !olderSameTurnPlayers[playerIndex] && repliesTo(reply, player) ? [player] : undefined;
    })();
    requestsCache.set(replyIndex, result);
    return result;
  };
  const batches = new Map<string, { ids: Set<string>; proofs: CourierMessage[]; explicit: boolean }>();
  const proofCache = new Map<string, Proof>();
  let batchesBuilt = false;
  const requestKey = (requests: CourierMessage[]) => JSON.stringify(requests.map(request => request.id));
  const proofFor = (replyIndex: number): Proof => {
    const reply = messages[replyIndex];
    const requests = requestsFor(replyIndex);
    if (!reply || !requests) return { complete: !reply?.replyToMessageIds };
    if (!batchesBuilt) {
      messages.forEach((message, index) => {
        if (!['assistant', 'contact'].includes(message.role) || message.sourceSeedId) return;
        const bound = requestsFor(index);
        if (!bound) return;
        const key = requestKey(bound);
        const batch = batches.get(key) ?? { ids: new Set<string>(), proofs: [], explicit: false };
        batch.ids.add(message.id);
        batch.explicit ||= message.replyToMessageIds !== undefined;
        if (message.expectedReplyIds !== undefined) batch.proofs.push(message);
        batches.set(key, batch);
      });
      batchesBuilt = true;
    }
    const key = requestKey(requests);
    const cached = proofCache.get(key);
    if (cached) return cached;
    const batch = batches.get(key);
    let result: Proof;
    if (!batch?.proofs.length) result = { complete: !batch?.explicit };
    else if (batch.proofs.some(message => !Array.isArray(message.expectedReplyIds) || !message.expectedReplyIds.length || message.expectedReplyIds.length > 120 || !message.expectedReplyIds.includes(message.id))) result = { complete: false };
    else {
      const expected = [...new Set(batch.proofs.flatMap(message => message.expectedReplyIds ?? []))].sort();
      result = { expected, complete: expected.length <= 120 && expected.every(id => batch.ids.has(id)) };
    }
    proofCache.set(key, result);
    return result;
  };
  return { indexById, requestsFor, proofFor };
}

/** One latest exchange only, one eligible attachment target per actual responding member. */
export function listCourierPhotoCandidates<N extends { id: string; 姓名: string }>(phone: CourierSystem, npcs: readonly N[], conversationId: string) {
  const conversation = phone.conversations.find(item => item.id === conversationId);
  if (!conversation || conversation.type === 'system' || conversation.typingMemberIds.length) return [];
  const reversedPlayerIndex = [...conversation.messages].reverse().findIndex(message => message.senderId === 'player' && message.role === 'user');
  const playerIndex = reversedPlayerIndex < 0 ? -1 : conversation.messages.length - 1 - reversedPlayerIndex;
  const player = conversation.messages[playerIndex];
  if (!player) return [];
  const lookup = createPhotoLookup(conversation.messages);
  const consumedSenders = new Set(conversation.messages.slice(playerIndex + 1).filter((message, offset) => message.photo
    && lookup.requestsFor(playerIndex + 1 + offset)?.at(-1) === player).map(message => message.senderId));
  const seen = new Set<string>();
  const candidates: Array<{ target: CourierPhotoTarget; npc: N }> = [];
  for (let index = conversation.messages.length - 1; index > playerIndex; index--) {
    const message = conversation.messages[index]!;
    if (seen.has(message.senderId) || !['assistant', 'contact'].includes(message.role) || lookup.requestsFor(index)?.at(-1) !== player) continue;
    // A photo on any reply from this member consumes their target for this exchange.
    seen.add(message.senderId);
    if (consumedSenders.has(message.senderId)) continue;
    const resolved = resolvePhotoTargetInConversation(phone, npcs, conversation, message.id, lookup);
    if (resolved) candidates.push(resolved);
  }
  return candidates.reverse();
}

/** Photo boundaries exclude relation metadata even after a user edits the preview. */
export function sanitizeCourierPhotoText(raw: string): string {
  return sanitizeCourierMessageText(raw.replace(/[,，;；]/gu, '\n')).split(/\r?\n|(?<=[。！？!?])/u)
    .filter(part => !/(?:NSFW档案|私密档案|记忆账本|长期印象|关系标签|七维|char_seven|affinity|intimacy|relationship|desire|trust\s*[:=]|memory\s*(?:ledger|archive)|private\s*(?:profile|archive))/iu.test(part))
    .map(part => part.trim()).filter(Boolean).join(', ').trim();
}

/** Extract the player's request only; no NPC speech, nearby history or private threads. */
export function readCourierPhotoContext(phone: CourierSystem, target: CourierPhotoTarget): string {
  const messages = phone.conversations.find((item) => item.id === target.conversationId)?.messages ?? [];
  const index = messages.findIndex((message) => message.id === target.messageId);
  const reply = messages[index];
  if (!reply) return '';
  const requests = createPhotoLookup(messages).requestsFor(index);
  if (!requests) return '';
  const text = requests.map(request => sanitizeCourierMessageText(request.content)).join('\n');
  let inRequest = false;
  return text.split(/\r?\n|(?<=[。！？!?])/u)
    .filter(sentence => {
      const photo = /(?:拍(?:张|一|个|照)|照片|自拍|合照|photo|selfie|picture)/iu.test(sentence);
      const continuation = inRequest && /^(?:\s*(?:请|要|你|她|他)?\s*(?:站|坐|走|穿|在|背景|动作|构图|镜头|光线|地点|表情)|\s*(?:stand|sit|wear|background|composition|lighting|at\b))/iu.test(sentence);
      inRequest = photo || continuation;
      return inRequest;
    })
    .map(sanitizeCourierPhotoText).filter(Boolean).join('\n').trim();
}
