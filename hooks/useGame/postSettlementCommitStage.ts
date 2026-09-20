import type { NPC记录 } from '@/models/npc';
import { 提取NPC同行记忆文本列表 } from '@/models/npc';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import { 归一化剧情编织系统 } from '@/models/storyWeaving';
import type { CanonTrack } from '@/models/teyvat/canon';
import { hydratePersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';
import { autoAlignCanonStoryProgress } from '@/services/storyProgressService';
import type { 剧情编织门禁快照 } from '@/services/storyWeaving';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';
import { compressNpcMemoryLedger } from './memoryUtils';
import type { NpcLedgerUpdateDebug } from './turnDebugContext';

interface TalentLevelView {
  id: string;
  名称: string;
  等级: number;
}

export interface SettlementCommitFeedback {
  talentLevelUps: Array<{ name: string; level: number }>;
  quest: { status: 'success' | 'skipped'; detail: string; notification?: string };
  variableDetail: string;
}

export function buildSettlementCommitFeedback(input: {
  beforeTalents: readonly TalentLevelView[];
  afterTalents: readonly TalentLevelView[];
  questEnabled: boolean;
  committedQuestUpdate?: string;
  variableApplied: boolean;
}): SettlementCommitFeedback {
  const talentLevelUps = input.afterTalents
    .filter((talent) => {
      const before = input.beforeTalents.find((item) => item.id === talent.id);
      return before != null && talent.等级 > before.等级;
    })
    .map((talent) => ({ name: talent.名称, level: talent.等级 }));
  return {
    talentLevelUps,
    quest: input.questEnabled
      ? {
          status: 'success',
          detail: input.committedQuestUpdate ?? '剧情任务已与本回合领域命令原子结算。',
          ...(input.committedQuestUpdate ? { notification: input.committedQuestUpdate } : {}),
        }
      : {
          status: 'skipped',
          detail: '任务系统已关闭。',
          ...(input.committedQuestUpdate ? { notification: input.committedQuestUpdate } : {}),
        },
    variableDetail: input.variableApplied
      ? '回复后的变量命令已落地。'
      : '本回合没有可落地的变量命令，已记录变量报告。',
  };
}

export function publishSettlementCommitFeedback(
  feedback: SettlementCommitFeedback,
  effects: {
    queue: (task: 'variable' | 'quest', status: 'success' | 'skipped', detail: string) => void;
    toast: (kind: 'success', title: string, detail: string) => void;
    notifyQuest: (detail?: string) => void;
  },
): void {
  if (feedback.talentLevelUps.length > 0) {
    effects.queue(
      'variable',
      'success',
      `天赋成长：${feedback.talentLevelUps.map((talent) => `${talent.name} 升至 Lv.${talent.level}`).join('、')}。`,
    );
    effects.toast(
      'success',
      '天赋成长',
      feedback.talentLevelUps.map((talent) => `${talent.name} Lv.${talent.level}`).join('、'),
    );
  }
  effects.queue('quest', feedback.quest.status, feedback.quest.detail);
  effects.notifyQuest(feedback.quest.notification);
  effects.queue('variable', 'success', feedback.variableDetail);
}

export interface PreparedPostSettlementNpcState {
  records: NPC记录[];
  changed: boolean;
  debug?: NpcLedgerUpdateDebug;
}

export function preparePostSettlementNpcState(input: {
  source: NPC记录[];
  nsfwEnabled: boolean;
  maleNsfwArchiveEnabled: boolean;
  compressionThreshold: number;
  compressionPrompt: string;
  turn: number;
  variableDebug?: NpcLedgerUpdateDebug;
}): PreparedPostSettlementNpcState {
  const enrichment = enrichNpcArchives(input.source, {
    nsfwEnabled: input.nsfwEnabled,
    maleNsfwArchiveEnabled: input.maleNsfwArchiveEnabled,
  });
  const summaryTriggered: string[] = [];
  const records = enrichment.records.map((npc) => {
    const compression = compressNpcMemoryLedger({
      npcId: npc.id,
      entries: npc.同行记忆 ?? [],
      summaries: npc.总结记忆 ?? [],
      threshold: input.compressionThreshold,
      prompt: input.compressionPrompt,
      turn: input.turn,
      source: '变量',
    });
    if (!compression.changed) return npc;
    if (compression.summaryTriggered && !summaryTriggered.includes(npc.姓名)) {
      summaryTriggered.push(npc.姓名);
    }
    return {
      ...npc,
      同行记忆: compression.memories,
      总结记忆: compression.summaries,
    };
  });
  const changed = enrichment.changed
    || records.length !== input.source.length
    || records.some((npc, index) => npc !== input.source[index]);
  const debug = input.variableDebug || summaryTriggered.length
    ? {
        updatedNames: input.variableDebug?.updatedNames ?? [],
        memoryAppended: input.variableDebug?.memoryAppended ?? [],
        ledgerFieldsUpdated: input.variableDebug?.ledgerFieldsUpdated ?? [],
        summaryTriggered: [
          ...(input.variableDebug?.summaryTriggered ?? []),
          ...summaryTriggered,
        ].filter((name, index, list) => Boolean(name) && list.indexOf(name) === index),
        warnings: input.variableDebug?.warnings ?? [],
      }
    : undefined;
  return { records, changed, ...(debug ? { debug } : {}) };
}

export function buildStoryProgressMemoryLine(previous: 剧情编织系统, next: 剧情编织系统): string {
  const before = previous.当前进度;
  const after = next.当前进度;
  if (!after) return '';
  if (
    before?.当前系列ID === after.当前系列ID
    && before?.当前分段ID === after.当前分段ID
    && before?.推进状态 === after.推进状态
    && before?.最近一次推进判定回合 === after.最近一次推进判定回合
  ) return '';

  const series = next.系列列表.find((item) => item.id === after.当前系列ID)
    ?? next.系列列表.find((item) => item.id === next.当前系列ID);
  const current = series?.分段列表.find((item) => item.id === after.当前分段ID)
    ?? series?.分段列表.find((item) => item.组号 === after.当前分段组号);
  const parts = [
    `剧情编织进度：${series?.标题 ?? '未知系列'} 当前进入第 ${after.当前分段组号} 段${current?.标题 ? `「${current.标题}」` : ''}`,
    `状态 ${after.推进状态}`,
  ];
  const latestArchive = after.历史归档.at(-1);
  if (latestArchive) {
    parts.push(`最新归档：第 ${latestArchive.分段组号} 段「${latestArchive.分段标题}」${latestArchive.摘要 ? `：${latestArchive.摘要}` : ''}`);
    if (latestArchive.角色推进摘要?.length) {
      parts.push(`角色阶段承接：${latestArchive.角色推进摘要.slice(0, 4).join('；')}`);
    }
  }
  if (after.已完成摘要.length) parts.push(`已归档：${after.已完成摘要.slice(-3).join('；')}`);
  if (after.当前待解问题.length) parts.push(`待解：${after.当前待解问题.slice(0, 3).join('；')}`);
  if (after.最近判定理由.length) parts.push(`判定：${after.最近判定理由.slice(0, 3).join('；')}`);
  return parts.join('。');
}

export function applyStoryProgressNpcMemory(
  npcs: NPC记录[],
  story: 剧情编织系统,
  turn: number,
): NPC记录[] {
  if (!story.当前进度) return npcs;
  const series = story.系列列表.find((item) => item.id === story.当前进度?.当前系列ID)
    ?? story.系列列表.find((item) => item.id === story.当前系列ID);
  if (!series) return npcs;
  const roleProgress = story.当前进度.历史归档.at(-1)?.角色推进摘要 ?? [];
  if (!roleProgress.length) return npcs;
  let changed = false;
  const next = npcs.map((npc) => {
    const aliases = [npc.姓名, npc.别名].filter((item): item is string => Boolean(item?.trim()));
    const matched = roleProgress.find((summary) => aliases.some((name) => summary.includes(name)));
    if (!matched || !(npc.阶位 === 'companion' || npc.同行 || 提取NPC同行记忆文本列表(npc).length > 0)) return npc;
    const existing = 提取NPC同行记忆文本列表(npc);
    const cleanSummary = matched.length > 120 ? `${matched.slice(0, 118)}…` : matched;
    if (existing.some((item) => item.includes(cleanSummary))) return npc;
    changed = true;
    return {
      ...npc,
      同行记忆: [
        ...(npc.同行记忆 ?? []),
        {
          id: `npc_story_progress_${npc.id}_${turn}_${Math.random().toString(36).slice(2, 6)}`,
          回合: turn,
          摘要: cleanSummary,
          来源: '其他' as const,
          关联NPCID: [npc.id],
        },
      ],
      最近回合: Math.max(npc.最近回合, turn),
    };
  });
  return changed ? next : npcs;
}

export function planPostSettlementStoryAlignment(input: {
  openingSystemTurn: boolean;
  storyWeaving: 剧情编织系统;
  turn: number;
  userInput: string;
  body: string;
  currentLocation?: string;
  gateSnapshot?: 剧情编织门禁快照 | null;
  canonTrack?: CanonTrack;
}): {
  alignment: ReturnType<typeof autoAlignCanonStoryProgress>;
  memoryLine: string;
} {
  const alignment = input.openingSystemTurn
    ? { system: input.storyWeaving, changed: false, progressed: false }
    : autoAlignCanonStoryProgress({
        storyWeaving: input.storyWeaving,
        turnCount: input.turn,
        userInput: input.userInput,
        body: input.body,
        currentLocation: input.currentLocation,
        gateSnapshot: input.gateSnapshot,
        canonTrack: input.canonTrack,
      });
  return {
    alignment,
    memoryLine: alignment.progressed
      ? buildStoryProgressMemoryLine(input.storyWeaving, alignment.system)
      : '',
  };
}

function getStoryWeavingWriteSignature(system: 剧情编织系统): string {
  return JSON.stringify({
    当前系列ID: system.当前系列ID,
    当前进度: system.当前进度
      ? {
          当前系列ID: system.当前进度.当前系列ID,
          当前分段ID: system.当前进度.当前分段ID,
          当前分段组号: system.当前进度.当前分段组号,
          推进状态: system.当前进度.推进状态,
          updatedAt: system.当前进度.updatedAt,
        }
      : null,
    系列: system.系列列表.map((series) => ({
      id: series.id,
      来源类型: series.来源类型,
      标题: series.标题,
      分段数: series.分段列表.length,
      章节数: series.章节列表.length,
      当前分段组号: series.当前分段组号,
      激活注入: series.激活注入,
      updatedAt: series.updatedAt,
      分段更新时间: series.分段列表.map((segment) => `${segment.id}:${segment.处理状态}:${segment.运行状态}:${segment.updatedAt}`),
    })),
  });
}

export async function resolveStoryWeavingForBackgroundWrite(input: {
  workflowBase: 剧情编织系统;
  proposed: 剧情编织系统;
  loadLatest: () => Promise<剧情编织系统 | null | undefined>;
}): Promise<{ system: 剧情编织系统; concurrentChange: boolean }> {
  const latest = await input.loadLatest();
  const latestNormalized = latest ? hydratePersistedStoryWeavingSystem(latest, input.workflowBase) : null;
  if (!latestNormalized) return { system: input.proposed, concurrentChange: false };
  const baseSignature = getStoryWeavingWriteSignature(归一化剧情编织系统(input.workflowBase));
  const latestSignature = getStoryWeavingWriteSignature(latestNormalized);
  return baseSignature === latestSignature
    ? { system: input.proposed, concurrentChange: false }
    : { system: latestNormalized, concurrentChange: true };
}
