/**
 * M6 拆分 · 阶段 10：回合收尾自动存档（原 executeSendWorkflow 内部步骤 10）。
 * 块的真实边界止于 catch 之前 —— catch/finally 属于编排器的错误处理，不是本阶段。
 * 被搬动的代码逐字保留；recoveryJournal 的写入在【原始位置】用回调回写外层，
 * 因为调用方的 finally 会读取它。
 * 原 `sendWorkflow.ts:1170-1216`，共 47 行。
 *
 * 拆分原则：**纯搬运，不改行为** —— 被搬动的代码逐字保留（含原有换行与缩进）。
 */
import { saveGame, saveSettings } from '@/services/dbService';
import {
  clearWorkflowRecoveryJournal,
  persistWorkflowRecoveryJournal,
  updateWorkflowRecoveryJournal,
  type WorkflowRecoveryJournal} from '@/services/workflowRecovery';
import { buildSavePayload, commitActiveSaveTreeMeta } from './saveLoadWorkflow';
import { runPostTurnAutosaveTask } from './postTurnAutosaveTask';
import { pushWorkflowQueueTask as pushQueueTask } from './workflowQueue';
import { readLiveGameState, type UseGameStateReturn } from '@/hooks/useGameState';
import { runTrackedSave, saveStatusStore } from '@/utils/saveStatus';
import type { VariableCalibrationResult } from './variableCalibrationStage';

export interface RunAutoSaveStageDeps {
  state: UseGameStateReturn;
  assertWorkflowActive: () => void;
  committedSettlementGame: VariableCalibrationResult['committedSettlementGame'];
  variableOverrides: VariableCalibrationResult['variableOverrides'];
  steambirdAfterGeneration: VariableCalibrationResult['steambirdAfterGeneration'];
  travelerAfterMastery: UseGameStateReturn['旅人'];
  finalHistoryForSave: VariableCalibrationResult['finalHistoryForSave'];
  memoryAfterStoryProgress: VariableCalibrationResult['memoryAfterStoryProgress'];
  irminsulAfterTurnRecall: VariableCalibrationResult['irminsulAfterTurnRecall'];
  courierAfterFallbackSeed: VariableCalibrationResult['courierAfterFallbackSeed'];
  npcAfterCompression: VariableCalibrationResult['npcAfterCompression'];
  storyWeavingForSave: VariableCalibrationResult['storyWeavingForSave'];
  codexAfterRuntimeUnlock: VariableCalibrationResult['codexAfterRuntimeUnlock'];
  recoveryJournal: WorkflowRecoveryJournal;
  /** 在原始位置回写外层 recoveryJournal。 */
  onJournalUpdated: (journal: WorkflowRecoveryJournal) => void;
}

/** 后台任务结束时从活体根取快照，绝不重放结算前捕获的固定切片。 */
export function buildPostTurnAutosavePayload(state: UseGameStateReturn) {
  return buildSavePayload(state, 'auto', undefined, readLiveGameState(state));
}

export async function runAutoSaveStage(deps: RunAutoSaveStageDeps) {
  const {
    state,
    assertWorkflowActive,
  } = deps;
  let recoveryJournal = deps.recoveryJournal;

      // 10. Auto-save —— 每回合只在后台队列收尾写一次，避免正文/变量阶段重复生成多条自动存档。
      if (state.gameSettings.enableAutoSaveEveryTurn) {
        pushQueueTask(state, 'autosave', 'pending', { detail: '正在写入本回合自动存档。' });
      }
      const saveTask = () => runPostTurnAutosaveTask({
        enabled: state.gameSettings.enableAutoSaveEveryTurn,
        build: () => buildPostTurnAutosavePayload(state),
        assertActive: assertWorkflowActive,
        persist: saveGame,
        commit: commitActiveSaveTreeMeta,
        markSaved: () => {
          pushQueueTask(state, 'autosave', 'success', { detail: '本回合自动存档完成。' });
          state.setHasSave(true);
        },
      });
      if (state.gameSettings.enableAutoSaveEveryTurn) {
        await runTrackedSave(
          saveStatusStore, state.getGameSessionId(), readLiveGameState(state), 'auto',
          saveTask, () => readLiveGameState(state), (result) => result.status === 'saved',
        );
      } else {
        await saveTask();
      }

      recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, { phase: 'autosave_committed' });
      deps.onJournalUpdated(recoveryJournal);
      await persistWorkflowRecoveryJournal(recoveryJournal);

    await saveSettings({
      theme: state.currentTheme,
      apiSettings: state.apiSettings,
      gameSettings: state.gameSettings,
      worldbooks: state.worldbooks,
    });
    await clearWorkflowRecoveryJournal(recoveryJournal.workflowId);

  return {
    recoveryJournal,
  };
}
