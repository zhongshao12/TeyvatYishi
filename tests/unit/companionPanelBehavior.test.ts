// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { CompanionPanel } from '@/components/features/GameSystems/CompanionPanel';
import { 创建NPC记录 } from '@/models/npc';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import type { API设置 } from '@/models/settings';
import { generateNpcAppearanceEstimate } from '@/services/ai/npcAppearanceEstimate';

vi.mock('@/services/ai/npcAppearanceEstimate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/ai/npcAppearanceEstimate')>();
  return { ...actual, generateNpcAppearanceEstimate: vi.fn() };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮：${label}`);
  return button;
}

function changeInput(host: HTMLElement, label: string, value: string): void {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);
  if (!input) throw new Error(`找不到输入框：${label}`);
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('CompanionPanel behavior', () => {
  it('archives a companion, shows the archived list, and restores without rejoining the party', async () => {
    const record = { ...创建NPC记录({ 姓名: '阿明', 阶位: 'companion', 初见回合: 1, 原著角色: false }), id: 'npc_aming', 同行: true };
    let records = [record];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = async () => act(async () => root.render(createElement(CompanionPanel, {
      npcRecords: records, onNpcRecordsChange: (update) => { records = typeof update === 'function' ? update(records) : update; },
      turnCount: 2, nsfwEnabled: false,
    })));
    try {
      await render();
      await act(async () => findButton('归档角色').click());
      await render();
      expect(records[0]).toMatchObject({ id: 'npc_aming', 已归档: true, 同行: false });
      await act(async () => findButton('已归档 1').click());
      expect(host.textContent).toContain('阿明');
      await act(async () => findButton('恢复角色').click());
      await render();
      expect(records[0]).toMatchObject({ id: 'npc_aming', 阶位: 'companion', 同行: false });
      expect(records[0]?.已归档).not.toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
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

  it('windows a large companion roster and reveals the next page on demand', async () => {
    const records = Array.from({ length: 125 }, (_, index) => 创建NPC记录({
      姓名: `测试角色${String(index + 1).padStart(3, '0')}`,
      阶位: 'companion',
      初见回合: 1,
      原著角色: false,
    }));

    await act(async () => {
      root.render(createElement(CompanionPanel, {
        npcRecords: records,
        onNpcRecordsChange: vi.fn(),
        turnCount: 1,
        nsfwEnabled: false,
      }));
    });

    const visibleRosterButtons = () => Array.from(host.querySelectorAll('aside button'))
      .filter((button) => button.textContent?.includes('测试角色'));

    expect(visibleRosterButtons()).toHaveLength(60);
    expect(host.textContent).toContain('还有 65 位未显示');

    await act(async () => findButton('再显示 60 位').click());

    expect(visibleRosterButtons()).toHaveLength(120);
    expect(host.textContent).toContain('还有 5 位未显示');
  });

  it('AI appearance completion writes only to the selected NPC and manual edits persist by id', async () => {
    const first = { ...创建NPC记录({ 姓名: '阿明', 阶位: 'companion', 初见回合: 1, 性别: '女' }), id: 'npc_first' };
    const second = { ...创建NPC记录({ 姓名: '阿华', 阶位: 'companion', 初见回合: 1, 性别: '女' }), id: 'npc_second' };
    let records = [first, second];
    vi.mocked(generateNpcAppearanceEstimate).mockResolvedValueOnce({ 发色: { value: '金色', source: 'ai_estimate' } });
    const apiSettings = { activeConfigId: 'test', configs: [{ id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://example.test', apiKey: 'test', model: 'test' }] } as API设置;
    const render = async () => act(async () => root.render(createElement(CompanionPanel, {
      npcRecords: records, onNpcRecordsChange: (update) => { records = typeof update === 'function' ? update(records) : update; },
      turnCount: 1, nsfwEnabled: false, apiSettings,
    })));
    await render();
    await act(async () => findButton('AI 补全空白外貌').click());
    expect(records.find((npc) => npc.id === 'npc_first')?.外貌档案?.发色?.value).toBe('金色');
    expect(records.find((npc) => npc.id === 'npc_second')?.外貌档案).toBeUndefined();
    await render();
    await act(async () => findButton('编辑外貌细项').click());
    await act(async () => changeInput(host, '手动修改发色', '黑色'));
    await act(async () => findButton('保存发色').click());
    expect(records.find((npc) => npc.id === 'npc_first')?.外貌档案?.发色).toEqual({ value: '黑色', source: 'manual' });
  });

  it('does not rerender the selected NPC detail while only the roster search changes', async () => {
    const record = 创建NPC记录({
      姓名: '测试角色',
      阶位: 'companion',
      初见回合: 1,
      原著角色: false,
    });
    let titleReads = 0;
    Object.defineProperty(record, '对玩家称呼', {
      configurable: true,
      enumerable: true,
      get() {
        titleReads += 1;
        return '旅行者';
      },
    });

    await act(async () => {
      root.render(createElement(CompanionPanel, {
        npcRecords: [record],
        onNpcRecordsChange: vi.fn(),
        turnCount: 1,
        nsfwEnabled: false,
      }));
    });
    titleReads = 0;

    const search = host.querySelector<HTMLInputElement>('input[aria-label="搜索同伴"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(search, '测试');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(titleReads).toBe(0);
  });

  it('opens a companion profile draft and discards it on cancel', async () => {
    const record = 创建NPC记录({ 姓名: '测试旅人', 阶位: 'companion', 初见回合: 1 });
    record.别名 = '旧称呼';
    const onNpcRecordsChange = vi.fn();

    await act(async () => {
      root.render(createElement(CompanionPanel, {
        npcRecords: [record], onNpcRecordsChange, turnCount: 1, nsfwEnabled: false,
      }));
    });
    onNpcRecordsChange.mockClear();

    await act(async () => findButton('编辑资料').click());
    const alias = host.querySelector<HTMLInputElement>('input[aria-label="别名"]');
    expect(alias?.value).toBe('旧称呼');

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(alias, '新称呼');
      alias?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => findButton('取消编辑').click());

    expect(host.querySelector('input[aria-label="别名"]')).toBeNull();
    expect(onNpcRecordsChange).not.toHaveBeenCalled();
  });

  it('saves basic profile fields and derives relationship from bounded affinity', async () => {
    const record = 创建NPC记录({ 姓名: '路人甲', 阶位: 'extra', 初见回合: 1 });
    const onNpcRecordsChange = vi.fn();
    const onProfileSaved = vi.fn();
    await act(async () => {
      root.render(createElement(CompanionPanel, {
        npcRecords: [record], onNpcRecordsChange, onProfileSaved, turnCount: 1, nsfwEnabled: false,
      }));
    });
    onNpcRecordsChange.mockClear();
    await act(async () => findButton('路人 1').click());
    await act(async () => findButton('编辑资料').click());
    await act(async () => {
      changeInput(host, '姓名', '路人乙');
      changeInput(host, '别名', '药师');
      changeInput(host, '介绍', '蒙德城的药师');
      changeInput(host, '外貌', '黑发');
      changeInput(host, '穿着', '旅行披风');
      changeInput(host, '性格', '谨慎');
      changeInput(host, '说话方式', '简洁');
      changeInput(host, '对玩家称呼', '旅行者');
      changeInput(host, '装备摘要', '药箱');
      changeInput(host, '好感度', '999');
    });
    await act(async () => findButton('保存资料').click());

    const updater = onNpcRecordsChange.mock.lastCall?.[0] as ((records: typeof record[]) => typeof record[]) | undefined;
    expect(updater).toBeTypeOf('function');
    const saved = updater?.([record])[0];
    expect(saved).toMatchObject({
      姓名: '路人乙', 别名: '药师', 介绍: '蒙德城的药师', 外貌: '黑发', 穿着: '旅行披风',
      性格: '谨慎', 说话方式: '简洁', 对玩家称呼: '旅行者', 装备摘要: '药箱',
      好感度: 150, 关系: 'close', id: record.id,
    });
    expect(host.querySelector('input[aria-label="别名"]')).toBeNull();
    expect(onProfileSaved).toHaveBeenCalledTimes(1);
  });

  it('locks canonical names and rejects a duplicate name for an extra NPC', async () => {
    const canonical = 创建NPC记录({ 姓名: '安柏', 阶位: 'companion', 初见回合: 1, 原著角色: true });
    const extra = 创建NPC记录({ 姓名: '路人甲', 阶位: 'extra', 初见回合: 1 });
    const onNpcRecordsChange = vi.fn();
    await act(async () => {
      root.render(createElement(CompanionPanel, {
        npcRecords: [canonical, extra], onNpcRecordsChange, turnCount: 1, nsfwEnabled: false,
      }));
    });
    onNpcRecordsChange.mockClear();
    await act(async () => findButton('编辑资料').click());
    expect(host.querySelector<HTMLInputElement>('input[aria-label="姓名"]')?.disabled).toBe(true);
    await act(async () => findButton('取消编辑').click());
    await act(async () => findButton('路人 1').click());
    await act(async () => findButton('编辑资料').click());
    await act(async () => changeInput(host, '姓名', '安柏'));
    await act(async () => findButton('保存资料').click());
    expect(host.textContent).toContain('姓名已被其他角色使用');
    expect(onNpcRecordsChange).not.toHaveBeenCalled();
  });

  it('renames the matching phone contact without overwriting concurrent contact changes', async () => {
    const record = 创建NPC记录({ 姓名: '旧名字', 阶位: 'extra', 初见回合: 1 });
    const courier = createEmptyCourierSystem();
    courier.contacts = [{ id: 'contact-a', npcId: record.id, name: '旧名字', available: true }];
    const onCourierChange = vi.fn();
    await act(async () => {
      root.render(createElement(CompanionPanel, {
        npcRecords: [record], onNpcRecordsChange: vi.fn(), turnCount: 1, nsfwEnabled: false,
        courier, onCourierChange,
      }));
    });
    await act(async () => findButton('路人 1').click());
    await act(async () => findButton('编辑资料').click());
    await act(async () => changeInput(host, '姓名', '新名字'));
    await act(async () => findButton('保存资料').click());

    const updater = onCourierChange.mock.lastCall?.[0];
    expect(updater).toBeTypeOf('function');
    const concurrent = { ...courier, contacts: [...courier.contacts, { id: 'contact-b', name: '另一位', available: true }] };
    expect(updater(concurrent).contacts).toEqual([
      { id: 'contact-a', npcId: record.id, name: '新名字', available: true },
      { id: 'contact-b', name: '另一位', available: true },
    ]);
  });

  it('shows the current traveler name and lets an adult correct a legacy-assumed first partner', async () => {
    const record = 创建NPC记录({ 姓名: '丽莎', 阶位: 'companion', 初见回合: 1, 原著角色: true });
    record.性别 = '女';
    record.NSFW档案 = {
      enabled: true, 年龄确认: 'adult', 年龄确认来源: 'canonical', 是否处女: '否',
      首次性行为对象引用: 'player', 首次性行为对象来源: 'legacy_assumed',
      经历: ['旧档推定，具体回合未知'],
    };
    const onNpcRecordsChange = vi.fn();
    await act(async () => root.render(createElement(CompanionPanel, {
      npcRecords: [record], onNpcRecordsChange, turnCount: 2, nsfwEnabled: true, travelerName: '云',
    })));
    await act(async () => findButton('NSFW档案').click());
    expect(host.querySelector('[data-testid="adult-female-sexual-history"]')?.textContent).toContain('云');
    expect(host.textContent).toContain('旧档推定');

    await act(async () => findButton('编辑首次对象').click());
    const type = host.querySelector<HTMLSelectElement>('select[aria-label="首次对象类型"]');
    expect(type).not.toBeNull();
    await act(async () => {
      if (!type) return;
      type.value = 'other';
      type.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => changeInput(host, '其他对象姓名', '凯亚'));
    await act(async () => findButton('保存首次对象').click());
    const updater = onNpcRecordsChange.mock.lastCall?.[0] as ((records: typeof record[]) => typeof record[]) | undefined;
    expect(updater?.([record])[0]?.NSFW档案).toMatchObject({
      首次性行为对象: '凯亚', 首次性行为对象来源: 'manual',
    });
    expect(updater?.([record])[0]?.NSFW档案?.首次性行为对象引用).toBeUndefined();
  });

  it('does not expose old unverified adult private fields in the companion page', async () => {
    const record = 创建NPC记录({ 姓名: '原创冒险家', 阶位: 'companion', 初见回合: 1 });
    record.性别 = '女';
    record.NSFW档案 = { enabled: true, 年龄确认: 'adult', 年龄确认来源: 'legacy_unverified', 是否处女: '否' };
    await act(async () => root.render(createElement(CompanionPanel, {
      npcRecords: [record], onNpcRecordsChange: vi.fn(), turnCount: 2, nsfwEnabled: true, travelerName: '云',
    })));
    await act(async () => findButton('NSFW档案').click());
    expect(host.querySelector('[data-testid="adult-female-sexual-history"]')).toBeNull();
    expect(host.textContent).toContain('待确认');
  });

  it('allows confirmed adult female underwear correction but hides it for unknown age', async () => {
    const adult = { ...创建NPC记录({ 姓名: '阿明', 阶位: 'companion', 初见回合: 1, 性别: '女', NSFW档案: { 年龄确认: 'adult', 年龄确认来源: 'manual' } }), id: 'npc_adult' };
    let records = [adult];
    const render = async () => act(async () => root.render(createElement(CompanionPanel, {
      npcRecords: records, onNpcRecordsChange: (update) => { records = typeof update === 'function' ? update(records) : update; },
      turnCount: 1, nsfwEnabled: true,
    })));
    await render();
    await act(async () => findButton('NSFW档案').click());
    expect(host.querySelector('input[aria-label="编辑常用内衣"]')).not.toBeNull();
    await act(async () => changeInput(host, '编辑常用内衣', '浅色棉质内衣'));
    await act(async () => findButton('保存常用内衣').click());
    expect(records[0]?.NSFW档案?.常用内衣).toBe('浅色棉质内衣');
    records = [{ ...adult, NSFW档案: { 年龄确认: 'unknown', 常用内衣: '不应展示' } }];
    await render();
    expect(host.querySelector('input[aria-label="编辑常用内衣"]')).toBeNull();
    expect(host.textContent).not.toContain('不应展示');
  });
});
