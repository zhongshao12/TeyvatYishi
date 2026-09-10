import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_PATH_ELEMENT_MAP,
  classifySaveUniverse,
  migratePartialTeyvatSave,
} from '@/compat/legacy-hsr/migrate';

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/saves', name), 'utf8'));
}

describe('legacy save migration boundary', () => {
  it('honors explicit universe markers before inspecting save contents', () => {
    expect(classifySaveUniverse({ universe: 'teyvat', schemaVersion: 2 })).toBe('teyvat');
  });

  it('classifies a legacy HSR fixture from independent structured signals', () => {
    expect(classifySaveUniverse(readFixture('legacy-hsr-save.json'))).toBe('legacy-hsr');
  });

  it('classifies a partial Teyvat fixture from independent structured signals', () => {
    expect(classifySaveUniverse(readFixture('partial-teyvat-save.json'))).toBe('partial-teyvat');
  });

  it('does not classify a save from a single free-text match', () => {
    expect(classifySaveUniverse({ note: '我在黑塔空间站醒来' })).toBe('unknown');
  });

  it('returns legacy saves untouched instead of converting them', () => {
    const input = readFixture('legacy-hsr-save.json');
    const before = structuredClone(input);

    const result = migratePartialTeyvatSave(input, {});

    expect(result.status).toBe('legacy-universe');
    expect(result).not.toHaveProperty('state');
    if (result.status === 'legacy-universe') expect(result.raw).toEqual(before);
    expect(input).toEqual(before);
  });

  it('withholds state when an element conversion requires input', () => {
    const unresolved = migratePartialTeyvatSave({ 旅人: { 主命途: 'nihility' } }, {});

    expect(unresolved.status).toBe('needs-input');
    expect(unresolved).not.toHaveProperty('state');
    if (unresolved.status === 'needs-input') {
      expect(unresolved.issues).toContainEqual(expect.objectContaining({
        code: 'UNRESOLVED_ELEMENT',
        path: '旅人.主命途',
        value: 'nihility',
      }));
    }
  });

  it('withholds state for an explicitly partial save missing the traveler element', () => {
    const result = migratePartialTeyvatSave({ universe: 'partial-teyvat', 旅人: {} }, {});

    expect(result.status).toBe('needs-input');
    expect(result).not.toHaveProperty('state');
    if (result.status === 'needs-input') {
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: 'UNRESOLVED_ELEMENT',
        path: '旅人.主命途',
        value: undefined,
      }));
    }
  });

  it('does not migrate an unmarked single-signal save even when its path is deterministic', () => {
    const result = migratePartialTeyvatSave({ 旅人: { 主命途: 'hunt' } }, {});

    expect(result.status).toBe('invalid');
    expect(result).not.toHaveProperty('state');
  });

  it('requires a star rank for each existing legacy item but not for an empty inventory', () => {
    const missingRank = migratePartialTeyvatSave({
      universe: 'partial-teyvat',
      旅人: { 主命途: 'hunt', 背包: [{ 名称: '旧物' }] },
    }, {});
    const noInventory = migratePartialTeyvatSave({
      universe: 'partial-teyvat',
      旅人: { 主命途: 'hunt' },
      背包: [],
    }, {});

    expect(missingRank.status).toBe('needs-input');
    if (missingRank.status === 'needs-input') {
      expect(missingRank.issues).toContainEqual(expect.objectContaining({
        code: 'UNRESOLVED_RARITY',
        path: '旅人.背包[0].星级',
        value: undefined,
      }));
    }
    expect(noInventory.status).toBe('migrated');
  });

  it('uses an explicit rarity resolution for an otherwise unknown legacy item rank', () => {
    const input = {
      universe: 'partial-teyvat',
      旅人: { 主命途: 'hunt', 背包: [{ 名称: '旧物', 星级: 'mythic' }] },
    };

    expect(migratePartialTeyvatSave(input, {}).status).toBe('needs-input');
    expect(migratePartialTeyvatSave(input, {
      rarityByLegacyValue: { mythic: 4 },
    }).status).toBe('migrated');
  });

  it('does not mutate explicit Teyvat saves while normalizing them', () => {
    const input = { universe: 'teyvat', schemaVersion: 2, turnCount: 3, 旅行者: { 姓名: '空' } };
    const before = structuredClone(input);

    const result = migratePartialTeyvatSave(input, {});

    expect(result.status).toBe('migrated');
    expect(input).toEqual(before);
  });

  it('migrates only after every ambiguity is resolved and leaves the source unchanged', () => {
    const input = readFixture('partial-teyvat-save.json');
    const before = structuredClone(input);

    const result = migratePartialTeyvatSave(input, {});

    expect(result.status).toBe('migrated');
    if (result.status === 'migrated') {
      expect(result.state.旅行者.姓名).toBe('荧');
      expect(result.state.旅行者.主元素).toBe('electro');
      expect(result.state.旅行者.元素共鸣).toEqual([expect.objectContaining({ element: 'electro' })]);
      expect(result.state.世界.currentRegion).toBe('mondstadt');
      expect(result.state.世界.currentLocation).toBe('蒙德城');
    }
    expect(input).toEqual(before);
  });

  it('uses all seven fixed legacy path mappings exactly', () => {
    expect(LEGACY_PATH_ELEMENT_MAP).toEqual({
      hunt: 'electro',
      destruction: 'pyro',
      preservation: 'geo',
      abundance: 'dendro',
      remembrance: 'cryo',
      erudition: 'hydro',
      elation: 'anemo',
    });
  });
});
