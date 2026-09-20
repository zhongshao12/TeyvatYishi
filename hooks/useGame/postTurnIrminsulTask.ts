import type { NarrativeTurn } from '@/models/teyvat/narrativeTurn';
import type { IrminsulMemory } from '@/models/teyvat/irminsul';
import type { TeyvatGameState } from '@/models/teyvat/state';
import { buildIrminsulArchiveEntry } from '@/services/irminsulArchive';
import { deriveCommittedQuestArchiveFacts } from '@/services/questService';
import { archiveCommittedQuestSettlement } from './questWorkflow';

export interface PostTurnIrminsulArchiveTaskInput {
  base: IrminsulMemory;
  committedGame: TeyvatGameState;
  turn: number;
  summary: string;
  body: string;
  location?: string;
  worldEvents: string[];
  gameTime?: string;
  questFactCandidates: NarrativeTurn['factCandidates'];
  recallEnabled: boolean;
  recallEligible: boolean;
  earliestRecallTurn: number;
  recallHitCount: number;
  recallUsedModel: boolean;
  now?: number;
}

export interface PostTurnIrminsulArchiveTaskResult {
  memory: IrminsulMemory;
  memoryDetail: string;
  recallStatus: 'skipped' | 'success';
  recallDetail: string;
}

export function runPostTurnIrminsulArchiveTask(
  input: PostTurnIrminsulArchiveTaskInput,
): PostTurnIrminsulArchiveTaskResult {
  const archiveEntry = buildIrminsulArchiveEntry({
    id: `irminsul_${input.turn}_${input.now ?? Date.now()}`,
    title: `第 ${input.turn} 回记忆`,
    summary: input.summary || input.body.slice(0, 360),
    sourceTurns: [input.turn],
    keywords: [input.location, ...input.worldEvents]
      .filter((item): item is string => Boolean(item))
      .slice(0, 8),
    recordedAt: input.gameTime || String(input.turn),
    archiveType: 'short',
    sourceText: input.body,
    turn: input.turn,
  });
  let memory = mergeIrminsulMemories(input.base, { entries: [archiveEntry] });
  const questFacts = deriveCommittedQuestArchiveFacts(
    input.committedGame,
    input.questFactCandidates
      .filter((candidate) => candidate.domain === 'quest')
      .map((candidate) => candidate.fact),
    input.turn,
  );
  memory = archiveCommittedQuestSettlement(memory, input.committedGame, questFacts, input.turn);

  if (!input.recallEnabled) {
    return {
      memory,
      memoryDetail: '世界树纪要已使用本回合公开小结入库。',
      recallStatus: 'skipped',
      recallDetail: '世界树召回已关闭，但归档仍已执行。',
    };
  }
  if (!input.recallEligible) {
    return {
      memory,
      memoryDetail: '世界树纪要已使用本回合公开小结入库。',
      recallStatus: 'skipped',
      recallDetail: `未到第${input.earliestRecallTurn + 1}回合，世界树召回已跳过。`,
    };
  }
  return {
    memory,
    memoryDetail: '世界树纪要已使用本回合公开小结入库。',
    recallStatus: 'success',
    recallDetail: input.recallHitCount > 0
      ? input.recallUsedModel
        ? '世界树召回已由独立模型完成。'
        : '世界树召回已由本地摘要检索完成。'
      : '世界树已检索，本回合没有命中相关档案。',
  };
}

export function mergeIrminsulMemories(base: IrminsulMemory, override?: IrminsulMemory): IrminsulMemory {
  if (!override) return base;
  const merged = [...base.entries];
  for (const entry of override.entries ?? []) {
    if (!merged.some((item) => item.id === entry.id)) merged.push(entry);
  }
  return { entries: merged };
}
