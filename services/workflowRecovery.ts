import { deleteSetting, loadSetting, saveSetting } from '@/services/dbService';
import {
  parseWorkflowRecoveryJournal,
  WORKFLOW_RECOVERY_STALE_MS,
  type WorkflowRecoveryJournal,
} from '@/utils/workflowRecoveryModel';
export {
  createWorkflowRecoveryJournal,
  isWorkflowRecoveryComplete,
  parseWorkflowRecoveryJournal,
  updateWorkflowRecoveryJournal,
  type WorkflowRecoveryJournal,
  type WorkflowRecoveryPhase,
} from '@/utils/workflowRecoveryModel';

export const WORKFLOW_RECOVERY_KEY = 'activeWorkflowRecoveryV1';

export async function loadWorkflowRecoveryJournal(
  read: (key: string) => Promise<unknown> = loadSetting,
  remove: (key: string) => Promise<void> = deleteSetting,
): Promise<WorkflowRecoveryJournal | null> {
  try {
    const stored = await read(WORKFLOW_RECOVERY_KEY);
    const journal = parseWorkflowRecoveryJournal(stored);
    if (stored !== null && stored !== undefined && !journal) {
      await remove(WORKFLOW_RECOVERY_KEY);
    }
    return journal;
  } catch (error) {
    // 静默失败会让玩家误以为「没有未完成回合」（用户第 5 项点名的静默失败之一）：
    // 这里必须留下可查记录，而不是只写 console。
    console.warn('[workflow-recovery] failed to load journal', error);
    void recordRecoveryFailure('recovery_journal_unreadable', '恢复日志读取失败：无法确认是否有未完成回合。', error);
    return null;
  }
}

export async function persistWorkflowRecoveryJournal(
  journal: WorkflowRecoveryJournal,
  write: (key: string, value: WorkflowRecoveryJournal) => Promise<void> = saveSetting,
): Promise<void> {
  await write(WORKFLOW_RECOVERY_KEY, journal);
}

export async function clearWorkflowRecoveryJournal(workflowId?: string): Promise<void> {
  try {
    if (workflowId) {
      const current = await loadWorkflowRecoveryJournal();
      if (current && current.workflowId !== workflowId) return;
    }
    await deleteSetting(WORKFLOW_RECOVERY_KEY);
  } catch (error) {
    console.warn('[workflow-recovery] failed to clear journal', error);
    void recordRecoveryFailure('recovery_journal_unclearable', '恢复日志清除失败：未完成回合可能被重复提示。', error);
  }
}

/** 恢复流程自身的失败也要进失败结算中心（2026-09-29 第 5 项）。 */
async function recordRecoveryFailure(reasonCode: string, humanReason: string, error: unknown): Promise<void> {
  try {
    const { reportFailure } = await import('@/utils/failureCenterStore');
    reportFailure({
      source: 'recovery',
      reasonCode,
      humanReason,
      dedupeKey: reasonCode,
      retryable: 'none',
      diagnostic: { visibleTo: 'developer', text: error instanceof Error ? error.message : String(error) },
    });
  } catch (reportError) {
    console.warn('[workflow-recovery] 失败结算登记失败', reportError);
  }
}


export function isWorkflowRecoveryStale(journal: WorkflowRecoveryJournal, now = Date.now()): boolean {
  return now - journal.updatedAt > WORKFLOW_RECOVERY_STALE_MS;
}

/** 读取未完成且未过期的恢复日志；过期日志直接清理。 */
export async function loadRecoverableWorkflow(): Promise<WorkflowRecoveryJournal | null> {
  const journal = await loadWorkflowRecoveryJournal();
  if (!journal) return null;
  if (isWorkflowRecoveryStale(journal)) {
    await clearWorkflowRecoveryJournal(journal.workflowId);
    return null;
  }
  return journal;
}
