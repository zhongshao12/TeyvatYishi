// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextViewerTab } from '@/components/features/Settings/ContextViewer';
import type { ContextSnapshot } from '@/hooks/useGame/contextSnapshotTypes';
import { estimateTextTokens } from '@/utils/tokenEstimate';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 上下文构成面板此前把 JSX 文本里的 `$` 当模板字符串前缀写死：
 * 界面上显示成「共 $11 字符 · 约 $8 token」「55% · $4」——每个数字前都多一个 `$`，
 * 玩家看到的是模板字符串残渣而不是正常计数。这里锁「显示的是真实数据，且没有 $ 残渣」。
 */
describe('ContextViewerTab composition readout', () => {
  let host: HTMLDivElement;
  let root: Root;

  const snapshot: ContextSnapshot = {
    kind: 'main',
    title: '主剧情上下文',
    sections: [
      { id: 's1', title: '世界书', category: '世界书', order: 1, content: '世界书内容', estimatedTokens: 5 },
      { id: 's2', title: '背包', category: '背包', order: 2, content: '背包物品清单', estimatedTokens: 6 },
    ],
    fullText: '世界书内容\n---\n背包物品清单',
    estimatedTokens: 11,
    uploadEstimatedTokens: 11,
    diagnosticEstimatedTokens: 0,
    createdAt: 0,
    sourceInput: '',
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function renderViewer() {
    await act(async () => {
      root.render(createElement(ContextViewerTab, {
        getSnapshot: async () => snapshot,
        refreshKey: 0,
        onRefresh: () => undefined,
      }));
    });
  }

  it('renders real composition numbers instead of the raw template placeholders', async () => {
    await renderViewer();
    const text = host.textContent ?? '';

    expect(text).not.toContain('${');
    expect(text).not.toContain('composition.totalChars');
    expect(text).not.toContain('formatTokenCount(section.tokens)');
    // 模板字符串残渣：数字前多出来的 `$`。
    expect(text).not.toMatch(/共 \$/);
    expect(text).not.toMatch(/% · \$/);

    const totalChars = '世界书内容'.length + '背包物品清单'.length;
    const totalTokens = estimateTextTokens('世界书内容') + estimateTextTokens('背包物品清单');
    expect(totalChars).toBe(11);
    expect(text).toContain(`共 ${totalChars.toLocaleString()} 字符 · 约 ${totalTokens.toLocaleString('en-US')} token`);

    // 每个类目的占比行同样必须带上真实 token 数（原来显示 ${formatTokenCount(section.tokens)}）。
    const backpackRatio = Math.round(('背包物品清单'.length / totalChars) * 100);
    const loreRatio = Math.round(('世界书内容'.length / totalChars) * 100);
    expect(text).toContain(`${backpackRatio}% · ${estimateTextTokens('背包物品清单').toLocaleString('en-US')}`);
    expect(text).toContain(`${loreRatio}% · ${estimateTextTokens('世界书内容').toLocaleString('en-US')}`);
  });
});
