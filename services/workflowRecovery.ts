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
    console.warn('[workflow-recovery] failed to load journal', error);
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
