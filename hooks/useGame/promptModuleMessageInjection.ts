import { 创建聊天消息, type 聊天消息 } from '@/models/chat';
import { buildLeanAssistantHistoryContent } from './historyWindow';
import type { ChatModuleMessage, 元素回响阶段 } from './systemPromptBuilder';

const ELEMENTAL_ECHO_JUDGEMENT_INSTRUCTION =
  '⚠ 元素回响·回应回合：最终只输出 NarrativeTurn JSON。在 body 中加入 text 明确包含“共鸣深化”的可见 system 块，并在 factCandidates 中加入 {"domain":"system","fact":"elemental_echo_result:共鸣深化","evidence":"共鸣深化"}；让元素回应玩家的选择，再把旅行者带回现实场景。';

export interface NarrativeApiMessagesInput {
  recentHistory: 聊天消息[];
  tavernMessages: 聊天消息[] | null;
  isOpeningSystemTrigger: boolean;
  openingInstruction: string;
  isAwakeningEnterTrigger: boolean;
  awakeningInstruction: string;
  awakeningPhase?: 元素回响阶段;
}

export function buildNarrativeApiMessages(input: NarrativeApiMessagesInput): 聊天消息[] {
  const messages: 聊天消息[] = [];
  if (input.tavernMessages) {
    messages.push(...input.tavernMessages);
  } else {
    for (const message of input.recentHistory) {
      if (message.role === 'user' && message.content.startsWith('[系统]')) continue;
      if (message.role === 'user') {
        messages.push(message);
      } else if (message.role === 'assistant' && message.parsedResponse) {
        messages.push(创建聊天消息('assistant', buildLeanAssistantHistoryContent(message)));
      }
    }
    if (input.isOpeningSystemTrigger) {
      messages.push(创建聊天消息('user', input.openingInstruction));
    }
    if (input.isAwakeningEnterTrigger && input.awakeningInstruction) {
      messages.push(创建聊天消息('user', input.awakeningInstruction));
    }
  }
  if (input.awakeningPhase === 'judgement') {
    messages.push(创建聊天消息('user', ELEMENTAL_ECHO_JUDGEMENT_INSTRUCTION));
  }
  return messages;
}

export interface PromptModuleMessageInjectionInput {
  systemPrompt: string;
  messages: 聊天消息[];
  moduleMessages: ChatModuleMessage[];
  provider: string;
}

export interface PromptModuleMessageInjectionResult {
  systemPrompt: string;
  messages: 聊天消息[];
}

/** 按酒馆 position/depth 语义将非 system 模块合并到主请求。 */
export function injectPromptModuleMessages(
  input: PromptModuleMessageInjectionInput,
): PromptModuleMessageInjectionResult {
  let systemPrompt = input.systemPrompt;
  const messages = [...input.messages];
  if (input.moduleMessages.length === 0) return { systemPrompt, messages };

  const positionZeroMessages = input.moduleMessages
    .filter((message) => message._injectionPosition === 0)
    .sort((left, right) => (left._injectionOrder ?? 0) - (right._injectionOrder ?? 0));
  if (positionZeroMessages.length > 0) {
    const fallbackText = positionZeroMessages.map((message) => message.content).join('\n\n---\n\n');
    systemPrompt = systemPrompt + '\n\n---\n\n' + fallbackText;
  }

  if (input.provider !== 'claude') {
    const depthMessages = input.moduleMessages
      .filter((message) => message._injectionPosition === 1)
      .sort((left, right) => (right._injectionDepth ?? 0) - (left._injectionDepth ?? 0));
    for (const message of depthMessages) {
      const depth = message._injectionDepth ?? 0;
      const insertIndex = Math.max(0, messages.length - depth);
      messages.splice(
        insertIndex,
        0,
        创建聊天消息(message.role as 'user' | 'assistant', message.content),
      );
    }
  } else {
    const fallbackMessages = input.moduleMessages
      .filter((message) => message._injectionPosition === 1)
      .sort((left, right) => (left._injectionOrder ?? 0) - (right._injectionOrder ?? 0));
    if (fallbackMessages.length > 0) {
      const fallbackText = fallbackMessages.map((message) => message.content).join('\n\n---\n\n');
      systemPrompt = systemPrompt + '\n\n---\n\n' + fallbackText;
    }
  }

  return { systemPrompt, messages };
}
