// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CourierMomentsPanel } from '@/components/features/Courier/CourierMomentsPanel';
import { createEmptyCourierSystem, normalizeCourierSystem, type CourierMoment } from '@/models/teyvat/courier';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const base = { travelerName: '旅人', eligibleCommenterCount: 0, canGenerateComments: false, commenterNames: new Map<string, string>(),
  onPublish: () => false, onEdit: () => false, onDelete: () => {}, onRetry: () => {} };
const post: CourierMoment = { id: 'post', authorId: 'player', content: '旅途记录', turn: 1, createdAt: 1000, updatedAt: 1000, revision: 1, targets: [], comments: [] };

it.each(['Infinity', -Infinity, 1e20, 'bad', '1e999'])('imported_invalid_device_time_%s_becomes_unknown', value => {
  const normalized = normalizeCourierSystem({ ...createEmptyCourierSystem(), moments: [{ ...post, createdAt: value, updatedAt: value }] });
  expect(normalized.moments?.[0]?.createdAt).toBe(0);
  expect(normalized.moments?.[0]?.updatedAt).toBe(0);
});

it('a_direct_bad_timestamp_cannot_crash_the_feed', async () => {
  await act(async () => root.render(createElement(CourierMomentsPanel, { ...base, moments: [{ ...post, createdAt: Infinity }] })));
  expect(host.textContent).toContain('旅途记录');
  expect(host.textContent).toContain('发布时间未记录');
});

it('normal_device_timestamp_is_preserved', async () => {
  const value = normalizeCourierSystem({ moments: [post] });
  await act(async () => root.render(createElement(CourierMomentsPanel, { ...base, moments: value.moments ?? [] })));
  expect(host.querySelector('time')?.getAttribute('dateTime')).toBe('1970-01-01T00:00:01.000Z');
});

it('image_and_mentioned_filters_only_change_visible_posts', async () => {
  const moments = [post, { ...post, id: 'image', content: '有图内容', images: [{ entryId: 'e', assetId: 'a' }] }, { ...post, id: 'mention', content: '点名内容', mentionIds: ['npc'] }];
  await act(async () => root.render(createElement(CourierMomentsPanel, { ...base, moments })));
  const click = async (label: string) => act(async () => {
    const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label);
    expect(button).toBeDefined(); button!.click();
  });
  await click('有图');
  expect(host.textContent).toContain('有图内容'); expect(host.textContent).not.toContain('点名内容');
  await click('已点名');
  expect(host.textContent).toContain('点名内容'); expect(host.textContent).not.toContain('有图内容');
  await click('全部'); expect(host.textContent).toContain('旅途记录');
  expect(moments).toHaveLength(3); expect(moments[2]?.mentionIds).toEqual(['npc']);
});
