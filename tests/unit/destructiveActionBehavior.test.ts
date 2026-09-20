// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfirmDialogHost, useConfirmDialog } from '@/components/ui/Modal';
import { InventoryPanel } from '@/components/features/GameSystems/InventoryPanel';
import { MemoryPanel } from '@/components/features/GameSystems/MemoryPanel';
import { CourierModal } from '@/components/features/Courier/CourierModal';
import type { TeyvatInventory } from '@/models/teyvat/items';
import type { 记忆系统 } from '@/models/memory';
import type { 记忆系统设置 } from '@/models/settings';
import type { CourierSystem } from '@/models/teyvat/courier';
import { dismissToast, getToasts } from '@/utils/toastStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function undoAction() {
  const toast = getToasts().find((item) => item.action?.label === '撤销');
  if (!toast?.action) throw new Error('没有找到撤销提示');
  return toast;
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮：${label}`);
  return button;
}

const inventory: TeyvatInventory = {
  mora: 100,
  items: [
    { id: 'item-sweet-flower', category: 'material', name: '甜甜花', description: '甜。', quantity: 5, rarity: 1, obtainedAtTurn: 3 },
  ],
};

const memorySystem: 记忆系统 = {
  即时记忆: ['记录一', '记录二'],
  短期记忆: ['摘要一'],
  中期记忆: [],
  长期记忆: [],
};

const memorySettings = {
  即时转短期阈值: 5,
  短期转中期阈值: 5,
  中期转长期阈值: 5,
  NPC记忆压缩阈值: 5,
} as unknown as 记忆系统设置;

const courier: CourierSystem = {
  contacts: [
    { id: 'amber', npcId: 'amber', name: '安柏', available: true },
    { id: 'lisa', npcId: 'lisa', name: '丽莎', available: true },
  ],
  letters: [],
  conversations: [
    {
      id: 'mondstadt-group', title: '蒙德伙伴', participantIds: ['player', 'amber', 'lisa'],
      messages: [{ id: 'm1', senderId: 'amber', senderName: '安柏', role: 'contact', content: '早上好！', turn: 3, timestamp: 1, readBy: ['amber'] }],
      unread: 0, type: 'group', typingMemberIds: [], creatorId: 'player', updatedAt: 2,
    },
    {
      id: 'lisa-private', title: '丽莎', participantIds: ['player', 'lisa'],
      messages: [], unread: 0, type: 'private', typingMemberIds: [], updatedAt: 1,
    },
  ],
  deliverySeeds: [],
  unreadTotal: 0,
  wallpapers: {},
};

describe('destructive action undo', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    for (const toast of [...getToasts()]) dismissToast(toast.id);
    host.remove();
    vi.restoreAllMocks();
  });

  it('offers an undo toast instead of a native confirm when discarding an item', async () => {
    const onInventoryChange = vi.fn();
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);

    await act(async () => {
      root.render(createElement(InventoryPanel, { inventory, onInventoryChange, turnCount: 4 }));
    });
    const itemCell = host.querySelector<HTMLButtonElement>('[data-testid="inventory-item-cell"]');
    expect(itemCell).not.toBeNull();
    await act(async () => itemCell!.click());

    const dropButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === '丢弃 1');
    expect(dropButton).toBeTruthy();
    await act(async () => dropButton!.click());

    expect(confirmSpy).not.toHaveBeenCalled();
    const toast = undoAction();
    expect(toast.title).toContain('甜甜花');

    await act(async () => toast.action!.run());
    // 撤销必须把丢弃前的背包快照原样还回去。
    expect(onInventoryChange).toHaveBeenCalledWith(inventory);
    vi.unstubAllGlobals();
  });

  it('offers an undo toast instead of a native confirm when compressing memory', async () => {
    const onMemorySystemChange = vi.fn();
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);

    await act(async () => {
      root.render(createElement(MemoryPanel, {
        memorySystem,
        onMemorySystemChange,
        turnCount: 6,
        settings: memorySettings,
      }));
    });
    await act(async () => findButton('压缩到短期').click());

    expect(confirmSpy).not.toHaveBeenCalled();
    const toast = undoAction();

    await act(async () => toast.action!.run());
    expect(onMemorySystemChange).toHaveBeenCalledWith(memorySystem);
    vi.unstubAllGlobals();
  });

  it('offers an undo toast instead of a native confirm when dissolving a group chat', async () => {
    const onCourierChange = vi.fn();
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);

    await act(async () => {
      root.render(createElement(CourierModal, { courier, onCourierChange, onClose: vi.fn() }));
    });
    await act(async () => findButton('群聊设置').click());
    await act(async () => findButton('解散群聊').click());

    expect(confirmSpy).not.toHaveBeenCalled();
    // 解散必须立刻生效。
    expect(onCourierChange).toHaveBeenCalledTimes(1);

    const toast = undoAction();
    await act(async () => toast.action!.run());
    expect(onCourierChange).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('gives the styled confirm dialog Escape handling and focus restoration', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = '删除存档';
    document.body.append(trigger);
    trigger.focus();

    let api: ReturnType<typeof useConfirmDialog> | null = null;
    function Harness() {
      api = useConfirmDialog();
      return createElement(ConfirmDialogHost, { dialog: api });
    }
    await act(async () => { root.render(createElement(Harness)); });

    let answer: boolean | null = null;
    await act(async () => {
      void api!.confirm({ title: '删除存档', message: '此操作不可恢复。', confirmLabel: '删除', tone: 'danger' }).then((value) => { answer = value; });
    });

    const dialog = host.querySelector<HTMLElement>('[role="dialog"][aria-label="删除存档"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('此操作不可恢复。');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(answer).toBe(false);

    await act(async () => {
      void api!.confirm({ title: '删除存档', message: '此操作不可恢复。', confirmLabel: '删除', tone: 'danger' }).then((value) => { answer = value; });
    });
    const confirmButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '删除');
    await act(async () => confirmButton!.click());
    await act(async () => { await Promise.resolve(); });
    expect(answer).toBe(true);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
