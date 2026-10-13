// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CourierModal } from '@/components/features/Courier/CourierModal';
import { createEmptyCourierSystem, normalizeCourierSystem, type CourierSystem } from '@/models/teyvat/courier';
import { mergeCourierSystemUpdates } from '@/services/ai/courierService';
import { 创建NPC记录, type NPC记录 } from '@/models/npc';
import { dismissToast, getToasts } from '@/utils/toastStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('phone identity and lifecycle UI', () => {
  let host: HTMLDivElement;
  let root: Root;
  let live: CourierSystem;
  let npcs: NPC记录[];
  let sessionId: number;
  const render = () => root.render(createElement(CourierModal, {
    courier: live, npcRecords: npcs, getGameSessionId: () => sessionId, onClose: () => {},
    onCourierChange: (update) => { live = typeof update === 'function' ? update(live) : update; render(); },
  }));
  const button = (label: string) => {
    const found = [...document.querySelectorAll('button')].find(item => item.textContent?.includes(label) || item.getAttribute('aria-label') === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  };
  beforeEach(() => {
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    live = createEmptyCourierSystem(); npcs = []; sessionId = 1;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    for (const toast of getToasts()) dismissToast(toast.id);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks();
    for (const toast of getToasts()) dismissToast(toast.id);
  });

  it('allows adding a second known NPC with the same display name but a different ID', async () => {
    npcs = ['first', 'second'].map(id => ({ ...创建NPC记录({ 姓名: '阿林', 初见回合: 1 }), id, 好感度: 20 }));
    live.contacts = [{ id: 'contact_first', npcId: 'first', name: '阿林', available: true }];
    await act(async () => render());
    await act(async () => button('联系人管理').click());
    expect(document.body.textContent).toContain('可添加的已结识角色');
    const add = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('＋'))!;
    await act(async () => add.click());
    expect(live.contacts.map(contact => contact.npcId)).toEqual(['first', 'second']);
  });

  const group = (creatorId?: string): CourierSystem => ({
    ...createEmptyCourierSystem(), contacts: [{ id: 'guide', name: '向导', available: true }],
    conversations: [{ id: 'group', title: '茶会', type: 'group', participantIds: ['player', 'guide'], messages: [], unread: 0, typingMemberIds: [], updatedAt: 1, ...(creatorId ? { creatorId } : {}) }],
    deliverySeeds: [{ id: 'pending', senderId: 'guide', reason: '集合', turn: 10, source: 'memory', triggerType: 'quest', priority: 'low', targetType: 'group', targetId: 'group', title: '茶会', context: '在广场见面', relatedNpcIds: [], status: 'pending' }],
  });
  it('undo really restores a dissolved group after normalization and preserves unrelated deletion markers', async () => {
    live = group('player'); const original = live;
    await act(async () => render());
    await act(async () => button('群聊设置').click());
    await act(async () => button('解散群聊').click());
    expect(live.conversations).toHaveLength(0);
    const undo = getToasts().find(toast => toast.action?.label === '撤销')?.action;
    expect(undo).toBeDefined();
    live = { ...live, deletedConversationIds: [...(live.deletedConversationIds ?? []), 'other-group'], contacts: [...live.contacts, { id: 'new', name: '新朋友', available: true }] };
    await act(async () => undo!.run());
    live = normalizeCourierSystem(live);
    live = mergeCourierSystemUpdates(live, original, original);
    expect(live.conversations.map(item => item.id)).toEqual(['group']);
    expect(live.deletedConversationIds).toEqual(['other-group']);
    expect(live.contacts.map(item => item.id)).toEqual(['guide', 'new']);
    expect(live.deliverySeeds.map(item => item.id)).toEqual(['pending']);
  });

  it('does not enable dissolve or display false success for another character\'s group', async () => {
    live = group('guide');
    await act(async () => render());
    await act(async () => button('群聊设置').click());
    expect(button('解散群聊').disabled).toBe(true);
    await act(async () => button('解散群聊').click());
    expect(live.conversations).toHaveLength(1);
    expect(getToasts().some(toast => toast.title.startsWith('已解散'))).toBe(false);
  });

  it('does not report success if permission changed after the render but before committing the click', async () => {
    live = group('player');
    await act(async () => render());
    await act(async () => button('群聊设置').click());
    live = { ...live, conversations: [{ ...live.conversations[0]!, creatorId: 'guide' }] };
    await act(async () => button('解散群聊').click());
    expect(live.conversations).toHaveLength(1);
    expect(getToasts().some(toast => toast.title.startsWith('已解散'))).toBe(false);
  });

  it('keeps legacy ownerless groups manageable and prevents undo after a save switch', async () => {
    live = group();
    await act(async () => render());
    await act(async () => button('群聊设置').click());
    await act(async () => button('解散群聊').click());
    expect(live.conversations).toHaveLength(0);
    const undo = getToasts().find(toast => toast.action?.label === '撤销')!.action!;
    sessionId = 2; live = createEmptyCourierSystem();
    await act(async () => undo.run());
    expect(live.conversations).toHaveLength(0);
  });

  const setText = (label: string, value: string) => {
    const field = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const withNamesakes = async () => {
    live.contacts = ['first', 'second'].map((npcId, index) => ({ id: `contact_${npcId}`, npcId, name: '阿林', remark: index ? '炼金师' : '向导', available: true }));
    await act(async () => render());
    await act(async () => button('朋友圈').click());
    await act(async () => button('写下旅途此刻').click());
  };
  const mentionButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="点名联系人"] button')];

  it('selecting the second namesake publishes that exact NPC ID and distinguishes the buttons', async () => {
    await withNamesakes();
    expect(mentionButtons()[1]?.textContent).toContain('炼金师');
    await act(async () => mentionButtons()[1]!.click());
    await act(async () => button('发布').click());
    expect(live.moments?.[0]?.mentionIds).toEqual(['second']);
  });

  it('keeps selected identity when inserting text before the mention', async () => {
    await withNamesakes();
    await act(async () => mentionButtons()[1]!.click());
    await act(async () => setText('写朋友圈', '明天 @阿林 '));
    await act(async () => setText('写朋友圈', '明天 @阿林 见'));
    await act(async () => button('发布').click());
    expect(live.moments?.[0]?.mentionIds).toEqual(['second']);
  });

  it('removing and retyping an ambiguous token cannot inherit the deleted selection', async () => {
    await withNamesakes();
    await act(async () => mentionButtons()[1]!.click());
    await act(async () => setText('写朋友圈', '明天见'));
    await act(async () => setText('写朋友圈', '@阿林 明天见'));
    await act(async () => button('发布').click());
    expect(live.moments?.[0]?.mentionIds ?? []).toEqual([]);
  });

  it('editing an unchanged post preserves the original namesake identity', async () => {
    await withNamesakes();
    live = { ...live, moments: [{ id: 'post', authorId: 'player', content: '@阿林 明天见', mentionIds: ['second'], turn: 1, revision: 1, createdAt: 1, updatedAt: 1, comments: [], targets: [] }] };
    await act(async () => render());
    await act(async () => button('编辑').click());
    await act(async () => button('保存修改').click());
    expect(live.moments?.[0]?.mentionIds).toEqual(['second']);
  });

  it('opening an old post after its mentioned contact was deleted cannot retarget the remaining namesake', async () => {
    await withNamesakes();
    live = { ...live, contacts: live.contacts.filter(contact => contact.npcId === 'first'), moments: [{ id: 'post', authorId: 'player', content: '@阿林 明天见', mentionIds: ['second'], turn: 1, revision: 1, createdAt: 1, updatedAt: 1, comments: [], targets: [] }] };
    await act(async () => render());
    await act(async () => button('编辑').click());
    await act(async () => button('保存修改').click());
    expect(live.moments?.[0]?.mentionIds ?? []).toEqual([]);
  });

  it('an unchanged old post keeps its mentioned NPC ID after a rename instead of adding a namesake', async () => {
    await withNamesakes();
    live = { ...live, contacts: live.contacts.map(contact => contact.npcId === 'second' ? { ...contact, name: '阿枫' } : contact), moments: [{ id: 'post', authorId: 'player', content: '@阿林 明天见', mentionIds: ['second'], turn: 1, revision: 1, createdAt: 1, updatedAt: 1, comments: [], targets: [] }] };
    await act(async () => render());
    await act(async () => button('编辑').click());
    await act(async () => button('保存修改').click());
    expect(live.moments?.[0]?.mentionIds).toEqual(['second']);
  });

  it('editing surrounding text in a renamed old post still addresses the original NPC', async () => {
    await withNamesakes();
    live = { ...live, contacts: live.contacts.map(contact => contact.npcId === 'second' ? { ...contact, name: '阿枫' } : contact), moments: [{ id: 'post', authorId: 'player', content: '@阿林 明天见', mentionIds: ['second'], turn: 1, revision: 1, createdAt: 1, updatedAt: 1, comments: [], targets: [] }] };
    await act(async () => render());
    await act(async () => button('编辑').click());
    await act(async () => setText('编辑朋友圈', '约好了 @阿林 明天见'));
    await act(async () => button('保存修改').click());
    expect(live.moments?.[0]?.mentionIds).toEqual(['second']);
  });
  it('an explicit replacement selection overrides the old target even if the displayed text is unchanged', async () => {
    await withNamesakes();
    live = { ...live, moments: [{ id: 'post', authorId: 'player', content: '@阿林', mentionIds: ['second'], turn: 1, revision: 1, createdAt: 1, updatedAt: 1, comments: [], targets: [] }] };
    await act(async () => render());
    await act(async () => button('编辑').click());
    await act(async () => setText('编辑朋友圈', ''));
    const editMentions = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] [aria-label="点名联系人"] button')];
    await act(async () => editMentions[0]!.click());
    await act(async () => button('保存修改').click());
    expect(live.moments?.[0]?.mentionIds).toEqual(['first']);
  });
  it('deleting one of two identical name tokens cannot guess which selected identity survived', async () => {
    await withNamesakes();
    await act(async () => mentionButtons()[0]!.click());
    await act(async () => mentionButtons()[1]!.click());
    await act(async () => setText('写朋友圈', '@阿林 '));
    await act(async () => button('发布').click());
    expect(live.moments?.[0]?.mentionIds ?? []).toEqual([]);
  });
});
