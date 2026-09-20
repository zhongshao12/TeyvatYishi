import { updateWorkflowRecoveryJournal, type WorkflowRecoveryJournal, type WorkflowRecoveryPhase } from '@/utils/workflowRecoveryModel';
import { normalizeTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import { loadRecoverableWorkflow, clearWorkflowRecoveryJournal } from '@/services/workflowRecovery';

export async function checkInterruptedWorkflow(): Promise<WorkflowRecoveryJournal | null> {
  const journal = await loadRecoverableWorkflow();
  if (journal?.phase === 'autosave_committed') {
    await clearWorkflowRecoveryJournal(journal.workflowId);
    return null;
  }
  return journal;
}

export function canAutoResume(
  journal: WorkflowRecoveryJournal,
  currentState: TeyvatGameState,
): boolean {
  if (journal.phase === 'narrative_received' || journal.phase === 'autosave_committed') return false;
  if (journal.phase === 'settlement_pending') {
    return Boolean(journal.assistantMessageId && journal.pendingNarrative && journal.pendingSettlement);
  }
  return resolveCommittedRecoveryState(journal, currentState).ok;
}

export async function dismissInterruptedWorkflow(journal: WorkflowRecoveryJournal): Promise<void> {
  await clearWorkflowRecoveryJournal(journal.workflowId);
}

export type RecoveryTarget =
  | { kind: 'pending_settlement' }
  | { kind: 'post_settlement' };

export function resolveRecoveryTarget(journal: WorkflowRecoveryJournal): RecoveryTarget | null {
  if (journal.phase === 'settlement_pending') return { kind: 'pending_settlement' };
  if (journal.phase === 'settlement_committed') return { kind: 'post_settlement' };
  return null;
}

export function shouldRollbackAbortedWorkflow(phase: WorkflowRecoveryPhase): boolean {
  return phase === 'narrative_received' || phase === 'settlement_pending';
}

export async function applyAbortedWorkflowPolicy(input: {
  phase: WorkflowRecoveryPhase;
  rollback: () => Promise<void>;
  clearJournal: () => Promise<void>;
}): Promise<'rolled_back' | 'preserved'> {
  if (!shouldRollbackAbortedWorkflow(input.phase)) return 'preserved';
  await input.rollback();
  await input.clearJournal();
  return 'rolled_back';
}

export function hasCommittedSettlementIdentity(state: TeyvatGameState, journal: WorkflowRecoveryJournal): boolean {
  const pending = journal.pendingSettlement;
  const assistantId = journal.assistantMessageId;
  if (!pending || !assistantId || state.turnCount !== pending.source.turnCount) return false;
  const hasAssistant = state.对话.entries.some((entry) => entry.id === assistantId && entry.role === 'assistant' && Number(entry.gameTime) === journal.turnAtStart);
  const hasSettlementMarker = state.叙事.variableBatches.some((batch) => batch.id === `vbatch_${pending.settlementId}` && batch.turn === journal.turnAtStart);
  return hasAssistant && hasSettlementMarker;
}

export type WorkflowResumeResult =
  | { ok: true; journal: WorkflowRecoveryJournal }
  | { ok: false; journal: WorkflowRecoveryJournal; error: string };

export type CommittedRecoveryStateResult =
  | { ok: true; state: TeyvatGameState }
  | { ok: false; error: 'RECOVERY_COMMITTED_SOURCE_MISSING' | 'RECOVERY_COMMITTED_IDENTITY_MISMATCH' };

/** Shared UI/execution policy for new durable and strictly validated historical committed journals. */
export function resolveCommittedRecoveryState(
  journal: WorkflowRecoveryJournal,
  currentState: TeyvatGameState,
): CommittedRecoveryStateResult {
  if (journal.phase !== 'settlement_committed') {
    return { ok: false, error: 'RECOVERY_COMMITTED_SOURCE_MISSING' };
  }
  if (journal.committedState) {
    return { ok: true, state: normalizeTeyvatGameState(journal.committedState) };
  }
  const assistantId = journal.assistantMessageId;
  const normalized = normalizeTeyvatGameState(currentState);
  const expectedCommittedTurn = journal.turnAtStart + 1;
  const exactAssistant = assistantId
    ? normalized.对话.entries.some((entry) => entry.id === assistantId
      && entry.role === 'assistant'
      && entry.gameTime === String(journal.turnAtStart))
    : false;
  if (normalized.turnCount !== expectedCommittedTurn || !exactAssistant) {
    return { ok: false, error: 'RECOVERY_COMMITTED_IDENTITY_MISMATCH' };
  }
  return { ok: true, state: normalized };
}

export async function runPendingSettlementRecovery(input: {
  journal: WorkflowRecoveryJournal;
  currentState: TeyvatGameState;
  settle: (source: TeyvatGameState, settlementId: string) => Promise<TeyvatGameState | null>;
  runPostSettlement: (committed: TeyvatGameState, journal: WorkflowRecoveryJournal) => Promise<{ ok: true } | { ok: false; error: string }>;
  persist: (journal: WorkflowRecoveryJournal) => Promise<void>;
}): Promise<WorkflowResumeResult> {
  const { journal } = input;
  if (journal.phase !== 'settlement_pending' || !journal.pendingNarrative || !journal.pendingSettlement) {
    return { ok: false, journal, error: 'RECOVERY_PENDING_SOURCE_MISSING' };
  }
  const committedCandidate = hasCommittedSettlementIdentity(input.currentState, journal)
    ? input.currentState
    : await input.settle(journal.pendingSettlement.source, journal.pendingSettlement.settlementId);
  if (!committedCandidate) return { ok: false, journal, error: 'RECOVERY_SETTLEMENT_REJECTED' };
  // Recovery accepts persisted/external input, so normalize once at this trust
  // boundary. Normal turns no longer pay the same cost again in every journal
  // phase update.
  const committed = normalizeTeyvatGameState(committedCandidate);

  const committedJournal = updateWorkflowRecoveryJournal(journal, {
    phase: 'settlement_committed',
    committedState: committed,
  });
  await input.persist(committedJournal);
  const post = await input.runPostSettlement(committedJournal.committedState!, committedJournal);
  if (!post.ok) return { ok: false, journal: committedJournal, error: post.error };
  const completedJournal = updateWorkflowRecoveryJournal(committedJournal, { phase: 'autosave_committed' });
  await input.persist(completedJournal);
  return { ok: true, journal: completedJournal };
}

/** Resume only the post-settlement tail from the durable committed root. */
export async function runCommittedSettlementRecovery(input: {
  journal: WorkflowRecoveryJournal;
  currentState: TeyvatGameState;
  runPostSettlement: (committed: TeyvatGameState, journal: WorkflowRecoveryJournal) => Promise<{ ok: true } | { ok: false; error: string }>;
  persist: (journal: WorkflowRecoveryJournal) => Promise<void>;
}): Promise<WorkflowResumeResult> {
  const { journal } = input;
  const resolved = resolveCommittedRecoveryState(journal, input.currentState);
  if (!resolved.ok) return { ok: false, journal, error: resolved.error };
  const post = await input.runPostSettlement(resolved.state, journal);
  if (!post.ok) return { ok: false, journal, error: post.error };
  const completedJournal = updateWorkflowRecoveryJournal(journal, { phase: 'autosave_committed' });
  await input.persist(completedJournal);
  return { ok: true, journal: completedJournal };
}
