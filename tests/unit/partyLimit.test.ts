import { describe, expect, it } from 'vitest';
import { NPC_PARTY_LIMIT } from '@/models/npc';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { commitTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { buildTeyvatCommandRegistryPrompt } from '@/utils/teyvatCommandRegistry';

/**
 * A1：队伍上限必须落在**写入层**与提示词，而不只是 UI。
 * 修复前：UI 拦 4 人，但提示词写「最多 3 名」，且 registry 的 travelingTogether 分支只校验 boolean
 * → 模型可以把第 5 人写成同行，而提示词与 UI 自相矛盾。
 */

const evidence = '安柏认真地点了点头';
const factCandidates = [{ domain: 'relationship' as const, fact: evidence, evidence }];

const record = (id: string, name: string, travelingTogether = false) => ({
  id, 姓名: name, 地区: '', 身份: '', 天赋: [], 说明: '', aliases: [],
  roleTier: 'companion' as const, affinity: 0, relationship: 'friend', intimate: false, travelingTogether,
  firstSeenTurn: 1, lastSeenTurn: 1, gender: '女', playerAddress: '', appearance: '', clothing: '',
  speechStyle: '', personality: '', equipmentSummary: '', sharedMemories: [], relationshipLedger: {
    recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [],
    unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [],
  }, notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
});

const stateWith = (travelingCount: number, extra = false) => {
  const state = createEmptyTeyvatGameState();
  const records = Array.from({ length: travelingCount }, (_, index) => record(`npc_p${index}`, `同伴${index}`, true));
  records.push(record('npc_new', '新人', false));
  if (extra) records.push(record('npc_extra', '另一个新人', false));
  state.NPC = normalizeTeyvatNpcRecords(records);
  return state;
};

const invite = (state: ReturnType<typeof stateWith>, id: string) => commitTeyvatTurn(state, [{
  action: 'set', root: 'NPC', path: `[id=${id}].travelingTogether`, value: true, evidence,
}], () => undefined, { factCandidates });

describe('队伍上限（不含玩家）', () => {
  it('is a single shared constant', () => {
    expect(NPC_PARTY_LIMIT).toBe(4);
  });

  it('advertises the same limit to the variable model', () => {
    expect(buildTeyvatCommandRegistryPrompt()).toContain(`同行同伴最多 ${NPC_PARTY_LIMIT} 名`);
    expect(buildTeyvatCommandRegistryPrompt()).not.toContain('同行同伴最多 3 名');
  });

  it('accepts an invite while there is still room', () => {
    const result = invite(stateWith(NPC_PARTY_LIMIT - 1), 'npc_new');

    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.nextState.NPC.filter((npc) => npc.travelingTogether)).toHaveLength(NPC_PARTY_LIMIT);
  });

  it('rejects an invite that would exceed the limit', () => {
    const state = stateWith(NPC_PARTY_LIMIT);
    const result = invite(state, 'npc_new');

    expect(result.status).toBe('rejected');
    expect(result.errors[0]?.code).toBe('INVALID_VALUE');
    expect(state.NPC.filter((npc) => npc.travelingTogether)).toHaveLength(NPC_PARTY_LIMIT);
  });

  it('still allows leaving the party (set to false) at the limit', () => {
    const state = stateWith(NPC_PARTY_LIMIT);
    const result = commitTeyvatTurn(state, [{
      action: 'set', root: 'NPC', path: '[id=npc_p0].travelingTogether', value: false, evidence,
    }], () => undefined, { factCandidates });

    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.nextState.NPC.filter((npc) => npc.travelingTogether)).toHaveLength(NPC_PARTY_LIMIT - 1);
  });

  it('does not count a character who is already traveling twice', () => {
    const state = stateWith(NPC_PARTY_LIMIT);
    // 已经在队伍里的角色再被 set true：不应被上限拦下（幂等）
    const result = commitTeyvatTurn(state, [{
      action: 'set', root: 'NPC', path: '[id=npc_p0].travelingTogether', value: true, evidence,
    }], () => undefined, { factCandidates });

    expect(result.status).toBe('committed');
  });
});
