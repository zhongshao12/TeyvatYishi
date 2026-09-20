import { describe, expect, it, vi } from 'vitest';
import {
  createWorkflowRecoveryJournal,
  isWorkflowRecoveryComplete,
  parseWorkflowRecoveryJournal,
  updateWorkflowRecoveryJournal,
  type WorkflowRecoveryJournal,
} from '../../utils/workflowRecoveryModel';
import { canAutoResume, resolveRecoveryTarget } from '../../hooks/useGame/recoveryResume';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '../../models/teyvat';
import { applyAbortedWorkflowPolicy, hasCommittedSettlementIdentity, runPendingSettlementRecovery, shouldRollbackAbortedWorkflow } from '../../hooks/useGame/recoveryResume';
import { loadWorkflowRecoveryJournal, persistWorkflowRecoveryJournal, WORKFLOW_RECOVERY_KEY } from '../../services/workflowRecovery';
import * as recoveryResume from '../../hooks/useGame/recoveryResume';
import { buildCommittedQuestArchive } from '../../services/questService';

describe('workflowRecoveryModel v2', () => {
  it('deletes a malformed durable recovery journal instead of ignoring it forever', async () => {
    const remove = vi.fn(async () => undefined);
    const loaded = await loadWorkflowRecoveryJournal(
      async () => ({ version: 3, workflowId: '', input: '' }),
      remove,
    );

    expect(loaded).toBeNull();
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(WORKFLOW_RECOVERY_KEY);
  });

  it('creates and parses only formal phases for new journals', () => {
    const journal = createWorkflowRecoveryJournal('input', 3);
    expect(journal.phase).toBe('narrative_received');
    const updated = updateWorkflowRecoveryJournal(journal, { phase: 'settlement_pending' });
    const parsed = parseWorkflowRecoveryJournal(JSON.parse(JSON.stringify(updated)));
    expect(parsed?.phase).toBe('settlement_pending');
    expect(parsed?.version).toBe(3);
    expect(parsed?.workflowId).toBe(journal.workflowId);
    expect(parsed?.phaseStartedAt).toBe(updated.phaseStartedAt);
  });

  it('rejects unknown phases', () => {
    const parsed = parseWorkflowRecoveryJournal({
      version: 2,
      workflowId: 'w',
      startedAt: 1,
      updatedAt: 1,
      input: 'x',
      turnAtStart: 1,
      phase: 'unknown',
    });
    expect(parsed).toBeNull();
  });

  it.each([
    ['main_request', 'narrative_received'],
    ['variable_settlement', 'settlement_pending'],
    ['memory', 'settlement_committed'],
    ['steambird', 'settlement_committed'],
    ['courier_seed', 'settlement_committed'],
    ['story_weaving', 'settlement_committed'],
    ['image_parse', 'settlement_committed'],
    ['image_generate', 'settlement_committed'],
    ['autosave', 'settlement_committed'],
    ['phone_seed', 'settlement_committed'],
    ['news', 'settlement_committed'],
  ])('maps historical phase %s only while parsing', (phase, expected) => {
    const parsed = parseWorkflowRecoveryJournal({
      version: 1,
      workflowId: 'w1',
      startedAt: 123,
      updatedAt: 124,
      input: 'x',
      turnAtStart: 1,
      phase,
    });
    expect(parsed?.version).toBe(3);
    expect(parsed?.phase).toBe(expected);
    expect(parsed?.phaseStartedAt).toBe(123);
  });

  it('resets phaseStartedAt only when the phase changes', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const journal = createWorkflowRecoveryJournal('input', 1);
      spy.mockReturnValue(2000);
      const first = updateWorkflowRecoveryJournal(journal, { phase: 'settlement_pending' });
      spy.mockReturnValue(3000);
      const samePhase = updateWorkflowRecoveryJournal(first, { phase: 'settlement_pending' });
      expect(samePhase.phaseStartedAt).toBe(first.phaseStartedAt);
      spy.mockReturnValue(4000);
      const nextPhase = updateWorkflowRecoveryJournal(samePhase, { phase: 'settlement_committed' });
      expect(nextPhase.phaseStartedAt).toBe(4000);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not re-normalize trusted game roots while advancing an in-memory journal', () => {
    const root = createEmptyTeyvatGameState();
    const journal = createWorkflowRecoveryJournal('input', 1);
    const pending = updateWorkflowRecoveryJournal(journal, {
      phase: 'settlement_pending',
      pendingSettlement: { settlementId: journal.workflowId, source: root },
    });
    expect(pending.pendingSettlement?.source).toBe(root);

    const committed = updateWorkflowRecoveryJournal(pending, {
      phase: 'settlement_committed',
      committedState: root,
    });
    expect(committed.committedState).toBe(root);
  });

describe('workflowRecoveryModel completion and resume branches', () => {
  const journal = (overrides: Partial<Parameters<typeof parseWorkflowRecoveryJournal>[0]> = {}) =>
    parseWorkflowRecoveryJournal({
      version: 3, workflowId: 'w', startedAt: 1, updatedAt: 1, input: 'x', turnAtStart: 1,
      phase: 'settlement_pending', phaseStartedAt: 1, ...overrides,
    })!;

  it('does not mistake an assistant message for durable workflow completion', () => {
    const j = journal({ assistantMessageId: 'ghost', userMessageId: 'user-1' });
    expect(isWorkflowRecoveryComplete(j, [
      { id: 'user-1', role: 'user' },
      { id: 'assistant-1', role: 'assistant' },
    ])).toBe(false);
  });

  it('returns false when there is no user message id', () => {
    const j = journal({ userMessageId: undefined });
    expect(isWorkflowRecoveryComplete(j, [
      { id: 'assistant-1', role: 'assistant' },
    ])).toBe(false);
  });

  it('returns false when the user message id is not found', () => {
    const j = journal({ userMessageId: 'missing-user' });
    expect(isWorkflowRecoveryComplete(j, [
      { id: 'other-user', role: 'user' },
      { id: 'assistant-1', role: 'assistant' },
    ])).toBe(false);
  });

  it('returns false when the only assistant precedes the user', () => {
    const j = journal({ userMessageId: 'user-1' });
    expect(isWorkflowRecoveryComplete(j, [
      { id: 'assistant-0', role: 'assistant' },
      { id: 'user-1', role: 'user' },
    ])).toBe(false);
  });

  it('never maps settlement_committed to variable replay and marks autosave_committed complete', () => {
    const durableRoot = createEmptyTeyvatGameState();
    const committed = journal({ phase: 'settlement_committed', assistantMessageId: 'assistant-1', committedState: durableRoot });
    expect(canAutoResume(committed, createEmptyTeyvatGameState())).toBe(true);
    expect(resolveRecoveryTarget(committed)).toEqual({ kind: 'post_settlement' });
    expect(resolveRecoveryTarget(committed)).not.toEqual({ kind: 'pending_settlement' });

    const complete = journal({ phase: 'autosave_committed', assistantMessageId: 'assistant-1' });
    expect(canAutoResume(complete, createEmptyTeyvatGameState())).toBe(false);
    expect(resolveRecoveryTarget(complete)).toBeNull();
    expect(isWorkflowRecoveryComplete(complete, [])).toBe(true);
  });

  it('auto-resumes a committed journal from its durable root even when the loaded history is stale', () => {
    const committedState = createEmptyTeyvatGameState();
    committedState.turnCount = 6;
    committedState.对话.entries.push({ id: 'assistant-6', role: 'assistant', content: '已提交', timestamp: 1, gameTime: '5' });
    const committed = journal({ phase: 'settlement_committed', assistantMessageId: 'assistant-6', committedState });
    expect(canAutoResume(committed, createEmptyTeyvatGameState())).toBe(true);
  });

  it('uses one exact identity policy for historical committed UI eligibility and direct recovery', async () => {
    const resolver = (recoveryResume as unknown as {
      resolveCommittedRecoveryState?: (journal: WorkflowRecoveryJournal, loaded: ReturnType<typeof createEmptyTeyvatGameState>) =>
        | { ok: true; state: ReturnType<typeof createEmptyTeyvatGameState> }
        | { ok: false; error: string };
    }).resolveCommittedRecoveryState;
    expect(typeof resolver).toBe('function');
    if (!resolver) return;

    const historical = journal({ phase: 'settlement_committed', assistantMessageId: 'assistant-legacy', turnAtStart: 4 });
    const loaded = createEmptyTeyvatGameState();
    loaded.turnCount = 5;
    loaded.世界.当前地点 = '历史已提交地点';
    loaded.对话.entries.push({ id: 'assistant-legacy', role: 'assistant', content: '历史正文', timestamp: 1, gameTime: '4' });
    const resolved = resolver(historical, loaded);
    expect(resolved).toMatchObject({ ok: true, state: { turnCount: 5, 世界: { 当前地点: '历史已提交地点' } } });
    if (!resolved.ok) return;
    expect(resolved.state).not.toBe(loaded);
    resolved.state.世界.当前地点 = 'tail mutation';
    expect(loaded.世界.当前地点).toBe('历史已提交地点');
    resolved.state.世界.当前地点 = '历史已提交地点';
    expect((canAutoResume as unknown as (journal: WorkflowRecoveryJournal, state: typeof loaded) => boolean)(historical, loaded)).toBe(true);

    const postStates: Array<ReturnType<typeof createEmptyTeyvatGameState>> = [];
    const persisted: string[] = [];
    const runCommitted = recoveryResume.runCommittedSettlementRecovery as unknown as (input: {
      journal: WorkflowRecoveryJournal;
      currentState: typeof loaded;
      runPostSettlement: (state: typeof loaded) => Promise<{ ok: true }>;
      persist: (next: WorkflowRecoveryJournal) => Promise<void>;
    }) => Promise<{ ok: boolean; journal: WorkflowRecoveryJournal; error?: string }>;
    const recovered = await runCommitted({
      journal: historical,
      currentState: loaded,
      runPostSettlement: async (state) => { postStates.push(state); return { ok: true }; },
      persist: async (next) => { persisted.push(next.phase); },
    });
    expect(recovered).toMatchObject({ ok: true, journal: { phase: 'autosave_committed' } });
    expect(postStates).toEqual([resolved.state]);
    expect(postStates[0]).not.toBe(loaded);
    expect(persisted).toEqual(['autosave_committed']);

    const mismatches = [
      { label: 'assistant id', mutate: (root: typeof loaded) => { root.对话.entries[0]!.id = 'wrong'; } },
      { label: 'assistant role', mutate: (root: typeof loaded) => { root.对话.entries[0]!.role = 'user'; } },
      { label: 'assistant game time', mutate: (root: typeof loaded) => { root.对话.entries[0]!.gameTime = '3'; } },
      { label: 'committed root turn', mutate: (root: typeof loaded) => { root.turnCount = 6; } },
    ];
    for (const mismatch of mismatches) {
      const root = structuredClone(loaded);
      mismatch.mutate(root);
      const invalid = resolver(historical, root);
      expect(invalid, mismatch.label).toEqual({ ok: false, error: 'RECOVERY_COMMITTED_IDENTITY_MISMATCH' });
      expect((canAutoResume as unknown as (journal: WorkflowRecoveryJournal, loaded: typeof root) => boolean)(historical, root), mismatch.label).toBe(false);
      const tail = vi.fn(async () => ({ ok: true as const }));
      const persist = vi.fn(async () => undefined);
      const result = await runCommitted({ journal: historical, currentState: root, runPostSettlement: tail, persist });
      expect(result, mismatch.label).toMatchObject({ ok: false, error: 'RECOVERY_COMMITTED_IDENTITY_MISMATCH', journal: { phase: 'settlement_committed' } });
      expect(tail, mismatch.label).not.toHaveBeenCalled();
      expect(persist, mismatch.label).not.toHaveBeenCalled();
    }
  });

  it('persists and normalizes the frozen settlement source needed for pending recovery', () => {
    const source = createEmptyTeyvatGameState();
    source.turnCount = 7;
    const pendingNarrative = {
      body: [{ kind: 'narration' as const, text: '抵达蒙德。' }], choices: [],
      factCandidates: [{ domain: 'location' as const, fact: '抵达蒙德', evidence: '抵达蒙德。' }],
      continuation: { summary: '抵达蒙德', unresolved: [] },
    };
    const parsed = parseWorkflowRecoveryJournal({
      ...journal({ phase: 'settlement_pending', assistantMessageId: 'assistant-7' }),
      pendingNarrative,
      pendingSettlement: { settlementId: 'settlement-w-7', source: { ...source, unknownRoot: true }, variableDraft: 'draft' },
    });
    expect(parsed?.pendingSettlement?.settlementId).toBe('settlement-w-7');
    expect(parsed?.pendingSettlement?.source.turnCount).toBe(7);
    expect(parsed?.pendingSettlement?.source).not.toHaveProperty('unknownRoot');
    expect(resolveRecoveryTarget(parsed!)).toEqual({ kind: 'pending_settlement' });
    expect(canAutoResume(parsed!, createEmptyTeyvatGameState())).toBe(true);
  });

  it('persists a normalized cloned exact committed root for crash recovery', () => {
    const committed = createEmptyTeyvatGameState();
    committed.turnCount = 12;
    committed.世界.当前地点 = '璃月港';
    committed.对话.entries.push({ id: 'assistant-12', role: 'assistant', content: '海灯升起。', timestamp: 12, gameTime: '11' });
    const parsed = parseWorkflowRecoveryJournal({
      ...journal({ phase: 'settlement_committed', assistantMessageId: 'assistant-12', turnAtStart: 11 }),
      committedState: { ...committed, unknownRoot: true },
    });
    committed.世界.当前地点 = '被后续修改';
    expect(parsed?.committedState?.turnCount).toBe(12);
    expect(parsed?.committedState?.世界.当前地点).toBe('璃月港');
    expect(parsed?.committedState).not.toHaveProperty('unknownRoot');
  });

  it('does not treat assistant presence as completed settlement and detects only exact committed identity', () => {
    const source = createEmptyTeyvatGameState();
    source.turnCount = 5;
    source.对话.entries.push({ id: 'assistant-5', role: 'assistant', content: '正文', gameTime: '4', timestamp: 1 });
    const pending = parseWorkflowRecoveryJournal({
      ...journal({ phase: 'settlement_pending', assistantMessageId: 'assistant-5', turnAtStart: 4 }),
      pendingNarrative: { body: [{ kind: 'narration', text: '正文' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } },
      pendingSettlement: { settlementId: 'w', source },
    })!;
    expect(isWorkflowRecoveryComplete(pending, [{ id: 'assistant-5', role: 'assistant' }])).toBe(false);
    expect(hasCommittedSettlementIdentity(source, pending)).toBe(false);
    source.叙事.variableBatches.push({ id: 'vbatch_w', turn: 4, timestamp: 1, source: 'main', modelName: 'x', results: [], rawText: '' });
    expect(hasCommittedSettlementIdentity(source, pending)).toBe(true);
    expect(hasCommittedSettlementIdentity({ ...source, turnCount: 6 }, pending)).toBe(false);
  });

  it('allows abort rollback only before the root settlement commit', () => {
    expect(shouldRollbackAbortedWorkflow('narrative_received')).toBe(true);
    expect(shouldRollbackAbortedWorkflow('settlement_pending')).toBe(true);
    expect(shouldRollbackAbortedWorkflow('settlement_committed')).toBe(false);
    expect(shouldRollbackAbortedWorkflow('autosave_committed')).toBe(false);
  });

  it('preserves the committed root and journal on a post-commit AbortError disposition', async () => {
    const committed = createEmptyTeyvatGameState();
    committed.世界.当前地点 = '蒙德城';
    const journalRef = journal({ phase: 'settlement_committed' });
    const rollback = vi.fn(async () => undefined);
    const clearJournal = vi.fn(async () => undefined);
    const disposition = await applyAbortedWorkflowPolicy({ phase: journalRef.phase, rollback, clearJournal });
    expect(disposition).toBe('preserved');
    expect(rollback).not.toHaveBeenCalled();
    expect(clearJournal).not.toHaveBeenCalled();
    expect(committed.世界.当前地点).toBe('蒙德城');
    expect(journalRef.phase).toBe('settlement_committed');
  });

  it('propagates phase persistence failures', async () => {
    const pending = journal({ phase: 'settlement_pending' });
    await expect(persistWorkflowRecoveryJournal(pending, async () => {
      throw new Error('durable write failed');
    })).rejects.toThrow('durable write failed');
  });

  it('resumes a fresh pending settlement exactly once and passes the exact committed state to the post tail', async () => {
    const source = createEmptyTeyvatGameState();
    source.turnCount = 8;
    source.对话.entries.push({ id: 'assistant-8', role: 'assistant', content: '正文', gameTime: '7', timestamp: 1 });
    const pending = parseWorkflowRecoveryJournal({
      ...journal({ phase: 'settlement_pending', assistantMessageId: 'assistant-8', turnAtStart: 7 }),
      pendingNarrative: { body: [{ kind: 'narration', text: '正文' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } },
      pendingSettlement: { settlementId: 'fresh-8', source },
    })!;
    const committed = structuredClone(source);
    committed.世界.当前地点 = '蒙德城';
    committed.叙事.variableBatches.push({ id: 'vbatch_fresh-8', turn: 7, timestamp: 1, source: 'main', modelName: 'x', results: [], rawText: '' });
    const settle = vi.fn(async () => committed);
    const post = vi.fn(async (state) => {
      expect(state).toEqual(normalizeTeyvatGameState(committed));
      expect(state).not.toBe(committed);
      return { ok: true as const };
    });
    const phases: string[] = [];
    const result = await runPendingSettlementRecovery({
      journal: pending, currentState: source, settle, runPostSettlement: post,
      persist: async (next) => { phases.push(next.phase); },
    });
    expect(result.ok).toBe(true);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['settlement_committed', 'autosave_committed']);
    expect(result.journal.committedState).toEqual(normalizeTeyvatGameState(committed));
    expect(result.journal.committedState).not.toBe(committed);
  });

  it('promotes an already-committed stale pending journal without replay and retains committed phase on post failure', async () => {
    const committed = createEmptyTeyvatGameState();
    committed.turnCount = 9;
    committed.对话.entries.push({ id: 'assistant-9', role: 'assistant', content: '正文', gameTime: '8', timestamp: 1 });
    committed.叙事.variableBatches.push({ id: 'vbatch_stale-9', turn: 8, timestamp: 1, source: 'main', modelName: 'x', results: [], rawText: '' });
    const pending = parseWorkflowRecoveryJournal({
      ...journal({ phase: 'settlement_pending', assistantMessageId: 'assistant-9', turnAtStart: 8 }),
      pendingNarrative: { body: [{ kind: 'narration', text: '正文' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } },
      pendingSettlement: { settlementId: 'stale-9', source: committed },
    })!;
    const settle = vi.fn(async () => null);
    const phases: string[] = [];
    const result = await runPendingSettlementRecovery({
      journal: pending, currentState: committed, settle,
      runPostSettlement: async (state) => {
        expect(state).toEqual(normalizeTeyvatGameState(committed));
        expect(state).not.toBe(committed);
        return { ok: false, error: 'autosave failed' };
      },
      persist: async (next) => { phases.push(next.phase); },
    });
    expect(result).toMatchObject({ ok: false, error: 'autosave failed', journal: { phase: 'settlement_committed' } });
    expect(settle).not.toHaveBeenCalled();
    expect(phases).toEqual(['settlement_committed']);
    expect(result.journal.committedState).toEqual(normalizeTeyvatGameState(committed));
    expect(result.journal.committedState).not.toBe(committed);
  });

  it('retains a committed journal on archive failure and retries one idempotent archive without settlement replay', async () => {
    const runCommitted = (recoveryResume as unknown as {
      runCommittedSettlementRecovery?: (input: {
        journal: WorkflowRecoveryJournal;
        currentState: ReturnType<typeof createEmptyTeyvatGameState>;
        runPostSettlement: (state: ReturnType<typeof createEmptyTeyvatGameState>, journal: WorkflowRecoveryJournal) => Promise<{ ok: true } | { ok: false; error: string }>;
        persist: (journal: WorkflowRecoveryJournal) => Promise<void>;
      }) => Promise<{ ok: boolean; journal: WorkflowRecoveryJournal; error?: string }>;
    }).runCommittedSettlementRecovery;
    expect(typeof runCommitted).toBe('function');
    if (!runCommitted) return;

    const committed = createEmptyTeyvatGameState();
    committed.turnCount = 10;
    committed.世界.当前日期 = '提瓦特历 10 日';
    committed.任务.completed.push({
      id: 'quest_archive', title: '归档任务', description: '', source: 'side', status: 'completed', objectives: [], rewards: [],
      createdAtTurn: 9, updatedAt: 10, completedAtTurn: 10,
    });
    const durable = parseWorkflowRecoveryJournal({
      ...journal({ phase: 'settlement_committed', assistantMessageId: 'assistant-10', turnAtStart: 9 }),
      committedState: committed,
    })!;
    const settle = vi.fn();
    const first = await runCommitted({
      journal: durable,
      currentState: createEmptyTeyvatGameState(),
      runPostSettlement: async (state) => {
        expect(state).toEqual(normalizeTeyvatGameState(committed));
        return { ok: false, error: 'archive offline' };
      },
      persist: async () => undefined,
    });
    expect(first).toMatchObject({ ok: false, error: 'archive offline', journal: { phase: 'settlement_committed' } });

    let archive = committed.世界树;
    const persisted: string[] = [];
    const retry = () => runCommitted({
      journal: first.journal,
      currentState: createEmptyTeyvatGameState(),
      runPostSettlement: async (state) => {
        archive = buildCommittedQuestArchive(archive, state, [{ questId: 'quest_archive', title: '归档任务', summary: '完成归档' }], 10);
        return { ok: true };
      },
      persist: async (next) => { persisted.push(next.phase); },
    });
    expect((await retry()).ok).toBe(true);
    expect((await retry()).ok).toBe(true);
    expect(archive.entries).toHaveLength(1);
    expect(archive.entries[0]!.id).toBe('irminsul_quest_10_quest_archive');
    expect(settle).not.toHaveBeenCalled();
    expect(persisted).toEqual(['autosave_committed', 'autosave_committed']);
  });
});

});
