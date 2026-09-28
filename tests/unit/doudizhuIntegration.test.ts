import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState, normalizeTeyvatNpcRecords } from '../../models/teyvat';
import { startDoudizhuGame } from '../../services/doudizhu/game';
import { applyDoudizhuGameAction } from '../../services/doudizhu/settlement';
import { buildDeltaOnlyStoredSave, buildSaveNodeDeltaRecord, restoreSaveFromDelta } from '../../utils/saveDeltaStorage';
import { findDoudizhuTerminalTurn } from '../helpers/doudizhuScenario';

const ids = ['npc-one', 'npc-two'] as const;
const state = () => {
  const root = createEmptyTeyvatGameState();
  root.世界.当前时间 = '18:00';
  root.NPC = normalizeTeyvatNpcRecords([
    { id: ids[0], 姓名: '甲', affinity: 20, roleTier: 'companion' },
    { id: ids[1], 姓名: '乙', affinity: 20, roleTier: 'companion' },
  ]);
  return root;
};

describe('Dou Dizhu save and resume boundary', () => {
  it('stores the active table in a delta save instead of silently restoring the base table', () => {
    const base = { ...state(), id: 1, type: 'manual', timestamp: 1, saveTree: { rootId: 'root', nodeId: 'one' } } as never;
    const currentRoot = state();
    currentRoot.斗地主.currentGame = startDoudizhuGame(ids, 123, 'active-game');
    const current = { ...currentRoot, id: 2, type: 'manual', timestamp: 2, saveTree: { rootId: 'root', nodeId: 'two', parentNodeId: 'one' } } as never;
    const delta = buildSaveNodeDeltaRecord(current, 2, { baseSave: base, baseSaveId: 1, storageMode: 'delta' });
    expect(delta?.baseMode).toBe('delta');
    expect(delta?.deltaPayload?.fields.斗地主).toMatchObject({ currentGame: { id: 'active-game' } });
    const compact = buildDeltaOnlyStoredSave(current, 1);
    expect((compact as unknown as { 斗地主?: unknown }).斗地主).toBeUndefined();
    const restored = restoreSaveFromDelta(base, compact, delta!);
    expect(normalizeTeyvatGameState(restored).斗地主.currentGame?.id).toBe('active-game');
  });

  it('continues after a JSON save round-trip, lets NPC finish, and settles only once', () => {
    const { before, action } = findDoudizhuTerminalTurn(state, ids, 'farmers');
    const loaded = normalizeTeyvatGameState(JSON.parse(JSON.stringify(before)));
    const finished = applyDoudizhuGameAction(loaded, action);
    expect(finished.斗地主.currentGame?.result?.winningSide).toBe('farmers');
    expect(finished.NPC.map((npc) => npc.affinity)).toEqual([25, 25]);
    const reloaded = normalizeTeyvatGameState(JSON.parse(JSON.stringify(finished)));
    const duplicate = applyDoudizhuGameAction(reloaded, action);
    expect(duplicate.NPC.map((npc) => npc.affinity)).toEqual([25, 25]);
    expect(duplicate.NPC.map((npc) => npc.sharedMemories.length)).toEqual([1, 1]);
    expect(duplicate.世界.当前时间).toBe('18:00');
  });
});
