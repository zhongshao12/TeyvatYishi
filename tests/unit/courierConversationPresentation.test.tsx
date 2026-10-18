// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CourierPanel } from '@/components/features/Courier/CourierPanel';
import { CourierMomentsPanel } from '@/components/features/Courier/CourierMomentsPanel';
import { createEmptyCourierSystem, type CourierSystem } from '@/models/teyvat/courier';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.stubGlobal('matchMedia', () => ({ matches: true })); Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('keeps new messages red on opening the phone, shows contact avatars, and clears only the conversation explicitly opened', async () => {
  let live: CourierSystem = { ...createEmptyCourierSystem(), contacts: [
    { id: 'amber-contact', npcId: 'amber', name: '安柏', avatar: '/amber-test.webp', available: true },
    { id: 'lisa-contact', npcId: 'lisa', name: '丽莎', avatar: '/lisa-test.webp', available: true },
  ], conversations: ['amber', 'lisa'].map((id, index) => ({ id: `${id}-chat`, title: index ? '丽莎' : '安柏', type: 'private', participantIds: ['player', `${id}-contact`], updatedAt: 2 - index, unread: index ? 3 : 1, typingMemberIds: [], messages: [
    { id: `message-${id}`, senderId: `${id}-contact`, senderName: index ? '丽莎' : '安柏', role: 'contact', content: '有新消息', turn: 1, timestamp: 1, readBy: [] },
  ] })), unreadTotal: 4 };
  const render = () => root.render(createElement(CourierPanel, { courier: live, onCourierChange: update => { live = typeof update === 'function' ? update(live) : update; render(); }, onClose: vi.fn() }));
  await act(async () => render());
  const entry = (name: string) => [...host.querySelectorAll('button')].find(button => button.querySelector('strong')?.textContent === name)!;
  expect(entry('安柏').querySelector('img')?.getAttribute('src')).toBe('/amber-test.webp');
  expect(entry('丽莎').querySelector('img')?.getAttribute('src')).toBe('/lisa-test.webp');
  expect(entry('安柏').querySelector('[aria-label="1 条未读消息"]')?.classList.contains('phone-unread-badge')).toBe(true);
  expect(entry('丽莎').querySelector('[aria-label="3 条未读消息"]')).not.toBeNull();
  await act(async () => entry('安柏').click());
  expect(entry('安柏').querySelector('.phone-unread-badge')).toBeNull();
  expect(entry('丽莎').querySelector('.phone-unread-badge')).not.toBeNull();
  expect(live.conversations.find(chat => chat.id === 'lisa-chat')?.unread).toBe(3);
});

it('shows a compact moments feed without developer instructions, retaining posts, comments and retry actions', async () => {
  await act(async () => root.render(createElement(CourierMomentsPanel, { moments: [{ id: 'post', authorId: 'player', content: '风起地的晚霞', turn: 3, createdAt: 1000, updatedAt: 1000, revision: 1,
    comments: [{ id: 'comment', npcId: 'amber', npcName: '安柏', content: '下次一起去看吧！', createdAt: 1000 }], targets: [{ npcId: 'lisa', status: 'failed' }] }],
    travelerName: '云', eligibleCommenterCount: 2, canGenerateComments: true, commenterNames: new Map([['lisa', '丽莎']]), onPublish: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onRetry: vi.fn() })));
  expect(host.textContent).toContain('风起地的晚霞'); expect(host.textContent).toContain('下次一起去看吧！'); expect(host.textContent).toContain('重试丽莎评论');
  expect(host.textContent).not.toMatch(/当前有.*角色符合|接口已填写|不占那|仅你可以发布|TRAVEL NOTES|把旅途的光/);
});
