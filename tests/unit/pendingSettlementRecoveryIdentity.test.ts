import { describe, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState, type TeyvatGameState } from '@/models/teyvat';
import {
  canAutoResume,
  resolvePendingRecoveryEligibility,
  runPendingSettlementRecovery,
} from '@/hooks/useGame/recoveryResume';
import { parseWorkflowRecoveryJournal } from '@/utils/workflowRecoveryModel';

/**
 * 对抗审查（2026-09-20）发现的真实缺陷：`settlement_pending` 的恢复路径没有存档身份校验，
 * 只有 `settlement_committed` 有（`resolveCommittedRecoveryState`）。
 *
 * `pendingSettlement.source` 是**那一回合从旧档冻结下来的整根快照**，恢复时被当作结算基线
 * （`runVariableCalibrationStep({ baseGameSnapshot: source })`）。而 `commitGame` 的 CAS 只比较
 * 「恢复开始 vs 提交那一刻」两次读取的**活体根** —— 玩家若在这份 journal 产生之后已经读入另一份
 * 存档，两次读取都是新档，CAS 通过，于是旧档整根被写进新档（跨存档数据损坏）。
 *
 * 本文件把当时证明污染确实发生的探针**反过来**：先留一份反例证据（照旧直接 settle 会写出旧档内容），
 * 再断言现在的实现拒绝恢复、且 `settle` 一次都不会被调用。
 */

function save(turnCount: number, location: string, ids: string[]): TeyvatGameState {
  const root = createEmptyTeyvatGameState();
  root.turnCount = turnCount;
  root.世界.当前地点 = location;
  for (const id of ids) {
    root.对话.entries.push({ id, role: 'user', content: id, timestamp: 1, gameTime: String(turnCount) });
  }
  return normalizeTeyvatGameState(root);
}

const saveA = () => save(4, '旧档的清泉镇', ['a-1', 'a-2']);
const saveB = () => save(9, '新档的稻妻城', ['b-1', 'b-2', 'b-3']);

/** 旧档这一回合开始时的冻结快照：turnCount+1，对话多出本回合的 user 与 assistant 消息。 */
function frozenSourceOf(base: TeyvatGameState): TeyvatGameState {
  return normalizeTeyvatGameState({
    ...base,
    turnCount: base.turnCount + 1,
    对话: {
      entries: [
        ...base.对话.entries,
        { id: 'a-user', role: 'user' as const, content: '继续走', timestamp: 2, gameTime: String(base.turnCount) },
        { id: 'a-assistant', role: 'assistant' as const, content: '风起了。', timestamp: 3, gameTime: String(base.turnCount) },
      ],
    },
  });
}

function buildJournal(source: TeyvatGameState, turnAtStart: number) {
  return parseWorkflowRecoveryJournal({
    version: 3,
    workflowId: 'wf_pending_identity',
    startedAt: 1,
    updatedAt: 1,
    input: '继续走',
    turnAtStart,
    phase: 'settlement_pending',
    phaseStartedAt: 1,
    userMessageId: 'a-user',
    assistantMessageId: 'a-assistant',
    pendingNarrative: { body: [], choices: [], factCandidates: [], continuation: { summary: 'x', unresolved: [] } },
    pendingSettlement: { settlementId: 'wf_pending_identity', source },
  })!;
}

describe('pending settlement recovery must belong to the live save', () => {
  it('refuses to settle when the live root is another save, and writes nothing', async () => {
    const baseA = saveA();
    const journal = buildJournal(frozenSourceOf(baseA), baseA.turnCount);
    const live = { current: saveB() };

    // 反例证据（修复前的决策链）：直接 settle(source) 的产物就是**旧档 A** 的根 ——
    // 与审查探针里「断言污染确实发生」的两条完全一致。
    const source = journal.pendingSettlement!.source;
    const polluted = normalizeTeyvatGameState({
      ...source,
      世界: { ...source.世界, 当前时间: '旧档被写进来的标记' },
    });
    expect(polluted.世界.当前地点).toBe('旧档的清泉镇');
    expect(polluted.对话.entries.map((entry) => entry.id)).toEqual(['a-1', 'a-2', 'a-user', 'a-assistant']);
    expect(polluted.世界.当前地点).not.toBe(live.current.世界.当前地点);

    const settle = vi.fn(async () => {
      live.current = polluted;
      return polluted;
    });
    const result = await runPendingSettlementRecovery({
      journal,
      currentState: live.current,
      settle,
      runPostSettlement: async () => ({ ok: true }),
      persist: async () => undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.error : null).toBe('RECOVERY_PENDING_IDENTITY_MISMATCH');
    expect(settle).not.toHaveBeenCalled();
    expect(live.current.世界.当前地点).toBe('新档的稻妻城');
    expect(live.current.turnCount).toBe(9);
    expect(live.current.对话.entries.map((entry) => entry.id)).toEqual(['b-1', 'b-2', 'b-3']);
  });

  it('refuses even when the switched save happens to share the turn count', async () => {
    const baseA = saveA();
    const journal = buildJournal(frozenSourceOf(baseA), baseA.turnCount);
    // 另一份存档恰好在同一个回合（同一棵存档树的分支 / 同进度的另一档）
    const sameTurnOtherSave = save(baseA.turnCount, '别的存档的风起地', ['c-1', 'c-2']);
    const settle = vi.fn(async () => journal.pendingSettlement!.source);

    const result = await runPendingSettlementRecovery({
      journal,
      currentState: sameTurnOtherSave,
      settle,
      runPostSettlement: async () => ({ ok: true }),
      persist: async () => undefined,
    });

    expect(result.ok === false ? result.error : null).toBe('RECOVERY_PENDING_IDENTITY_MISMATCH');
    expect(settle).not.toHaveBeenCalled();
    expect(resolvePendingRecoveryEligibility(journal, sameTurnOtherSave).ok).toBe(false);
  });

  it('still recovers the legitimate case: the live root is this save\'s own pre-turn state', async () => {
    const baseA = saveA();
    const source = frozenSourceOf(baseA);
    const journal = buildJournal(source, baseA.turnCount);
    const preTurnLiveRoot = normalizeTeyvatGameState(baseA);
    const settle = vi.fn(async (_source: TeyvatGameState) => source);

    expect(resolvePendingRecoveryEligibility(journal, preTurnLiveRoot)).toEqual({ ok: true });
    const result = await runPendingSettlementRecovery({
      journal,
      currentState: preTurnLiveRoot,
      settle,
      runPostSettlement: async () => ({ ok: true }),
      persist: async () => undefined,
    });

    expect(settle).toHaveBeenCalledTimes(1);
    // journal 落库时会归一化 source（parsePendingSettlement），所以按内容断言而不是引用。
    expect(settle.mock.calls[0]?.[0]?.turnCount).toBe(source.turnCount);
    expect(settle.mock.calls[0]?.[0]?.对话.entries.map((entry) => entry.id))
      .toEqual(source.对话.entries.map((entry) => entry.id));
    expect(result.ok).toBe(true);
    expect(result.ok ? result.journal.phase : null).toBe('autosave_committed');
  });

  it('tolerates long-session trimming of the earliest messages', async () => {
    const baseA = saveA();
    const journal = buildJournal(frozenSourceOf(baseA), baseA.turnCount);
    // 长会话裁剪掉最早的消息后，活体对话不再是 source 的严格前缀，但最后一条仍在同一条时间线上。
    const trimmed = normalizeTeyvatGameState({
      ...baseA,
      对话: { entries: [baseA.对话.entries[baseA.对话.entries.length - 1]!] },
    });

    expect(resolvePendingRecoveryEligibility(journal, trimmed).ok).toBe(true);
  });

  it('fails closed when the frozen source carries no conversation to compare against', () => {
    const baseA = saveA();
    const journal = buildJournal(normalizeTeyvatGameState({ ...baseA, turnCount: baseA.turnCount + 1, 对话: { entries: [] } }), baseA.turnCount);

    const eligibility = resolvePendingRecoveryEligibility(journal, baseA);

    expect(eligibility).toEqual({ ok: false, error: 'RECOVERY_PENDING_SOURCE_MISSING' });
  });

  it('refuses an empty live timeline after a new game unless it is the pristine startup root', () => {
    const baseA = save(1, '旧档的风起地', []);
    const journal = buildJournal(frozenSourceOf(baseA), baseA.turnCount);
    const switchedEmpty = save(1, '新档的星落湖', []);

    expect(resolvePendingRecoveryEligibility(journal, switchedEmpty)).toEqual({
      ok: false, error: 'RECOVERY_PENDING_IDENTITY_MISMATCH',
    });
    expect(resolvePendingRecoveryEligibility(journal, baseA, { allowPristineRoot: true })).toEqual({ ok: true });
  });

  it('mirrors the same decision in the UI eligibility check (canAutoResume)', () => {
    const baseA = saveA();
    const journal = buildJournal(frozenSourceOf(baseA), baseA.turnCount);

    expect(canAutoResume(journal, saveB())).toBe(false);
    expect(canAutoResume(journal, save(baseA.turnCount, '别的存档的风起地', ['c-1']))).toBe(false);
    expect(canAutoResume(journal, normalizeTeyvatGameState(baseA))).toBe(true);
  });
});
