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
import { compactVariableBatchHistory } from '@/utils/longSessionRetention';
import { pushWorkflowQueueTask as pushQueueTask } from './workflowQueue';
import type { UseGameStateReturn } from '@/hooks/useGameState';
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

export async function runAutoSaveStage(deps: RunAutoSaveStageDeps) {
  const {
    state,
    assertWorkflowActive,
    committedSettlementGame,
    variableOverrides,
    steambirdAfterGeneration,
    travelerAfterMastery,
    finalHistoryForSave,
    memoryAfterStoryProgress,
    irminsulAfterTurnRecall,
    courierAfterFallbackSeed,
    npcAfterCompression,
    storyWeavingForSave,
    codexAfterRuntimeUnlock,
  } = deps;
  let recoveryJournal = deps.recoveryJournal;

      // 10. Auto-save —— 每回合只在后台队列收尾写一次，避免正文/变量阶段重复生成多条自动存档。
      if (state.gameSettings.enableAutoSaveEveryTurn) {
        pushQueueTask(state, 'autosave', 'pending', { detail: '正在写入本回合自动存档。' });
      }
      await runPostTurnAutosaveTask({
        enabled: state.gameSettings.enableAutoSaveEveryTurn,
        build: () => {
          const variableBatchesForSave = compactVariableBatchHistory(variableOverrides?.batch
            ? [...state.variableBatches, variableOverrides.batch]
            : state.variableBatches);
          return buildSavePayload(state, 'auto', {
            chatHistory: finalHistoryForSave,
            记忆: memoryAfterStoryProgress,
            世界树: irminsulAfterTurnRecall,
            手机: courierAfterFallbackSeed,
            背包: committedSettlementGame.背包,
            旅人: travelerAfterMastery ?? variableOverrides?.旅人,
            世界: variableOverrides?.世界,
            NPC: npcAfterCompression,
            蒸汽鸟报: steambirdAfterGeneration ?? variableOverrides?.蒸汽鸟报,
            剧情: variableOverrides?.剧情,
            剧情编织: storyWeavingForSave,
            图鉴: codexAfterRuntimeUnlock,
            variableBatches: variableBatchesForSave,
            queueTasks: state.queueTasks,
            turnCount: state.turnCount + 1,
          }, committedSettlementGame);
        },
        assertActive: assertWorkflowActive,
        persist: saveGame,
        commit: commitActiveSaveTreeMeta,
        markSaved: () => {
          pushQueueTask(state, 'autosave', 'success', { detail: '本回合自动存档完成。' });
          state.setHasSave(true);
        },
      });

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
