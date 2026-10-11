/**
 * M6 拆分 · 阶段 9.5：元素附着与反应结算（G1 极简版，原 executeSendWorkflow 内部步骤 9.5）。
 * 2026-10-09 W02/W05：在提交 updater 内读取活体旅人，只结算元素字段，
 * 保留后台等待期间的玩家编辑。结算 ID 的完成标记防止恢复时重复授予熟练度。
 * 后面的自动存档不属于本阶段；旅人投影交回调用方供状态与日志同步。
 */
import { ELEMENT_NAMES } from '@/styles/elementTokens';
import { pushWorkflowQueueTask as pushQueueTask } from './workflowQueue';
import { settlePostTurnElements } from './postTurnElementalStage';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { VariableCalibrationResult } from './variableCalibrationStage';
import { flushSync } from 'react-dom';
import { toLegacyTraveler } from '@/hooks/useGameState';
import { hasSettlementTailTask, markSettlementTailTask } from './postSettlementTaskState';

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
      const session = state.getGameSessionId();
      let travelerAfterMastery = variableOverrides?.旅人 ?? state.旅人;
      let masteryGains: ReturnType<typeof settlePostTurnElements>['masteryGains'] = [];
      let masteryGainPerTurn = 0;
      flushSync(() => state.updateGameState((current) => {
        if (state.getGameSessionId() !== session) return current;
        const settlementId = committedSettlementGame.叙事.lastCommittedMoment?.settlementId;
        if (settlementId && hasSettlementTailTask(current, settlementId, 'elements')) return current;
        const elementalSettlement = settlePostTurnElements({
          body: displayText,
          traveler: current.旅行者,
          travelerNames: [committedSettlementGame.旅行者.姓名, committedSettlementGame.旅行者.别名, current.旅行者.姓名],
          field: current.叙事.元素场面,
          events: current.叙事.元素事件,
          turn: committedSettlementGame.turnCount,
        });
        travelerAfterMastery = toLegacyTraveler({ ...current, 旅行者: elementalSettlement.traveler });
        masteryGains = elementalSettlement.masteryGains;
        masteryGainPerTurn = elementalSettlement.masteryGainPerTurn;
        const settled = { ...current, 旅行者: elementalSettlement.traveler, 叙事: {
          ...current.叙事, 元素场面: elementalSettlement.field, 元素事件: elementalSettlement.events,
        } };
        return settlementId ? markSettlementTailTask(settled, settlementId, 'elements') : settled;
      }));
      if (masteryGains.length) {
        pushQueueTask(state, 'variable', 'success', {
          detail: `本回合使用了 ${masteryGains.map((element) => ELEMENT_NAMES[element]).join('、')}，元素熟练度 +${masteryGainPerTurn}。`,
        });
      }

  return {
    travelerAfterMastery,
  };
}
