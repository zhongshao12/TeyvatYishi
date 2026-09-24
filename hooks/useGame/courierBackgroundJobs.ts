import type { API配置项 } from '@/models/settings';
import { 提取NPC同行记忆文本列表, type NPC记录 } from '@/models/npc';
import type { CourierDeliverySeed, CourierSystem } from '@/models/teyvat/courier';
import {
  appendPhoneExchangeMemory,
  appendPhoneDeliveryMemories,
  appendCourierMessage,
  beginCourierReply,
  buildCourierSenderNpcRecords,
  buildCourierSenderProfile,
  composeCourierGroupReplyLocally,
  composeCourierReplyLocally,
  ensureCourierContactNpcRecord,
  endCourierReply,
  findCourierReplyCandidates,
  type CourierReplyCandidate,
  selectGroupReplyMembers,
  splitLetterIntoLines,
  type CourierGroupReplyContext,
  type CourierLetterEnvironment,
  type CourierReplyContext,
} from '@/services/ai/courierService';
import { generateCourierGroupReply, generateCourierLetter, generateCourierReply } from '@/services/ai/courierLetterModel';
import { appendApiErrorReport } from '@/services/ai/apiErrorReportService';
import { processScheduledCourierSeeds } from './courierWorkflow';
import { buildCourierPlayerBatch } from '@/utils/courierReplyBatch';

/**
 * 信使回信纯逻辑：找出最后一条仍是玩家消息的会话，为每个会话生成一封联系人回信
 * （AI 优先，失败回退本地写作器），返回更新后的信使系统与回信数量。
 * 队列提示 / 通知 / toast 等有状态编排留在 sendWorkflow。
 */
export interface CourierReplyPassInput {
  courier: CourierSystem;
  npcs: NPC记录[];
  /** Save identity: old requests must not block or release a new save's claim. */
  sessionId?: number;
  environment?: CourierLetterEnvironment;
  travelerName?: string;
  letterApiConfig: API配置项 | null;
  turn: number;
  maxReplies?: number;
  /** 群聊中每条玩家消息最多几位成员跟帖（默认 3）。 */
  maxGroupReplies?: number;
  /** 可注入的群聊人物生成器；生产环境默认使用手机独立模型。 */
  groupReplyGenerator?: typeof generateCourierGroupReply;
  /** IDs already claimed by the caller (the UI keeps its claim through bubble reveal). */
  preclaimedConversationIds?: readonly string[];
  /** A specific committed player-message range for immediate replies. */
  replyBatch?: { conversationId: string; messageIds: readonly string[] };
  /** Immediate UI replies fail visibly; background jobs retain their local fallback. */
  fallbackPolicy?: 'local' | 'error';
}

export interface CourierReplyPassResult {
  courier: CourierSystem;
  npcs: NPC记录[];
  replied: number;
}

export const COURIER_MESSAGE_REVEAL_INTERVAL_MS = 500;

export interface CourierDeliveryTaskInput {
  enabled: boolean;
  autoGenerateSeeds: boolean;
  courier: CourierSystem;
  npcs: NPC记录[];
  turn: number;
  now: number;
  userInput: string;
  body: string;
  maxSeedsPerTurn: number;
  contactCooldownTurns: number;
  environment?: CourierLetterEnvironment;
  travelerName?: string;
  letterApiConfig: API配置项 | null;
}

export interface CourierDeliveryTaskResult {
  status: 'skipped' | 'success';
  courier: CourierSystem;
  npcs: NPC记录[];
  delivered: number;
  newNpcNames: string[];
  detail: string;
}

export async function runCourierDeliveryTask(input: CourierDeliveryTaskInput): Promise<CourierDeliveryTaskResult> {
  if (!input.enabled) {
    return {
      status: 'skipped', courier: input.courier, npcs: input.npcs, delivered: 0, newNpcNames: [],
      detail: '手机消息已关闭，本回合已跳过。',
    };
  }
  let courier = input.courier;
  let npcs = input.npcs;
  if (input.autoGenerateSeeds) {
    const fallbackSeed = buildFallbackCourierSeed({
      courier,
      npcs,
      turn: input.turn,
      userInput: input.userInput,
      body: input.body,
      maxSeedsPerTurn: input.maxSeedsPerTurn,
      contactCooldownTurns: input.contactCooldownTurns,
    });
    if (fallbackSeed) {
      courier = {
        ...courier,
        deliverySeeds: [...courier.deliverySeeds, fallbackSeed],
        unreadTotal: courier.unreadTotal + 1,
      };
    }
  }

  const scheduled = processScheduledCourierSeeds(courier, input.turn, input.now, {
    npcs,
    environment: input.environment,
    travelerName: input.travelerName,
  });
  if (!scheduled.due.length) {
    return {
      status: 'skipped', courier, npcs, delivered: 0, newNpcNames: [],
      detail: '本回合没有待处理的手机消息。',
    };
  }
  courier = scheduled.next;

  for (const seed of scheduled.due.slice(0, 2)) {
    if (!input.letterApiConfig) break;
    const senderNpc = npcs.find((npc) => npc.id === seed.senderId || seed.relatedNpcIds.includes(npc.id));
    const senderConversation = courier.conversations.find((conversation) =>
      conversation.messages.some((message) => message.sourceSeedId === seed.id)
      || conversation.participantIds.includes(seed.senderId));
    try {
      const letter = await generateCourierLetter(input.letterApiConfig, {
        seed,
        sender: buildCourierSenderProfile(senderNpc, senderConversation, senderNpc?.姓名?.trim() || seed.title || seed.senderId),
        environment: input.environment,
        travelerName: input.travelerName,
      });
      courier = replaceSeedMessagesWithAiLetter(courier, seed, letter);
    } catch {
      // 本地投递内容已经生成，AI 润色失败时直接保留。
    }
  }

  const newNpcRecords = buildCourierSenderNpcRecords({
    dueSeeds: scheduled.due,
    contacts: courier.contacts,
    npcs,
    turn: input.turn,
  });
  if (newNpcRecords.length) npcs = [...npcs, ...newNpcRecords];
  npcs = appendPhoneDeliveryMemories(npcs, courier, scheduled.due, input.turn);
  return {
    status: 'success',
    courier,
    npcs,
    delivered: scheduled.due.length,
    newNpcNames: newNpcRecords.map((npc) => npc.姓名),
    detail: `已送达 ${scheduled.due.length} 条定时手机消息。`,
  };
}

export interface CourierReplyTaskInput extends Omit<CourierReplyPassInput, 'maxReplies'> {
  enabled: boolean;
  maxReplies?: number;
  onPending?: (detail: string) => void;
}

export interface CourierReplyTaskResult extends CourierReplyPassResult {
  status: 'skipped' | 'success';
  pendingDetail?: string;
  detail: string;
}

export async function runCourierReplyTask(input: CourierReplyTaskInput): Promise<CourierReplyTaskResult> {
  if (!input.enabled) {
    return { status: 'skipped', courier: input.courier, npcs: input.npcs, replied: 0, detail: '手机消息已关闭。' };
  }
  const candidates = findCourierReplyCandidates(input.courier, input.maxReplies ?? 2);
  if (!candidates.length) {
    return { status: 'skipped', courier: input.courier, npcs: input.npcs, replied: 0, detail: '本回合没有待回复的手机会话。' };
  }
  const pendingDetail = `正在生成 ${candidates.length} 个手机会话的角色回复。`;
  input.onPending?.(pendingDetail);
  const result = await runCourierReplyPass({ ...input, maxReplies: input.maxReplies ?? 2 });
  return {
    ...result,
    status: result.replied > 0 ? 'success' : 'skipped',
    pendingDetail,
    detail: result.replied > 0 ? `已生成 ${result.replied} 个手机会话回复。` : '本回合没有生成手机回复。',
  };
}

export function buildFallbackCourierSeed(input: {
  courier: CourierSystem;
  npcs: NPC记录[];
  turn: number;
  userInput: string;
  body: string;
  maxSeedsPerTurn: number;
  contactCooldownTurns: number;
}): CourierDeliverySeed | null {
  if (input.maxSeedsPerTurn <= 0) return null;
  const pendingCount = input.courier.deliverySeeds.filter((seed) => seed.status === 'pending').length;
  if (pendingCount >= input.maxSeedsPerTurn || pendingCount > 0) return null;

  const cooldown = Math.max(1, Math.trunc(input.contactCooldownTurns || 3));
  const fallbackGlobalCooldown = Math.max(3, cooldown);
  const lastNonUrgentSeedTurn = input.courier.deliverySeeds
    .filter((seed) => seed.priority !== 'urgent')
    .reduce((latest, seed) => Math.max(latest, Number(seed.turn) || 0), 0);
  if (lastNonUrgentSeedTurn > 0 && input.turn - lastNonUrgentSeedTurn < fallbackGlobalCooldown) return null;

  const text = `${input.userInput}\n${input.body}`;
  const candidates = input.npcs
    .filter((npc) => npc.关系 !== 'enemy')
    .filter((npc) => npc.阶位 === 'companion' || npc.同行 || 提取NPC同行记忆文本列表(npc).length > 0)
    .filter((npc) => {
      const recentTurn = Number(npc.最近回合 || 0);
      if (recentTurn < Math.max(1, input.turn - 4)) return false;
      const aliases = [npc.姓名, npc.别名].filter((item): item is string => Boolean(item?.trim()));
      return npc.同行 || aliases.some((name) => text.includes(name));
    })
    .filter((npc) => {
      const lastSeedTurn = input.courier.deliverySeeds
        .filter((seed) => seed.targetId === npc.id || seed.targetId === `npc_${npc.id}` || seed.relatedNpcIds.includes(npc.id))
        .reduce((latest, seed) => Math.max(latest, Number(seed.turn) || 0), 0);
      return lastSeedTurn <= 0 || input.turn - lastSeedTurn >= cooldown;
    })
    .sort((left, right) => {
      if (left.同行 !== right.同行) return left.同行 ? -1 : 1;
      const recentDiff = Number(right.最近回合 || 0) - Number(left.最近回合 || 0);
      if (recentDiff !== 0) return recentDiff;
      return 提取NPC同行记忆文本列表(right).length - 提取NPC同行记忆文本列表(left).length;
    });

  const npc = candidates[0];
  if (!npc) return null;
  const reason = [
    input.body.replace(/\s+/g, ' ').trim().slice(0, 120),
    提取NPC同行记忆文本列表(npc).slice(-1)[0],
  ].filter(Boolean).join('；');
  const title = `${npc.姓名}的跟进来信`;
  const context = `${npc.姓名}近期与旅行者有互动，可低频投递一封跟进、确认状况或延续约定的来信。已发生事实：${reason || '近期剧情互动。'}`;
  if (hasRecentSimilarCourierSeed({ courier: input.courier, npcId: npc.id, turn: input.turn, title, context })) return null;
  return {
    id: `courier_seed_fallback_${input.turn}_${npc.id}_${Math.random().toString(36).slice(2, 8)}`,
    senderId: npc.id,
    reason: '近期剧情互动跟进',
    turn: input.turn,
    source: 'main_story',
    triggerType: npc.同行 ? 'quest' : 'relationship',
    priority: 'low',
    targetType: 'private',
    targetId: npc.id,
    title,
    context,
    relatedNpcIds: [npc.id],
    expiresAfterTurns: 6,
    status: 'pending',
  };
}

function replaceSeedMessagesWithAiLetter(
  courier: CourierSystem,
  seed: CourierDeliverySeed,
  letter: string,
): CourierSystem {
  return {
    ...courier,
    conversations: courier.conversations.map((conversation) => {
      if (!conversation.participantIds.includes(seed.senderId)) return conversation;
      const firstIndex = conversation.messages.findIndex((message) => message.sourceSeedId === seed.id);
      if (firstIndex < 0) return conversation;
      const seedMessageCount = conversation.messages.filter((message) => message.sourceSeedId === seed.id).length;
      const template = conversation.messages[firstIndex];
      if (!template) return conversation;
      const rebuilt = splitLetterIntoLines(letter).map((text, lineIndex) => ({
        ...template,
        id: `courier_seed_message_${seed.id}_ai_${lineIndex}`,
        content: text,
        timestamp: (template.timestamp || 0) + lineIndex,
      }));
      return {
        ...conversation,
        messages: [
          ...conversation.messages.slice(0, firstIndex),
          ...rebuilt,
          ...conversation.messages.slice(firstIndex + seedMessageCount),
        ],
      };
    }),
  };
}

function hasRecentSimilarCourierSeed(input: {
  courier: CourierSystem;
  npcId: string;
  turn: number;
  title: string;
  context: string;
  windowTurns?: number;
}): boolean {
  const windowTurns = Math.max(3, input.windowTurns ?? 12);
  const currentText = `${input.title}\n${input.context}`;
  return input.courier.deliverySeeds.some((seed) => {
    if (input.turn - (Number(seed.turn) || 0) > windowTurns) return false;
    const sameTarget = seed.targetId === input.npcId || seed.targetId === `npc_${input.npcId}` || seed.relatedNpcIds.includes(input.npcId);
    return sameTarget && isCourierSeedTextSimilar(currentText, `${seed.title}\n${seed.context}`);
  });
}

function isCourierSeedTextSimilar(leftText: string, rightText: string): boolean {
  const normalize = (value: string) => value
    .replace(/\s+/g, '')
    .replace(/[，。！？!?；;、,.…~～“”"'\[\]（）()《》<>]/g, '')
    .trim();
  const left = normalize(leftText);
  const right = normalize(rightText);
  if (!left || !right) return false;
  if (left === right || (left.length >= 12 && right.includes(left)) || (right.length >= 12 && left.includes(right))) return true;
  const shared = [...new Set(left)].filter((char) => right.includes(char)).length;
  return shared / Math.max(1, Math.min(left.length, right.length)) >= 0.82;
}

/**
 * 把同一封手机回信按气泡逐条揭示。等待函数可注入，便于无真实计时器的单元测试。
 */
export async function revealCourierMessages<T>(
  messages: readonly T[],
  onReveal: (message: T, index: number) => void | Promise<void>,
  intervalMs = COURIER_MESSAGE_REVEAL_INTERVAL_MS,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  for (let index = 0; index < messages.length; index += 1) {
    await wait(Math.max(0, intervalMs));
    const message = messages[index];
    if (message !== undefined) await onReveal(message, index);
  }
}

export async function runCourierReplyPass(input: CourierReplyPassInput): Promise<CourierReplyPassResult> {
  const preclaimed = new Set(input.preclaimedConversationIds ?? []);
  const ownedClaims: string[] = [];
  let requestedCandidates: CourierReplyCandidate[];
  if (input.replyBatch) {
    const conversation = input.courier.conversations.find((item) => item.id === input.replyBatch?.conversationId);
    const playerMessage = conversation && conversation.type !== 'system'
      ? buildCourierPlayerBatch(conversation, input.replyBatch.messageIds)
      : null;
    if (!conversation || !playerMessage) throw new Error('PHONE_REPLY_BATCH_STALE');
    const contactId = [...conversation.messages].reverse().find((message) => message.senderId !== 'player')?.senderId
      ?? conversation.participantIds.find((id) => id !== 'player');
    if (!contactId) throw new Error('PHONE_REPLY_CONTACT_MISSING');
    requestedCandidates = [{ conversation, playerMessage, contactId }];
  } else {
    requestedCandidates = findCourierReplyCandidates(input.courier, input.maxReplies ?? 2, preclaimed);
  }
  const candidates = requestedCandidates
    .filter((candidate) => {
      if (preclaimed.has(candidate.conversation.id)) return true;
      if (!beginCourierReply(candidate.conversation.id, input.sessionId)) return false;
      ownedClaims.push(candidate.conversation.id);
      return true;
    });
  if (!candidates.length) return { courier: input.courier, npcs: input.npcs, replied: 0 };
  if (input.fallbackPolicy === 'error' && !input.letterApiConfig) {
    for (const conversationId of ownedClaims) endCourierReply(conversationId, input.sessionId);
    throw new Error('PHONE_REPLY_API_UNAVAILABLE');
  }

  let updated = input.courier;
  let updatedNpcs = input.npcs;
  let replied = 0;
  try {
    for (const candidate of candidates) {
    const { conversation, playerMessage, contactId } = candidate;

    // 群聊：多位成员跟帖（至少一人），每人一条口语化短消息，署名各自联系人。
    if (conversation.type === 'group') {
      const memberIds = selectGroupReplyMembers(conversation, playerMessage, input.maxGroupReplies ?? 3, updated.contacts);
      let nextCourier = updated;
      let memberReplied = 0;
      for (const memberId of memberIds) {
        const contact = updated.contacts.find((item) => item.id === memberId);
        const provisionalName = contact?.name?.trim() || memberId;
        updatedNpcs = ensureCourierContactNpcRecord(updatedNpcs, {
          contactId: memberId,
          ...(contact?.npcId ? { npcId: contact.npcId } : {}),
          name: provisionalName,
          turn: input.turn,
        });
        const senderNpc = updatedNpcs.find((npc) =>
          (contact?.npcId && npc.id === contact.npcId) || npc.id === memberId || (contact?.name?.trim() && npc.姓名 === contact.name.trim()));
        const senderName = contact?.name?.trim() || senderNpc?.姓名?.trim() || memberId;
        const groupContext: CourierGroupReplyContext = {
          conversation,
          playerMessage,
          sender: buildCourierSenderProfile(senderNpc, conversation, senderName),
          travelerName: input.travelerName,
        };
        let text: string;
        // 每一位实际回复者都使用自己的人设与同行记忆调用手机模型，避免第三人起退化为通用套话。
        if (input.letterApiConfig) {
          try {
            text = await (input.groupReplyGenerator ?? generateCourierGroupReply)(input.letterApiConfig, groupContext);
          } catch (error) {
            if (input.fallbackPolicy === 'error') throw error;
            console.warn('[phone-message] 群聊 AI 回复失败，已使用本地回复：', error instanceof Error ? error.message : String(error));
            void appendApiErrorReport({
              source: '手机消息群聊',
              config: input.letterApiConfig,
              requestMode: 'non-stream',
              error,
            });
            text = composeCourierGroupReplyLocally(groupContext);
          }
        } else {
          text = composeCourierGroupReplyLocally(groupContext);
        }
        const memberAvatar = contact?.avatar?.trim() || undefined;
        nextCourier = appendCourierMessage(nextCourier, conversation.id, {
          id: `courier_group_reply_${playerMessage.id}_${memberId}`,
          senderId: memberId,
          senderName,
          role: 'contact',
          content: text,
          turn: input.turn,
          timestamp: Date.now() + memberReplied,
          ...(memberAvatar ? { avatar: memberAvatar } : {}),
          readBy: [],
        });
        if (senderNpc) {
          updatedNpcs = appendPhoneExchangeMemory(updatedNpcs, {
            npcId: senderNpc.id,
            conversationId: conversation.id,
            exchangeId: `${playerMessage.id}_${memberId}`,
            turn: input.turn,
            playerText: playerMessage.content,
            replyTexts: [text],
            relatedNpcIds: conversation.participantIds.filter((id) => id !== memberId && id !== 'player'),
          });
        }
        memberReplied += 1;
      }
      updated = nextCourier;
      if (memberReplied > 0) replied += 1;
        continue;
      }

    // 私密会话：单联系人回一封完整来信（AI 优先，失败回退本地写作器）。
    const contact = updated.contacts.find((item) => item.id === contactId);
    const provisionalName = contact?.name?.trim() || conversation.title?.trim() || contactId;
    updatedNpcs = ensureCourierContactNpcRecord(updatedNpcs, {
      contactId,
      ...(contact?.npcId ? { npcId: contact.npcId } : {}),
      name: provisionalName,
      turn: input.turn,
    });
    const senderNpc = updatedNpcs.find((npc) =>
      (contact?.npcId && npc.id === contact.npcId) || npc.id === contactId || (contact?.name?.trim() && npc.姓名 === contact.name.trim()));
    const senderName = contact?.name?.trim() || senderNpc?.姓名?.trim() || conversation.title?.trim() || contactId;
    const replyContext: CourierReplyContext = {
      conversation,
      playerMessage,
      sender: buildCourierSenderProfile(senderNpc, conversation, senderName),
      environment: input.environment,
      travelerName: input.travelerName,
    };
    let letter: string;
    if (input.letterApiConfig) {
      try {
        letter = await generateCourierReply(input.letterApiConfig, replyContext);
      } catch (error) {
        if (input.fallbackPolicy === 'error') throw error;
        console.warn('[phone-message] 私聊 AI 回复失败，已使用本地回复：', error instanceof Error ? error.message : String(error));
        void appendApiErrorReport({
          source: '手机消息私聊',
          config: input.letterApiConfig,
          requestMode: 'non-stream',
          error,
        });
        letter = composeCourierReplyLocally(replyContext);
      }
    } else {
      letter = composeCourierReplyLocally(replyContext);
    }
    const replyAvatar = contact?.avatar?.trim() || undefined;
    // 一句一句话：回信按句读拆成多条消息依次发出。
    const replyLines = splitLetterIntoLines(letter);
    let nextCourier = updated;
    replyLines.forEach((text, lineIndex) => {
      nextCourier = appendCourierMessage(nextCourier, conversation.id, {
        id: `courier_reply_${playerMessage.id}_${lineIndex}`,
        senderId: contactId,
        senderName,
        role: 'contact',
        content: text,
        turn: input.turn,
        timestamp: Date.now() + lineIndex,
        ...(replyAvatar ? { avatar: replyAvatar } : {}),
        readBy: [],
      });
    });
    updated = nextCourier;
    if (senderNpc) {
      updatedNpcs = appendPhoneExchangeMemory(updatedNpcs, {
        npcId: senderNpc.id,
        conversationId: conversation.id,
        exchangeId: playerMessage.id,
        turn: input.turn,
        playerText: playerMessage.content,
        replyTexts: replyLines,
      });
    }
      replied += 1;
    }
    return { courier: updated, npcs: updatedNpcs, replied };
  } finally {
    for (const conversationId of ownedClaims) endCourierReply(conversationId, input.sessionId);
  }
}
