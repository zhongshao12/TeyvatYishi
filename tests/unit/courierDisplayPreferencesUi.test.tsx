// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CourierMomentsPanel } from '@/components/features/Courier/CourierMomentsPanel';
import * as db from '@/services/dbService';
import { useCourierDisplayPreferences } from '@/components/features/Courier/useCourierDisplayPreferences';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
const props = { moments: [], travelerName: '旅人', eligibleCommenterCount: 0, canGenerateComments: false, commenterNames: new Map<string, string>(),
  onPublish: () => false, onEdit: () => false, onDelete: () => {}, onRetry: () => {} };

it('a late initial preference read cannot overwrite a successfully saved new choice', async () => {
  let finishRead!: (value: unknown) => void;
  vi.spyOn(db, 'loadSetting').mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  let display!: ReturnType<typeof useCourierDisplayPreferences>;
  function Harness() { display = useCourierDisplayPreferences(); return createElement('div', null, display.preferences.density); }
  await act(async () => root.render(createElement(Harness)));
  await act(async () => display.save({ density: 'compact', showWorldMoment: true, showLocation: false, expandComments: true }));
  await act(async () => finishRead({ density: 'comfortable' }));
  expect(host.textContent).toBe('compact');
  expect((await db.loadSetting('courierMomentsDisplay') as { density: string }).density).toBe('compact');
});
beforeEach(async () => { await db.deleteSetting('courierMomentsDisplay'); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const click = async (label: string) => act(async () => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label);
  expect(button).toBeDefined(); button!.click();
  if (label === '保存显示设置') await db.loadSetting('courierMomentsDisplay');
});
const open = async () => { await act(async () => root.render(createElement(CourierMomentsPanel, props))); await click('朋友圈设置'); };

it('saves_display_preferences_without_overwriting_other_settings_and_reloads_them', async () => {
  await db.saveSetting('gameSettings', { sentinel: 'other setting' }); await db.saveSetting('apiSettings', { sentinel: 'new api' });
  await open();
  const density = document.querySelector<HTMLSelectElement>('[aria-label="卡片密度"]')!;
  await act(async () => { density.value = 'compact'; density.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('保存显示设置');
  expect(await db.loadSetting('courierMomentsDisplay')).toEqual({ density: 'compact', showWorldMoment: true, showLocation: true, expandComments: true });
  expect(await db.loadSetting('gameSettings')).toEqual({ sentinel: 'other setting' });
  expect(await db.loadSetting('apiSettings')).toEqual({ sentinel: 'new api' });
  await act(async () => { root.unmount(); root = createRoot(host); root.render(createElement(CourierMomentsPanel, props)); });
  await click('朋友圈设置');
  expect(document.querySelector<HTMLSelectElement>('[aria-label="卡片密度"]')?.value).toBe('compact');
});

it('cancelling_display_settings_does_not_write_a_new_preference', async () => {
  await open();
  const density = document.querySelector<HTMLSelectElement>('[aria-label="卡片密度"]')!;
  await act(async () => { density.value = 'compact'; density.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('取消'); expect(await db.loadSetting('courierMomentsDisplay')).toBeNull();
});

it('a_failed_save_keeps_the_settings_dialog_and_its_draft', async () => {
  await open();
  vi.spyOn(db, 'saveSetting').mockRejectedValueOnce(new Error('disk full'));
  const density = document.querySelector<HTMLSelectElement>('[aria-label="卡片密度"]')!;
  await act(async () => { density.value = 'compact'; density.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('保存显示设置');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('disk full');
  expect(document.querySelector<HTMLSelectElement>('[aria-label="卡片密度"]')?.value).toBe('compact');
  expect(await db.loadSetting('courierMomentsDisplay')).toBeNull();
});
