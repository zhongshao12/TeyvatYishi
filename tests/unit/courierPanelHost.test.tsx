// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CourierPanel as Content } from '@/components/features/Courier/CourierPanel';
import { SystemDrawer } from '@/components/layout/SystemDrawer';
import { createEmptyCourierSystem, type CourierSystem } from '@/models/teyvat/courier';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const initial: CourierSystem = {
  ...createEmptyCourierSystem(),
  contacts: [{ id: 'amber', npcId: 'npc-amber', name: '安柏', available: true }],
  conversations: [{ id: 'chat', type: 'private', title: '安柏', participantIds: ['player', 'amber'],
    messages: [], unread: 0, typingMemberIds: [], updatedAt: 1 }],
};

it('system_phone_content_does_not_register_a_second_dialog', async () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    const [courier, setCourier] = useState(initial);
    return createElement(SystemDrawer, { open, title: '手机', onClose: () => setOpen(false),
      children: createElement(Content, { courier, onCourierChange: setCourier, onClose: () => setOpen(false) }) });
  }
  await act(async () => root.render(createElement(Harness)));
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(document.querySelector('textarea[aria-label="手机回复"]')).not.toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.classList.contains('modal-open')).toBe(false);
});

it('embedded_phone_sends_to_live_state_and_returns_focus_after_closing', async () => {
  let courier = initial;
  function Harness() {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState(initial); courier = value;
    return createElement('div', null,
      createElement('button', { onClick: () => setOpen(true) }, '打开手机'),
      createElement(SystemDrawer, { open, title: '手机', onClose: () => setOpen(false), children:
        createElement(Content, { courier: value, onCourierChange: setValue, currentTurn: 9, onClose: () => setOpen(false) }) }));
  }
  await act(async () => root.render(createElement(Harness)));
  const opener = host.querySelector<HTMLButtonElement>('button')!; opener.focus();
  await act(async () => opener.click());
  const input = document.querySelector<HTMLTextAreaElement>('[aria-label="手机回复"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '今天见');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const send = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '发送')!;
  await act(async () => send.click());
  expect(courier.conversations[0]?.messages.at(-1)?.content).toBe('今天见');
  expect(courier.conversations[0]?.messages.at(-1)?.turn).toBe(9);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭面板"]')!.click());
  expect(document.activeElement).toBe(opener);
});
