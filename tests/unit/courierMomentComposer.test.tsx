// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CourierMomentsPanel } from '@/components/features/Courier/CourierMomentsPanel';
import type { CourierMoment } from '@/models/teyvat/courier';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
const change = async (label: string, value: string) => act(async () => {
  const input = document.querySelector<HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const base = { travelerName: '旅人', eligibleCommenterCount: 0, canGenerateComments: false,
  commenterNames: new Map<string, string>(), mentionCandidates: [{ npcId: 'amber', name: '安柏' }],
  onPublish: () => false, onEdit: () => false, onDelete: () => {}, onRetry: () => {} };
const post: CourierMoment = { id: 'p', authorId: 'player', content: 'a'.repeat(500), createdAt: 1, updatedAt: 1, turn: 1, revision: 1, targets: [], comments: [] };
async function openDraft() {
  if (!document.querySelector('[aria-label="写朋友圈"]')) await act(async () => button('写下旅途此刻').click());
}

it.each([499, 500])('mention_button_cannot_overflow_edit_draft_at_%i_characters', async length => {
  let submitted = false;
  await act(async () => root.render(createElement(CourierMomentsPanel, { ...base, moments: [{ ...post, content: 'a'.repeat(length) }], onEdit: () => { submitted = true; return false; } })));
  await act(async () => button('编辑').click());
  await act(async () => button('@安柏').click());
  expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑朋友圈"]')?.value).toBe('a'.repeat(length));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('500');
  expect(submitted).toBe(false);
});

it('failed_publish_keeps_the_draft_and_explains_that_it_was_not_saved', async () => {
  await act(async () => root.render(createElement(CourierMomentsPanel, { ...base, moments: [] })));
  await openDraft(); await change('写朋友圈', '不会消失的草稿');
  await act(async () => button('发布').click());
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="写朋友圈"]')?.value).toBe('不会消失的草稿');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('未保存');
});

it('publisher_opens_an_independent_dialog_and_escape_preserves_the_draft', async () => {
  await act(async () => root.render(createElement(CourierMomentsPanel, { ...base, moments: [] })));
  await openDraft(); await change('写朋友圈', '稍后发布');
  expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('发布朋友圈');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await openDraft();
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="写朋友圈"]')?.value).toBe('稍后发布');
});
