// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RightMenu } from '@/components/layout/RightMenu';
import { MobileQuickMenu } from '@/components/layout/MobileQuickMenu';
import { LeftPanel } from '@/components/layout/LeftPanel';
import { CourierPanel } from '@/components/features/Courier/CourierPanel';
import { SystemDrawer } from '@/components/layout/SystemDrawer';
import { LazySurfaceFallback } from '@/components/layout/AppPanels';
import { 创建空角色 } from '@/models/character';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import { type GameSystemId } from '@/data/gameMenu';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const noop = () => {};

it('a contained phone can also be closed while its lazy content is loading', async () => {
  let closed = false;
  await act(async () => root.render(createElement(LazySurfaceFallback, { label: '手机载入中', onClose: () => { closed = true; } })));
  const close = host.querySelector<HTMLButtonElement>('[aria-label="关闭载入面板"]'); expect(close).not.toBeNull();
  await act(async () => close!.click()); expect(closed).toBe(true);
});

it('a disabled contained phone has a touch-accessible exit without relying on Escape', async () => {
  function Harness() { const [open, setOpen] = useState(true); return createElement(SystemDrawer, { open, title: '手机', contentMode: 'contained', onClose: () => setOpen(false),
    children: createElement(CourierPanel, { courier: createEmptyCourierSystem(), enabled: false, onClose: () => setOpen(false), onCourierChange: noop }) }); }
  await act(async () => root.render(createElement(Harness)));
  const close = document.querySelector<HTMLButtonElement>('[aria-label="关闭手机"]'); expect(close).not.toBeNull();
  await act(async () => close!.click()); expect(document.querySelector('[aria-label="手机已关闭"]')).toBeNull();
});

it('second_system_entry_opens_phone_and_shows_its_unread_count', async () => {
  let selected: GameSystemId | null = null;
  const props = { activeId: null, onSelect: (id: GameSystemId) => { selected = id; }, onSaveGame: noop, onLoadGame: noop, onSettings: noop, courierUnread: 7 };
  await act(async () => root.render(createElement(RightMenu, props)));
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('.journal-system-tab')];
  await act(async () => buttons[1]!.click());
  expect(selected).toBe('phone');
  expect(buttons[1]?.textContent).toContain('7');
  expect(buttons[0]?.textContent).toContain('元素与天赋');
});

it('left_traveler_bookmark_keeps_identity_and_party_but_no_phone_entry', async () => {
  const props = { traveler: { ...创建空角色(), 姓名: '测试旅人', 身份: '冒险者' }, onOpenCourier: noop, courierUnread: 7, currentStoryChapter: '测试篇章' };
  await act(async () => root.render(createElement(LeftPanel, props)));
  expect(host.querySelector('[title="打开手机"]')).toBeNull();
  expect(host.textContent).toContain('测试旅人');
  expect(host.textContent).toContain('测试篇章');
});

it('mobile_phone_shortcut_is_not_duplicated_in_more_systems', async () => {
  let opened = 0;
  await act(async () => root.render(createElement(MobileQuickMenu, { onCharacter: noop, onCourier: () => { opened++; }, onSettings: noop, onSave: noop, onHome: noop, onSystemSelect: noop, courierUnread: 7 })));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="手机"]')!.click());
  expect(opened).toBe(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="更多"]')!.click());
  expect([...host.querySelectorAll('button')].filter(button => button.textContent?.includes('手机'))).toHaveLength(1);
});

it('disabled_phone_shows_settings_instead_of_a_false_reply_input', async () => {
  let settingsOpened = false;
  const props = { courier: createEmptyCourierSystem(), enabled: false, onOpenSettings: () => { settingsOpened = true; }, onClose: noop, onCourierChange: noop };
  await act(async () => root.render(createElement(CourierPanel, props)));
  expect(host.textContent).toContain('手机系统已关闭');
  const settings = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('打开手机设置'));
  expect(settings).toBeDefined();
  await act(async () => settings!.click());
  expect(settingsOpened).toBe(true);
  expect(host.querySelector('[aria-label="手机回复"]')).toBeNull();
});
