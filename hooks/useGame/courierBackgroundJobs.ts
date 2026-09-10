import type { API配置项 } from '@/models/settings';
import type { NPC记录 } from '@/models/npc';
import type { CourierSystem } from '@/models/teyvat/courier';
import {
  appendPhoneExchangeMemory,
  appendCourierMessage,
  buildCourierSenderProfile,
  composeCourierGroupReplyLocally,
  composeCourierReplyLocally,
  ensureCourierContactNpcRecord,
  findCourierReplyCandidates,
  selectGroupReplyMembers,
  splitLetterIntoLines,
  type CourierGroupReplyContext,
  type CourierLetterEnvironment,
  type CourierReplyContext,
} from '@/services/ai/courierService';
import { generateCourierGroupReply, generateCourierReply } from '@/services/ai/courierLetterModel';
import { appendApiErrorReport } from '@/services/ai/apiErrorReportService';

/**
 * 信使回信纯逻辑：找出最后一条仍是玩家消息的会话，为每个会话生成一封联系人回信
 * （AI 优先，失败回退本地写作器），返回更新后的信使系统与回信数量。
 * 队列提示 / 通知 / toast 等有状态编排留在 sendWorkflow。
 */
export interface CourierReplyPassInput {
  courier: CourierSystem;
  npcs: NPC记录[];
  environment?: CourierLetterEnvironment;
  travelerName?: string;
  letterApiConfig: API配置项 | null;
  turn: number;
  maxReplies?: number;
  /** 群聊中每条玩家消息最多几位成员跟帖（默认 3）。 */
  maxGroupReplies?: number;
}

export interface CourierReplyPassResult {
  courier: CourierSystem;
  npcs: NPC记录[];
  replied: number;
}

export const COURIER_MESSAGE_REVEAL_INTERVAL_MS = 500;

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
    await onReveal(messages[index], index);
  }
}

export async function runCourierReplyPass(input: CourierReplyPassInput): Promise<CourierReplyPassResult> {
  const candidates = findCourierReplyCandidates(input.courier, input.maxReplies ?? 2);
  if (!candidates.length) return { courier: input.courier, npcs: input.npcs, replied: 0 };

  let updated = input.courier;
  let updatedNpcs = input.npcs;
  let replied = 0;
  for (const candidate of candidates) {
    const { conversation, playerMessage, contactId } = candidate;

    // 群聊：多位成员跟帖（至少一人），每人一条口语化短消息，署名各自联系人。
    if (conversation.type === 'group') {
      const memberIds = selectGroupReplyMembers(conversation, playerMessage, input.maxGroupReplies ?? 3, updated.contacts);
      let nextCourier = updated;
      let memberReplied = 0;
      let aiUsed = 0;
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
        // AI 仅用于前两位成员，控制单回合调用量；其余用本地跟帖兜底。
        if (input.letterApiConfig && aiUsed < 2) {
          try {
            text = await generateCourierGroupReply(input.letterApiConfig, groupContext);
            aiUsed += 1;
          } catch (error) {
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
}
