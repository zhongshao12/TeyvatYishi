import { describe, expect, it } from 'vitest';
import { createLegacyGameViewSelector } from '@/hooks/useGameState';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { preflightTeyvatTurn } from '@/services/teyvatTurnTransaction';
import type { NPC记录 } from '@/models/npc';
import { buildNpcRelationshipPlanning } from '@/services/npcRelationshipPlanning';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';

describe('runtime performance regressions', () => {
  it('keeps legacy slice references stable when only the phone changes', () => {
    const select = createLegacyGameViewSelector();
    const initial = createEmptyTeyvatGameState();
    const first = select(initial);
    const second = select({
      ...initial,
      手机: { ...initial.手机, unreadTotal: 1 },
    });

    expect(second).toBe(first);

    const npcChanged = select({
      ...initial,
      NPC: [...initial.NPC],
    });
    expect(npcChanged).not.toBe(first);
    expect(npcChanged.NPC).not.toBe(first.NPC);
    expect(npcChanged.chatHistory).toBe(first.chatHistory);
    expect(npcChanged.相册).toBe(first.相册);
    expect(npcChanged.variableBatches).toBe(first.variableBatches);
  });

  it('preflights commands without normalizing the entire game root', () => {
    const initial = createEmptyTeyvatGameState();
    initial.turnCount = 1.75;
    const result = preflightTeyvatTurn(initial, [{
      action: 'set',
      root: '世界',
      path: '当前地点',
      value: '蒙德城',
      evidence: '城门在晨光中打开',
    }], {
      factCandidates: [{ domain: 'location', fact: '旅行者抵达蒙德城', evidence: '城门在晨光中打开' }],
    });

    expect(result.status).toBe('accepted');
    expect(result.nextState.turnCount).toBe(1.75);
    expect(result.nextState.世界.当前地点).toBe('蒙德城');
  });

  it('reuses enriched archives for unchanged NPC objects when one companion changes', () => {
    const npc = (id: string, name: string): NPC记录 => ({
      id,
      姓名: name,
      阶位: 'extra',
      好感度: 0,
      关系: 'stranger',
      同行: false,
      初见回合: 1,
      最近回合: 1,
      备注: [],
    });
    const lisa = npc('npc-lisa', '丽莎');
    const amber = npc('npc-amber', '安柏');
    const options = { nsfwEnabled: false, maleNsfwArchiveEnabled: false };

    const first = enrichNpcArchives([lisa, amber], options);
    const second = enrichNpcArchives([lisa, { ...amber, 好感度: 5 }], options);

    expect(second.records[0]).toBe(first.records[0]);
    expect(second.records[1]).not.toBe(first.records[1]);
    expect(second.records[1]?.好感度).toBe(5);
  });

  it('reads each NPC memory ledger only once while building relationship planning', () => {
    let memoryReads = 0;
    const npc: NPC记录 = {
      id: 'npc-lisa',
      姓名: '丽莎',
      阶位: 'extra',
      好感度: 0,
      关系: 'stranger',
      同行: false,
      初见回合: 1,
      最近回合: 8,
      备注: [],
    };
    Object.defineProperty(npc, '同行记忆', {
      configurable: true,
      enumerable: true,
      get: () => {
        memoryReads += 1;
        return ['与旅行者约定在图书馆再见'];
      },
    });

    const planning = buildNpcRelationshipPlanning([npc], 10);

    expect(planning.条目).toHaveLength(1);
    expect(planning.条目[0]?.建议动作).toBe('兑现承诺或冲突');
    expect(memoryReads).toBe(1);
  });
});
