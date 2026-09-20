/**
 * M6 拆分 · 阶段 9.5：元素附着与反应结算（G1 极简版，原 executeSendWorkflow 内部步骤 9.5）。
 * 块的真实边界止于 fieldChanged 分支的 updateGameState 调用 —— 后面的步骤 10 是自动存档，不属于本阶段。
 * 被搬动的代码逐字保留（含原有缩进；原块处在 variableCalibration 之后的缩进层级里）。
 * 本阶段不写入任何外层可变量；唯一需要交回调用方的是 travelerAfterMastery。
 * 依赖类型从产出者推导（VariableCalibrationResult[...] / UseGameStateReturn['旅人']），而非手工猜测。
 * 原 `sendWorkflow.ts:1082-1113`，共 32 行。
 *
 * 拆分原则：**纯搬运，不改行为** —— 被搬动的代码逐字保留（含原有换行与缩进）。
 */
import { ELEMENT_NAMES } from '@/styles/elementTokens';
import { pushWorkflowQueueTask as pushQueueTask } from './workflowQueue';
import { settlePostTurnElements } from './postTurnElementalStage';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { VariableCalibrationResult } from './variableCalibrationStage';

export interface RunElementalSettlementStageDeps {
  state: UseGameStateReturn;
  displayText: string;
  committedSettlementGame: VariableCalibrationResult['committedSettlementGame'];
  variableOverrides: VariableCalibrationResult['variableOverrides'];
}

export async function runElementalSettlementStage(deps: RunElementalSettlementStageDeps) {
  const {
    state,
    displayText,
    committedSettlementGame,
    variableOverrides,
  } = deps;

      // 9.5 元素附着与反应结算（G1 极简版）：从正文检测元素应用，更新场面附着并记录反应事件。
      // 熟练度只记旅行者本人施放的元素（主语过滤），避免敌人的元素攻击被算到旅行者头上。
      const travelerForMastery = variableOverrides?.旅人 ?? state.旅人;
      const elementalSettlement = settlePostTurnElements({
        body: displayText,
        traveler: travelerForMastery,
        travelerNames: [
          committedSettlementGame.旅行者.姓名,
          committedSettlementGame.旅行者.别名,
        ],
        field: committedSettlementGame.叙事.元素场面,
        events: committedSettlementGame.叙事.元素事件,
        turn: committedSettlementGame.turnCount,
      });
      const travelerAfterMastery = elementalSettlement.traveler;
      const masteryGains = elementalSettlement.masteryGains;
      if (masteryGains.length) {
        state.set旅人(travelerAfterMastery);
        pushQueueTask(state, 'variable', 'success', {
          detail: `本回合使用了 ${masteryGains.map((element) => ELEMENT_NAMES[element]).join('、')}，元素熟练度 +${elementalSettlement.masteryGainPerTurn}。`,
        });
      }
      if (elementalSettlement.fieldChanged) {
        state.updateGameState((current) => ({
          ...current,
          叙事: {
            ...current.叙事,
            元素场面: elementalSettlement.field,
            元素事件: elementalSettlement.events,
          },
        }));
      }

  return {
    travelerAfterMastery,
  };
}
