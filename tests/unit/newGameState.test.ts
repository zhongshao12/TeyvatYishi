import { describe, expect, it } from 'vitest';
import { buildNewGameState } from '@/hooks/useGame/newGameState';
import { toLegacyTraveler, toLegacyWorld } from '@/hooks/useGameState';
import { 创建NPC记录 } from '@/models/npc';
import { 创建空剧情编织系统 } from '@/models/storyWeaving';
import { createEmptyTeyvatGameState, normalizeArchiveCodex } from '@/models/teyvat';

const empty = createEmptyTeyvatGameState();
const traveler = { ...toLegacyTraveler(empty), id: 'same-name', 姓名: '云' };
const world = { ...toLegacyWorld(empty), 当前地点: '蒙德城' };
const storyWeaving = 创建空剧情编织系统();

describe('new-game state isolation', () => {
  it('starts a second same-name game with fresh per-game slices', () => {
    const first = buildNewGameState({
      traveler, world, initialNpcs: [创建NPC记录({ 姓名: '安柏', 初见回合: 1 })],
      storyWeaving, codexCatalog: empty.图鉴,
    });
    first.背包 = { ...first.背包, items: [{ id: 'old-item' }] } as typeof first.背包;
    first.任务 = { ...first.任务, active: [{ id: 'old-quest' }] } as typeof first.任务;
    first.手机.contacts.push({ id: 'old-contact' } as typeof first.手机.contacts[number]);
    first.相册 = { ...first.相册, entries: [{ id: 'old-photo' }] } as typeof first.相册;
    first.地图 = { ...first.地图, unlockedStatues: ['mondstadt', 'liyue'] };

    const second = buildNewGameState({ traveler: { ...traveler, id: 'other-id' }, world, initialNpcs: [], storyWeaving, codexCatalog: empty.图鉴 });

    expect(second.旅行者.姓名).toBe('云');
    expect(second.旅行者.id).toBe('other-id');
    expect(second.turnCount).toBe(1);
    expect(second.NPC).toEqual([]);
    for (const key of ['背包', '手机', '世界树', '蒸汽鸟报', '原著轨道', '对话', '记忆', '相册', '任务', '后台队列', '地图'] as const) {
      expect(second[key]).toEqual(createEmptyTeyvatGameState()[key]);
    }
    expect(second.叙事.plotNodes).toEqual([]);
    expect(second.叙事.variableBatches).toEqual([]);
    expect(second.世界.当前地点).toBe('蒙德城');
  });

  it('keeps codex definitions but clears every unlock marker', () => {
    const catalog = normalizeArchiveCodex({
      entries: [{ id: 'custom-entry', name: '自建条目', builtin: false, unlockedAtTurn: 67,
        runtimeUnlock: { status: 'unlocked', note: '上一局获得', condition: '完成蒙德任务' } }],
      unlockedEntryIds: ['custom-entry'],
    });
    const result = buildNewGameState({ traveler, world, initialNpcs: [], storyWeaving, codexCatalog: catalog });

    expect(result.图鉴.unlockedEntryIds).toEqual([]);
    expect(result.图鉴.entries[0]).toMatchObject({ id: 'custom-entry', name: '自建条目', unlockedAtTurn: 0,
      runtimeUnlock: { status: '', note: '', condition: '完成蒙德任务' } });
    expect(catalog.entries[0]?.runtimeUnlock.note).toBe('上一局获得');
  });
});
