// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TravelerProfileModal } from '@/components/features/Character/TravelerProfileModal';
import { 创建空角色, type 角色数据结构 } from '@/models/character';
import { displayFirstPartner } from '@/utils/npcFirstPartner';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const traveler: 角色数据结构 = {
  ...创建空角色(), id: 'player', 姓名: '云', 年龄: 25,
  主元素: 'anemo', 元素共鸣: [{ element: 'anemo', mastery: 3, unlocked: true, source: 'traveler_resonance', unlockedAt: '开局', notes: '' }],
};

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`找不到按钮：${label}`);
  return found;
}

function enter(host: HTMLElement, label: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);
  if (!input) throw new Error(`找不到输入框：${label}`);
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('traveler profile editing', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('cancel_keeps_traveler_unchanged', async () => {
    const onTravelerChange = vi.fn();
    await act(async () => root.render(createElement(TravelerProfileModal, { traveler, onTravelerChange, onClose: vi.fn() })));
    await act(async () => button(host, '编辑资料').click());
    await act(async () => enter(host, '旅人姓名', '新名字'));
    expect(onTravelerChange).not.toHaveBeenCalled();
    await act(async () => button(host, '取消编辑').click());
    expect(onTravelerChange).not.toHaveBeenCalled();
    expect(host.textContent).toContain('云');
    expect(host.querySelector('[aria-label="旅人姓名"]')).toBeNull();
  });

  it('save_updates_basic_fields_once', async () => {
    const onTravelerChange = vi.fn();
    await act(async () => root.render(createElement(TravelerProfileModal, { traveler, onTravelerChange, onClose: vi.fn() })));
    await act(async () => button(host, '编辑资料').click());
    const changes = [
      ['旅人姓名', '新名字'], ['旅人别名', '新别名'], ['旅人性别', '女'], ['旅人年龄', '26'],
      ['旅人身高', '170cm'], ['旅人生日', '3月11日'], ['旅人身份', '冒险者'],
      ['旅人外貌', '金色短发'], ['旅人性格', '勇敢'], ['旅人背景', '来自远方'],
    ];
    for (const [label, value] of changes) await act(async () => enter(host, label!, value!));
    expect(onTravelerChange).not.toHaveBeenCalled();
    await act(async () => button(host, '保存资料').click());
    expect(onTravelerChange).toHaveBeenCalledTimes(1);
    const saved = onTravelerChange.mock.calls[0]![0] as 角色数据结构;
    expect(saved).toMatchObject({ 姓名: '新名字', 别名: '新别名', 性别: '女', 年龄: 26, 身高: '170cm', 生日: '3月11日', 身份: '冒险者', 外貌: '金色短发', 性格: '勇敢', 背景: '来自远方' });
    expect(saved.元素共鸣).toBe(traveler.元素共鸣);
    expect(saved.主元素).toBe('anemo');
    expect(traveler.姓名).toBe('云');
  });

  it('rejects blank names and invalid age without writing', async () => {
    const onTravelerChange = vi.fn();
    await act(async () => root.render(createElement(TravelerProfileModal, { traveler, onTravelerChange, onClose: vi.fn() })));
    await act(async () => button(host, '编辑资料').click());
    await act(async () => enter(host, '旅人姓名', '   '));
    await act(async () => button(host, '保存资料').click());
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/姓名/u);
    expect(onTravelerChange).not.toHaveBeenCalled();
    await act(async () => enter(host, '旅人姓名', '云'));
    await act(async () => enter(host, '旅人年龄', '-1'));
    await act(async () => button(host, '保存资料').click());
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/年龄/u);
    expect(onTravelerChange).not.toHaveBeenCalled();
  });

  it('player_reference_displays_renamed_traveler', async () => {
    const onTravelerChange = vi.fn();
    await act(async () => root.render(createElement(TravelerProfileModal, { traveler, onTravelerChange, onClose: vi.fn() })));
    await act(async () => button(host, '编辑资料').click());
    await act(async () => enter(host, '旅人姓名', '风'));
    await act(async () => button(host, '保存资料').click());
    const saved = onTravelerChange.mock.calls[0]![0] as 角色数据结构;
    const archive = { 是否处女: '否' as const, 首次性行为对象引用: 'player' as const };
    expect(displayFirstPartner(archive, saved.姓名)).toBe('风');
    expect(archive.首次性行为对象引用).toBe('player');
  });
});
