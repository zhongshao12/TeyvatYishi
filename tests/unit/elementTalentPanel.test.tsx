// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ElementTalentPanel } from '@/components/features/GameSystems/ElementTalentPanel';
import { SkillPanel } from '@/components/features/GameSystems/SkillPanel';
import { 创建空角色, type 角色数据结构 } from '@/models/character';
import type { API设置 } from '@/models/settings';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root; let traveler: 角色数据结构;
const initial: 角色数据结构 = { ...创建空角色(), 姓名: '测试旅人', 主元素: 'anemo',
  元素共鸣: [
    { element: 'anemo', unlocked: true, mastery: 40, source: 'traveler_resonance', notes: '', unlockedAt: '开局' },
    { element: 'geo', unlocked: true, mastery: 15, source: 'traveler_resonance', notes: '', unlockedAt: '开局' },
  ], 天赋: [
    { id: 'a', 名称: '风掌', 类别: 'elemental_skill', 关联元素: 'anemo', 等级: 1, 说明: '风的测试天赋' },
    { id: 'g', 名称: '岩星', 类别: 'elemental_skill', 关联元素: 'geo', 等级: 20, 说明: '岩的测试天赋' },
    { id: 'c', 名称: '烹饪', 类别: 'passive', 关联元素: '', 等级: 1, 说明: '通用测试天赋' },
  ] };
function Harness() {
  const [value, setValue] = useState(initial); traveler = value;
  return createElement(ElementTalentPanel, { traveler: value, onTravelerChange: setValue });
}
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); traveler = initial; });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (part: string) => {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
  return buttons.find(item => item.textContent?.trim() === part) ?? buttons.find(item => item.textContent?.includes(part))!;
};
const type = (label: string, value: string) => {
  const field = host.querySelector<HTMLInputElement>(`[aria-label="${label}"], [placeholder="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
};

it('browsing_locked_and_unlocked_elements_does_not_change_resonance', async () => {
  await act(async () => root.render(createElement(Harness)));
  expect(host.textContent).not.toContain('岩的测试天赋');
  await act(async () => button('坚守、契约').click());
  expect(traveler.主元素).toBe('anemo');
  expect(host.textContent).toContain('岩的测试天赋');
  expect(host.textContent).not.toContain('风的测试天赋');
  expect(host.textContent).toContain('通用测试天赋');
  await act(async () => button('设为主元素').click());
  expect(traveler.主元素).toBe('geo');
  await act(async () => button('流动、治愈').click());
  expect(traveler.主元素).toBe('geo');
  expect(button('设为主元素').disabled).toBe(true);
  expect(host.textContent).not.toContain('岩的测试天赋');
  expect(traveler.元素共鸣).toHaveLength(2);
});

it('talent_registration_edit_level_limits_and_removal_remain_available', async () => {
  await act(async () => root.render(createElement(Harness)));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="风掌 降级"]')?.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="风掌 升级"]')!.click());
  expect(traveler.天赋[0]?.等级).toBe(2);
  await act(async () => button('编辑').click());
  await act(async () => { type('编辑天赋名称', '风掌改'); });
  await act(async () => button('保存').click());
  expect(traveler.天赋[0]?.名称).toBe('风掌改');
  await act(async () => { type('天赋名称', '新天赋'); type('效果与限制', '测试效果'); });
  await act(async () => button('登记天赋').click());
  expect(traveler.天赋.find(item => item.名称 === '新天赋')?.关联元素).toBe('anemo');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除 新天赋"]')!.click());
  expect(traveler.天赋.some(item => item.名称 === '新天赋')).toBe(false);
  await act(async () => button('坚守、契约').click());
  expect(host.querySelector<HTMLButtonElement>('[aria-label="岩星 升级"]')?.disabled).toBe(true);
  expect([...host.querySelectorAll('select[aria-label="关联元素"] option')].some(option => (option as HTMLOptionElement).value === 'hydro')).toBe(false);
});

it('ai_talent_draft_keeps_the_selected_awakened_element', async () => {
  const api: API设置 = { configs: [{ id: 'fake', name: '离线测试', provider: 'openai', baseUrl: 'https://unit.invalid', apiKey: 'fixture', model: 'fixture', maxTokens: 1000, temperature: 0.7, createdAt: 1, updatedAt: 1 }], activeConfigId: 'fake' };
  const requests: unknown[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ 名称: '试验风技', 类别: 'elemental_skill', 等级: 1, 说明: '可控模型返回' }) } }] }), { status: 200 });
  });
  function DraftHarness() { const [value, setValue] = useState(initial); traveler = value; return createElement(SkillPanel, { traveler: value, onTravelerChange: setValue, apiSettings: api }); }
  await act(async () => root.render(createElement(DraftHarness)));
  await act(async () => button('让 AI 草拟').click());
  expect(requests).toHaveLength(1);
  expect(traveler.天赋.find(item => item.名称 === '试验风技')?.关联元素).toBe('anemo');
});
