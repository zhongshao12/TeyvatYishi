import { describe, expect, it } from 'vitest';
import {
  buildNarrativeApiMessages,
  injectPromptModuleMessages,
} from '../../hooks/useGame/promptModuleMessageInjection';
import { createEmptyNarrativeTurn } from '../../models/teyvat/narrativeTurn';
import type { 聊天消息 } from '../../models/chat';

const baseMessages: 聊天消息[] = [
  { id: 'u1', role: 'user', content: '出发', timestamp: 1 },
  { id: 'a1', role: 'assistant', content: '来到城门', timestamp: 2 },
];

describe('promptModuleMessageInjection', () => {
  it('filters system triggers, compacts assistant history, and adds real awakening instructions', () => {
    const parsedResponse = createEmptyNarrativeTurn();
    parsedResponse.body = [{ kind: 'narration', text: '琴在城门前停下脚步。' }];
    parsedResponse.continuation.summary = '抵达蒙德城门';
    const messages = buildNarrativeApiMessages({
      recentHistory: [
        { id: 'system-trigger', role: 'user', content: '[系统] 踏入元素回响', timestamp: 1 },
        { id: 'user', role: 'user', content: '我选择回应风。', timestamp: 2 },
        { id: 'assistant', role: 'assistant', content: '旧的完整正文', timestamp: 3, parsedResponse },
        { id: 'unparsed', role: 'assistant', content: '未解析内容', timestamp: 4 },
      ],
      tavernMessages: null,
      isOpeningSystemTrigger: false,
      openingInstruction: '开场指令',
      isAwakeningEnterTrigger: true,
      awakeningInstruction: '进入风元素回响',
      awakeningPhase: 'judgement',
    });

    expect(messages.some((message) => message.content.startsWith('[系统]'))).toBe(false);
    expect(messages.some((message) => message.content === '未解析内容')).toBe(false);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'user']);
    expect(messages[1]?.content).toContain('琴在城门前停下脚步');
    expect(messages[2]?.content).toBe('进入风元素回响');
    expect(messages[3]?.content).toContain('元素回响·回应回合');
  });

  it('appends position-zero modules by order and inserts in-chat modules by depth', () => {
    const result = injectPromptModuleMessages({
      systemPrompt: '基础系统提示',
      messages: baseMessages,
      provider: 'openai',
      moduleMessages: [
        { role: 'assistant', content: '末尾提醒', _injectionPosition: 1, _injectionDepth: 0 },
        { role: 'user', content: '倒数第二提醒', _injectionPosition: 1, _injectionDepth: 1 },
        { role: 'user', content: '第二条系统补充', _injectionPosition: 0, _injectionOrder: 20 },
        { role: 'user', content: '第一条系统补充', _injectionPosition: 0, _injectionOrder: 10 },
      ],
    });

    expect(result.systemPrompt).toBe(
      '基础系统提示\n\n---\n\n第一条系统补充\n\n---\n\n第二条系统补充',
    );
    expect(result.messages.map((message) => `${message.role}:${message.content}`)).toEqual([
      'user:出发',
      'user:倒数第二提醒',
      'assistant:来到城门',
      'assistant:末尾提醒',
    ]);
    expect(baseMessages.map((message) => message.id)).toEqual(['u1', 'a1']);
  });

  it('keeps Claude history unchanged and appends depth modules to the system prompt by order', () => {
    const result = injectPromptModuleMessages({
      systemPrompt: '基础系统提示',
      messages: baseMessages,
      provider: 'claude',
      moduleMessages: [
        { role: 'assistant', content: '后置规则', _injectionPosition: 1, _injectionOrder: 2 },
        { role: 'user', content: '前置规则', _injectionPosition: 1, _injectionOrder: 1 },
      ],
    });

    expect(result.systemPrompt).toBe('基础系统提示\n\n---\n\n前置规则\n\n---\n\n后置规则');
    expect(result.messages).toEqual(baseMessages);
    expect(result.messages).not.toBe(baseMessages);
  });
});
