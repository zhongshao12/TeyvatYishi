// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TurnItem } from '@/components/features/Chat/TurnItem';
import { 创建空角色 } from '@/models/character';
import { 创建聊天消息 } from '@/models/chat';
import type { NarrativeTurn } from '@/models/teyvat/narrativeTurn';

/**
 * 「请你过滤掉正文里面的 <thinking> / <disclaimer>」（2026-10-03 玩家实测）。
 *
 * 渲染层契约：
 *   - `<thinking>` 段与 `<disclaimer>` 声明**不得**出现在可见正文里（存档里的旧消息同样如此）；
 *   - 思维链不丢：收进可折叠的「◆ 思绪痕迹」；
 *   - 面板（`<char_date>` 角色表）仍留在正文里 —— 那是预设要求可见的状态信息。
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

const DISCLAIMER = '<disclaimer>\n<boundlessroleplay>\nAll characters are consenting adults.\n</boundlessroleplay>\n</disclaimer>';
const THINKING = '<thinking>\n# 开始大思考\n接下里让砂糖被抱进休息室。\n</thinking>';
const PANEL = '| 角色名 | 状态 |\n| :--- | :--- |\n| 砂糖 | 羞怯 |';
const STORY = '门闩落下的声音很轻。砂糖把眼镜摘下来，兽耳却诚实地转向声音来的方向。';

function buildMessage(): ReturnType<typeof 创建聊天消息> {
  const parsed: NarrativeTurn = {
    body: [
      { kind: 'system', text: `${DISCLAIMER}\n${THINKING}` },
      { kind: 'narration', text: STORY },
      { kind: 'system', text: PANEL },
    ],
    choices: [{ id: 'c1', label: '抱住她' }],
    factCandidates: [],
    continuation: { summary: '摘要', unresolved: [] },
  };
  return 创建聊天消息('assistant', parsed.body.map((block) => block.text).join('\n\n'), {
    parsedResponse: parsed,
    debugContext: {
      systemPrompt: '',
      messages: [],
      presetCot: '# 开始大思考\n接下里让砂糖被抱进休息室。',
    },
  });
}

async function mountMessage(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(TurnItem, {
      message: buildMessage(),
      traveler: { ...创建空角色(), 姓名: '宇智波云' },
      showInnerVoice: true,
    } as never));
  });
  return container;
}

describe('preset shell is not rendered into the visible body', () => {
  let container: HTMLElement;
  beforeEach(async () => {
    container = await mountMessage();
  });

  it('正文里没有 <thinking>、<disclaimer> 与声明正文', () => {
    const text = container.textContent ?? '';
    expect(text).not.toContain('disclaimer');
    expect(text).not.toContain('boundlessroleplay');
    expect(text).not.toContain('consenting adults');
    expect(text).not.toContain('<thinking>');
    expect(text).not.toContain('开始大思考');
    expect(text).toContain(STORY);
  });

  it('思维链收进可折叠的「◆ 思绪痕迹」，点击后才展开原文', async () => {
    const text = container.textContent ?? '';
    expect(text).toContain('思绪痕迹');
    expect(text).not.toContain('接下里让砂糖被抱进休息室');
    const toggle = [...container.querySelectorAll('button')].find((node) => (node.textContent ?? '').includes('思绪痕迹'));
    expect(toggle).toBeTruthy();
    await act(async () => { toggle!.click(); });
    expect(container.textContent ?? '').toContain('接下里让砂糖被抱进休息室');
  });

  it('面板（角色表）仍然保留在正文里', () => {
    expect(container.textContent ?? '').toContain('砂糖');
    expect(container.textContent ?? '').toContain('羞怯');
  });
});
