// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CompanionPanel } from '@/components/features/GameSystems/CompanionPanel';
import { 创建NPC记录 } from '@/models/npc';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { applyLegacyNpcRecords, mapTeyvatNpcsToLegacy } from '@/hooks/useGameState';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('sourced NPC appearance archive', () => {
  const hosts: HTMLDivElement[] = [];
  afterEach(() => { for (const host of hosts) host.remove(); hosts.length = 0; vi.restoreAllMocks(); });

  it('appearance_facts_roundtrip_with_source', () => {
    const npc = {
      ...创建NPC记录({ 姓名: '阿明', 阶位: 'companion', 初见回合: 1, 性别: '女', NSFW档案: { 年龄确认: 'adult', 年龄确认来源: 'manual' } }),
      id: 'npc_aming', 外貌: '一位金发旅人。',
      外貌档案: {
        发色: { value: '金色', source: 'narrative' },
        瞳色: { value: '琥珀色', source: 'manual' },
        身高: { value: '168 cm', source: 'ai_estimate' },
        体重: { value: '55 kg', source: 'ai_estimate' },
        三围: { value: '86/61/88 cm', source: 'manual' },
      },
    } as const;
    const saved = applyLegacyNpcRecords(createEmptyTeyvatGameState(), [npc]);
    const loaded = normalizeTeyvatGameState(JSON.parse(JSON.stringify(saved)));
    expect(loaded.NPC[0]?.appearanceFacts).toEqual(npc.外貌档案);
    expect(mapTeyvatNpcsToLegacy(loaded)[0]?.外貌档案).toEqual(npc.外貌档案);
    expect(mapTeyvatNpcsToLegacy(loaded)[0]?.外貌).toBe('一位金发旅人。');
  });

  it('unknown_age_hides_measurements', async () => {
    const npc = {
      ...创建NPC记录({ 姓名: '阿明', 阶位: 'companion', 初见回合: 1, 性别: '女' }),
      id: 'npc_aming', 外貌档案: {
        发色: { value: '黑色', source: 'manual' },
        三围: { value: '86/61/88 cm', source: 'manual' },
      },
    } as const;
    const loaded = normalizeTeyvatGameState(applyLegacyNpcRecords(createEmptyTeyvatGameState(), [npc]));
    expect(loaded.NPC[0]?.appearanceFacts?.三围).toBeUndefined();
    const host = document.createElement('div');
    hosts.push(host);
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(CompanionPanel, {
        npcRecords: mapTeyvatNpcsToLegacy(loaded), onNpcRecordsChange: vi.fn(), turnCount: 2, nsfwEnabled: false,
      })));
      expect(host.textContent).toContain('发色');
      expect(host.textContent).toContain('黑色');
      expect(host.textContent).not.toContain('86/61/88');
      expect(host.textContent).not.toContain('三围');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('shows five explicit empty fields for an adult without invented values', async () => {
    const npc = {
      ...创建NPC记录({ 姓名: '阿明', 阶位: 'companion', 初见回合: 1, 性别: '女', NSFW档案: { 年龄确认: 'adult', 年龄确认来源: 'manual' } }),
      id: 'npc_aming',
    };
    const host = document.createElement('div');
    hosts.push(host);
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(CompanionPanel, {
        npcRecords: [npc], onNpcRecordsChange: vi.fn(), turnCount: 2, nsfwEnabled: false,
      })));
      for (const label of ['发色', '瞳色', '身高', '体重', '三围']) expect(host.textContent).toContain(label);
      expect(host.textContent).toContain('未记录');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps two same-name NPC appearance archives separate by stable id', () => {
    const first = { ...创建NPC记录({ 姓名: '同名旅人', 初见回合: 1, 性别: '女' }), id: 'npc_same_a', 外貌档案: { 发色: { value: '金色', source: 'manual' as const } } };
    const second = { ...创建NPC记录({ 姓名: '同名旅人', 初见回合: 1, 性别: '女' }), id: 'npc_same_b', 外貌档案: { 发色: { value: '黑色', source: 'narrative' as const } } };
    const loaded = normalizeTeyvatGameState(JSON.parse(JSON.stringify(applyLegacyNpcRecords(createEmptyTeyvatGameState(), [first, second]))));
    const records = mapTeyvatNpcsToLegacy(loaded);
    expect(records).toHaveLength(2);
    expect(records.find((npc) => npc.id === 'npc_same_a')?.外貌档案?.发色?.value).toBe('金色');
    expect(records.find((npc) => npc.id === 'npc_same_b')?.外貌档案?.发色?.value).toBe('黑色');
  });

  it('strips protected-age private fields despite a manual adult flag', () => {
    const npc = { ...创建NPC记录({ 姓名: '阿明', 初见回合: 1, 性别: '女', 介绍: '十岁的学徒', NSFW档案: {
      年龄确认: 'adult', 年龄确认来源: 'manual', 常用内衣: '不应显示',
    } }), id: 'npc_minor_evidence', 外貌档案: { 三围: { value: '86/61/88 cm', source: 'manual' as const } } };
    const loaded = mapTeyvatNpcsToLegacy(normalizeTeyvatGameState(applyLegacyNpcRecords(createEmptyTeyvatGameState(), [npc])))[0];
    expect(loaded?.外貌档案?.三围).toBeUndefined();
    expect(loaded?.NSFW档案?.常用内衣).toBeUndefined();
  });
});
