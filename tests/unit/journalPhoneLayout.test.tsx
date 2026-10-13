// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CourierPanel } from '@/components/features/Courier/CourierPanel';
import { createEmptyCourierSystem, type CourierSystem } from '@/models/teyvat/courier';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root; let courier: CourierSystem;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('matchMedia', () => ({ matches: true })); Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const initial = (): CourierSystem => ({ ...createEmptyCourierSystem(),
  contacts: [{ id: 'amber', npcId: 'npc-amber', name: '安柏', available: true }],
  conversations: [{ id: 'chat', type: 'private', title: '安柏', participantIds: ['player', 'amber'], messages: [], unread: 0, typingMemberIds: [], updatedAt: 1 }] });
const click = async (label: string) => act(async () => {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label);
  expect(button).toBeDefined(); button!.click();
});
const type = async (text: string) => act(async () => {
  const input = host.querySelector<HTMLTextAreaElement>('[aria-label="手机回复"]')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true }));
});

it('a contact jump clears an old group filter and drafts always belong to the displayed recipient', async () => {
  function Harness() { const [value, setValue] = useState(() => ({ ...initial(), conversations: [...initial().conversations,
    { id: 'group', type: 'group' as const, title: '其他群组', participantIds: ['player', 'amber'], messages: [], unread: 0, typingMemberIds: [], updatedAt: 0 }] })); courier = value; return createElement(CourierPanel, { courier: value, onCourierChange: setValue, onClose: () => {} }); }
  await act(async () => root.render(createElement(Harness)));
  await type('给安柏的私人草稿'); await click('群组');
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="手机回复"]')?.value).toBe('');
  await type('给群组的草稿'); await click('通讯录'); await click('▸ 联系人管理（1）');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="与 安柏 聊天"]')!.click());
  expect(host.querySelector('h3')?.textContent).toContain('安柏');
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="手机回复"]')?.value).toBe('给安柏的私人草稿');
  await click('发送');
  expect(courier.conversations.find(item => item.id === 'chat')?.messages.at(-1)?.content).toBe('给安柏的私人草稿');
  expect(courier.conversations.find(item => item.id === 'group')?.messages).toHaveLength(0);
  await click('群组'); expect(host.querySelector<HTMLTextAreaElement>('[aria-label="手机回复"]')?.value).toBe('给群组的草稿');
});

it('a new group created from contacts is shown even after filtering private conversations', async () => {
  function Harness() { const [value, setValue] = useState(() => ({ ...initial(), contacts: [...initial().contacts, { id: 'lisa', npcId: 'npc-lisa', name: '丽莎', available: true }] })); courier = value; return createElement(CourierPanel, { courier: value, onCourierChange: setValue, onClose: () => {} }); }
  await act(async () => root.render(createElement(Harness))); await click('私聊'); await click('通讯录'); await click('▸ 组建群组');
  await act(async () => { host.querySelector<HTMLInputElement>('[aria-label="选择群成员 安柏"]')!.click(); host.querySelector<HTMLInputElement>('[aria-label="选择群成员 丽莎"]')!.click(); });
  await click('组建群组（已选 2 人）');
  const group = courier.conversations.find(item => item.type === 'group'); expect(group).toBeDefined();
  expect(host.querySelector('h3')?.textContent).toBe(group?.title);
  await type('群组招呼'); await click('发送');
  expect(courier.conversations.find(item => item.id === group!.id)?.messages.at(-1)?.content).toBe('群组招呼');
  expect(courier.conversations.find(item => item.id === 'chat')?.messages).toHaveLength(0);
});

it('three_phone_sections_share_one_chat_and_keep_its_draft', async () => {
  function Harness() { const [value, setValue] = useState(initial); courier = value; return createElement(CourierPanel, { courier: value, onCourierChange: setValue, onClose: () => {} }); }
  await act(async () => root.render(createElement(Harness)));
  await click('消息'); await type('还没发出的消息');
  const timeline = host.querySelector('[data-testid="phone-message-timeline"]');
  await click('通讯录');
  await click('▸ 联系人管理（1）');
  const contact = host.querySelector<HTMLButtonElement>('[aria-label="与 安柏 聊天"]'); expect(contact).not.toBeNull();
  await act(async () => contact!.click());
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label="手机回复"]')?.value).toBe('还没发出的消息');
  expect(host.querySelector('[data-testid="phone-message-timeline"]')).toBe(timeline);
  await click('朋友圈'); expect(host.querySelector('[aria-label="朋友圈"]')).not.toBeNull();
  await click('消息'); expect(host.querySelector<HTMLTextAreaElement>('[aria-label="手机回复"]')?.value).toBe('还没发出的消息');
  expect(courier.conversations[0]?.messages).toHaveLength(0);
});

it('a_phone_covered_by_another_system_dialog_does_not_mark_messages_read', async () => {
  function Harness() {
    const [value, setValue] = useState(() => { const next = initial(); next.conversations[0]!.unread = 1; return next; }); courier = value;
    const props = { courier: value, onCourierChange: setValue, onClose: () => {}, visible: false };
    return createElement(CourierPanel, props);
  }
  await act(async () => root.render(createElement(Harness)));
  expect(courier.conversations[0]?.unread).toBe(1);
});

it('sending_while_reading_old_messages_returns_the_timeline_to_the_bottom', async () => {
  function Harness() { const [value, setValue] = useState(initial); courier = value; return createElement(CourierPanel, { courier: value, onCourierChange: setValue, onClose: () => {} }); }
  await act(async () => root.render(createElement(Harness))); await click('消息');
  const timeline = host.querySelector<HTMLElement>('[data-testid="phone-message-timeline"]')!;
  Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 1200 });
  Object.defineProperty(timeline, 'clientHeight', { configurable: true, value: 200 });
  timeline.scrollTop = 40;
  await act(async () => timeline.dispatchEvent(new Event('scroll', { bubbles: true })));
  const before = vi.mocked(HTMLElement.prototype.scrollIntoView).mock.calls.length;
  await type('我来回复'); await click('发送');
  expect(courier.conversations[0]?.messages.at(-1)?.content).toBe('我来回复');
  expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.calls.length).toBeGreaterThan(before);
});

it('typing_with_ime_or_shift_enter_does_not_send_but_enter_does', async () => {
  function Harness() { const [value, setValue] = useState(initial); courier = value; return createElement(CourierPanel, { courier: value, onCourierChange: setValue, onClose: () => {} }); }
  await act(async () => root.render(createElement(Harness)));
  await click('消息'); await type('你好');
  const input = host.querySelector<HTMLTextAreaElement>('[aria-label="手机回复"]')!;
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })));
  expect(courier.conversations[0]?.messages).toHaveLength(0);
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(courier.conversations[0]?.messages.at(-1)?.content).toBe('你好');
});
