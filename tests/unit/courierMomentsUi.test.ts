// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CourierModal } from '@/components/features/Courier/CourierModal';
import { createEmptyCourierSystem, type CourierSystem } from '@/models/teyvat/courier';
import { 创建NPC记录 } from '@/models/npc';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function typeInto(textarea: HTMLTextAreaElement, content: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, content);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

it('lets the player publish, edit, and delete a phone Moment without fake NPC posts', async () => {
  const onRequestMomentComments = vi.fn();
  function Harness() {
    const [courier, setCourier] = useState<CourierSystem>(createEmptyCourierSystem);
    return createElement(CourierModal, {
      courier, currentTurn: 8, travelerName: '云', onCourierChange: setCourier,
      onRequestMomentComments, onClose: vi.fn(),
    });
  }
  await act(async () => root.render(createElement(Harness)));
  await act(async () => button('朋友圈').click());
  expect(document.body.textContent).toContain('仅你可以发布动态');
  expect(document.body.textContent).toContain('当前有 0 位角色符合评论条件');
  expect(document.body.textContent).toContain('生死挚友（好感度超过 100）');
  // 2026-09-29 第 7 项：文案改为区分「自动评论」与「@ 点名一定回应」，断言随契约更新。
  expect(document.body.textContent).toContain('暂无符合条件的角色，不会收到自动评论；但 @ 点名的联系人仍会回应');
  await act(async () => button('写下旅途此刻').click());
  const composer = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="写朋友圈"]');
  expect(composer).not.toBeNull();
  await act(async () => typeInto(composer!, '今天的风很温柔'));
  await act(async () => button('发布').click());
  expect(document.body.textContent).toContain('今天的风很温柔');
  expect(document.body.textContent).toContain('现实发布时间');
  expect(onRequestMomentComments).toHaveBeenCalledTimes(1);
  await act(async () => button('编辑').click());
  expect(document.body.textContent).toContain('保存修改将清空旧评论，并按新内容重新生成');
  const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑朋友圈"]');
  await act(async () => typeInto(editor!, '晚风也很温柔'));
  await act(async () => button('保存修改').click());
  expect(document.body.textContent).toContain('晚风也很温柔');
  expect(document.body.textContent).not.toContain('今天的风很温柔');
  await act(async () => button('删除').click());
  expect(document.body.textContent).not.toContain('晚风也很温柔');
});

it('explains missing local phone API while allowing the player to publish and cancel edits', async () => {
  const amber = { ...创建NPC记录({ 姓名: '安柏', 初见回合: 1 }), id: 'amber', 好感度: 101 };
  const courier: CourierSystem = {
    ...createEmptyCourierSystem(),
    contacts: [{ id: 'amber-contact', npcId: 'amber', name: '安柏', available: true }],
    moments: [{ id: 'p1', authorId: 'player', content: '晨风', turn: 1, createdAt: 1, updatedAt: 1, revision: 1, comments: [], targets: [] }],
  };
  await act(async () => root.render(createElement(CourierModal, {
    courier, npcRecords: [amber], canGenerateMomentComments: false, onCourierChange: vi.fn(), onClose: vi.fn(),
  })));
  await act(async () => button('朋友圈').click());
  expect(document.body.textContent).toContain('当前有 1 位角色符合评论条件');
  expect(document.body.textContent).toContain('手机评论接口未配置：自动评论不会生成，@ 点名的联系人会由本地回应补上');
  await act(async () => button('编辑').click());
  await act(async () => button('取消').click());
  expect(document.body.textContent).toContain('晨风');
  expect(courier.moments?.[0]?.revision).toBe(1);
});

it('retries only the named failed commenter without inventing a local reply', async () => {
  const request = vi.fn();
  const amber = { ...创建NPC记录({ 姓名: '安柏', 初见回合: 1 }), id: 'amber', 好感度: 101 };
  const lisa = { ...创建NPC记录({ 姓名: '丽莎', 初见回合: 1 }), id: 'lisa', 好感度: 101 };
  const courier: CourierSystem = {
    ...createEmptyCourierSystem(),
    moments: [{ id: 'p1', authorId: 'player', content: '今天到蒙德了', turn: 2,
      createdAt: 1, updatedAt: 1, revision: 3, comments: [], targets: [
        { npcId: 'amber', status: 'failed' }, { npcId: 'lisa', status: 'failed' },
      ] }],
  };
  await act(async () => root.render(createElement(CourierModal, {
    courier, npcRecords: [amber, lisa], onCourierChange: vi.fn(), onRequestMomentComments: request, onClose: vi.fn(),
  })));
  await act(async () => button('朋友圈').click());
  await act(async () => button('重试安柏评论').click());
  expect(request).toHaveBeenCalledWith('p1', 3, 'amber');
  expect(document.body.textContent).toContain('重试丽莎评论');
  expect(document.body.textContent).not.toContain('下次一起');
});

it('keeps the chat timeline mounted and its scroll offset when visiting Moments', async () => {
  const courier: CourierSystem = {
    ...createEmptyCourierSystem(),
    conversations: [{ id: 'private-amber', title: '安柏', participantIds: ['player', 'amber'], messages: [
      { id: 'm1', senderId: 'amber', senderName: '安柏', role: 'contact', content: '欢迎来到蒙德', turn: 1, timestamp: 1, readBy: [] },
    ], unread: 0, type: 'private', typingMemberIds: [], updatedAt: 1 }],
  };
  await act(async () => root.render(createElement(CourierModal, { courier, onCourierChange: vi.fn(), onClose: vi.fn() })));
  const timeline = document.querySelector<HTMLElement>('[data-testid="phone-message-timeline"]');
  expect(timeline).not.toBeNull();
  timeline!.scrollTop = 42;
  await act(async () => button('朋友圈').click());
  expect(document.querySelector('[data-testid="phone-message-timeline"]')).toBe(timeline);
  const amberChat = [...document.querySelectorAll('button')].find((item) => item.querySelector('strong')?.textContent === '安柏');
  expect(amberChat).toBeDefined();
  await act(async () => amberChat!.click());
  expect(document.querySelector<HTMLElement>('[data-testid="phone-message-timeline"]')?.scrollTop).toBe(42);
});
