// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { CompanionPanel } from '@/components/features/GameSystems/CompanionPanel';
import { 创建NPC记录 } from '@/models/npc';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮：${label}`);
  return button;
}

describe('CompanionPanel behavior', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('windows a large companion roster and reveals the next page on demand', async () => {
    const records = Array.from({ length: 125 }, (_, index) => 创建NPC记录({
      姓名: `测试角色${String(index + 1).padStart(3, '0')}`,
      阶位: 'companion',
      初见回合: 1,
      原著角色: false,
    }));

    await act(async () => {
      root.render(createElement(CompanionPanel, {
        npcRecords: records,
        onNpcRecordsChange: vi.fn(),
        turnCount: 1,
        nsfwEnabled: false,
      }));
    });

    const visibleRosterButtons = () => Array.from(host.querySelectorAll('aside button'))
      .filter((button) => button.textContent?.includes('测试角色'));

    expect(visibleRosterButtons()).toHaveLength(60);
    expect(host.textContent).toContain('还有 65 位未显示');

    await act(async () => findButton('再显示 60 位').click());

    expect(visibleRosterButtons()).toHaveLength(120);
    expect(host.textContent).toContain('还有 5 位未显示');
  });

  it('does not rerender the selected NPC detail while only the roster search changes', async () => {
    const record = 创建NPC记录({
      姓名: '测试角色',
      阶位: 'companion',
      初见回合: 1,
      原著角色: false,
    });
    let titleReads = 0;
    Object.defineProperty(record, '对玩家称呼', {
      configurable: true,
      enumerable: true,
      get() {
        titleReads += 1;
        return '旅行者';
      },
    });

    await act(async () => {
      root.render(createElement(CompanionPanel, {
        npcRecords: [record],
        onNpcRecordsChange: vi.fn(),
        turnCount: 1,
        nsfwEnabled: false,
      }));
    });
    titleReads = 0;

    const search = host.querySelector<HTMLInputElement>('input[aria-label="搜索同伴"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(search, '测试');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(titleReads).toBe(0);
  });
});
