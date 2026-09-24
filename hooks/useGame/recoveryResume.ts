import { updateWorkflowRecoveryJournal, type WorkflowRecoveryJournal, type WorkflowRecoveryPhase } from '@/utils/workflowRecoveryModel';
import { normalizeTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import { loadRecoverableWorkflow, clearWorkflowRecoveryJournal } from '@/services/workflowRecovery';

export interface RecoveryIdentityContext {
  allowPristineRoot?: boolean;
  currentSaveTreeNodeId?: string | null;
}

function isSameRecoverySaveTree(journal: WorkflowRecoveryJournal, context: RecoveryIdentityContext): boolean {
  return journal.originSaveTreeNodeId === undefined
    || context.currentSaveTreeNodeId === undefined
    || journal.originSaveTreeNodeId === context.currentSaveTreeNodeId;
}

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
  options: RecoveryIdentityContext = {},
): boolean {
  if (journal.phase === 'narrative_received' || journal.phase === 'autosave_committed') return false;
  if (journal.phase === 'settlement_pending') {
    // 与 committed 阶段同一条原则（见 resolveCommittedRecoveryState）：UI 的「可恢复」判定
    // 必须与真正执行时的身份校验共用同一个校验器，否则界面会提供一个执行时必然被拒的入口
    // —— 或者更糟：提供一个会把旧档冻结根写进当前存档的入口。
    return resolvePendingRecoveryEligibility(journal, currentState, options).ok;
  }
  return resolveCommittedRecoveryState(journal, currentState, options).ok;
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
  sessionStillCurrent?: () => boolean;
  rollback: () => Promise<void>;
  clearJournal: () => Promise<void>;
}): Promise<'rolled_back' | 'preserved'> {
  if (input.sessionStillCurrent && !input.sessionStillCurrent()) return 'preserved';
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

export type PendingRecoveryEligibility =
  | { ok: true }
  | { ok: false; error: 'RECOVERY_PENDING_SOURCE_MISSING' | 'RECOVERY_PENDING_IDENTITY_MISMATCH' };

/**
 * `settlement_pending` 阶段的身份校验：这份 journal 只属于「它当时那份存档」。
 *
 * 为什么必须有：`pendingSettlement.source` 是**那一回合冻结下来的整根快照**，
 * 恢复时会把它当成结算基线（`settle(source)` → `runVariableCalibrationStep({ baseGameSnapshot: source })`）。
 * 而 `commitGame` 的 CAS 只比较「恢复开始 vs 提交那一刻」两次读取的**活体根** ——
 * 若玩家在这份 journal 产生之后已经读入另一份存档（或开了新局），两次读取都是**新档**，
 * CAS 会通过，于是旧档的冻结根被写进新档（跨存档数据损坏）。
 *
 * 判定（与 `resolveCommittedRecoveryState` 同思路，全部基于活体根）：
 * 1) 这一回合尚未提交 → 活体回合数必须仍是 `journal.turnAtStart`（`source` 是 turnAtStart + 1）；
 * 2) 同一份存档 → `source` 的对话必须真是一条**更长的**时间线，且活体对话的最后一条仍在其中
 *    （最后一条而非严格前缀：长会话会裁剪最早的消息，严格前缀会把合法恢复判成不合法）。
 */
export function resolvePendingRecoveryEligibility(
  journal: WorkflowRecoveryJournal,
  currentState: TeyvatGameState,
  context: RecoveryIdentityContext = {},
): PendingRecoveryEligibility {
  const pending = journal.pendingSettlement;
  if (journal.phase !== 'settlement_pending' || !journal.pendingNarrative || !pending) {
    return { ok: false, error: 'RECOVERY_PENDING_SOURCE_MISSING' };
  }
  if (!isSameRecoverySaveTree(journal, context)) return { ok: false, error: 'RECOVERY_PENDING_IDENTITY_MISMATCH' };
  const live = normalizeTeyvatGameState(currentState);
  const sourceEntries = pending.source.对话.entries;
  const liveEntries = live.对话.entries;
  if (sourceEntries.length === 0) return { ok: false, error: 'RECOVERY_PENDING_SOURCE_MISSING' };
  // 崩溃窗口：结算已写进活体根，但 journal 还来不及晋级。精确的 assistant +
  // settlement marker 同时存在时，只需推进日志和尾流程，绝不能再次执行 settle。
  if (hasCommittedSettlementIdentity(live, journal)) return { ok: true };
  if (live.turnCount !== journal.turnAtStart) return { ok: false, error: 'RECOVERY_PENDING_IDENTITY_MISMATCH' };
  if (liveEntries.length === 0 && !context.allowPristineRoot) {
    return { ok: false, error: 'RECOVERY_PENDING_IDENTITY_MISMATCH' };
  }
  if (liveEntries.length > sourceEntries.length) return { ok: false, error: 'RECOVERY_PENDING_IDENTITY_MISMATCH' };
  const sourceIds = new Set(sourceEntries.map((entry) => entry.id));
  const lastLiveId = liveEntries.at(-1)?.id;
  if (lastLiveId && !sourceIds.has(lastLiveId)) return { ok: false, error: 'RECOVERY_PENDING_IDENTITY_MISMATCH' };
  return { ok: true };
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
  options: RecoveryIdentityContext = {},
): CommittedRecoveryStateResult {
  if (journal.phase !== 'settlement_committed') {
    return { ok: false, error: 'RECOVERY_COMMITTED_SOURCE_MISSING' };
  }
  if (!isSameRecoverySaveTree(journal, options)) {
    return { ok: false, error: 'RECOVERY_COMMITTED_IDENTITY_MISMATCH' };
  }
  if (journal.committedState) {
    const committed = normalizeTeyvatGameState(journal.committedState);
    const live = normalizeTeyvatGameState(currentState);
    const lastLiveId = live.对话.entries.at(-1)?.id;
    const committedIds = new Set(committed.对话.entries.map((entry) => entry.id));
    if (!lastLiveId && !options.allowPristineRoot) {
      return { ok: false, error: 'RECOVERY_COMMITTED_IDENTITY_MISMATCH' };
    }
    if (live.turnCount > committed.turnCount || (lastLiveId && !committedIds.has(lastLiveId))) {
      return { ok: false, error: 'RECOVERY_COMMITTED_IDENTITY_MISMATCH' };
    }
    return { ok: true, state: committed };
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
  allowPristineRoot?: boolean;
  currentSaveTreeNodeId?: string | null;
  settle: (source: TeyvatGameState, settlementId: string) => Promise<TeyvatGameState | null>;
  runPostSettlement: (committed: TeyvatGameState, journal: WorkflowRecoveryJournal) => Promise<{ ok: true } | { ok: false; error: string }>;
  persist: (journal: WorkflowRecoveryJournal) => Promise<void>;
}): Promise<WorkflowResumeResult> {
  const { journal } = input;
  // 身份校验必须在 `settle` **之前**：settle 会把 journal 里那份旧档冻结根写进当前活体存档。
  const eligibility = resolvePendingRecoveryEligibility(journal, input.currentState, {
    allowPristineRoot: input.allowPristineRoot,
    currentSaveTreeNodeId: input.currentSaveTreeNodeId,
  });
  if (!eligibility.ok) return { ok: false, journal, error: eligibility.error };
  const pending = journal.pendingSettlement;
  if (!pending) return { ok: false, journal, error: 'RECOVERY_PENDING_SOURCE_MISSING' };
  const committedCandidate = hasCommittedSettlementIdentity(input.currentState, journal)
    ? input.currentState
    : await input.settle(pending.source, pending.settlementId);
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
  allowPristineRoot?: boolean;
  currentSaveTreeNodeId?: string | null;
  runPostSettlement: (committed: TeyvatGameState, journal: WorkflowRecoveryJournal) => Promise<{ ok: true } | { ok: false; error: string }>;
  persist: (journal: WorkflowRecoveryJournal) => Promise<void>;
}): Promise<WorkflowResumeResult> {
  const { journal } = input;
  const resolved = resolveCommittedRecoveryState(journal, input.currentState, {
    allowPristineRoot: input.allowPristineRoot,
    currentSaveTreeNodeId: input.currentSaveTreeNodeId,
  });
  if (!resolved.ok) return { ok: false, journal, error: resolved.error };
  const post = await input.runPostSettlement(resolved.state, journal);
  if (!post.ok) return { ok: false, journal, error: post.error };
  const completedJournal = updateWorkflowRecoveryJournal(journal, { phase: 'autosave_committed' });
  await input.persist(completedJournal);
  return { ok: true, journal: completedJournal };
}
