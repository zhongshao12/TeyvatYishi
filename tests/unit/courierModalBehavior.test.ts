// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CourierModal } from '@/components/features/Courier/CourierModal';
import type { CourierSystem } from '@/models/teyvat/courier';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseCourier: CourierSystem = {
  contacts: [
    { id: 'amber', npcId: 'amber', name: '安柏', available: true },
    { id: 'lisa', npcId: 'lisa', name: '丽莎', available: true },
  ],
  letters: [],
  conversations: [{
    id: 'mondstadt-group',
    title: '蒙德伙伴',
    participantIds: ['player', 'amber', 'lisa'],
    messages: [
      { id: 'm1', senderId: 'amber', senderName: '安柏', role: 'contact', content: '早上好！', turn: 3, timestamp: 1, readBy: ['amber'] },
      { id: 'm2', senderId: 'lisa', senderName: '丽莎', role: 'contact', content: '下午见。', turn: 4, timestamp: 2, readBy: ['lisa'] },
    ],
    unread: 0,
    type: 'group',
    typingMemberIds: [],
    creatorId: 'player',
    updatedAt: 2,
  }],
  deliverySeeds: [],
  unreadTotal: 0,
  wallpapers: {},
};

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮：${label}`);
  return button;
}

describe('CourierModal behavior', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('renders the group roster and visual turn boundary from actual messages', async () => {
    await act(async () => {
      root.render(createElement(CourierModal, {
        courier: baseCourier,
        travelerName: '云',
        onCourierChange: vi.fn(),
        onClose: vi.fn(),
      }));
    });

    expect(host.textContent).toContain('云、安柏、丽莎');
    expect(host.querySelector('[data-testid="phone-turn-divider"]')?.getAttribute('aria-label')).toBe('第 4 回合');
    expect(findButton('@全体成员')).toBeTruthy();
    expect(findButton('@安柏')).toBeTruthy();
    expect(findButton('@丽莎')).toBeTruthy();
  });

  it('inserts the group-wide mention from the @all shortcut', async () => {
    await act(async () => {
      root.render(createElement(CourierModal, {
        courier: baseCourier,
        travelerName: '云',
        onCourierChange: vi.fn(),
        onClose: vi.fn(),
      }));
    });

    const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="手机回复"]');
    await act(async () => findButton('@全体成员').click());

    expect(textarea?.value).toBe('@全体成员 ');
  });

  it('inserts an @ mention and sends the trimmed message with Enter', async () => {
    const onCourierChange = vi.fn();
    const onRequestReply = vi.fn();
    await act(async () => {
      root.render(createElement(CourierModal, {
        courier: baseCourier,
        travelerName: '云',
        currentTurn: 8,
        onCourierChange,
        onRequestReply,
        onClose: vi.fn(),
      }));
    });

    const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="手机回复"]');
    expect(textarea).not.toBeNull();
    await act(async () => findButton('@丽莎').click());
    expect(textarea?.value).toBe('@丽莎 ');

    await act(async () => {
      setTextareaValue(textarea!, `${textarea!.value} 晚上好 `);
    });
    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onCourierChange).toHaveBeenCalledTimes(1);
    const update = onCourierChange.mock.calls[0]![0] as CourierSystem | ((previous: CourierSystem) => CourierSystem);
    const next = typeof update === 'function' ? update(baseCourier) : update;
    const sent = next.conversations[0]!.messages.at(-1);
    expect(sent).toMatchObject({ senderId: 'player', senderName: '云', content: '@丽莎  晚上好', turn: 8 });
    expect(textarea?.value).toBe('');
    expect(onRequestReply).toHaveBeenCalledWith('mondstadt-group', next);
  });

  it('keeps Shift+Enter as a draft instead of sending', async () => {
    const onCourierChange = vi.fn();
    await act(async () => {
      root.render(createElement(CourierModal, {
        courier: baseCourier,
        onCourierChange,
        onClose: vi.fn(),
      }));
    });
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="手机回复"]')!;
    await act(async () => setTextareaValue(textarea, '继续调查'));
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    });

    expect(onCourierChange).not.toHaveBeenCalled();
    expect(textarea.value).toBe('继续调查');
  });

  it('constrains contact management to its own vertical scroll area', async () => {
    const manyContacts = Array.from({ length: 30 }, (_, index) => ({
      id: `contact-${index}`,
      npcId: `npc-${index}`,
      name: `联系人${index}`,
      available: true,
    }));
    await act(async () => {
      root.render(createElement(CourierModal, {
        courier: { ...baseCourier, contacts: manyContacts },
        onCourierChange: vi.fn(),
        onClose: vi.fn(),
      }));
    });

    await act(async () => findButton('▸ 联系人管理（30）').click());
    const list = host.querySelector<HTMLElement>('[aria-label="联系人列表"]');

    expect(list).not.toBeNull();
    expect(list?.style.overflowY).toBe('auto');
    expect(list?.style.maxHeight).toBe('13rem');
  });

  it('constrains group member selection to its own vertical scroll area', async () => {
    const manyContacts = Array.from({ length: 30 }, (_, index) => ({
      id: `contact-${index}`,
      npcId: `npc-${index}`,
      name: `联系人${index}`,
      available: true,
    }));
    await act(async () => {
      root.render(createElement(CourierModal, {
        courier: { ...baseCourier, contacts: manyContacts },
        onCourierChange: vi.fn(),
        onClose: vi.fn(),
      }));
    });

    await act(async () => findButton('▸ 组建群组').click());
    const list = host.querySelector<HTMLElement>('[aria-label="群聊成员列表"]');

    expect(list).not.toBeNull();
    expect(list?.style.overflowY).toBe('auto');
    expect(list?.style.maxHeight).toBe('13rem');
  });

  it('creates a named group from the isolated contact tools', async () => {
    const onCourierChange = vi.fn();
    await act(async () => {
      root.render(createElement(CourierModal, {
        courier: baseCourier,
        onCourierChange,
        onClose: vi.fn(),
      }));
    });

    await act(async () => findButton('▸ 组建群组').click());
    const amber = host.querySelector<HTMLInputElement>('input[aria-label="选择群成员 安柏"]');
    const lisa = host.querySelector<HTMLInputElement>('input[aria-label="选择群成员 丽莎"]');
    const groupName = host.querySelector<HTMLInputElement>('input[aria-label="群名称"]');
    await act(async () => {
      amber?.click();
      lisa?.click();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(groupName, '蔷薇侦察小队');
      groupName?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => findButton('组建群组（已选 2 人）').click());

    expect(onCourierChange).toHaveBeenCalledTimes(1);
    const update = onCourierChange.mock.calls[0]![0] as CourierSystem | ((previous: CourierSystem) => CourierSystem);
    const next = typeof update === 'function' ? update(baseCourier) : update;
    expect(next.conversations.at(-1)).toMatchObject({
      title: '蔷薇侦察小队',
      type: 'group',
      participantIds: ['player', 'amber', 'lisa'],
    });
  });

  it('renders only the newest phone messages first and can reveal older history on demand', async () => {
    const messages = Array.from({ length: 400 }, (_, index) => ({
      id: `message-${index}`,
      senderId: index % 2 ? 'amber' : 'player',
      senderName: index % 2 ? '安柏' : '云',
      role: index % 2 ? 'contact' : 'user',
      content: `历史消息 ${index}`,
      turn: index + 1,
      timestamp: index + 1,
      readBy: ['player'],
    }));
    const courier: CourierSystem = {
      ...baseCourier,
      conversations: [{ ...baseCourier.conversations[0]!, messages }],
    };

    await act(async () => {
      root.render(createElement(CourierModal, {
        courier,
        travelerName: '云',
        onCourierChange: vi.fn(),
        onClose: vi.fn(),
      }));
    });

    expect(host.querySelectorAll('[data-phone-message-row]')).toHaveLength(80);
    expect(host.textContent).toContain('较早的 320 条消息');

    await act(async () => findButton('加载更早消息').click());
    expect(host.querySelectorAll('[data-phone-message-row]')).toHaveLength(160);
  });

  it('windows a large conversation list and reveals more conversations on demand', async () => {
    const conversations = Array.from({ length: 125 }, (_, index) => ({
      ...baseCourier.conversations[0]!,
      id: `conversation-${index}`,
      title: `测试会话${String(index + 1).padStart(3, '0')}`,
      updatedAt: 125 - index,
    }));
    const courier: CourierSystem = { ...baseCourier, conversations };

    await act(async () => {
      root.render(createElement(CourierModal, {
        courier,
        onCourierChange: vi.fn(),
        onClose: vi.fn(),
      }));
    });

    const renderedConversations = () => Array.from(host.querySelectorAll('button'))
      .filter((button) => button.textContent?.includes('测试会话'));

    expect(renderedConversations()).toHaveLength(60);
    expect(host.textContent).toContain('还有 65 个会话未显示');

    await act(async () => findButton('再显示 60 个会话').click());

    expect(renderedConversations()).toHaveLength(120);
    expect(host.textContent).toContain('还有 5 个会话未显示');
  });

  it('does not rerender unchanged conversation rows when another conversation receives a message', async () => {
    let unchangedTitleReads = 0;
    const unchangedConversation = {
      ...baseCourier.conversations[0]!,
      id: 'lisa-private',
      participantIds: ['player', 'lisa'],
      messages: [],
      updatedAt: 1,
    };
    Object.defineProperty(unchangedConversation, 'title', {
      configurable: true,
      enumerable: true,
      get: () => {
        unchangedTitleReads += 1;
        return '丽莎';
      },
    });
    const activeConversation = {
      ...baseCourier.conversations[0]!,
      id: 'amber-private',
      title: '安柏',
      participantIds: ['player', 'amber'],
      updatedAt: 10,
    };
    const courier: CourierSystem = {
      ...baseCourier,
      conversations: [activeConversation, unchangedConversation],
    };
    const onCourierChange = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(createElement(CourierModal, { courier, onCourierChange, onClose }));
    });
    unchangedTitleReads = 0;

    await act(async () => {
      root.render(createElement(CourierModal, {
        courier: {
          ...courier,
          conversations: [{
            ...activeConversation,
            messages: [...activeConversation.messages, {
              id: 'new-message', senderId: 'amber', senderName: '安柏', role: 'contact',
              content: '侦察结束！', turn: 5, timestamp: 11, readBy: [],
            }],
            updatedAt: 11,
          }, unchangedConversation],
        },
        onCourierChange,
        onClose,
      }));
    });

    expect(unchangedTitleReads).toBe(0);
  });

  it('does not rerender the phone surface when its parent repeats identical props', async () => {
    let unreadReads = 0;
    const courier = { ...baseCourier };
    Object.defineProperty(courier, 'unreadTotal', {
      configurable: true,
      enumerable: true,
      get: () => {
        unreadReads += 1;
        return 1;
      },
    });
    const onCourierChange = vi.fn();
    const onClose = vi.fn();
    const props = { courier, onCourierChange, onClose };

    await act(async () => {
      root.render(createElement(CourierModal, props));
    });
    unreadReads = 0;
    await act(async () => {
      root.render(createElement(CourierModal, props));
    });

    expect(unreadReads).toBe(0);
  });

  it('does not rerender existing message rows when a new message is appended', async () => {
    let oldContentReads = 0;
    const oldMessage = { ...baseCourier.conversations[0]!.messages[0]! };
    Object.defineProperty(oldMessage, 'content', {
      configurable: true,
      enumerable: true,
      get: () => {
        oldContentReads += 1;
        return '早上好！';
      },
    });
    const activeConversation = {
      ...baseCourier.conversations[0]!,
      messages: [oldMessage, baseCourier.conversations[0]!.messages[1]!],
    };
    const courier: CourierSystem = { ...baseCourier, conversations: [activeConversation] };
    const onCourierChange = vi.fn();
    const onClose = vi.fn();
    const npcRecords: [] = [];

    await act(async () => {
      root.render(createElement(CourierModal, { courier, npcRecords, onCourierChange, onClose }));
    });
    oldContentReads = 0;
    await act(async () => {
      root.render(createElement(CourierModal, {
        courier: {
          ...courier,
          conversations: [{
            ...activeConversation,
            messages: [...activeConversation.messages, {
              id: 'm3', senderId: 'amber', senderName: '安柏', role: 'contact',
              content: '侦察结束！', turn: 5, timestamp: 3, readBy: [],
            }],
            updatedAt: 3,
          }],
        },
        npcRecords,
        onCourierChange,
        onClose,
      }));
    });

    expect(oldContentReads).toBe(0);
  });
});
