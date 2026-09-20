import type { ArchiveCodex } from '@/models/teyvat/codex';
import type { IrminsulEntry, IrminsulMemory } from '@/models/teyvat/irminsul';
import { retrieveCodexEntries, type CodexRetrievalResult } from '@/services/codexRetrieval';
import { retrieveIrminsulEntries } from '@/services/irminsulRetrieval';
import { formatCodexRecallSummary, formatIrminsulRecallSummary } from './turnDebugContext';

export interface MainRecallStageInput {
  isOpeningSystemTrigger: boolean;
  turnCount: number;
  memoryInjectionEnabled: boolean;
  memorySettings: {
    irminsulEnabled: boolean;
    earliestRecallTurn: number;
    recallLimit: number;
  };
  codexSettings: {
    enabled: boolean;
    aiSupplementEnabled: boolean;
    maxRelatedEntries: number;
  };
  memoryCounts: {
    short: number;
    medium: number;
    long: number;
    immediate: number;
  };
  irminsul: IrminsulMemory;
  codex: ArchiveCodex;
  recallQuery: string;
  codexRecallQuery: string;
}

export interface IrminsulRecallPreview {
  entries: IrminsulEntry[];
  strongEntries: IrminsulEntry[];
  weakEntries: IrminsulEntry[];
  previewText: string;
  injection: string;
  usedModel: boolean;
}

export interface MainRecallStageResult {
  irminsulEnabled: boolean;
  irminsulRecallEnabled: boolean;
  codexRecallEnabled: boolean;
  codexAiSupplementEnabled: boolean;
  irminsulPreview: IrminsulRecallPreview | null;
  codexPreview: CodexRetrievalResult | null;
  summary: string;
  fullContent: string;
  workflowHint: string;
}

export function buildMainRecallStage(input: MainRecallStageInput): MainRecallStageResult {
  const irminsulEnabled = input.memorySettings.irminsulEnabled;
  const irminsulRecallEnabled = irminsulEnabled
    && !input.isOpeningSystemTrigger
    && input.memorySettings.earliestRecallTurn < input.turnCount;
  const codexRecallEnabled = !input.isOpeningSystemTrigger
    && input.codexSettings.enabled
    && Boolean(input.codexRecallQuery.trim());
  const codexAiSupplementEnabled = codexRecallEnabled && input.codexSettings.aiSupplementEnabled;

  const irminsulEntries = irminsulRecallEnabled && input.recallQuery.trim()
    ? retrieveIrminsulEntries(input.irminsul, input.recallQuery, input.memorySettings.recallLimit)
    : [];
  const irminsulPreview: IrminsulRecallPreview | null = irminsulEntries.length
    ? {
        entries: irminsulEntries,
        strongEntries: irminsulEntries,
        weakEntries: [],
        previewText: irminsulEntries.map((entry) => entry.title).join('、'),
        injection: irminsulEntries.map((entry) => entry.summary).filter(Boolean).join('\n\n'),
        usedModel: false,
      }
    : null;
  const codexPreview = codexRecallEnabled
    ? retrieveCodexEntries(input.codex, input.codexRecallQuery, input.codexSettings.maxRelatedEntries)
    : null;

  const summary = [
    formatCodexRecallSummary(codexPreview),
    formatIrminsulRecallSummary(irminsulPreview?.previewText),
  ].join('\n');
  const fullContent = [
    codexPreview?.injection ? ['【图鉴完整召回】', codexPreview.injection].join('\n') : '',
    irminsulPreview?.injection ? ['【记忆完整召回】', irminsulPreview.injection].join('\n') : '',
  ].filter(Boolean).join('\n\n');
  const memoryHint = input.isOpeningSystemTrigger
    ? '开局专用上下文已注入：角色 / 场景 / 切入说明 / 开局世界书 / 原生开场叙事'
    : irminsulPreview?.injection
      ? `剧情回忆已命中，已暂停普通短中长期记忆注入：强 ${irminsulPreview.strongEntries.length} 条 / 弱 ${irminsulPreview.weakEntries.length} 条`
      : input.memoryInjectionEnabled
        ? `记忆上下文已注入：短期 ${input.memoryCounts.short} 条 / 中期 ${input.memoryCounts.medium} 条 / 长期 ${input.memoryCounts.long} 条；即时缓存 ${input.memoryCounts.immediate} 条仅用于后续压缩`
        : '记忆上下文已跳过';
  const irminsulHint = !irminsulEnabled
    ? '世界树召回已关闭'
    : irminsulPreview?.entries.length
      ? `剧情回忆已召回：强 ${irminsulPreview.strongEntries.length} 条 / 弱 ${irminsulPreview.weakEntries.length} 条`
      : irminsulRecallEnabled
        ? `世界树已召回：${input.irminsul.entries.length ? '无相关档案' : '当前还没有可召回档案'}`
        : `世界树已召回：未到第${input.memorySettings.earliestRecallTurn + 1}回合`;
  const codexHint = input.codexSettings.enabled
    ? `图鉴内容已注入（${codexAiSupplementEnabled ? '关键词 + AI 补充' : '仅正文关键词'}）：${
        codexPreview?.entries.length
          ? codexPreview.entries.slice(0, 2).map((entry) => entry.name).join('、')
          : '无相关条目'
      }`
    : '图鉴已跳过';

  return {
    irminsulEnabled,
    irminsulRecallEnabled,
    codexRecallEnabled,
    codexAiSupplementEnabled,
    irminsulPreview,
    codexPreview,
    summary,
    fullContent,
    workflowHint: input.isOpeningSystemTrigger ? memoryHint : `${memoryHint} · ${irminsulHint} · ${codexHint}`,
  };
}
