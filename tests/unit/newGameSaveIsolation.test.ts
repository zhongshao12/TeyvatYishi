import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildNewGameState } from '@/hooks/useGame/newGameState';
import { toLegacyTraveler, toLegacyWorld, type UseGameStateReturn } from '@/hooks/useGameState';
import { buildSavePayload, clearActiveSaveTreeMetaIfMatches, commitActiveSaveTreeMeta } from '@/hooks/useGame/saveLoadWorkflow';
import { 创建空剧情编织系统 } from '@/models/storyWeaving';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState, type TeyvatGameState } from '@/models/teyvat';
import { loadSave, saveGame } from '@/services/dbService';
import { getSaveTreeMeta } from '@/utils/saveTree';

const base = createEmptyTeyvatGameState();
const traveler = { ...toLegacyTraveler(base), 姓名: '云' };
const world = toLegacyWorld(base);

function payloadFor(game: TeyvatGameState) {
  const state = { game, chatHistory: [], variableBatches: [] } as unknown as UseGameStateReturn;
  return buildSavePayload(state, 'manual', undefined, game);
}

describe('same-name save isolation', () => {
  afterEach(() => clearActiveSaveTreeMetaIfMatches());

  it('saves separate roots and reloads each game by its own ID', async () => {
    clearActiveSaveTreeMetaIfMatches();
    const first = buildNewGameState({ traveler: { ...traveler, id: 'traveler-a' }, world,
      initialNpcs: [], storyWeaving: 创建空剧情编织系统(), codexCatalog: base.图鉴 });
    first.背包.items.push({ id: 'sunsettia', category: 'food', name: '日落果', description: '',
      quantity: 1, rarity: 1, obtainedAtTurn: 1 });
    const firstPayload = payloadFor(first);
    const firstId = await saveGame(firstPayload);
    commitActiveSaveTreeMeta(firstPayload);

    // New-game flow clears the active tree before its first save.
    clearActiveSaveTreeMetaIfMatches();
    const second = buildNewGameState({ traveler: { ...traveler, id: 'traveler-b' }, world,
      initialNpcs: [], storyWeaving: 创建空剧情编织系统(), codexCatalog: base.图鉴 });
    expect(second.背包.items).toEqual([]);
    const secondPayload = payloadFor(second);
    const secondId = await saveGame(secondPayload);

    expect(firstId).not.toBe(secondId);
    expect(getSaveTreeMeta(firstPayload as never).rootId).not.toBe(getSaveTreeMeta(secondPayload as never).rootId);
    const loadedFirst = await loadSave(firstId);
    const loadedSecond = await loadSave(secondId);
    expect(loadedFirst).not.toBeNull();
    expect(loadedSecond).not.toBeNull();
    expect(normalizeTeyvatGameState(loadedFirst).旅行者.id).toBe('traveler-a');
    expect(normalizeTeyvatGameState(loadedFirst).背包.items.map((item) => item.name)).toEqual(['日落果']);
    expect(normalizeTeyvatGameState(loadedSecond).旅行者.id).toBe('traveler-b');
    expect(normalizeTeyvatGameState(loadedSecond).背包.items).toEqual([]);
  });
});
