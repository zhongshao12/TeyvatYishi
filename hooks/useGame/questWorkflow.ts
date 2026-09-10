import { OPENING_MAIN_QUEST } from '@/data/questPresets';
import type { TeyvatGameState } from '@/models/teyvat/state';
import type { IrminsulMemory } from '@/models/teyvat/irminsul';
import type { NarrativeTurn } from '@/models/teyvat/narrativeTurn';
import type { TeyvatDomainCommand, TeyvatTurnError } from '@/models/teyvat/domainCommand';
import { reduceTeyvatTurn } from '@/services/teyvatTurnTransaction';
import {
  buildCommittedQuestArchive,
  deriveQuestDomainCommands,
  type QuestArchiveFact,
  type QuestDomainSettlement,
} from '@/services/questService';
import { DEFAULT_NOTIFICATION_SETTINGS, notifyEvent, type 通知设置 } from '@/utils/notifications';
import { pushToast } from '@/utils/toastStore';

export interface QuestSettlementInput {
  state: TeyvatGameState;
  enabled: boolean;
  questUpdates: readonly string[];
  body: string;
  variableFacts: ReadonlyArray<{ 路径: string; 值: unknown }>;
  factCandidates: NarrativeTurn['factCandidates'];
  turn: number;
}

export interface QuestSettlementPlan extends QuestDomainSettlement {
  evidence: string;
}

export interface ComposedQuestSettlementInput extends QuestSettlementInput {
  narrativeCommands: readonly TeyvatDomainCommand[];
}

export interface ComposedQuestSettlement {
  commands: TeyvatDomainCommand[];
  quest: QuestSettlementPlan;
  previewErrors: TeyvatTurnError[];
}

/** 汇总新结构化事实与旧标签任务更新，迁移期间不再静默丢掉任一路径。 */
export function collectQuestUpdatePayloads(input: {
  factCandidates?: ReadonlyArray<{ domain: string; fact: string; evidence?: string }>;
  questUpdates?: readonly string[];
}): string[] {
  const output: string[] = [];
  const push = (value: string) => {
    const text = value.trim();
    if (text && !output.includes(text)) output.push(text);
  };
  input.questUpdates?.forEach(push);
  input.factCandidates?.filter((candidate) => candidate.domain === 'quest').forEach((candidate) => push(candidate.fact));
  return output;
}

function openingQuest(): TeyvatGameState['任务']['active'][number] {
  return {
    id: OPENING_MAIN_QUEST.id,
    title: OPENING_MAIN_QUEST.标题,
    description: OPENING_MAIN_QUEST.描述,
    source: 'main',
    status: 'active',
    objectives: OPENING_MAIN_QUEST.目标.map((objective) => ({
      id: objective.id,
      type: ({ 达成: 'reach', 收集: 'collect', 交谈: 'talk', 前往: 'travel', 击杀: 'defeat', 时间: 'time' } as const)[objective.类型],
      description: objective.描述,
      targetCount: objective.目标数量,
      currentCount: objective.当前数量,
      completed: objective.完成,
    })),
    rewards: OPENING_MAIN_QUEST.奖励.map((reward) => `${reward.类型}:${reward.内容}:${reward.数量 ?? 1}`),
    createdAtTurn: OPENING_MAIN_QUEST.创建回合,
    updatedAt: OPENING_MAIN_QUEST.创建回合,
  };
}

/** Pure orchestration: every synchronous quest effect is returned as a command. */
export function deriveQuestSettlementPlan(input: QuestSettlementInput): QuestSettlementPlan {
  const questFact = input.factCandidates.find((candidate) => candidate.domain === 'quest');
  const evidence = questFact?.evidence.trim()
    || questFact?.fact.trim()
    || input.body.trim().slice(0, 240)
    || `第 ${input.turn} 回任务结算`;
  if (!input.enabled) return { commands: [], archiveFacts: [], updates: [], evidence };

  const hasQuest = input.state.任务.active.length + input.state.任务.completed.length + input.state.任务.abandoned.length > 0;
  let state = input.state;
  const prefix: QuestDomainSettlement['commands'] = [];
  if (!hasQuest && input.turn <= 1) {
    const initialQuest = openingQuest();
    state = { ...state, 任务: { ...state.任务, active: [initialQuest] } };
    prefix.push({ action: 'push', root: '任务', path: 'active', value: initialQuest, evidence });
    prefix.push({ action: 'push', root: '任务', path: 'lastUpdates', value: `接取任务：${initialQuest.title}`, evidence });
  }
  const derived = deriveQuestDomainCommands({ ...input, state, evidence });
  return { ...derived, commands: [...prefix, ...derived.commands], evidence };
}

/**
 * Applies narrative commands to a pure preview so same-turn location/inventory/NPC
 * facts are visible to quest derivation. The original combined batch is still
 * committed exactly once by the caller.
 */
export function composeQuestSettlementCommands(input: ComposedQuestSettlementInput): ComposedQuestSettlement {
  const preview = reduceTeyvatTurn(input.state, input.narrativeCommands, {
    factCandidates: input.factCandidates,
  });
  if (preview.status === 'rejected') {
    return {
      commands: [...input.narrativeCommands],
      quest: deriveQuestSettlementPlan({ ...input, enabled: false }),
      previewErrors: preview.errors,
    };
  }
  const quest = deriveQuestSettlementPlan({ ...input, state: preview.nextState });
  return {
    commands: [...input.narrativeCommands, ...quest.commands],
    quest,
    previewErrors: [],
  };
}

/** Post-commit, retry-safe Irminsul archive. It does not execute quest commands. */
export function archiveCommittedQuestSettlement(
  current: IrminsulMemory,
  committedState: TeyvatGameState,
  facts: readonly QuestArchiveFact[],
  turn: number,
): IrminsulMemory {
  return buildCommittedQuestArchive(current, committedState, facts, turn);
}

export function notifyCommittedQuestUpdate(settings: 通知设置 | undefined, update?: string): void {
  if (update) notifyEvent(settings ?? DEFAULT_NOTIFICATION_SETTINGS, 'quest', '任务更新', update);
  if (update && (settings?.events.quest) !== false) {
    pushToast({ kind: 'info', title: '任务更新', detail: update });
  }
}

export type { QuestArchiveFact };
