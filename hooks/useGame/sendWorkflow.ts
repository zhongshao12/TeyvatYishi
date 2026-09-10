import { applyLegacyGameStateOverrides, toLegacyTurnCheckpoint, type UseGameStateReturn } from '@/hooks/useGameState';
import { 创建聊天消息, type 聊天消息, type 回合快照 } from '@/models/chat';
import { createEmptyNarrativeTurn, narrativeTurnBodyText, type NarrativeTurn } from '@/models/teyvat/narrativeTurn';
import type { SteambirdNews } from '@/models/teyvat/steambird';
import { sendChatMessage } from '@/services/ai/text';
import { isEmptyResponse, parseResponse } from '@/services/ai/responseParser';
import { revalidateFactCandidatesForBody } from '@/services/ai/narrativeTurnParser';
import { generateNarrativeImage } from '@/services/ai/imageGeneration';
import { appendApiErrorReport } from '@/services/ai/apiErrorReportService';
import { isNonRetryableAIError } from '@/services/ai/deepSeekRecovery';
import { callVariableModel, type NsfwBaselineCandidate } from '@/services/ai/variableModel';
import { buildOpeningSystemPrompt, buildSystemPrompt } from './systemPromptBuilder';
import { buildTavernMessageChain } from './tavernMessageChainBuilder';
import { applyTavernOutputRegexScripts } from './tavernRegexProcessor';
import { getCurrentSTPresetV2 } from '@/utils/stSettingsNormalizer';
import { getBuiltinPresetsV2, loadAllBuiltinTavernPresets } from '@/data/builtinPresets';
import { 构建天气Prompt片段, 解析天气标签, 验证天气合法性 } from '@/data/weatherRules';
import {
  buildImmediateMemory,
  addImmediateMemory,
  autoCompressMemorySystemWithArchives,
  autoCompressMemorySystemWithArchivesAsync,
  compressNpcMemoryLedger,
  upsertRecallEntry,
} from './memoryUtils';
import { runSteambirdGenerationStep } from './steambirdWorkflow';
import { processScheduledCourierSeeds } from './courierWorkflow';
import { applyAbortedWorkflowPolicy, runCommittedSettlementRecovery, runPendingSettlementRecovery, type WorkflowResumeResult } from './recoveryResume';
import {
  archiveCommittedQuestSettlement,
  composeQuestSettlementCommands,
  collectQuestUpdatePayloads,
  notifyCommittedQuestUpdate,
} from './questWorkflow';
import { deriveCommittedQuestArchiveFacts } from '@/services/questService';
import { autoAlignCanonStoryProgress } from '@/services/storyProgressService';
import { evaluateStoryWeavingGate, getStoryWeavingInjectionDiagnostics } from '@/services/storyWeaving';
import { 归一化世界状态, 格式化开局档案上下文, type 世界状态 } from '@/models/world';
import { loadSetting, saveGame, saveSetting } from '@/services/dbService';
import {
  clearWorkflowRecoveryJournal,
  createWorkflowRecoveryJournal,
  persistWorkflowRecoveryJournal,
  updateWorkflowRecoveryJournal,
  type WorkflowRecoveryJournal,
} from '@/services/workflowRecovery';
import { buildSavePayload, commitActiveSaveTreeMeta } from './saveLoadWorkflow';
import {
  deriveNarrativeTimeFact,
  deriveNarrativeInventoryRemovalFacts,
  derivePartyPresenceFacts,
  deriveResolvedNpcLedgerFacts,
  factsToTeyvatDomainCommands,
  parseVariableFacts,
} from '@/utils/variableFacts';
import { reduceTeyvatTurn, commitTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { normalizeTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import {
  createDocumentVisibilitySource,
  createVisibilityBufferedPublisher,
  type VisibilityBufferedPublisher,
} from '@/utils/visibilityBufferedPublisher';
import { createRafCoalescedSetter } from '@/utils/rafCoalescedSetter';
import { setStreamingMessage } from '@/utils/streamingMessageStore';
import type { 变量事实, 变量命令, 变量命令批次 } from '@/models/variableCommand';
import { applyElementalEchoResult, applyTravelerSkillMastery, canInviteElementalEcho, ELEMENTAL_ECHO_MASTERY_GAIN, enterElementalEcho } from '@/services/elementalAttunementService';
import { generateCourierLetter, resolveCourierApiConfig } from '@/services/ai/courierLetterModel';
import { appendPhoneDeliveryMemories, buildCourierSenderNpcRecords, buildCourierSenderProfile, findCourierReplyCandidates, splitLetterIntoLines } from '@/services/ai/courierService';
import { runCourierReplyPass } from './courierBackgroundJobs';
import { 天气列表 } from '@/data/weatherRules';
import { ELEMENT_IDS, type ElementId } from '@/models/teyvat/elements';
import { ELEMENT_NAMES } from '@/styles/elementTokens';
import { 创建默认记忆系统设置 } from '@/models/settings';
import type { API配置项, API设置, 文生图API配置 } from '@/models/settings';
import type { 队列任务ID, 队列任务记录, 队列任务状态 } from '@/models/queueTask';
import { retrieveCodexEntries, type CodexRetrievalResult } from '@/services/codexRetrieval';
import { applyStoryArchiveCodexRuntimeUnlock } from '@/services/codexRuntimeUnlock';
import { buildPersistedStoryWeavingSystem, hydratePersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';
import { getBuiltinPresets } from '@/data/builtinPresets';
import { retrieveIrminsulEntries } from '@/services/irminsulRetrieval';
import { buildIrminsulArchiveEntry } from '@/services/irminsulArchive';
import { 创建默认图鉴系统设置 } from '@/models/settings';
import { selectNpcLedgersForTurn, 提取NPC同行记忆文本列表, type NPC记录, type NPC账本选择结果 } from '@/models/npc';
import type { CourierDeliverySeed, CourierSystem } from '@/models/teyvat/courier';
import type { IrminsulMemory } from '@/models/teyvat/irminsul';
import {
  buildImmediateStoryReview,
  buildCodexKeywordRecallQuery,
  buildLeanAssistantHistoryContent,
  buildMainRecallQuery,
  getMainHistoryWindow,
} from './historyWindow';
import { 归一化剧情编织系统, type 剧情编织系统 } from '@/models/storyWeaving';
import { restorePreTurnSnapshot } from './turnSnapshot';
import { getNsfwArchiveBlockReason } from '@/utils/nsfwArchivePolicy';
import { normalizePlayerSpeechInBody } from '@/utils/playerSpeechGuard';
import { enrichNpcArchives, needsNsfwBaseline } from '@/utils/npcArchiveEnrichment';
import { sanitizeParsedResponse, sanitizeContaminatedText } from '@/utils/textSanitizer';
import { appendWorldEvents } from '@/utils/worldEvents';
import { getAnticipatedNpcNamesForTurn, getCodexNpcNamesForTurn, getMissingPartyMembers } from './npcPresence';
import { buildCachePrefixDiagnostics, buildTurnTokenUsage } from './turnDiagnostics';
import type { CodexEntry } from '@/models/teyvat/codex';
import { buildImagePromptTokenizerConfig } from '@/services/ai/imagePromptTokenizer';
import { applyNovelAIRulePreset } from '@/utils/imagePromptRules';
import { globalImageTaskQueue } from '@/utils/imageTaskQueue';
import { DEFAULT_NOTIFICATION_SETTINGS, notifyEvent } from '@/utils/notifications';
import { pushToast } from '@/utils/toastStore';
import { resolveStorySnapshot, selectPresentStorySnapshotNpcs } from '@/services/ai/storySnapshotPipeline';
import { 创建相册图片条目, 添加图片到相册, 创建相册资源引用 } from '@/utils/albumActions';
import { compactPreTurnSnapshot } from '@/utils/saveRuntimeCompactor';
import { compactChatHistoryForLongSession, compactVariableBatchHistory } from '@/utils/longSessionRetention';
import { applyElementToField, buildElementalFieldPromptSection, detectAppliedElements, detectTravelerAppliedElements, MAX_ELEMENT_EVENTS } from '@/models/teyvat';
import { createMacroContext, type MacroContext, type MacroGameState } from '@/utils/macroEngine';
import { updateTriggerStatesAfterTurn } from '@/utils/worldbook';

const DEEPSEEK_MAIN_FORMAT_GUARD = [
  'DeepSeek 主剧情格式校验：只输出一个合法 NarrativeTurn JSON 对象。',
  '根字段固定为 body、choices、factCandidates、continuation；不要 Markdown 围栏、标签、解释或额外字段。',
  'body 只含可见 narration/dialogue/system 块；不要输出 thinking、analysis、推理过程或工具载荷。',
].join('\n');

function formatOriginalProtagonistForOpening(originalProtagonist: 世界状态['原著主角']): string {
  if (originalProtagonist === '荧') return '原作主角荧';
  if (originalProtagonist === '空') return '原作主角空';
  if (originalProtagonist === '空荧双主角') return '原作主角空与荧';
  if (originalProtagonist === '无主角') return '无固定原著主角（玩家以自定义身份独行）';
  return '所选原著主角';
}

function getDeepSeekMainProtocolIssues(parsed: NarrativeTurn): string[] {
  const issues: string[] = [];
  if (!narrativeTurnBodyText(parsed)) issues.push('body 没有可见正文块');
  if (!Array.isArray(parsed.choices)) issues.push('choices 不是数组');
  if (!Array.isArray(parsed.factCandidates)) issues.push('factCandidates 不是数组');
  if (!parsed.continuation || !Array.isArray(parsed.continuation.unresolved)) issues.push('continuation 无效');
  return issues;
}

function buildDeepSeekProtocolRetryGuard(issues: string[]): string {
  return [
    'DeepSeek 主剧情自动重试：上一版 JSON 未通过 NarrativeTurn 协议校验。',
    `失败项：${issues.join('；') || '未知格式错误'}。`,
    '请完全重写，不要延续上一版残缺输出。',
    DEEPSEEK_MAIN_FORMAT_GUARD,
  ].join('\n');
}

function stripLeakedHistoryMetaFromBody(body: string): string {
  if (!body) return body;
  return body
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line) return raw;
      const historyTag = line.match(/^【\s*(历史时间|历史正文|历史狭间问答|历史狭间评判|历史短期记忆|历史变量草稿|历史剧情规划)\s*】\s*(.*)$/);
      if (!historyTag) return raw;
      const [, tag, rest] = historyTag;
      if (tag === '历史时间') return '';
      return rest.trim() ? `【旁白】${rest.trim()}` : '';
    })
    .filter((line) => line.trim())
    .join('\n');
}

function buildStoryProgressMemoryLine(previous: 剧情编织系统, next: 剧情编织系统): string {
  const before = previous.当前进度;
  const after = next.当前进度;
  if (!after) return '';
  if (
    before?.当前系列ID === after.当前系列ID &&
    before?.当前分段ID === after.当前分段ID &&
    before?.推进状态 === after.推进状态 &&
    before?.最近一次推进判定回合 === after.最近一次推进判定回合
  ) {
    return '';
  }
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

// 区E执法块(结构轮, 2026-07-26): 注入在聊天历史与玩家输入之后——离生成点最近的位置。
// 实现参照狭间评判提醒的既有先例(尾部 user 消息,三 provider 通用,连续 user 消息已有
// DeepSeek 守卫先例)。素材复用本回合已算好的图鉴命中,不新增检索。
function buildTurnEnforcementBlock(input: {
  playerName: string;
  wordCountTarget: number;
  codexEntries?: CodexEntry[];
  storyWeavingActive: boolean;
}): string {
  const lines: string[] = ['# 本回合生成前核对（最高优先级，覆盖上文所有软性描述）'];
  const characters = (input.codexEntries ?? []).filter((entry) => (
    entry.category === 'character' && entry.injection.type === 'character'
  ));
  if (characters.length) {
    lines.push('【在场角色锚点】');
    for (const c of characters) {
      if (c.injection.type !== 'character') continue;
      const speech = c.injection.speechStyle?.trim() ?? '';
      const forbid = c.injection.portrayalBoundaries?.trim() ?? '';
      const bits = [
        speech ? `说话方式：${speech.length > 60 ? `${speech.slice(0, 58)}…` : speech}` : '',
        forbid ? `禁止误写：${forbid.length > 60 ? `${forbid.slice(0, 58)}…` : forbid}` : '',
      ].filter(Boolean).join('｜');
      if (bits) lines.push(`- ${c.name}：${bits}`);
    }
  }
  lines.push('【硬性要点】');
  lines.push(`- 发言归属：【${input.playerName}】只承载玩家本回合明确说出的原话；NPC 台词、拟声词、环境音绝不挂玩家名。`);
  lines.push('- 禁止代写玩家的心理、神态、感受或决定；正文内禁止任何选项菜单结构。');
  if (input.storyWeavingActive) {
    lines.push('- 剧情编织滑窗只按门禁推进；已发生的事件禁止重演，未开始的分段禁止抢跑。');
  }
  lines.push(`- body 可见文本不少于 ${input.wordCountTarget} 字；NarrativeTurn 四个根字段齐全。`);
  lines.push('逐项核对以上约束后再动笔；与上文任何描述冲突时，以本块为准。');
  return lines.join('\n');
}

function applyStoryProgressNpcMemory(npcs: NPC记录[], story: 剧情编织系统, _memoryLine: string, turn: number): NPC记录[] {
  if (!story.当前进度) return npcs;
  const series = story.系列列表.find((item) => item.id === story.当前进度?.当前系列ID)
    ?? story.系列列表.find((item) => item.id === story.当前系列ID);
  if (!series) return npcs;
  const latestArchive = story.当前进度.历史归档.at(-1);
  const roleProgress = latestArchive?.角色推进摘要 ?? [];
  if (!roleProgress.length) return npcs;
  let changed = false;
  const next = npcs.map((npc) => {
    const aliases = [npc.姓名, npc.别名].filter((item): item is string => Boolean(item?.trim()));
    const matched = roleProgress.find((summary) =>
      aliases.some((name) => summary.includes(name)),
    );
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

function formatCodexDiagnosticsPreview(result?: CodexRetrievalResult | null): string {
  if (!result) return '';
  return [
    '图鉴召回诊断：',
    `命中条目：${result.entries.map((entry) => entry.name).join('、') || '无'}`,
    `注入字符：${result.injection.length}`,
  ].join('\n');
}

function formatCodexRecallSummary(result?: CodexRetrievalResult | null): string {
  if (!result) return '图鉴召回：无';
  return `图鉴召回：${result.entries.map((entry) => entry.name).join('、') || '无'}`;
}

function formatIrminsulRecallSummary(previewText?: string): string {
  const text = String(previewText || '').trim();
  if (!text) return '记忆召回：无';
  const names = Array.from(
    new Set(
      text
        .split(/[|\n，,]/)
        .map((item) => item.replace(/^强回忆[:：]/, '').replace(/^弱回忆[:：]/, '').trim())
        .filter((item) => item && item !== '无'),
    ),
  );
  return `记忆召回：${names.length ? names.join('，') : '无'}`;
}

function buildNpcLedgerDebug(selection?: NPC账本选择结果): NonNullable<聊天消息['debugContext']>['npcLedgerInjection'] | undefined {
  if (!selection) return undefined;
  return {
    selectedNames: selection.selected.map((item) => item.npc.姓名),
    skippedNames: selection.skipped.slice(0, 12),
    injected: selection.selected.map((item) => ({
      name: item.npc.姓名,
      reason: item.reasons,
      fields: item.fields,
      hasRecentInteraction: Boolean(item.ledger.最近互动),
      hasMustRemember: item.ledger.必须记得.length > 0 || item.ledger.禁止遗忘.length > 0,
      hasUnresolvedItems: item.ledger.未完成事项.length > 0 || item.ledger.未解决冲突.length > 0,
    })),
  };
}

type NpcLedgerUpdateDebug = NonNullable<聊天消息['debugContext']>['npcLedgerUpdate'];

const NPC_LEDGER_FIELD_LABELS: Record<string, string> = {
  最近互动: '最近互动',
  对玩家长期印象: '对玩家长期印象',
  当前关系阶段: '当前关系阶段',
  共同经历: '共同经历',
  未完成事项: '未完成事项',
  未解决冲突: '未解决冲突',
  必须记得: '必须记得',
  禁止遗忘: '禁止遗忘',
  同行记忆: '同行记忆',
};

function normalizeNpcDebugName(name: string): string {
  return name.trim() || '未知 NPC';
}

function extractNpcNameFromCommandKey(key: string): string {
  const matched = key.match(/^NPC\[id=([^\]]+)\]/);
  return matched?.[1]?.trim() || '';
}

function extractNpcFieldFromCommandKey(key: string): string {
  const matched = key.match(/^NPC\[[^\]]+\]\.([^.[\]]+)/);
  return matched?.[1]?.trim() || '';
}

function pushUniqueText(list: string[], text: string) {
  const normalized = text.trim();
  if (!normalized || list.includes(normalized)) return;
  list.push(normalized);
}

function buildNpcLedgerUpdateDebug(input: {
  facts: 变量事实[];
  commands: 变量命令[];
  results: Array<{ command: 变量命令; ok: boolean; reason?: string; kind?: string }>;
  warnings: string[];
  summaryTriggeredNames?: string[];
}): NpcLedgerUpdateDebug | undefined {
  const updatedNames: string[] = [];
  const memoryAppended: string[] = [];
  const ledgerFieldsUpdated: string[] = [];
  const warnings: string[] = [];
  const npcNameById = new Map<string, string>();

  for (const fact of input.facts) {
    if (fact.type !== 'npc') continue;
    const name = normalizeNpcDebugName(fact.name || fact.id || '');
    if (fact.id?.trim()) npcNameById.set(fact.id.trim(), name);
    const factFields = [
      fact.recentInteraction ? '最近互动' : '',
      fact.longTermImpression ? '对玩家长期印象' : '',
      fact.intimateRelationship !== undefined ? '亲密关系' : '',
      fact.sharedExperiences?.length ? '共同经历' : '',
      fact.openItems?.length ? '未完成事项' : '',
      fact.unresolvedConflicts?.length ? '未解决冲突' : '',
      fact.mustRemember?.length ? '必须记得' : '',
      fact.doNotForget?.length ? '禁止遗忘' : '',
    ].filter(Boolean);
    if (fact.memory) pushUniqueText(memoryAppended, `${name}：${fact.memory}`);
    if (factFields.length) pushUniqueText(ledgerFieldsUpdated, `${name}：${factFields.join('、')}`);
    if (fact.memory && !factFields.length) {
      pushUniqueText(warnings, `${name} 只写了 memory，没有同步 recentInteraction / mustRemember / openItems 等账本字段。`);
    }
    if (factFields.length || fact.memory || fact.affinityDelta !== undefined || fact.affinitySet !== undefined || fact.intimateRelationship !== undefined || fact.following !== undefined) {
      pushUniqueText(updatedNames, name);
    }
  }

  const successfulCommands = input.results.filter((item) => item.ok);
  for (const item of successfulCommands) {
    const key = item.command.key;
    if (!key.startsWith('NPC[')) continue;
    const commandName = extractNpcNameFromCommandKey(key);
    const name = npcNameById.get(commandName) ?? commandName;
    const field = extractNpcFieldFromCommandKey(key);
    if (name) pushUniqueText(updatedNames, name);
    if (field === '同行记忆') pushUniqueText(memoryAppended, `${name || 'NPC'}：已追加同行记忆`);
    const label = NPC_LEDGER_FIELD_LABELS[field];
    if (label && field !== '同行记忆') pushUniqueText(ledgerFieldsUpdated, `${name || 'NPC'}：${label}`);
  }

  for (const reason of input.warnings) {
    pushUniqueText(warnings, reason);
  }

  const summaryTriggered = input.summaryTriggeredNames ?? [];
  if (!updatedNames.length && !memoryAppended.length && !ledgerFieldsUpdated.length && !summaryTriggered.length && !warnings.length) {
    return undefined;
  }
  return {
    updatedNames,
    memoryAppended,
    ledgerFieldsUpdated,
    summaryTriggered,
    warnings,
  };
}

function attachNpcLedgerUpdateDebug(
  history: 聊天消息[],
  messageId: string,
  update?: NpcLedgerUpdateDebug,
): 聊天消息[] {
  if (!update) return history;
  return history.map((msg) => {
    if (msg.id !== messageId) return msg;
    return {
      ...msg,
      debugContext: msg.debugContext
        ? { ...msg.debugContext, npcLedgerUpdate: update }
        : msg.debugContext,
    };
  });
}

function formatNpcLedgerPreview(selection?: NPC账本选择结果): string {
  if (!selection) return '';
  const selected = selection.selected.map((item) => `${item.npc.姓名}（${item.reasons.slice(0, 3).join('、') || '相关'}）`);
  const skipped = selection.skipped.slice(0, 4).map((item) => `${item.name}：${item.reason}`);
  return [
    'NPC账本注入诊断：',
    selected.length ? `已注入：${selected.join('；')}` : '已注入：无',
    skipped.length ? `未注入示例：${skipped.join('；')}` : '',
  ].filter(Boolean).join('\n');
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

async function resolveStoryWeavingForBackgroundWrite(input: {
  workflowBase: 剧情编织系统;
  proposed: 剧情编织系统;
}): Promise<{ system: 剧情编织系统; concurrentChange: boolean }> {
  const latest = await loadSetting<剧情编织系统>('storyWeavingSystem');
  const latestNormalized = latest ? hydratePersistedStoryWeavingSystem(latest, input.workflowBase) : null;
  if (!latestNormalized) return { system: input.proposed, concurrentChange: false };
  const baseSignature = getStoryWeavingWriteSignature(归一化剧情编织系统(input.workflowBase));
  const latestSignature = getStoryWeavingWriteSignature(latestNormalized);
  if (baseSignature === latestSignature) {
    return { system: input.proposed, concurrentChange: false };
  }
  return { system: latestNormalized, concurrentChange: true };
}

function normalizeCourierSeedComparableText(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[，。！？!?；;、,.…~～“”"'\[\]（）()《》<>]/g, '')
    .trim();
}

function isCourierSeedTextSimilar(a: string, b: string): boolean {
  const left = normalizeCourierSeedComparableText(a);
  const right = normalizeCourierSeedComparableText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 12 && right.includes(left)) return true;
  if (right.length >= 12 && left.includes(right)) return true;
  const shared = [...new Set(left)].filter((char) => right.includes(char)).length;
  return shared / Math.max(1, Math.min(left.length, right.length)) >= 0.82;
}

function hasRecentSimilarCourierSeed(input: {
  courier: CourierSystem;
  npcId: string;
  turn: number;
  title: string;
  context: string;
  windowTurns?: number;
}): boolean {
  const windowTurns = Math.max(3, input.windowTurns ?? 12);
  const currentText = `${input.title}\n${input.context}`;
  return input.courier.deliverySeeds.some((seed) => {
    if (input.turn - (Number(seed.turn) || 0) > windowTurns) return false;
    const sameTarget = seed.targetId === input.npcId || seed.targetId === `npc_${input.npcId}` || seed.relatedNpcIds.includes(input.npcId);
    if (!sameTarget) return false;
    return isCourierSeedTextSimilar(currentText, `${seed.title}\n${seed.context}`);
  });
}

function buildFallbackCourierSeed(input: {
  courier: CourierSystem;
  npcs: NPC记录[];
  turn: number;
  userInput: string;
  body: string;
  maxSeedsPerTurn: number;
  contactCooldownTurns: number;
}): CourierDeliverySeed | null {
  if (input.maxSeedsPerTurn <= 0) return null;
  const pendingCount = input.courier.deliverySeeds.filter((seed) => seed.status === 'pending').length;
  if (pendingCount >= input.maxSeedsPerTurn) return null;
  if (input.courier.deliverySeeds.some((seed) => seed.status === 'pending')) return null;

  const cooldown = Math.max(1, Math.trunc(input.contactCooldownTurns || 3));
  const fallbackGlobalCooldown = Math.max(3, cooldown);
  const lastNonUrgentSeedTurn = input.courier.deliverySeeds
    .filter((seed) => seed.priority !== 'urgent')
    .reduce((latest, seed) => Math.max(latest, Number(seed.turn) || 0), 0);
  if (lastNonUrgentSeedTurn > 0 && input.turn - lastNonUrgentSeedTurn < fallbackGlobalCooldown) return null;

  const text = `${input.userInput}\n${input.body}`;
  const candidates = input.npcs
    .filter((npc) => npc.关系 !== 'enemy')
    .filter((npc) => npc.阶位 === 'companion' || npc.同行 || 提取NPC同行记忆文本列表(npc).length > 0)
    .filter((npc) => {
      const recentTurn = Number(npc.最近回合 || 0);
      if (recentTurn < Math.max(1, input.turn - 4)) return false;
      const aliases = [npc.姓名, npc.别名].filter((item): item is string => Boolean(item?.trim()));
      return npc.同行 || aliases.some((name) => text.includes(name));
    })
    .filter((npc) => {
      const lastSeedTurn = input.courier.deliverySeeds
        .filter((seed) =>
          seed.targetId === npc.id ||
          seed.targetId === `npc_${npc.id}` ||
          seed.relatedNpcIds.includes(npc.id),
        )
        .reduce((latest, seed) => Math.max(latest, Number(seed.turn) || 0), 0);
      return lastSeedTurn <= 0 || input.turn - lastSeedTurn >= cooldown;
    })
    .sort((a, b) => {
      if (a.同行 !== b.同行) return a.同行 ? -1 : 1;
      const recentDiff = Number(b.最近回合 || 0) - Number(a.最近回合 || 0);
      if (recentDiff !== 0) return recentDiff;
      return 提取NPC同行记忆文本列表(b).length - 提取NPC同行记忆文本列表(a).length;
    });

  const npc = candidates[0];
  if (!npc) return null;
  const reason = [
    input.body.replace(/\s+/g, ' ').trim().slice(0, 120),
    提取NPC同行记忆文本列表(npc).slice(-1)[0],
  ].filter(Boolean).join('；');
  const title = `${npc.姓名}的跟进来信`;
  const context = `${npc.姓名}近期与旅行者有互动，可低频投递一封跟进、确认状况或延续约定的来信。已发生事实：${reason || '近期剧情互动。'}`;
  if (hasRecentSimilarCourierSeed({
    courier: input.courier,
    npcId: npc.id,
    turn: input.turn,
    title,
    context,
  })) {
    return null;
  }
  return {
    id: `courier_seed_fallback_${input.turn}_${npc.id}_${Math.random().toString(36).slice(2, 8)}`,
    senderId: npc.id,
    reason: '近期剧情互动跟进',
    turn: input.turn,
    source: 'main_story',
    triggerType: npc.同行 ? 'quest' : 'relationship',
    priority: 'low',
    targetType: 'private',
    targetId: npc.id,
    title,
    context,
    relatedNpcIds: [npc.id],
    expiresAfterTurns: 6,
    status: 'pending',
  };
}

/** 格式伪历史：在 `user:开始任务` 后注入最小合法 NarrativeTurn。 */
const NARRATIVE_TURN_EXAMPLE_USER = '开始任务';
const NARRATIVE_TURN_EXAMPLE_ASSISTANT = JSON.stringify({
  body: [{ kind: 'system', id: 'ready', text: '系统已就绪，等待玩家发起首回合。' }],
  choices: [],
  factCandidates: [],
  continuation: { summary: '系统初始化完成。', unresolved: [] },
});

function isDeepSeekMainConfig(config: { provider?: string; baseUrl?: string; model?: string }): boolean {
  const provider = String(config.provider ?? '').toLowerCase();
  const baseUrl = String(config.baseUrl ?? '').toLowerCase();
  const model = String(config.model ?? '').toLowerCase();
  return provider === 'deepseek' || baseUrl.includes('deepseek') || model.includes('deepseek');
}

function applyNsfwVariablePolicy(
  commands: 变量命令[],
  policy: { nsfwEnabled: boolean; maleNsfwArchiveEnabled: boolean },
  npcs: NPC记录[] = [],
): {
  allowedCommands: 变量命令[];
  rejectedCommands: Array<{ command: 变量命令; ok: false; reason: string }>;
} {
  const allowedCommands: 变量命令[] = [];
  const rejectedCommands: Array<{ command: 变量命令; ok: false; reason: string }> = [];

  for (const command of commands) {
    const key = command.key ?? '';
    const valueText = JSON.stringify(command.value ?? '');
    const touchesNsfw = key.includes('NSFW档案') || valueText.includes('NSFW档案');
    const touchesMaleArchive =
      key.includes('男性身体档案') ||
      key.includes('男性器') ||
      valueText.includes('男性身体档案') ||
      valueText.includes('男性器');

    if (touchesNsfw && !policy.nsfwEnabled) {
      rejectedCommands.push({
        command,
        ok: false,
        reason: 'NSFW 总开关未开启，已阻止写入 NSFW 档案。',
      });
      continue;
    }

    if (touchesNsfw) {
      const blockedReason = getNsfwBlockedCommandReason(command, npcs);
      if (blockedReason) {
        rejectedCommands.push({
          command,
          ok: false,
          reason: blockedReason,
        });
        continue;
      }
    }

    if (touchesMaleArchive && !policy.maleNsfwArchiveEnabled) {
      rejectedCommands.push({
        command,
        ok: false,
        reason: '男性 NSFW 档案开关未开启，已阻止写入男性身体档案。',
      });
      continue;
    }

    allowedCommands.push(command);
  }

  return { allowedCommands, rejectedCommands };
}

function getNsfwBlockedCommandReason(command: 变量命令, npcs: NPC记录[]): string | null {
  const text = `${command.key}\n${JSON.stringify(command.value ?? '')}`;
  const selector = command.key.match(/^NPC\[([^\]]+)\]/)?.[1] ?? '';
  const selectorValue = selector.includes('=')
    ? selector.split('=').slice(1).join('=').replace(/^["']|["']$/g, '').trim()
    : selector.trim();
  const npc = npcs.find((item) =>
    item.id === selectorValue ||
    item.姓名 === selectorValue ||
    item.别名 === selectorValue ||
    text.includes(item.姓名) ||
    Boolean(item.别名 && text.includes(item.别名)),
  );
  const reason = getNsfwArchiveBlockReason(npc, selectorValue, text);
  return reason ? `NSFW 档案已阻止：${reason}。` : null;
}

function pushQueueTask(
  state: UseGameStateReturn,
  id: 队列任务ID,
  status: 队列任务状态,
  patch?: {
    title?: string;
    subtitle?: string;
    detail?: string;
    rawText?: string;
    turn?: number;
    targetMessageId?: string;
    targetBatchId?: string;
    retryHint?: string;
    failCount?: number;
    retrying?: boolean;
    cancellable?: boolean;
    cancelled?: boolean;
  },
) {
  const titleMap: Record<队列任务ID, string> = {
    main_story: '主剧情生成',
    memory: '记忆整理',
    variable: '变量生成',
    steambird: '蒸汽鸟报',
    world_evolution: '世界演变',
    irminsul: '世界树召回',
    codex: '图鉴检索',
    courier: '手机消息',
    autosave: '自动存档',
    narrative_image_parse: '故事快照解析',
    narrative_image_generate: '故事快照生成',
    quest: '剧情任务',
  };
  const subtitleMap: Record<队列任务ID, string> = {
    main_story: '主 API 输出正文与行动选项',
    memory: '即时记忆写入与自动压缩',
    variable: '解析正文并落地变量命令',
    steambird: '独立 API 推演蒸汽鸟报与后台事件',
    world_evolution: '后续接入独立世界演变 API',
    narrative_image_parse: '从正文提取故事快照提示词',
    narrative_image_generate: '调用生图 API 生成故事快照',
    quest: '解析任务更新并结算目标进度',
    irminsul: '后续接入回忆检索队列',
    codex: '独立 API 检索原著资料',
    courier: '主动消息契机与手机入口',
    autosave: '写入最近自动存档',
  };
  const record: 队列任务记录 = {
    id,
    title: patch?.title ?? titleMap[id],
    subtitle: patch?.subtitle ?? subtitleMap[id],
    turn: patch?.turn ?? state.turnCount,
    timestamp: Date.now(),
    status,
    detail: patch?.detail,
    rawText: patch?.rawText,
    targetMessageId: patch?.targetMessageId,
    targetBatchId: patch?.targetBatchId,
    retryHint: patch?.retryHint,
    failCount: patch?.failCount,
    retrying: patch?.retrying,
    cancellable: patch?.cancellable,
    cancelled: patch?.cancelled,
  };
  state.setQueueTasks((prev) => [
    ...prev.slice(-24),
    record,
  ]);
  return record;
}

function splitStreamingReveal(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const sentenceChunks = trimmed.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g)?.filter(Boolean) ?? [];
  if (sentenceChunks.length > 1) return sentenceChunks;
  const chars = Array.from(trimmed);
  if (chars.length <= 16) return [trimmed];
  const chunkSize = Math.max(4, Math.ceil(chars.length / 10));
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += chunkSize) {
    chunks.push(chars.slice(i, i + chunkSize).join(''));
  }
  return chunks;
}

function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

function waitStreamingPreviewDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted || isPageHidden() || typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let done = false;
    let timer: number | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      if (typeof timer === 'number') window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const onVisibilityChange = () => {
      if (isPageHidden()) finish();
    };
    timer = window.setTimeout(finish, ms);
    document.addEventListener('visibilitychange', onVisibilityChange);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

function buildRecentTurnWindowForSteambird(history: 聊天消息[], currentUserInput: string, currentBody: string, interval: number): string[] {
  const windowSize = Math.max(5, Math.min(10, Math.trunc(interval) || 5));
  const pairs: string[] = [];
  let pendingUser = '';

  for (const msg of history) {
    if (msg.role === 'user') {
      pendingUser = msg.content;
      continue;
    }
    if (msg.role === 'assistant') {
      const body = msg.parsedResponse ? narrativeTurnBodyText(msg.parsedResponse) : msg.content;
      if (pendingUser || body) {
        pairs.push(`- 玩家：${pendingUser || '（无）'}\n  正文：${body.slice(0, 420)}`);
      }
      pendingUser = '';
    }
  }

  pairs.push(`- 玩家：${currentUserInput || '（无）'}\n  正文：${currentBody.slice(0, 420)}`);
  return pairs.slice(-windowSize);
}

async function revealStreamingPreview(
  state: UseGameStateReturn,
  text: string,
  signal?: AbortSignal,
  options?: { delayMs?: number; minChunks?: number },
): Promise<void> {
  const chunks = splitStreamingReveal(text);
  if (!chunks.length) return;
  const streamSetter = createRafCoalescedSetter(setStreamingMessage);
  if (isPageHidden()) {
    streamSetter.flush(text.trim());
    return;
  }
  const minChunks = options?.minChunks ?? 8;
  const delayMs = options?.delayMs ?? 18;
  const revealChunks =
    chunks.length >= minChunks
      ? chunks
      : (() => {
          const chars = Array.from(text.trim());
          const chunkSize = Math.max(3, Math.ceil(chars.length / minChunks));
          const expanded: string[] = [];
          for (let i = 0; i < chars.length; i += chunkSize) {
            expanded.push(chars.slice(i, i + chunkSize).join(''));
          }
          return expanded;
        })();

  let preview = '';
  try {
    for (const chunk of revealChunks) {
      if (signal?.aborted) return;
      preview += chunk;
      streamSetter.set(preview);
      await waitStreamingPreviewDelay(delayMs, signal);
      if (isPageHidden()) {
        streamSetter.flush(text.trim());
        return;
      }
    }
    // Ensure the final preview is committed before callers clear/replace it.
    streamSetter.flush(preview);
  } finally {
    streamSetter.cancel();
  }
}

function mergeIrminsulMemories(base: IrminsulMemory, override?: IrminsulMemory): IrminsulMemory {
  if (!override) return base;
  const merged = [...base.entries];
  for (const entry of override.entries ?? []) {
    if (!merged.some((item) => item.id === entry.id)) {
      merged.push(entry);
    }
  }
  return { entries: merged };
}

export interface SendWorkflowDeps {
  state: UseGameStateReturn;
  getActiveConfig: () => import('@/models/settings').API配置项 | null;
  onBeforeSend: () => void;
  onAfterSend: () => void;
  rerollContext?: {
    nonce: string;
    previousResponse: string;
  } | null;
}


function compactForRerollInstruction(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 900 ? `${cleaned.slice(0, 900)}...` : cleaned;
}

function buildSingleApiSettings(config: API配置项): API设置 {
  return {
    activeConfigId: config.id,
    configs: [config],
  };
}

function resolveNarrativeImageTokenizerConfig(state: UseGameStateReturn, mainConfig: API配置项 | null): API配置项 | null {
  if (!mainConfig) return null;
  return buildImagePromptTokenizerConfig(state.gameSettings, buildSingleApiSettings(mainConfig));
}

function resolveNarrativeImageGenerationApi(state: UseGameStateReturn): 文生图API配置 | null {
  const imageSettings = state.gameSettings.文生图系统;
  return imageSettings.普通接口.enabled
    ? applyNovelAIRulePreset(imageSettings.普通接口, imageSettings.rules)
    : null;
}

function archiveNarrativeSnapshotToAlbum(
  state: UseGameStateReturn,
  image: import('@/models/chat').叙事插图,
  params: {
    title: string;
    size: string;
    sourcePrompt: string;
  },
  domainAlbum?: UseGameStateReturn['相册'],
  onDomainAlbumChange?: (next: UseGameStateReturn['相册']) => void,
  writeState = true,
): import('@/models/chat').叙事插图 {
  if (image.status !== 'done' || !image.dataUrl) return image;
  const item = 创建相册图片条目({
    title: params.title || image.description || '故事快照',
    src: image.dataUrl,
    source: 'generated',
    targetType: 'scene',
    slot: 'scene',
    prompt: image.prompt,
    negativePrompt: image.negativePrompt,
    sourcePrompt: params.sourcePrompt,
    finalPrompt: image.prompt,
    finalNegativePrompt: image.negativePrompt,
    dimensions: params.size,
    tags: ['故事快照', '正文生图'],
    note: '故事快照',
  });
  const nextAlbum = 添加图片到相册(domainAlbum ?? state.相册, item);
  onDomainAlbumChange?.(nextAlbum);
  if (writeState) state.set相册(nextAlbum);
  return {
    ...image,
    dataUrl: 创建相册资源引用(item.asset.id),
    assetId: item.asset.id,
  };
}

async function generateNarrativeImagesForMessage(params: {
  state: UseGameStateReturn;
  messageId: string;
  body: string;
  tokenizerConfig: API配置项 | null;
  imageApiConfig: 文生图API配置;
  turn: number;
  signal?: AbortSignal;
  replaceExisting?: boolean;
  domainContext?: Pick<UseGameStateReturn, '旅人' | 'NPC' | '相册'> & {
    onAlbumChange?: (next: UseGameStateReturn['相册']) => void;
  };
  writeDomainState?: boolean;
}): Promise<import('@/models/chat').叙事插图[] | null> {
  const { state, messageId, body, tokenizerConfig, imageApiConfig, turn, signal, replaceExisting = false, domainContext, writeDomainState = true } = params;
  const failMessage = (error: string) => {
    if (!replaceExisting || !writeDomainState) return;
    state.setChatHistory((prev) => prev.map((msg) =>
      msg.id === messageId && msg.role === 'assistant'
        ? {
            ...msg,
            narrativeImages: [{
              id: `narrative_failed_${turn}_${Date.now()}`,
              dataUrl: '',
              type: 'scene' as const,
              kind: 'snapshot' as const,
              prompt: '',
              negativePrompt: '',
              description: '故事快照',
              status: 'failed' as const,
              error,
            }],
          }
        : msg,
    ));
  };
  pushQueueTask(state, 'narrative_image_parse', 'pending', {
    detail: '正在解析正文中的故事快照提示词。',
    turn,
    targetMessageId: messageId,
  });
  try {
    const playerAppearanceMode = state.gameSettings.文生图系统?.正文生图?.playerAppearanceMode ?? 'auto';
    const presentNpcRecords = selectPresentStorySnapshotNpcs(domainContext?.NPC ?? state.NPC ?? [], body);
    const traveler = domainContext?.旅人 ?? state.旅人;
    const snapshot = await resolveStorySnapshot({
      apiConfig: tokenizerConfig,
      body,
      traveler,
      playerAppearanceMode,
      presentNpcs: presentNpcRecords,
      rules: state.gameSettings.文生图系统.rules,
      size: '1280x720',
      slot: 'scene',
      signal,
    });
    pushQueueTask(state, 'narrative_image_parse', 'success', {
      detail: snapshot.source === 'local'
        ? `模型解析未完成，已使用本地草稿：${snapshot.summary.title || '剧情瞬间'}。${snapshot.warning ? ` ${snapshot.warning}` : ''}`
        : `已解析故事快照：${snapshot.summary.title || '剧情瞬间'}。`,
      rawText: snapshot.diagnosticRawText,
      turn,
      targetMessageId: messageId,
    });
    const generatedImages: import('@/models/chat').叙事插图[] = [];
    pushQueueTask(state, 'narrative_image_generate', 'pending', {
      detail: `正在生成故事快照：${snapshot.summary.title || '剧情瞬间'}。`,
      turn,
      targetMessageId: messageId,
    });
    const imageId = `narrative_${turn}_snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const result = await generateNarrativeImage(
      imageApiConfig,
      snapshot.prompt,
      snapshot.negativePrompt,
      'scene',
      snapshot.summary.title || '故事快照',
      imageId,
      snapshot.renderContext,
      signal,
    );
    if (result.status === 'done' || result.status === 'failed') {
      result.kind = 'snapshot';
    }
    const archivedResult = archiveNarrativeSnapshotToAlbum(state, result, {
      title: snapshot.summary.title || '故事快照',
      size: '1280x720',
      sourcePrompt: body,
    }, domainContext?.相册, domainContext?.onAlbumChange, writeDomainState);
    generatedImages.push(archivedResult);
    pushQueueTask(state, 'narrative_image_generate', result.status === 'done' ? 'success' : 'failed', {
      detail: result.status === 'done'
        ? `${snapshot.summary.title || '故事快照'} 故事快照生成完成。`
        : `${snapshot.summary.title || '故事快照'} 故事快照生成失败：${result.error}`,
      turn,
      targetMessageId: messageId,
    });
    if (generatedImages.length > 0 && writeDomainState) {
      state.setChatHistory((prev) => {
        const targetIdx = prev.findIndex((msg) => msg.id === messageId);
        if (targetIdx < 0) return prev;
        const targetMsg = prev[targetIdx];
        if (targetMsg.role !== 'assistant') return prev;
        const updated = [...prev];
        updated[targetIdx] = {
          ...targetMsg,
          narrativeImages: replaceExisting
            ? generatedImages
            : [...(targetMsg.narrativeImages ?? []), ...generatedImages],
        };
        return updated;
      });
    }
    return generatedImages;
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      failMessage((err as Error).message);
      pushQueueTask(state, 'narrative_image_parse', 'failed', {
        detail: `故事快照解析失败：${(err as Error).message}`,
        turn,
        targetMessageId: messageId,
      });
    }
    return null;
  }
}

export async function regenerateNarrativeImagesForMessage(
  state: UseGameStateReturn,
  getActiveConfig: () => API配置项 | null,
  messageId: string,
): Promise<void> {
  const message = state.chatHistory.find((item) => item.id === messageId);
  if (!message || message.role !== 'assistant') return;
  const body = message.parsedResponse ? narrativeTurnBodyText(message.parsedResponse) : message.content.trim();
  if (!body) return;
  const narrative = state.gameSettings.文生图系统?.正文生图;
  if (!narrative?.enabled) {
    pushQueueTask(state, 'narrative_image_parse', 'failed', {
      detail: '正文生图未启用，无法重新生成故事快照。',
      turn: Number(message.gameTime) || state.turnCount,
      targetMessageId: messageId,
    });
    return;
  }
  const mainConfig = getActiveConfig();
  const tokenizerConfig = resolveNarrativeImageTokenizerConfig(state, mainConfig);
  const imageApiConfig = resolveNarrativeImageGenerationApi(state);
  if (!imageApiConfig) {
    pushQueueTask(state, 'narrative_image_generate', 'failed', {
      detail: '正文生图主文生图接口未启用，无法生成故事快照。',
      turn: Number(message.gameTime) || state.turnCount,
      targetMessageId: messageId,
    });
    return;
  }
  const turn = Number(message.gameTime) || state.turnCount;
  const previousImages = message.narrativeImages ?? [];
  state.setChatHistory((prev) => prev.map((item) =>
    item.id === messageId
      ? {
          ...item,
          narrativeImages: previousImages.length
            ? previousImages.map((img) => ({ ...img, status: 'generating' as const, error: undefined }))
            : [{
                id: `narrative_regen_${turn}_${Date.now()}`,
                dataUrl: '',
                type: 'scene' as const,
                prompt: '',
                negativePrompt: '',
                description: '故事快照',
                kind: 'snapshot' as const,
                status: 'generating' as const,
              }],
        }
      : item,
  ));
  await generateNarrativeImagesForMessage({
    state,
    messageId,
    body,
    tokenizerConfig,
    imageApiConfig,
    turn,
    replaceExisting: true,
  });
}

/**
 * Resume only the idempotent post-settlement tail of a committed turn.
 * Domain commands are deliberately absent here: settlement_committed is the
 * durable boundary after which recovery may run background work and autosave,
 * but must never replay variable/domain commands.
 */
async function runPostSettlementWorkflow(
  state: UseGameStateReturn,
  journal: WorkflowRecoveryJournal,
  committedOverride?: TeyvatGameState,
): Promise<void> {
  if (journal.phase !== 'settlement_committed') return;
  const committed = normalizeTeyvatGameState(committedOverride ?? journal.committedState ?? state.game);
  const committedHistory = committed.对话.entries;
  const assistant = journal.assistantMessageId
    ? committedHistory.find((message) => message.id === journal.assistantMessageId && message.role === 'assistant')
    : [...committedHistory].reverse().find((message) => message.role === 'assistant');
  const body = assistant
    ? (assistant.structuredResponse ? narrativeTurnBodyText(assistant.structuredResponse) : assistant.content.trim())
    : '';
  const assistantIndex = assistant ? committedHistory.findIndex((message) => message.id === assistant.id) : -1;
  const userInput = assistantIndex >= 0
    ? [...committedHistory.slice(0, assistantIndex)].reverse().find((message) => message.role === 'user')?.content.trim() || journal.input
    : journal.input;
  const turn = committed.turnCount;
  const stableNow = journal.startedAt;

  let steambird = committed.蒸汽鸟报;
  const steambirdSettings = state.gameSettings.蒸汽鸟报系统;
  const steambirdInterval = Math.max(5, Math.min(10, Math.trunc(steambirdSettings?.generateIntervalTurns ?? 5) || 5));
  const shouldRunSteambird = Boolean(
    body && steambirdSettings?.enabled && steambirdSettings.autoGenerate && (turn === 1 || turn % steambirdInterval === 0),
  );
  const steambirdBody = `${userInput}\n${body}`.trim();
  const steambirdAlreadyApplied = steambird.articles.some((article) =>
    article.turn === turn && article.body.trim() === steambirdBody,
  );
  if (shouldRunSteambird && !steambirdAlreadyApplied) {
    const result = runSteambirdGenerationStep({
      current: steambird,
      publicFacts: [{ title: `第 ${turn} 回公开见闻`, detail: steambirdBody }],
      turnCount: turn,
      now: stableNow,
    });
    if (result?.changed) steambird = result.steambird;
  }

  let irminsul = committed.世界树;
  const irminsulAlreadyApplied = irminsul.entries.some((entry) =>
    entry.turn === turn && entry.sourceText.trim() === body.trim(),
  );
  if (body && !irminsulAlreadyApplied) {
    irminsul = mergeIrminsulMemories(irminsul, { entries: [buildIrminsulArchiveEntry({
      id: `irminsul_recovery_${journal.workflowId}`,
      title: `第 ${turn} 回记忆`,
      summary: assistant?.structuredResponse?.continuation.summary || body.slice(0, 360),
      sourceTurns: [turn],
      keywords: [committed.世界.当前地点, ...(assistant?.structuredResponse?.factCandidates ?? [])
        .filter((candidate) => candidate.domain === 'world')
        .map((candidate) => candidate.fact)]
        .filter((item): item is string => Boolean(item))
        .slice(0, 8),
      recordedAt: committed.世界.当前日期 || String(turn),
      archiveType: 'short',
      sourceText: body,
      turn,
    })] });
  }
  const recoveredQuestFacts = deriveCommittedQuestArchiveFacts(
    committed,
    assistant?.structuredResponse?.factCandidates
      .filter((candidate) => candidate.domain === 'quest')
      .map((candidate) => candidate.fact) ?? [],
    turn,
  );
  irminsul = archiveCommittedQuestSettlement(irminsul, committed, recoveredQuestFacts, turn);

  const committedLegacy = toLegacyTurnCheckpoint({
    turnCount: committed.turnCount,
    pendingOpeningTrigger: null,
    traveler: committed.旅行者,
    npc: committed.NPC,
    album: committed.相册,
  });
  const committedTraveler = committedLegacy.旅人 as UseGameStateReturn['旅人'];
  const committedNpcs = committedLegacy.NPC as UseGameStateReturn['NPC'];
  const committedAlbum = committedLegacy.相册 as UseGameStateReturn['相册'];
  let courier = processScheduledCourierSeeds(committed.手机, turn, stableNow).next;
  if (state.gameSettings.手机系统.enabled && state.gameSettings.手机系统.autoGenerateSeeds) {
    const fallbackSeed = buildFallbackCourierSeed({
      courier,
      npcs: committedNpcs,
      turn,
      userInput,
      body,
      maxSeedsPerTurn: state.gameSettings.手机系统.maxSeedsPerTurn,
      contactCooldownTurns: state.gameSettings.手机系统.contactCooldownTurns,
    });
    if (fallbackSeed) {
      courier = {
        ...courier,
        deliverySeeds: [...courier.deliverySeeds, fallbackSeed],
        unreadTotal: courier.unreadTotal + 1,
      };
    }
  }

  let backgroundState = normalizeTeyvatGameState({
    ...committed,
    蒸汽鸟报: steambird,
    世界树: irminsul,
    手机: courier,
  });
  let finalConversation = committedHistory;
  let finalAlbum = committedAlbum;
  const narrativeSettings = state.gameSettings.文生图系统?.正文生图;
  const alreadyHasNarrativeImage = Boolean(assistant?.narrativeImages?.some((image) => image.status === 'done'));
  if (assistant && body && narrativeSettings?.enabled && narrativeSettings.mode === 'auto' && !alreadyHasNarrativeImage) {
    const activeConfig = state.apiSettings.configs.find((config) => config.id === state.apiSettings.activeConfigId)
      ?? state.apiSettings.configs[0]
      ?? null;
    const imageApiConfig = resolveNarrativeImageGenerationApi(state);
    if (imageApiConfig) {
      const generatedImages = await generateNarrativeImagesForMessage({
        state,
        messageId: assistant.id,
        body,
        tokenizerConfig: resolveNarrativeImageTokenizerConfig(state, activeConfig),
        imageApiConfig,
        turn,
        domainContext: {
          旅人: committedTraveler,
          NPC: committedNpcs,
          相册: finalAlbum,
          onAlbumChange: (next) => { finalAlbum = next; },
        },
        writeDomainState: false,
      });
      if (generatedImages?.length) {
        finalConversation = finalConversation.map((message) => message.id === assistant.id
          ? { ...message, narrativeImages: [...(message.narrativeImages ?? []), ...generatedImages] }
          : message);
      }
    }
  }
  backgroundState = applyLegacyGameStateOverrides({
    ...backgroundState,
    对话: { entries: finalConversation },
  }, { 相册: finalAlbum });
  state.replaceGameState(backgroundState);

  const saveData = buildSavePayload(state, 'auto', undefined, backgroundState);
  await saveGame(saveData);
  commitActiveSaveTreeMeta(saveData);
  state.setHasSave(true);
}

export async function resumePostSettlementWorkflow(
  state: UseGameStateReturn,
  journal: WorkflowRecoveryJournal,
  committedOverride?: TeyvatGameState,
): Promise<WorkflowResumeResult> {
  try {
    await runPostSettlementWorkflow(state, journal, committedOverride);
    return { ok: true, journal };
  } catch (error) {
    return { ok: false, journal, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function resumeCommittedSettlementWorkflow(
  state: UseGameStateReturn,
  journal: WorkflowRecoveryJournal,
): Promise<WorkflowResumeResult> {
  return runCommittedSettlementRecovery({
    journal,
    currentState: state.game,
    persist: persistWorkflowRecoveryJournal,
    runPostSettlement: async (committed, committedJournal) => {
      const result = await resumePostSettlementWorkflow(state, committedJournal, committed);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
  });
}

/** Resume a durable pending settlement directly from its normalized frozen source. */
export async function resumePendingSettlementWorkflow(
  state: UseGameStateReturn,
  journal: WorkflowRecoveryJournal,
): Promise<WorkflowResumeResult> {
  return runPendingSettlementRecovery({
    journal,
    currentState: state.game,
    persist: persistWorkflowRecoveryJournal,
    settle: async (source, settlementId) => {
      if (!journal.pendingNarrative || !journal.pendingSettlement) return null;
      const pending = journal.pendingSettlement;
    const config = state.apiSettings.configs.find((item) => item.id === state.apiSettings.activeConfigId)
      ?? state.apiSettings.configs[0]
      ?? null;
      if (!config) return null;
    const legacy = toLegacyTurnCheckpoint({
      turnCount: source.turnCount,
      pendingOpeningTrigger: null,
      traveler: source.旅行者, world: source.世界, npc: source.NPC, inventory: source.背包,
      memory: source.记忆, courier: source.手机, irminsul: source.世界树, codex: source.图鉴,
      steambird: source.蒸汽鸟报, album: source.相册, quest: source.任务, queue: source.后台队列,
      narrative: source.叙事,
    });
    const body = narrativeTurnBodyText(journal.pendingNarrative);
    const settlement = await runVariableCalibrationStep({
      state,
      mainApiConfig: config,
      userInput: journal.input,
      body,
      variableDraft: pending.variableDraft,
      turnAfter: source.turnCount,
      memorySystemSnapshot: legacy.记忆 as import('@/models/memory').记忆系统,
      travelerSnapshot: legacy.旅人 as import('@/models/character').角色数据结构,
      worldSnapshot: legacy.世界 as import('@/models/world').世界状态,
      baseGameSnapshot: source,
      factCandidates: journal.pendingNarrative.factCandidates,
      questUpdates: journal.pendingNarrative.factCandidates.filter((candidate) => candidate.domain === 'quest').map((candidate) => candidate.fact),
      questEnabled: state.gameSettings.任务系统?.enabled === true,
      settlementId,
    });
      return settlement?.committedGame ?? null;
    },
    runPostSettlement: async (committed, committedJournal) => {
      const post = await resumePostSettlementWorkflow(state, committedJournal, committed);
      return post.ok ? { ok: true } : { ok: false, error: post.error };
    },
  });
}

export async function retryQueueTask(
  state: UseGameStateReturn,
  getActiveConfig: () => API配置项 | null,
  task: 队列任务记录,
  mode: 'retry' | 'reroll' = 'retry',
): Promise<void> {
  if (task.id === 'narrative_image_parse' || task.id === 'narrative_image_generate') {
    const targetMessageId = task.targetMessageId ?? findLatestAssistantMessage(state.chatHistory)?.id;
    if (!targetMessageId) {
      pushQueueTask(state, task.id, 'failed', {
        detail: '未找到可重试的正文回合。',
        failCount: (task.failCount ?? 0) + 1,
      });
      return;
    }
    pushQueueTask(state, task.id, 'pending', {
      detail: mode === 'reroll' ? '正在重新解析并生成故事快照。' : '正在重试故事快照任务。',
      turn: task.turn || state.turnCount,
      targetMessageId,
      retrying: true,
      failCount: task.failCount,
    });
    await regenerateNarrativeImagesForMessage(state, getActiveConfig, targetMessageId);
    return;
  }

  if (task.id === 'steambird') {
    await retrySteambirdQueueTask(state, task, mode);
    return;
  }

  if (task.id === 'variable') {
    await retryVariableQueueTask(state, getActiveConfig, task, mode);
  }
}

async function retrySteambirdQueueTask(
  state: UseGameStateReturn,
  task: 队列任务记录,
  mode: 'retry' | 'reroll',
): Promise<void> {
  const assistant = findLatestAssistantMessage(state.chatHistory);
  if (!assistant) {
    pushQueueTask(state, 'steambird', 'failed', {
      detail: '未找到可用于蒸汽鸟报重试的正文回合。',
      failCount: (task.failCount ?? 0) + 1,
    });
    return;
  }
  const userInput = findPreviousUserInput(state.chatHistory, assistant.id);
  const body = assistant.parsedResponse ? narrativeTurnBodyText(assistant.parsedResponse) : assistant.content.trim();
  if (!body) {
    pushQueueTask(state, 'steambird', 'failed', {
      detail: '当前正文为空，无法重试蒸汽鸟报生成。',
      failCount: (task.failCount ?? 0) + 1,
    });
    return;
  }
  const steambirdSettings = state.gameSettings.蒸汽鸟报系统;
  const interval = Math.max(5, Math.min(10, Math.trunc(steambirdSettings?.generateIntervalTurns ?? 5) || 5));
  const abortController = new AbortController();
  pushQueueTask(state, 'steambird', 'pending', {
    detail: mode === 'reroll' ? '正在重生成蒸汽鸟报，本次不受回合间隔限制。' : '正在重试蒸汽鸟报，本次不受回合间隔限制。',
    turn: Number(assistant.gameTime) || task.turn || state.turnCount,
    retrying: true,
    failCount: task.failCount,
    targetMessageId: assistant.id,
  });
  try {
    const result = runSteambirdGenerationStep({
      current: state.蒸汽鸟报,
      publicFacts: [{ title: `第 ${state.turnCount} 回公开见闻`, detail: `${userInput}\n${body}`.trim() }],
      turnCount: state.turnCount,
    });
    if (result?.changed) state.set蒸汽鸟报(result.steambird);
    pushQueueTask(state, 'steambird', result ? 'success' : 'failed', {
      detail: result
        ? result.changed
          ? `蒸汽鸟报已${mode === 'reroll' ? '重生成' : '重试更新'}，当前共 ${result.steambird.articles.length} 篇报道。`
          : '蒸汽鸟报已重试，但模型没有返回可写入的新变化。'
        : '蒸汽鸟报重试失败，请检查蒸汽鸟报 API 配置或模型返回。',
      turn: Number(assistant.gameTime) || task.turn || state.turnCount,
      failCount: result ? task.failCount : (task.failCount ?? 0) + 1,
      targetMessageId: assistant.id,
    });
  } catch (err) {
    pushQueueTask(state, 'steambird', 'failed', {
      detail: `蒸汽鸟报重试失败：${(err as Error).message}`,
      turn: Number(assistant.gameTime) || task.turn || state.turnCount,
      failCount: (task.failCount ?? 0) + 1,
      targetMessageId: assistant.id,
    });
  }
}

async function retryVariableQueueTask(
  state: UseGameStateReturn,
  getActiveConfig: () => API配置项 | null,
  task: 队列任务记录,
  mode: 'retry' | 'reroll',
): Promise<void> {
  const batch = findRetryableVariableBatch(state.variableBatches, task.targetBatchId);
  if (!batch) {
    pushQueueTask(state, 'variable', 'failed', {
      detail: '未找到可安全重试的失败变量批次。若上一批已有成功命令，为避免重复结算，请不要直接重跑整批。',
      failCount: (task.failCount ?? 0) + 1,
    });
    return;
  }
  const assistant = findAssistantMessageForTurn(state.chatHistory, batch.turn) ?? findLatestAssistantMessage(state.chatHistory);
  const mainConfig = getActiveConfig();
  if (!assistant || !mainConfig) {
    pushQueueTask(state, 'variable', 'failed', {
      detail: !assistant ? '未找到变量批次对应的正文回合。' : '未配置主 API，无法重试变量结算。',
      targetBatchId: batch.id,
      failCount: (task.failCount ?? 0) + 1,
    });
    return;
  }
  const body = assistant.parsedResponse ? narrativeTurnBodyText(assistant.parsedResponse) : assistant.content.trim();
  if (!body) {
    pushQueueTask(state, 'variable', 'failed', {
      detail: '当前正文为空，无法重试变量结算。',
      targetBatchId: batch.id,
      failCount: (task.failCount ?? 0) + 1,
    });
    return;
  }
  pushQueueTask(state, 'variable', 'pending', {
    detail: mode === 'reroll' ? '正在重生成变量结算结果。' : '正在重试变量结算。',
    turn: batch.turn,
    targetMessageId: assistant.id,
    targetBatchId: batch.id,
    retrying: true,
    failCount: task.failCount,
  });
  const overrides = await runVariableCalibrationStep({
    state,
    mainApiConfig: mainConfig,
    userInput: findPreviousUserInput(state.chatHistory, assistant.id),
    body,
    variableDraft: assistant.parsedResponse?.factCandidates.length
      ? JSON.stringify({ facts: assistant.parsedResponse.factCandidates })
      : undefined,
    turnAfter: batch.turn + 1,
    memorySystemSnapshot: state.记忆,
    travelerSnapshot: state.旅人,
    worldSnapshot: state.世界,
    allowIrminsul: false,
  });
  const retryBatch = overrides?.batch;
  const hasFailure = retryBatch?.results.some((result) => !result.ok);
  pushQueueTask(state, 'variable', retryBatch && !hasFailure ? 'success' : retryBatch ? 'failed' : 'failed', {
    detail: retryBatch
      ? hasFailure
        ? '变量结算已重试，但仍存在失败命令，请展开查看原始信息。'
        : '变量结算已重试并落地。'
      : '变量结算重试未返回结果。',
    turn: batch.turn,
    targetMessageId: assistant.id,
    targetBatchId: retryBatch?.id ?? batch.id,
    failCount: hasFailure || !retryBatch ? (task.failCount ?? 0) + 1 : task.failCount,
  });
}

function findLatestAssistantMessage(history: 聊天消息[]): 聊天消息 | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.role === 'assistant') return item;
  }
  return undefined;
}

function findAssistantMessageForTurn(history: 聊天消息[], turn: number): 聊天消息 | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.role === 'assistant' && Number(item.gameTime) === turn) return item;
  }
  return undefined;
}

function findPreviousUserInput(history: 聊天消息[], assistantId: string): string {
  const assistantIndex = history.findIndex((item) => item.id === assistantId);
  if (assistantIndex < 0) return '';
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.role === 'user') return item.content;
  }
  return '';
}

function findRetryableVariableBatch(batches: 变量命令批次[], targetBatchId?: string): 变量命令批次 | undefined {
  const candidates = targetBatchId
    ? batches.filter((batch) => batch.id === targetBatchId)
    : [...batches].reverse();
  // 只允许整批完全失败的结果手动重试。
  // 若同一批里已有成功命令，重跑整批可能让已成功的 set/push 再落地一次，造成重复结算。
  return candidates.find((batch) =>
    batch.results.length > 0 &&
    batch.results.every((result) => !result.ok),
  );
}

function normalizeRerollCompareText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/[【】「」『』“”"'‘’（）()\[\]{}<>《》,，.。!！?？:：;；、\s]/g, '')
    .toLowerCase()
    .slice(0, 6000);
}

function calculateRerollSimilarity(nextText: string, previousText: string): number {
  const left = normalizeRerollCompareText(nextText);
  const right = normalizeRerollCompareText(previousText);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length >= 80 && right.includes(left)) return 0.98;
  if (right.length >= 80 && left.includes(right)) return 0.98;

  const buildGrams = (text: string): Set<string> => {
    const grams = new Set<string>();
    for (let index = 0; index <= text.length - 8; index += 2) {
      grams.add(text.slice(index, index + 8));
    }
    return grams;
  };
  const leftGrams = buildGrams(left);
  const rightGrams = buildGrams(right);
  if (!leftGrams.size || !rightGrams.size) return 0;
  let shared = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) shared += 1;
  }
  return shared / Math.max(1, Math.min(leftGrams.size, rightGrams.size));
}

function buildRerollGenerationGuard(nonce: string, previousResponse: string): string {
  return [
    '重roll末尾强约束：本轮是玩家主动要求重写上一版回复。',
    `重roll nonce: ${nonce}`,
    '事实起点、玩家输入和可用上下文保持一致，但正文表达路径必须明显不同。',
    '必须更换开场镜头、段落推进顺序、对白切入、收尾钩子和行动选项写法；不得复用上一版前三句、连续短语、变量草稿句式或相同结尾。',
    '如果上一版以旁白开场，本版优先从角色动作或短对白开场；如果上一版以对白开场，本版优先从环境、动作或感官细节切入。',
    '仍必须输出完整合法的 NarrativeTurn JSON，不得因为重roll省略任何根字段。',
    previousResponse
      ? `上一版回复摘录（只用于避重复，不是当前事实）：${compactForRerollInstruction(previousResponse)}`
      : '',
  ].filter(Boolean).join('\n');
}

function buildRerollSimilarityRetryGuard(previousResponse: string, similarity: number): string {
  return [
    '重roll自动换写：上一版重roll结果与被替换回复过于相似。',
    `相似度：${Math.round(similarity * 100)}%。`,
    '请完全换一种写法重写本回合：',
    '- 保留事实起点和玩家输入，但更换开场镜头、行动顺序、对白切入、句式和收束钩子。',
    '- 不得复用上一版连续短语、段落结构、对白顺序或相同结尾。',
    '- 若上一版以旁白开场，本版优先以 NPC 动作或一句短对白开场；若上一版以对白开场，本版优先以环境或动作开场。',
    '- 仍必须输出完整合法的 NarrativeTurn JSON，不得省略任何根字段。',
    previousResponse
      ? `被替换回复摘录（只用于避重复）：${compactForRerollInstruction(previousResponse)}`
      : '',
  ].filter(Boolean).join('\n');
}

export async function executeSendWorkflow(
  userInput: string,
  deps: SendWorkflowDeps,
): Promise<void> {
  const { state } = deps;
  const rawConfig = deps.getActiveConfig();
  if (!rawConfig) {
    alert('请先在设置中配置API');
    return;
  }
  const config = rawConfig;
  const mainStoryConfig = config;
  const isOpeningSystemTrigger = state.turnCount === 1 && userInput.startsWith('[系统]');
  const openingInstruction =
    '请根据当前角色、当前场景、世界书与内置提示词，直接生成第 0 回合开场叙事。不要等待玩家再次输入。';

  const isAwakeningEnterTrigger = userInput === '[系统] 踏入元素回响';
  let effectiveWorld: typeof state.世界 = state.世界;
  if (isAwakeningEnterTrigger && state.世界.元素回响邀请) {
    const entered = enterElementalEcho({
      ...state.世界,
      元素回响邀请: state.世界.元素回响邀请,
      进行中元素回响: state.世界.进行中元素回响 ?? '',
    });
    effectiveWorld = {
      ...entered,
      元素回响邀请: undefined,
      进行中元素回响: entered.进行中元素回响 as ElementId,
    };
  }
  const awakeningElementId = isAwakeningEnterTrigger ? effectiveWorld.进行中元素回响 : undefined;
  const awakeningInstruction = awakeningElementId
    ? `玩家选择进入元素回响（元素 ID: ${awakeningElementId}）。请按 elementalEcho 流程生成三道诘问，不要推进主剧情。`
    : '';

  // Abort previous request
  state.abortControllerRef.current?.abort();
  const abortController = new AbortController();
  state.abortControllerRef.current = abortController;
  const isCurrentWorkflow = () => state.abortControllerRef.current === abortController;
  const assertWorkflowActive = () => {
    if (abortController.signal.aborted || !isCurrentWorkflow()) {
      throw new DOMException('Workflow aborted', 'AbortError');
    }
  };

  deps.onBeforeSend();
  state.setLoading(true);
  setStreamingMessage('');
  state.setWorkflowHint('世界树召回 / 图鉴检索中');
  state.setWorkflowStatus('searching');
  state.setLiveRecallSummary('图鉴召回：检索中\n世界树召回：检索中');
  state.setLiveRecallFullContent('');
  pushQueueTask(state, 'main_story', 'pending', { detail: '正在调用主剧情模型。', cancellable: true });
  let pendingVariableStarted = false;
  let keepWorkflowHint = false;
  let rollbackHistoryOnAbort = state.chatHistory;
  let rollbackSnapshotOnAbort: 回合快照 | null = null;
  let visibilityPublisher: VisibilityBufferedPublisher | null = null;
  // Declared outside the stream setup so finally can always cancel a pending rAF commit.
  const streamMessageSetter = createRafCoalescedSetter(setStreamingMessage);
  let recoveryJournal = createWorkflowRecoveryJournal(userInput, state.turnCount);

  const startTime = Date.now();

  try {
    await persistWorkflowRecoveryJournal(recoveryJournal);

    // 0. 本回合 user 发送之前的全状态快照，留给 reroll 回滚用。
    //    避免重 roll 时上次的变量副作用堆叠（NPC / 蒸汽鸟报等都会双份）。
    const preTurnSnapshot = compactPreTurnSnapshot({
      旅人: state.旅人,
      背包: state.背包,
      世界: effectiveWorld,
      记忆: state.记忆,
      世界树: state.世界树,
      图鉴: state.图鉴,
      手机: state.手机,
      NPC: state.NPC,
      相册: state.相册,
      蒸汽鸟报: state.蒸汽鸟报,
      剧情: state.剧情,
      剧情编织: state.剧情编织,
      variableBatches: state.variableBatches,
      queueTasks: state.queueTasks,
      turnCount: state.turnCount,
      pendingOpeningTrigger: state.pendingOpeningTrigger,
    });
    rollbackSnapshotOnAbort = preTurnSnapshot;

    // 1. Add user message。同时把过往 assistant 上的 snapshot 全部清掉，只保留即将生成的最新一条，
    //    避免存档无限膨胀（snapshot 只服务"最近一次 reroll"，老的没用）。
    //    同时把 preTurnSnapshot 也挂到 user 消息上，这样主剧情生成失败（没有 assistant 消息）时，
    //    重roll 仍能找到快照回滚，不会误回退到上一回合。
    const userMsg = 创建聊天消息('user', userInput, {
      gameTime: `${state.turnCount}`,
      preTurnSnapshot,
    });
    recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, { userMessageId: userMsg.id });
    await persistWorkflowRecoveryJournal(recoveryJournal);
    const purgedHistory = compactChatHistoryForLongSession(state.chatHistory.map((m) =>
      m.role === 'assistant' && m.preTurnSnapshot
        ? { ...m, preTurnSnapshot: undefined }
        : m,
    ));
    rollbackHistoryOnAbort = purgedHistory;
    const updatedHistory = [...purgedHistory, userMsg];
    state.setChatHistory(updatedHistory);

    // 2. Build system prompt
    const currentScope: 'opening' | 'main' | 'elementalEcho' = effectiveWorld.进行中元素回响
      ? 'elementalEcho'
      : state.turnCount === 1
        ? 'opening'
        : 'main';
    const awakeningPhase: 'question' | 'judgement' | undefined = effectiveWorld.进行中元素回响
      ? (isAwakeningEnterTrigger ? 'question' : 'judgement')
      : undefined;
    const openingArchiveText = 格式化开局档案上下文(effectiveWorld.开局档案);
    const worldbookCtx = {
      recentUserInput: userInput,
      recentAIResponse: '',
      worldName: effectiveWorld.当前时段?.名称 ?? '',
      travelerName: state.旅人.姓名,
      turnCount: state.turnCount,
      startScenarioId: effectiveWorld.起航之地ID,
      startSceneName: effectiveWorld.开局档案?.章节锚点名称 ?? effectiveWorld.当前地点,
      currentLocation: effectiveWorld.当前地点,
      openingRegionName: effectiveWorld.开局档案?.地区名称,
      openingChapterName: effectiveWorld.开局档案?.章节锚点名称,
      openingEntryText: effectiveWorld.开局档案?.玩家介入原文,
      openingSource: effectiveWorld.开局档案?.来源,
      openingArchiveText,
      npcNames: getCodexNpcNamesForTurn({
        world: effectiveWorld,
        npcs: state.NPC,
        history: updatedHistory,
        userInput,
        turnCount: state.turnCount,
      }),
      originalProtagonist: effectiveWorld.原著主角,
      currentScope,
      // 当前剧情模式，用于按 storyModeGate 过滤主线世界书（4 选 1）
      storyMode: effectiveWorld.剧情模式,
      canonTrack: state.game.原著轨道,
      // Phase 7.1：世界书扫描扩展（消息历史 + 触发状态）
      recentMessages: updatedHistory
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .filter(Boolean)
        .slice(-100),
      messageCount: state.turnCount,
      worldbookTriggerStates: state.gameSettings.worldbookTriggerStates,
    };
    const anticipatedCodexNpcNames = getAnticipatedNpcNamesForTurn({
      world: effectiveWorld,
      history: updatedHistory,
      userInput,
      npcRecords: state.NPC,
    });
    const immediateStoryReviewForCodex = !isOpeningSystemTrigger ? buildImmediateStoryReview(updatedHistory) : '';
    const latestCodexStoryPlan = [...updatedHistory]
      .reverse()
      .find((message) => message.role === 'assistant' && message.parsedResponse?.continuation.summary.trim())
      ?.parsedResponse?.continuation.summary.trim();
    const storyWeavingDiagnostics = state.gameSettings.剧情编织系统?.enabled && state.gameSettings.剧情编织系统.currentWindow
      ? getStoryWeavingInjectionDiagnostics(state.剧情编织)
      : null;
    const codexSceneContext = {
      ...worldbookCtx,
      startScenarioId: undefined,
      startSceneName: undefined,
      currentLocation: undefined,
      npcNames: [],
      presentNpcNamesForFallback: worldbookCtx.npcNames,
      anticipatedNpcNames: anticipatedCodexNpcNames,
      aiSupplementHints: {
        currentLocation: effectiveWorld.当前地点,
        presentNpcNames: worldbookCtx.npcNames,
        immediateStoryReview: immediateStoryReviewForCodex,
        storyPlan: [
          latestCodexStoryPlan,
          storyWeavingDiagnostics
            ? `当前剧情段：${storyWeavingDiagnostics.当前分段标题}；下一段预热：${storyWeavingDiagnostics.下一分段标题 || '无'}`
            : '',
        ].filter(Boolean).join('\n'),
        openingArchiveText,
      },
    };
    const recallQuery = buildMainRecallQuery({
      userInput,
      history: updatedHistory,
      currentLocation: effectiveWorld.当前地点,
      npcNames: worldbookCtx.npcNames,
    });
    const codexRecallQuery = buildCodexKeywordRecallQuery({
      userInput,
      history: updatedHistory,
    });
    let steambirdForPrompt = state.蒸汽鸟报;
    let openingSteambirdForSave: SteambirdNews | null = null;
    let openingSteambirdPreprocessed = false;
    if (isOpeningSystemTrigger && state.gameSettings.蒸汽鸟报系统?.enabled && state.gameSettings.蒸汽鸟报系统?.autoGenerate) {
      pushQueueTask(state, 'steambird', 'pending', {
        detail: '开局前正在先处理一次蒸汽鸟报，用作首回合世界背景。',
        cancellable: true,
      });
      try {
        const openingProtagonist = formatOriginalProtagonistForOpening(effectiveWorld.原著主角);
        const openingArchive = effectiveWorld.开局档案;
        const openingPressure = openingArchive?.整理档案?.特别要求?.length
          ? openingArchive.整理档案.特别要求.join('；')
          : openingArchive?.章节参考说明 || effectiveWorld.当前地点 || '当前开局地区';
        const openingSteambirdBody = [
          `开局初始化：当前开局为${openingArchive?.地区名称 ?? effectiveWorld.当前地点 ?? '未知地区'}「${openingArchive?.章节锚点名称 ?? effectiveWorld.起航之地ID ?? '未命名章节'}」。`,
          `章节参考：${openingArchive?.章节参考说明 ?? '按当前开局档案和世界状态生成首回合世界事件苗头。'}`,
          `开局压力：${openingPressure}`,
          openingArchive?.玩家介入原文 ? `玩家介入：${openingArchive.玩家介入原文}` : '',
          `原著主角配置：${openingProtagonist}`,
        ].filter(Boolean).join('\n');
        const preSteambird = runSteambirdGenerationStep({
          current: state.蒸汽鸟报,
          publicFacts: [{ title: `${openingArchive?.地区名称 ?? effectiveWorld.当前地点 ?? '当前地区'}开局见闻`, detail: openingSteambirdBody }],
          turnCount: state.turnCount + 1,
        });
        assertWorkflowActive();
        if (preSteambird?.changed) state.set蒸汽鸟报(preSteambird.steambird);
        openingSteambirdPreprocessed = true;
        steambirdForPrompt = preSteambird?.steambird ?? state.蒸汽鸟报;
        openingSteambirdForSave = preSteambird?.steambird ?? null;
        pushQueueTask(state, 'steambird', 'success', {
          detail: preSteambird?.changed
            ? `开局蒸汽鸟报预处理完成，当前 ${preSteambird.steambird.articles.length} 篇报道。`
            : preSteambird
              ? '开局蒸汽鸟报预处理完成，但本轮没有可写报道变化。'
              : '开局蒸汽鸟报预处理未生成可用结果。',
        });
      } catch (err) {
        pushQueueTask(state, 'steambird', 'failed', {
          detail: err instanceof Error ? err.message : '开局蒸汽鸟报预处理失败。',
          failCount: state.gameSettings.蒸汽鸟报系统?.api.retryCount ?? 1,
        });
      }
    }
    const irminsulEnabled = state.gameSettings.记忆系统?.世界树启用 !== false;
    const irminsulRecallEnabled = irminsulEnabled && !isOpeningSystemTrigger && (state.gameSettings.记忆系统?.世界树召回最早触发回合 ?? 10) < state.turnCount;
    const codexRecallEnabled = !isOpeningSystemTrigger && !!(state.gameSettings.图鉴系统?.enabled && state.图鉴 && worldbookCtx.recentUserInput);
    const codexAiSupplementEnabled = codexRecallEnabled && state.gameSettings.图鉴系统?.enableAiSupplement === true;
    const storyWeavingGate = state.gameSettings.剧情编织系统?.enabled && state.gameSettings.剧情编织系统.currentWindow
      ? evaluateStoryWeavingGate(state.剧情编织, worldbookCtx)
      : null;
    pushQueueTask(state, 'irminsul', irminsulRecallEnabled ? 'pending' : 'skipped', {
      detail: irminsulRecallEnabled ? '正在检索世界树记忆档案。' : '未到世界树召回回合，已跳过。',
      cancellable: irminsulRecallEnabled,
    });
    const irminsulEntries = irminsulRecallEnabled && recallQuery
      ? retrieveIrminsulEntries(state.世界树, recallQuery, state.gameSettings.记忆系统?.世界树召回条数 ?? 8)
      : [];
    const irminsulPreview = irminsulEntries.length ? {
      entries: irminsulEntries,
      strongEntries: irminsulEntries,
      weakEntries: [],
      previewText: irminsulEntries.map((entry) => entry.title).join('、'),
      injection: irminsulEntries.map((entry) => entry.summary).filter(Boolean).join('\n\n'),
      usedModel: false,
    } : null;
    const codexPreview = codexRecallEnabled
      ? retrieveCodexEntries(
          state.图鉴,
          codexRecallQuery,
          state.gameSettings.图鉴系统?.maxRelatedEntries ?? 创建默认图鉴系统设置().maxRelatedEntries,
        )
      : null;
    assertWorkflowActive();
    const recallSummaryForTurn = [
      formatCodexRecallSummary(codexPreview),
      formatIrminsulRecallSummary(irminsulPreview?.previewText),
    ].join('\n');
    const recallFullContentForTurn = [
      codexPreview?.injection ? ['【图鉴完整召回】', codexPreview.injection].join('\n') : '',
      irminsulPreview?.injection ? ['【记忆完整召回】', irminsulPreview.injection].join('\n') : '',
    ].filter(Boolean).join('\n\n');
    state.setLiveRecallSummary(recallSummaryForTurn);
    state.setLiveRecallFullContent(recallFullContentForTurn);
    const memoryHint = isOpeningSystemTrigger
      ? '开局专用上下文已注入：角色 / 场景 / 切入说明 / 开局世界书 / 原生开场叙事'
      : irminsulPreview?.injection
      ? `剧情回忆已命中，已暂停普通短中长期记忆注入：强 ${irminsulPreview.strongEntries?.length ?? 0} 条 / 弱 ${irminsulPreview.weakEntries?.length ?? 0} 条`
      : state.gameSettings.enableMemoryInjection
      ? `记忆上下文已注入：短期 ${state.记忆.短期记忆.length} 条 / 中期 ${(state.记忆.中期记忆 ?? []).length} 条 / 长期 ${state.记忆.长期记忆.length} 条；即时缓存 ${state.记忆.即时记忆.length} 条仅用于后续压缩`
      : '记忆上下文已跳过';
    const irminsulHint = !irminsulEnabled
      ? '世界树召回已关闭'
      : irminsulPreview?.entries.length
      ? `剧情回忆已召回：强 ${irminsulPreview.strongEntries?.length ?? 0} 条 / 弱 ${irminsulPreview.weakEntries?.length ?? 0} 条`
      : irminsulRecallEnabled
        ? `世界树已召回：${state.世界树.entries.length ? '无相关档案' : '当前还没有可召回档案'}`
        : `世界树已召回：未到第${(state.gameSettings.记忆系统?.世界树召回最早触发回合 ?? 10) + 1}回合`;
    const codexHint = state.gameSettings.图鉴系统?.enabled
      ? `图鉴内容已注入（${codexAiSupplementEnabled ? '关键词 + AI 补充' : '仅正文关键词'}）：${
          codexPreview?.entries.length
            ? codexPreview.entries.slice(0, 2).map((entry) => entry.name).join('、')
            : '无相关条目'
        }`
      : '图鉴已跳过';
    state.setWorkflowHint(isOpeningSystemTrigger ? memoryHint : `${memoryHint} · ${irminsulHint} · ${codexHint}`);
    state.setWorkflowStatus('done');
    const immediateStoryReview = !isOpeningSystemTrigger ? buildImmediateStoryReview(updatedHistory) : '';
    const storyRecallInjection = [
      immediateStoryReview
        ? ['# 即时剧情回顾', '', '【即时剧情回顾】', immediateStoryReview].join('\n')
        : '',
      irminsulPreview?.injection ?? '',
    ].filter((item) => item.trim()).join('\n\n');
    const npcLedgerSelection = !isOpeningSystemTrigger
      ? selectNpcLedgersForTurn({
          records: state.NPC,
          turnCount: state.turnCount,
          explicitNames: worldbookCtx.npcNames,
          sceneNames: effectiveWorld.当前时段?.人物?.map((npc) => npc.姓名),
          recalledNames: worldbookCtx.npcNames,
        })
      : undefined;
    const currentTriggerType = deps.rerollContext
      ? 'swipe'
      : isOpeningSystemTrigger
        ? 'opening'
        : 'normal';

    // ST 预设兼容：宏引擎上下文。
    // local 每回合重置；global 从 settings 读取副本（避免直接 mutate state）。
    // 处理完后若 global 变化，回写到 settings.macroGlobalVars 实现跨会话持久化。
    const prevGlobalSnapshot = state.gameSettings.macroGlobalVars ?? {};
    // 组装游戏状态快照供 ST 标准宏使用（{{char}}/{{user}}/{{lastMessage}} 等）
    const lastMsg = updatedHistory[updatedHistory.length - 1];
    const lastUserMsg = [...updatedHistory].reverse().find((m) => m.role === 'user');
    const lastAssistantMsg = [...updatedHistory].reverse().find((m) => m.role === 'assistant');
    const macroGameState: MacroGameState = {
      charName: state.旅人.姓名 || state.旅人.别名 || '无名旅者',
      userName: state.旅人.姓名 || '无名旅者',
      lastMessage: lastMsg?.content ?? '',
      lastUserMessage: lastUserMsg?.content ?? '',
      lastCharMessage: lastAssistantMsg?.content ?? '',
      messageCount: updatedHistory.length,
      turnCount: state.turnCount,
      modelName: mainStoryConfig.model,
      maxContext: mainStoryConfig.maxContext,
    };
    const macroCtx: MacroContext = createMacroContext(prevGlobalSnapshot, macroGameState);

    const builtPrompt = isOpeningSystemTrigger
      ? buildOpeningSystemPrompt(
          state.旅人,
          effectiveWorld,
          state.gameSettings,
          state.turnCount,
          state.worldbooks,
          worldbookCtx,
          steambirdForPrompt,
          currentTriggerType,
          macroCtx,
          state.任务,
        )
      : buildSystemPrompt(
          state.旅人,
          effectiveWorld,
          state.记忆,
          state.gameSettings,
          state.turnCount,
          state.worldbooks,
          worldbookCtx,
          state.NPC,
          state.蒸汽鸟报,
          state.剧情,
          state.剧情编织,
          state.图鉴,
          state.世界树,
          state.手机,
          awakeningPhase,
          storyRecallInjection || (irminsulRecallEnabled ? '' : undefined),
          codexRecallEnabled ? (codexPreview?.injection ?? '') : undefined,
          Boolean(irminsulPreview?.injection),
          npcLedgerSelection,
          currentTriggerType,
          macroCtx,
          state.任务,
          state.背包,
        );

    // 宏引擎处理后回写 globalVars（仅当 global 变化时）
    if (Object.keys(macroCtx.global).length !== Object.keys(prevGlobalSnapshot).length
      || Object.entries(macroCtx.global).some(([k, v]) => prevGlobalSnapshot[k] !== v)) {
      state.setGameSettings((prev) => ({ ...prev, macroGlobalVars: { ...macroCtx.global } }));
    }

    // Phase 7.1：本回合世界书注入完成后，回写触发状态表（用于 delay / cooldown 判断）。
    // 必须在 buildSystemPrompt 之后调用，保证本回合 cooldown 检查用的是上一回合的状态。
    const nextTriggerStates = updateTriggerStatesAfterTurn(state.worldbooks, worldbookCtx);
    if (nextTriggerStates !== state.gameSettings.worldbookTriggerStates) {
      state.setGameSettings((prev) => ({ ...prev, worldbookTriggerStates: nextTriggerStates }));
    }
    let systemPrompt = builtPrompt.systemPrompt;
    // 天气判断 prompt 注入
    const 天气片断 = 构建天气Prompt片段(effectiveWorld.当前地点, effectiveWorld.当前天气);
    systemPrompt = systemPrompt + '\n\n' + 天气片断;
    // G1：场面元素状态一致性提示（追加在末尾，保持缓存前缀稳定）。
    const elementalSection = buildElementalFieldPromptSection(state.game.叙事.元素场面, state.game.叙事.元素事件);
    if (elementalSection) {
      systemPrompt = systemPrompt + '\n\n' + elementalSection;
    }
    // Phase 4: In-Chat depth 注入。非 system 角色的模块消息按 depth 插入聊天历史。
    const moduleChatMessages = builtPrompt.chatModuleMessages;
    // 内置酒馆预设按需加载：正文使用前确保预设 JSON 已就位（带缓存，仅首次真正 fetch）。
    await loadAllBuiltinTavernPresets();
    const currentPresetV2 = getCurrentSTPresetV2(state.gameSettings, getBuiltinPresetsV2());
    const shouldTryTavernV2 =
      state.gameSettings.enableStPreset !== false &&
      Boolean(currentPresetV2?.preset?.prompts?.length) &&
      Boolean(currentPresetV2?.preset?.prompt_order?.length);
    let tavernV2Messages: 聊天消息[] | null = null;
    let tavernV2Error: unknown = null;
    const recentHistory = getMainHistoryWindow(updatedHistory, state.gameSettings, state.记忆);
    const tavernHistory = recentHistory.filter((msg) => msg.id !== userMsg.id);
    if (deps.rerollContext && !isOpeningSystemTrigger) {
      systemPrompt = [
        systemPrompt,
        '',
        '# 重roll生成约束',
        `本次请求是玩家对上一版回复的重roll。重roll nonce: ${deps.rerollContext.nonce}`,
        '必须基于同一事实起点重新组织镜头、描写、对话和节奏；禁止复用上一版回复的具体段落、句式、变量草稿或行动选项。',
        '开场方式、对白切入、段落顺序和结尾钩子都要换；不要复用上一版前三句、连续短语或相同收束。',
        '可以保留必要事实一致性，但正文展开方式必须明显不同；如果上一版已经处理某事件，本次不得因为重roll而把旧副作用当作已发生事实。',
        deps.rerollContext.previousResponse
          ? `上一版回复摘录（仅用于避重复，不是当前事实）：${compactForRerollInstruction(deps.rerollContext.previousResponse)}`
          : '',
      ].filter(Boolean).join('\n');
    }

    if (shouldTryTavernV2 && currentPresetV2) {
      try {
        const latestTavernInput = isOpeningSystemTrigger
          ? openingInstruction
          : isAwakeningEnterTrigger
            ? awakeningInstruction
            : userInput;
        tavernV2Messages = buildTavernMessageChain({
          settings: state.gameSettings,
          preset: currentPresetV2.preset,
          characterId: state.gameSettings.currentStCharacterId ?? currentPresetV2.characterId ?? null,
          chatHistory: tavernHistory,
          latestUserInput: latestTavernInput,
          playerName: state.旅人.姓名 || state.旅人.别名 || '无名旅者',
          playerRole: state.旅人,
          includeNativeContextInWorldbook: false,
          includeNativeNarrative: false,
          triggerType: currentTriggerType,
          macroCtx,
        }).map((msg) => 创建聊天消息(msg.role, msg.content));
        if (tavernV2Messages.length === 0) {
          tavernV2Messages = null;
          tavernV2Error = new Error('ST V2 消息链为空，已回退 legacy 主剧情路径');
          console.warn('[ST V2] 消息链为空，已回退 legacy 主剧情路径');
        }
      } catch (error) {
        tavernV2Messages = null;
        tavernV2Error = error;
        console.warn('[ST V2] 消息链构建失败，已回退 legacy 主剧情路径', error);
      }
    }

    // 3. Prepare messages for API
    const apiMessages: 聊天消息[] = [];
    if (tavernV2Messages) {
      apiMessages.push(...tavernV2Messages);
    } else {
      for (const msg of recentHistory) {
        // 跳过 [系统] 触发消息，避免污染 AI 上下文
        if (msg.role === 'user' && msg.content.startsWith('[系统]')) {
          continue;
        }
        if (msg.role === 'user') {
          apiMessages.push(msg);
        } else if (msg.role === 'assistant' && msg.parsedResponse) {
          apiMessages.push(创建聊天消息('assistant', buildLeanAssistantHistoryContent(msg)));
        }
      }
      if (isOpeningSystemTrigger) {
        apiMessages.push(创建聊天消息('user', openingInstruction));
      }
      // [系统] 触发被 API 过滤 → 必须额外推一条真实指令,否则 AI 收到空白消息直接卡住。
      if (isAwakeningEnterTrigger && awakeningInstruction) {
        apiMessages.push(创建聊天消息('user', awakeningInstruction));
      }
    }
    // 回应回合追加系统级提醒，强化正式元素回响结果事实。
    if (awakeningPhase === 'judgement') {
      apiMessages.push(
        创建聊天消息(
          'user',
          '⚠ 元素回响·回应回合：最终只输出 NarrativeTurn JSON。在 body 中加入 text 明确包含“共鸣深化”的可见 system 块，并在 factCandidates 中加入 {"domain":"system","fact":"elemental_echo_result:共鸣深化","evidence":"共鸣深化"}；让元素回应玩家的选择，再把旅行者带回现实场景。',
        ),
      );
    }

    const deepSeekMainMode = state.gameSettings.deepSeekMainMode ?? 'off';
    const deepSeekMainActive = isDeepSeekMainConfig(mainStoryConfig) && deepSeekMainMode !== 'off';
    const deepSeekLockFormat = deepSeekMainActive && deepSeekMainMode === 'lock_format';
    const shouldUseCotFakeHistory =
      state.gameSettings.enableCotFakeHistory && !isOpeningSystemTrigger && !deepSeekMainActive;

    // Phase 4/7：从当前激活预设读取 assistant prefill
    // 正式 JSON 合同不使用 DeepSeek assistant prefill，避免缺少 JSON 起始字符。
    const currentPresetId = state.gameSettings.currentStPresetId;
    const allPresets = [
      ...getBuiltinPresets(),
      ...(state.gameSettings.stPresets ?? []),
    ];
    const currentPreset = currentPresetId
      ? allPresets.find((p) => p.id === currentPresetId)
      : undefined;
    const presetAssistantPrefill = currentPreset?.assistantPrefill;
    const usePresetPrefill = false;
    const effectivePrefixMode = false;
    const effectivePrefixContent = '';

    if (deepSeekMainActive) {
      apiMessages.push(创建聊天消息('user', DEEPSEEK_MAIN_FORMAT_GUARD));
    }
    if (deps.rerollContext && !isOpeningSystemTrigger) {
      apiMessages.push(创建聊天消息(
        'user',
        buildRerollGenerationGuard(deps.rerollContext.nonce, deps.rerollContext.previousResponse),
      ));
    }

    // 区E执法块(结构轮): 主剧情普通回合的最后一条 user 消息。开局/狭间评判/ST V2 消息链回合跳过
    // (各有自己的收尾协议)。
    if (!isOpeningSystemTrigger && !tavernV2Messages && awakeningPhase !== 'judgement') {
      apiMessages.push(创建聊天消息('user', buildTurnEnforcementBlock({
        playerName: state.旅人.姓名 || state.旅人.别名 || '无名旅者',
        wordCountTarget: state.gameSettings.wordCountTarget,
        codexEntries: codexPreview?.entries,
        storyWeavingActive: Boolean(state.gameSettings.剧情编织系统?.enabled && state.gameSettings.剧情编织系统.currentWindow),
      })));
    }

    // 3b. 格式伪历史注入：在消息序列最前面塞一对 user/assistant，提供最小合法 NarrativeTurn 范例。
    //     DeepSeek 专用模式下不注入这段伪装续聊，避免污染真实 user 输入并降低格式漂移。
    if (shouldUseCotFakeHistory) {
      apiMessages.unshift(
        创建聊天消息('user', NARRATIVE_TURN_EXAMPLE_USER),
        创建聊天消息('assistant', NARRATIVE_TURN_EXAMPLE_ASSISTANT),
      );
    }

    // 3c. ST 预设兼容：In-Chat depth 注入。
    //     injectionPosition=1 的模块按 injectionDepth 插入聊天历史。
    //     depth=0 末尾后，depth=1 末尾前，依此类推。
    //     Claude 方案 D：Claude 下 normalizeClaudeMessages 会抽取所有 system 消息到顶层，
    //     所以 Claude 下跳过 depth 注入。user/assistant 角色的 depth 模块追加到 systemPrompt 尾部。
    //     兜底：injectionPosition=0 的 user/assistant 模块（ST 预设很少用）也追加到 systemPrompt，
    //     避免内容丢失。
    //
    // 方案 B + C（v3 计划）：position 分流规则
    //   - position=0 + system role → 进 systemSection（在 injectPromptModules 里处理）
    //   - position=0 + user/assistant role → 追加 systemPrompt 尾部（方案 B，下方分支）
    //     简化处理：ST 语义里 position=0 + depth>0 表示插入 systemPrompt 中段，
    //     但我们的 systemPrompt 是字符串拼接，无法精确插入中段，统一追加到尾部。
    //     ST 预设中 position=0 + user/assistant + depth>0 极罕见，此简化可接受。
    //   - position=1 + user/assistant role（非 Claude）→ depth 注入（方案 C，下方分支）
    //   - position=1 + user/assistant role（Claude）→ 追加 systemPrompt 尾部（Claude 方案 D）
    if (moduleChatMessages.length > 0) {
      // 方案 B：injectionPosition=0 的 user/assistant 消息追加到 systemPrompt 尾部
      const positionZeroMessages = moduleChatMessages
        .filter((m) => m._injectionPosition === 0)
        .sort((a, b) => (a._injectionOrder ?? 0) - (b._injectionOrder ?? 0));
      if (positionZeroMessages.length > 0) {
        const fallbackText = positionZeroMessages.map((m) => m.content).join('\n\n---\n\n');
        systemPrompt = systemPrompt + '\n\n---\n\n' + fallbackText;
      }

      if (mainStoryConfig.provider !== 'claude') {
        // 方案 C：非 Claude 走 depth 注入，按 depth 降序 splice 到 apiMessages
        // 降序是为了避免 splice 时索引偏移（先插后面的再插前面的）
        const depthMessages = moduleChatMessages
          .filter((m) => m._injectionPosition === 1)
          .sort((a, b) => (b._injectionDepth ?? 0) - (a._injectionDepth ?? 0));
        for (const msg of depthMessages) {
          const depth = msg._injectionDepth ?? 0;
          const insertIndex = Math.max(0, apiMessages.length - depth);
          apiMessages.splice(insertIndex, 0, 创建聊天消息(msg.role as 'user' | 'assistant', msg.content));
        }
      } else {
        // Claude 方案 D：depth 模块退回 systemPrompt 拼接
        const fallbackMessages = moduleChatMessages
          .filter((m) => m._injectionPosition === 1)
          .sort((a, b) => (a._injectionOrder ?? 0) - (b._injectionOrder ?? 0));
        if (fallbackMessages.length > 0) {
          const fallbackText = fallbackMessages.map((m) => m.content).join('\n\n---\n\n');
          systemPrompt = systemPrompt + '\n\n---\n\n' + fallbackText;
        }
      }
    }

    const shouldStreamMainRequest = state.gameSettings.enableStreaming && !isPageHidden();
    const mainRequestMode: 'stream' | 'non-stream' = shouldStreamMainRequest ? 'stream' : 'non-stream';

    // 4. Stream AI response（含自动重试循环）
    let streamedText = '';
    let streamEventCount = 0;
    let previewText = '';
    let previewEpoch = 0;
    let previewChain: Promise<void> = Promise.resolve();
    visibilityPublisher = typeof document === 'undefined'
      ? null
      : createVisibilityBufferedPublisher({
          source: createDocumentVisibilitySource(document),
          commit: (text) => {
            previewEpoch += 1;
            previewText = text;
            streamMessageSetter.flush(text);
          },
        });
    let result: Awaited<ReturnType<typeof sendChatMessage>>;
    const configuredMaxAttempts = state.gameSettings.autoRetryOnError
      ? Math.max(1, state.gameSettings.autoRetryCount) + 1
      : 1;
    const hasRequiredParty = getMissingPartyMembers('', state.NPC).length > 0;
    const maxAttempts = (deepSeekMainActive || deps.rerollContext || hasRequiredParty) ? Math.max(2, configuredMaxAttempts) : configuredMaxAttempts;
    let lastErr: unknown = null;
    let deepSeekProtocolIssuesForTurn: string[] = [];
    let rerollSimilarityForTurn: number | undefined;
    let rerollSimilarityRetried = false;
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt++;
      streamedText = '';
      streamEventCount = 0;
      previewText = '';
      previewEpoch += 1;
      previewChain = Promise.resolve();
      streamMessageSetter.flush('');
      try {
        result = await sendChatMessage(mainStoryConfig, {
          messages: apiMessages,
          systemPrompt,
          onDelta: (delta) => {
            streamedText += delta;
            if (!state.gameSettings.enableStreaming) {
              streamMessageSetter.set(streamedText);
              return;
            }
            if (visibilityPublisher?.bufferWhenHidden(streamedText)) {
              previewEpoch += 1;
              previewText = streamedText;
              return;
            }
            streamEventCount += 1;
            const deltaPreviewEpoch = previewEpoch;
            previewChain = previewChain.then(async () => {
              const chunks = splitStreamingReveal(delta);
              for (const chunk of chunks) {
                if (abortController.signal.aborted || deltaPreviewEpoch !== previewEpoch) return;
                if (isPageHidden()) {
                  previewEpoch += 1;
                  previewText = streamedText;
                  visibilityPublisher?.bufferWhenHidden(streamedText);
                  return;
                }
                previewText += chunk;
                streamMessageSetter.set(previewText);
                await waitStreamingPreviewDelay(14, abortController.signal);
                if (isPageHidden()) {
                  previewEpoch += 1;
                  previewText = streamedText;
                  visibilityPublisher?.bufferWhenHidden(streamedText);
                  return;
                }
              }
            });
          },
          signal: abortController.signal,
          streaming: shouldStreamMainRequest,
          prefixMode: effectivePrefixMode,
          prefixContent: effectivePrefixContent,
          // Phase 3：透传 API 配置的采样参数（支持 ST 预设同步过来的高级参数）
          topP: mainStoryConfig.topP,
          topK: mainStoryConfig.topK,
          topA: mainStoryConfig.topA,
          minP: mainStoryConfig.minP,
          repetitionPenalty: mainStoryConfig.repetitionPenalty,
          frequencyPenalty: mainStoryConfig.frequencyPenalty,
          presencePenalty: mainStoryConfig.presencePenalty,
          maxContext: mainStoryConfig.maxContext,
        });
        if (tavernV2Messages && currentPresetV2) {
          const regexCleanup = applyTavernOutputRegexScripts(result.fullText || streamedText, currentPresetV2.preset);
          if (regexCleanup.applied.length > 0 && regexCleanup.text !== result.fullText) {
            result = {
              ...result,
              fullText: regexCleanup.text,
              parsed: parseResponse(regexCleanup.text),
            };
            streamedText = regexCleanup.text;
            console.info('[ST V2] 已执行安全输出正则清理:', regexCleanup.applied);
          }
        }
        const candidateText = narrativeTurnBodyText(result.parsed);
        // 抗空回检测：正式回合必须含至少一个可见正文块。
        const isBlankResponse = !candidateText || isEmptyResponse(result.parsed);
        if (isBlankResponse) {
          void appendApiErrorReport({
            source: '主剧情工作流',
            config: mainStoryConfig,
            requestMode: mainRequestMode,
            error: new Error(`返回空响应，触发自动重试。主剧情第 ${attempt}/${maxAttempts} 次（无可见正文块）。`),
            responseText: result.fullText || streamedText || '（空响应）',
          });
          if (attempt < Math.max(2, maxAttempts)) {
            console.warn(`[sendWorkflow] 第 ${attempt} 次返回空响应（无可见正文块），自动重试。`);
            continue;
          }
          throw new Error('AI response was empty');
        }
        const missingPartyMembers = getMissingPartyMembers(candidateText, state.NPC);
        if (missingPartyMembers.length) {
          const detail = `正文遗漏同行成员：${missingPartyMembers.join('、')}`;
          void appendApiErrorReport({
            source: '队伍完整性校验',
            config: mainStoryConfig,
            requestMode: mainRequestMode,
            error: new Error(detail),
            responseText: result.fullText || streamedText || candidateText,
          });
          if (attempt < maxAttempts) {
            apiMessages.push(创建聊天消息('user', `${detail}。请完整重写本回合，并让每位同行成员至少有一次具名发言、行动或可观察反应。仍只输出合法 NarrativeTurn JSON。`));
            pushQueueTask(state, 'main_story', 'pending', { detail: `${detail}，正在自动补写。`, failCount: attempt, retrying: true, cancellable: true });
            continue;
          }
          throw new Error(detail);
        }
        // 主剧情不再执行“截断续写”自动重试。
        // JSON 合同失败由 parseResponse 抛出稳定错误并进入整回合重试，不做 tagged fallback。
        const rerollSimilarity = deps.rerollContext
          ? calculateRerollSimilarity(candidateText, deps.rerollContext.previousResponse)
          : 0;
        if (deps.rerollContext) {
          rerollSimilarityForTurn = rerollSimilarity;
        }
        if (deps.rerollContext && rerollSimilarity >= 0.86 && attempt < maxAttempts) {
          rerollSimilarityRetried = true;
          void appendApiErrorReport({
            source: '重roll相似度校验',
            config: mainStoryConfig,
            requestMode: mainRequestMode,
            error: new Error(`主剧情第 ${attempt}/${maxAttempts} 次重roll结果与上一版过于相似，相似度 ${Math.round(rerollSimilarity * 100)}%。`),
            responseText: result.fullText || streamedText || candidateText,
          });
          apiMessages.push(创建聊天消息('user', buildRerollSimilarityRetryGuard(deps.rerollContext.previousResponse, rerollSimilarity)));
          pushQueueTask(state, 'main_story', 'pending', {
            detail: '重roll结果与上一版过于相似，正在强制换写。',
            failCount: attempt,
            retrying: true,
            cancellable: true,
          });
          console.warn(`[sendWorkflow] 第 ${attempt}/${maxAttempts} 次重roll与上一版过于相似，自动换写，相似度：${rerollSimilarity.toFixed(3)}`);
          continue;
        }
        const protocolIssues = deepSeekMainActive
          ? getDeepSeekMainProtocolIssues(result.parsed)
          : [];
        if (protocolIssues.length) {
          deepSeekProtocolIssuesForTurn = protocolIssues;
          void appendApiErrorReport({
            source: 'DeepSeek 主剧情协议校验',
            config: mainStoryConfig,
            requestMode: mainRequestMode,
            error: new Error(`主剧情第 ${attempt}/${maxAttempts} 次输出协议不完整：${protocolIssues.join('；')}`),
            responseText: result.fullText || streamedText || '（空响应）',
          });
          if (attempt < maxAttempts) {
            apiMessages.push(创建聊天消息('user', buildDeepSeekProtocolRetryGuard(protocolIssues)));
            pushQueueTask(state, 'main_story', 'pending', {
              detail: `DeepSeek 输出协议不完整，正在重试：${protocolIssues.join('；')}`,
              failCount: attempt,
              retrying: true,
              cancellable: true,
            });
            console.warn(`[sendWorkflow] DeepSeek 第 ${attempt}/${maxAttempts} 次输出协议不完整，自动重试：`, protocolIssues);
            continue;
          }
        } else if (deepSeekMainActive) {
          deepSeekProtocolIssuesForTurn = [];
        }
        lastErr = null;
        break;
      } catch (innerErr) {
        if ((innerErr as Error).name === 'AbortError' || abortController.signal.aborted) {
          throw innerErr;
        }
        lastErr = innerErr;
        const innerMessage = innerErr instanceof Error ? innerErr.message : String(innerErr ?? '');
        const alreadyReportedByApiLayer =
          innerMessage.includes('API Error') ||
          innerMessage.includes('Failed to fetch') ||
          innerMessage.includes('No response body');
        if (!alreadyReportedByApiLayer) {
          void appendApiErrorReport({
            source: '主剧情工作流',
          config: mainStoryConfig,
            requestMode: mainRequestMode,
            error: innerErr,
            responseText: streamedText || previewText || '',
          });
        }
        if (isNonRetryableAIError(innerErr) || attempt >= maxAttempts) break;
        pushQueueTask(state, 'main_story', 'pending', {
          detail: `主剧情生成失败 ${attempt} 次，正在自动重试。`,
          failCount: attempt,
          retrying: true,
          cancellable: true,
        });
        console.warn(`[sendWorkflow] 第 ${attempt}/${maxAttempts} 次尝试失败，自动重试：`, innerErr);
      }
    }
    if (lastErr) throw lastErr;
    // 进入下面流程：result 一定已被赋值（lastErr 为空意味着 break 出循环）
    result = result!;

    visibilityPublisher?.flush();

    if (abortController.signal.aborted || !isCurrentWorkflow()) return;

    // 5. Build AI message
    const duration = (Date.now() - startTime) / 1000;
    pushQueueTask(state, 'main_story', 'success', {
      detail: `正文生成完成，用时 ${Math.round(duration)}s。`,
    });
    const cleanedParsed = sanitizeParsedResponse(result.parsed, state.gameSettings.额外功能);
    const parsedBody = normalizePlayerSpeechInBody({
      body: narrativeTurnBodyText(cleanedParsed),
      playerName: state.旅人.姓名 || state.旅人.别名 || '你',
      userInput,
    });
    const finalBody = stripLeakedHistoryMetaFromBody(sanitizeContaminatedText(parsedBody, state.gameSettings.额外功能)).trim();
    const displayText = finalBody;
    if (state.gameSettings.enableStreaming) {
      if (streamEventCount > 0) {
        await previewChain;
      } else if (displayText.trim()) {
        await revealStreamingPreview(state, displayText, abortController.signal, {
          delayMs: 16,
          minChunks: 8,
        });
      }
      streamMessageSetter.flush('');
    } else {
      streamMessageSetter.cancel();
    }
    const finalBodyBlocks: NarrativeTurn['body'] = finalBody
      ? [{ kind: 'narration', text: finalBody }]
      : [];
    const parsedForDisplay: NarrativeTurn = {
      body: finalBodyBlocks,
      choices: cleanedParsed.choices.map((choice) => ({ ...choice })),
      factCandidates: revalidateFactCandidatesForBody(cleanedParsed.factCandidates, finalBodyBlocks),
      continuation: {
        summary: cleanedParsed.continuation.summary,
        unresolved: [...cleanedParsed.continuation.unresolved],
      },
    };
    const tokenUsage = buildTurnTokenUsage({
      system: 'main_story',
      apiUsage: result.usage,
      systemPrompt,
      messages: apiMessages,
      outputText: result.fullText || displayText,
      provider: config.provider,
      model: config.model,
    });
    const previousDebugContext = [...updatedHistory]
      .reverse()
      .find((msg) => msg.role === 'assistant' && msg.debugContext?.systemPrompt)?.debugContext;
    const cachePrefixDiagnostics = buildCachePrefixDiagnostics({
      enabled: state.gameSettings.enableCacheDiagnostics === true,
      systemPrompt,
      messages: apiMessages,
      previous: previousDebugContext
        ? {
            systemPrompt: previousDebugContext.systemPrompt,
            messages: previousDebugContext.messages,
          }
        : undefined,
    });
    const aiMsg = 创建聊天消息('assistant', displayText, {
      gameTime: `${state.turnCount}`,
      parsedResponse: parsedForDisplay,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      tokenUsage,
      responseDurationSec: duration,
      preTurnSnapshot,
      debugContext: {
        systemPrompt,
        messages: apiMessages.map((msg) => ({ role: msg.role, content: msg.content })),
        deepSeekMainMode: deepSeekMainActive ? deepSeekMainMode : 'off',
        deepSeekCotFakeHistorySkipped: deepSeekMainActive && state.gameSettings.enableCotFakeHistory === true,
        deepSeekPrefixMode: deepSeekLockFormat,
        deepSeekProtocolIssues: deepSeekProtocolIssuesForTurn,
        deepSeekMainOriginalModel: result.deepSeekRecovery?.originalModel,
        deepSeekMainAdaptedModel: result.deepSeekRecovery?.fallbackModel
          ?? (result.deepSeekRecovery?.initialModel !== result.deepSeekRecovery?.originalModel
            ? result.deepSeekRecovery?.initialModel
            : undefined),
        stV2Attempted: shouldTryTavernV2,
        stV2Used: Boolean(tavernV2Messages),
        stV2FallbackReason: tavernV2Error instanceof Error ? tavernV2Error.message : tavernV2Error ? String(tavernV2Error) : undefined,
        rerollSimilarity: rerollSimilarityForTurn,
        rerollSimilarityRetried,
        cachePrefixDiagnostics,
        mainRequestMode,
        recallSummary: recallSummaryForTurn,
        recallFullContent: recallFullContentForTurn,
        irminsulRecallPreview: irminsulPreview?.previewText ?? '',
        irminsulRecallRawText: '',
        irminsulRecallUsedModel: irminsulPreview?.usedModel === true,
        codexRecallPreview: formatCodexDiagnosticsPreview(codexPreview),
        codexRecallInjection: codexRecallEnabled ? (codexPreview?.injection ?? '') : '',
        codexRecallRawText: '',
        codexRecallUsedModel: false,
        npcLedgerInjection: buildNpcLedgerDebug(npcLedgerSelection),
        npcLedgerSelectionRaw: npcLedgerSelection,
        recallPreview: [
          irminsulPreview?.previewText ?? '',
          storyWeavingGate
            ? `剧情编织门禁：${storyWeavingGate.mode}｜第 ${storyWeavingGate.分段组号 ?? '?'} 段｜${storyWeavingGate.reasons.join('；') || '无命中理由'}`
            : '',
          storyWeavingDiagnostics
            ? [
              `剧情编织注入健康：${storyWeavingDiagnostics.健康状态}`,
              `剧情编织实际注入：第 ${storyWeavingDiagnostics.当前分段组号} 段「${storyWeavingDiagnostics.当前分段标题}」｜${storyWeavingDiagnostics.当前分段运行状态}`,
              storyWeavingDiagnostics.归档锚点标题 ? `已跳过归档锚点：第 ${storyWeavingDiagnostics.归档锚点组号} 段「${storyWeavingDiagnostics.归档锚点标题}」` : '',
              storyWeavingDiagnostics.前一分段标题 ? `历史承接段：${storyWeavingDiagnostics.前一分段标题}` : '',
              storyWeavingDiagnostics.下一分段标题 ? `下一段预热：${storyWeavingDiagnostics.下一分段标题}` : '',
              storyWeavingDiagnostics.检查项.length ? `注入检查：${storyWeavingDiagnostics.检查项.join('；')}` : '',
            ].filter(Boolean).join('\n')
            : '',
          formatCodexDiagnosticsPreview(codexPreview),
          formatNpcLedgerPreview(npcLedgerSelection),
        ].filter(Boolean).join('\n\n'),
      },
    });
    recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, {
      phase: 'narrative_received',
      assistantMessageId: aiMsg.id,
      pendingNarrative: parsedForDisplay,
    });
    await persistWorkflowRecoveryJournal(recoveryJournal);
    let finalHistory = [...updatedHistory, aiMsg];
    // assistant 消息已携带 preTurnSnapshot，清掉 user 消息上的，避免存档膨胀
    const userMsgIdx = finalHistory.findIndex((m) => m.id === userMsg.id);
    if (userMsgIdx >= 0 && finalHistory[userMsgIdx].preTurnSnapshot) {
      finalHistory = finalHistory.map((m, i) => i === userMsgIdx ? { ...m, preTurnSnapshot: undefined } : m);
    }
    finalHistory = compactChatHistoryForLongSession(finalHistory);
    streamMessageSetter.flush('');
    state.setLoading(false);
    state.setPendingVariable(true);
    pendingVariableStarted = true;

    // 6. Update memory
    pushQueueTask(state, 'memory', 'pending', { detail: '正在写入即时记忆并检查压缩阈值。' });
    const rawMemory = buildImmediateMemory(userInput, [
      parsedForDisplay.continuation.summary ? `本回合小结：${parsedForDisplay.continuation.summary}` : '',
      displayText,
    ].filter(Boolean).join('\n\n'));
    let mem = addImmediateMemory(state.记忆, rawMemory, state.turnCount);
    const compression = await autoCompressMemorySystemWithArchivesAsync(
      mem,
      state.turnCount,
      state.gameSettings.记忆系统 ?? 创建默认记忆系统设置(),
      config,
      abortController.signal,
    );
    assertWorkflowActive();
    mem = compression.memory;
    const irminsulWithCompression = compression.archives.reduce(upsertRecallEntry, state.世界树);
    const compressionDetail = compression.failures.length
      ? `记忆总结有 ${compression.failures.length} 批 API 失败，已保留完整失败草稿；当前回合继续使用本地 fallback。`
      : compression.usedModel
        ? '即时/短期/中期/长期记忆已调用记忆总结 API 完成整理。'
        : '即时/短期/中期/长期记忆已使用本地摘要完成整理。';
    pushQueueTask(state, 'memory', compression.failures.length ? 'failed' : 'success', {
      detail: compressionDetail,
      failCount: compression.failures.length || undefined,
      retryHint: compression.failures.length ? '打开记忆系统的“失败草稿”页重新总结。' : undefined,
    });

    // 7 / 7a / 7b. 世界 + 旅人 的本回合修改全部累计到本地变量,最后一次性 set。
    //     这样在 8.5 变量校准里能拿到这些修改作为 snapshot——否则变量模型 commit 时
    //     会用函数开始时的世界覆盖刚写入的元素回响邀请/进行中状态，
    //     表现就是「狭间邀请卡片在变量校准结束后突然消失」。
    //     worldAfter 用 effectiveWorld 初始化（进入触发已经写入进行中元素回响）。
    let worldAfter: typeof state.世界 = 归一化世界状态(effectiveWorld);
    let travelerAfter: typeof state.旅人 = state.旅人;

    // 7. 全局事件
    const worldFactCandidates = parsedForDisplay.factCandidates
      .filter((candidate) => candidate.domain === 'world' || candidate.domain === 'location' || candidate.domain === 'time')
      .map((candidate) => candidate.fact);
    if (worldFactCandidates.length) {
      worldAfter = {
        ...worldAfter,
        全局事件: appendWorldEvents(worldAfter.全局事件, worldFactCandidates),
      };
    }

    const systemFacts = parsedForDisplay.factCandidates
      .filter((candidate) => candidate.domain === 'system')
      .map((candidate) => candidate.fact);
    const inviteFact = systemFacts.find((fact) => /^elemental_echo_invite:/i.test(fact));
    // 元素回响邀请只接受正式 system fact 中的七元素 ID。
    if (inviteFact && !worldAfter.元素回响邀请 && !worldAfter.进行中元素回响) {
      const invitedRaw = inviteFact.split(':').slice(1).join(':').trim().toLowerCase();
      const invitedId = ELEMENT_IDS.includes(invitedRaw as ElementId) ? invitedRaw as ElementId : null;
      if (invitedId) {
        const target = travelerAfter.元素共鸣.find((item) => item.element === invitedId);
        if (target && canInviteElementalEcho(target)) {
          worldAfter = { ...worldAfter, 元素回响邀请: invitedId };
        } else {
          console.warn('[sendWorkflow] 元素回响邀请被忽略：目标元素未达到回响资格。', invitedId);
        }
      } else {
        console.warn('[sendWorkflow] 无法解析元素回响邀请。', inviteFact);
      }
    }

    const judgementFact = systemFacts.find((fact) => /^elemental_echo_result:/i.test(fact));
    if (judgementFact && worldAfter.进行中元素回响) {
      const elementId = worldAfter.进行中元素回响;
      const judgementRaw = judgementFact.split(':').slice(1).join(':').trim();
      const accepted = judgementRaw.includes('共鸣深化')
        || judgementRaw.includes('升阶')
        || judgementRaw.includes('突破')
        || judgementRaw.includes('确认')
        || /resonance|advance|awaken/i.test(judgementRaw);
      if (accepted) {
        try {
          const result = applyElementalEchoResult(
            travelerAfter,
            { ...worldAfter, 元素回响邀请: worldAfter.元素回响邀请 ?? '', 进行中元素回响: elementId },
            elementId,
            ELEMENTAL_ECHO_MASTERY_GAIN,
          );
          travelerAfter = result.traveler;
          worldAfter = {
            ...result.world,
            元素回响邀请: result.world.元素回响邀请
              ? result.world.元素回响邀请 as ElementId
              : undefined,
            进行中元素回响: undefined,
          };
        } catch (error) {
          console.warn('[sendWorkflow] 应用元素回响结果失败。', error);
          worldAfter = { ...worldAfter, 进行中元素回响: undefined };
        }
      } else {
        console.warn('[sendWorkflow] 无法识别元素回响结果。', judgementRaw);
      }
    }

    // 天气解析：从 AI 响应中提取 <天气> 标签，写入世界状态
    // 注意:此处 worldAfter.当前地点 仍是本回合开始前的旧地点,变量模型尚未运行。
    // 如果 AI 同回合切地点并换天气（如蒙德城→璃月港并开始降雨），用旧地点校验会误拒。
    // 因此只要天气 ID 合法(解析天气标签 已校验过中文→ID 映射)就直接接受,
    // 地点白名单仅作 prompt 引导,不强制校验。
    const rawResponseTextForTurn = result.fullText || displayText;
    const 天气 = 解析天气标签(rawResponseTextForTurn);
    if (天气) {
      if (!验证天气合法性(天气, worldAfter.当前地点)) {
        console.info('[天气] 天气与当前地点白名单不匹配，仍接受（地点可能在本回合由变量模型更新）:', 天气, '| 旧地点:', worldAfter.当前地点);
      }
      worldAfter = { ...worldAfter, 当前天气: 天气 };
    }

    result.fullText = '';
    result.parsed = createEmptyNarrativeTurn();
    result.usage = undefined;
    apiMessages.length = 0;
    systemPrompt = '';
    streamedText = '';
    previewText = '';
    tavernV2Messages = null;

    // 8.5 变量模型校准：主回复完成 → 调用独立的变量模型分析正文，把结构化命令落地。
    //     失败/超时不影响主流程，只在 console 报警。
    pushQueueTask(state, 'variable', 'pending', {
      detail: '正在调用变量模型并结算回复后的状态变化。',
    });
    const frozenSettlementState = normalizeTeyvatGameState({
      ...applyLegacyGameStateOverrides(state.game, {
        chatHistory: finalHistory,
        记忆: mem,
        世界: worldAfter,
        旅人: travelerAfter,
        turnCount: state.turnCount + 1,
      }),
      世界树: irminsulWithCompression,
      蒸汽鸟报: openingSteambirdForSave ?? state.game.蒸汽鸟报,
    });
    const settlementVariableDraft = parsedForDisplay.factCandidates.length
      ? JSON.stringify({ facts: parsedForDisplay.factCandidates })
      : undefined;
    recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, {
      phase: 'settlement_pending',
      pendingSettlement: {
        settlementId: recoveryJournal.workflowId,
        source: frozenSettlementState,
        ...(settlementVariableDraft ? { variableDraft: settlementVariableDraft } : {}),
      },
    });
    await persistWorkflowRecoveryJournal(recoveryJournal);
    const variableOverrides = await runVariableCalibrationStep({
      state,
      mainApiConfig: config,
      userInput,
      body: displayText,
      variableDraft: settlementVariableDraft,
      turnAfter: state.turnCount + 1,
      // 本回合主流程已经更新过的切片，传入保证变量模型看到最新值
      memorySystemSnapshot: mem,
      // 7/7a/7b 累积的 旅人 / 世界 也要带进去——否则校准 commit 会用旧值覆盖,
      // 避免抹掉刚写入的元素回响状态或元素共鸣变化。
      travelerSnapshot: travelerAfter,
      worldSnapshot: worldAfter,
      signal: abortController.signal,
      allowIrminsul: irminsulEnabled,
      shouldCommit: isCurrentWorkflow,
      baseGameSnapshot: frozenSettlementState,
      factCandidates: parsedForDisplay.factCandidates,
      questUpdates: collectQuestUpdatePayloads({ factCandidates: parsedForDisplay.factCandidates }),
      questEnabled: state.gameSettings.任务系统?.enabled === true,
      settlementId: recoveryJournal.workflowId,
      });
      if (!variableOverrides?.committedGame) throw new Error('TEYVAT_SETTLEMENT_REJECTED');
      const committedSettlementGame = variableOverrides.committedGame;
      // 天赋成长反馈：对比结算前后等级，剧情驱动的天赋升级提示给玩家。
      const talentLevelUps = committedSettlementGame.旅行者.天赋.filter((talent) => {
        const before = frozenSettlementState.旅行者.天赋.find((item) => item.id === talent.id);
        return before != null && talent.等级 > before.等级;
      });
      if (talentLevelUps.length) {
        pushQueueTask(state, 'variable', 'success', {
          detail: `天赋成长：${talentLevelUps.map((talent) => `${talent.名称} 升至 Lv.${talent.等级}`).join('、')}。`,
        });
        pushToast({
          kind: 'success',
          title: '天赋成长',
          detail: talentLevelUps.map((talent) => `${talent.名称} Lv.${talent.等级}`).join('、'),
        });
      }
      recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, {
        phase: 'settlement_committed',
        committedState: committedSettlementGame,
      });
      assertWorkflowActive();
      await persistWorkflowRecoveryJournal(recoveryJournal);

      const committedQuestUpdate = variableOverrides.questUpdates?.at(-1);
      pushQueueTask(state, 'quest', state.gameSettings.任务系统?.enabled ? 'success' : 'skipped', {
        detail: state.gameSettings.任务系统?.enabled
          ? committedQuestUpdate ?? '剧情任务已与本回合领域命令原子结算。'
          : '任务系统已关闭。',
      });
      notifyCommittedQuestUpdate(state.gameSettings.notificationSettings, committedQuestUpdate);

      const variableApplied = Boolean(variableOverrides && Object.keys(variableOverrides).some((key) => key !== 'batch' && key !== 'npcLedgerUpdate'));
      pushQueueTask(state, 'variable', 'success', {
        detail: variableApplied ? '回复后的变量命令已落地。' : '本回合没有可落地的变量命令，已记录变量报告。',
      });

      const npcSource = variableOverrides?.NPC ?? state.NPC;
      const archiveEnrichment = enrichNpcArchives(npcSource, {
        nsfwEnabled: state.gameSettings.enableNsfw,
        maleNsfwArchiveEnabled: state.gameSettings.enableMaleNsfwArchive,
      });

      // NSFW 基线补建：开启 NSFW 后，把需要补建基线的 NPC 信息传给变量模型，
      // 变量模型在变量更新那一次调用里顺带生成 NSFW 基线档案，走正常 nsfw_archive facts 落库链路。
      const npcSourceForCompression = archiveEnrichment.records;
      const memorySettings = state.gameSettings.记忆系统 ?? 创建默认记忆系统设置();
      const npcCompressionSummaryTriggered: string[] = [];
      let npcAfterCompression = npcSourceForCompression.map((npc) => {
        const ledgerCompression = compressNpcMemoryLedger({
          npcId: npc.id,
          entries: npc.同行记忆 ?? [],
          summaries: npc.总结记忆 ?? [],
          threshold: memorySettings.NPC记忆压缩阈值,
          prompt: memorySettings.NPC记忆压缩提示词,
          turn: state.turnCount,
          source: '变量',
        });
        if (!ledgerCompression.changed) {
          return npc;
        }
        if (ledgerCompression.summaryTriggered) {
          pushUniqueText(npcCompressionSummaryTriggered, npc.姓名);
        }
        return {
          ...npc,
          同行记忆: ledgerCompression.memories,
          总结记忆: ledgerCompression.summaries,
        };
      });
      let npcChanged =
        archiveEnrichment.changed ||
        npcAfterCompression.length !== npcSource.length ||
        npcAfterCompression.some((npc, index) => npc !== npcSource[index]);
      const npcLedgerUpdateDebug = variableOverrides?.npcLedgerUpdate || npcCompressionSummaryTriggered.length
        ? {
            updatedNames: variableOverrides?.npcLedgerUpdate?.updatedNames ?? [],
            memoryAppended: variableOverrides?.npcLedgerUpdate?.memoryAppended ?? [],
            ledgerFieldsUpdated: variableOverrides?.npcLedgerUpdate?.ledgerFieldsUpdated ?? [],
            summaryTriggered: [
              ...(variableOverrides?.npcLedgerUpdate?.summaryTriggered ?? []),
              ...npcCompressionSummaryTriggered,
            ].filter((name, index, list) => Boolean(name) && list.indexOf(name) === index),
            warnings: variableOverrides?.npcLedgerUpdate?.warnings ?? [],
          }
        : undefined;
      if (npcLedgerUpdateDebug) {
        finalHistory = attachNpcLedgerUpdateDebug(finalHistory, aiMsg.id, npcLedgerUpdateDebug);
        state.setChatHistory(finalHistory);
      }

      let memoryAfterStoryProgress = variableOverrides?.记忆 ?? mem;
      let memoryChangedAfterSettlement = false;
      const storyAlignment = isOpeningSystemTrigger
        ? { system: state.剧情编织, changed: false, progressed: false }
        : autoAlignCanonStoryProgress({
            storyWeaving: state.剧情编织,
            turnCount: state.turnCount + 1,
            userInput,
            body: displayText,
            currentLocation: variableOverrides?.世界?.当前地点 ?? worldAfter.当前地点 ?? effectiveWorld.当前地点,
            gateSnapshot: storyWeavingGate,
            canonTrack: committedSettlementGame.原著轨道,
          });
      const storyProgressMemoryLine = storyAlignment.progressed
        ? buildStoryProgressMemoryLine(state.剧情编织, storyAlignment.system)
        : '';
      let storyWeavingForSave = storyAlignment.system;
      let storyWeavingConcurrentChange = false;
      if (storyAlignment.changed) {
        assertWorkflowActive();
        const resolvedStory = await resolveStoryWeavingForBackgroundWrite({
          workflowBase: state.剧情编织,
          proposed: storyAlignment.system,
        });
        storyWeavingForSave = resolvedStory.system;
        storyWeavingConcurrentChange = resolvedStory.concurrentChange;
        if (!storyWeavingConcurrentChange) {
          state.set剧情编织(storyWeavingForSave);
          await saveSetting('storyWeavingSystem', buildPersistedStoryWeavingSystem(storyWeavingForSave));
        } else {
          pushQueueTask(state, 'codex', 'success', {
            detail: '检测到剧情编织面板已有更新，本回合后台未覆盖最新导入/分解结果。',
          });
        }
        assertWorkflowActive();
        if (storyProgressMemoryLine && !storyWeavingConcurrentChange) {
          memoryAfterStoryProgress = addImmediateMemory(memoryAfterStoryProgress, storyProgressMemoryLine, state.turnCount + 1);
          mem = memoryAfterStoryProgress;
          memoryChangedAfterSettlement = true;
          const npcAfterStoryProgress = applyStoryProgressNpcMemory(
            npcAfterCompression,
            storyWeavingForSave,
            storyProgressMemoryLine,
            state.turnCount + 1,
          );
          if (npcAfterStoryProgress !== npcAfterCompression) {
            npcAfterCompression = npcAfterStoryProgress;
            npcChanged = true;
          }
        }
      }
      if (npcChanged || memoryChangedAfterSettlement) {
        state.updateGameState((current) => applyLegacyGameStateOverrides(current, {
          ...(npcChanged ? { NPC: npcAfterCompression } : {}),
          ...(memoryChangedAfterSettlement ? { 记忆: memoryAfterStoryProgress } : {}),
        }));
      }
      let codexAfterRuntimeUnlock = state.图鉴;
      if (storyAlignment.progressed && !storyWeavingConcurrentChange) {
        const codexUnlock = applyStoryArchiveCodexRuntimeUnlock({
          codex: state.图鉴,
          storyWeaving: storyWeavingForSave,
        });
        if (codexUnlock.changed) {
          assertWorkflowActive();
          codexAfterRuntimeUnlock = codexUnlock.codex;
          state.set图鉴(codexAfterRuntimeUnlock);
          assertWorkflowActive();
          pushQueueTask(state, 'codex', 'success', {
            detail: `剧情归档已更新图鉴门禁：${codexUnlock.unlocked.slice(0, 3).map((item) => `${item.name}→${item.status}`).join('、')}${codexUnlock.unlocked.length > 3 ? ` 等 ${codexUnlock.unlocked.length} 项` : ''}。`,
          });
        }
      }
      const steambirdSettings = state.gameSettings.蒸汽鸟报系统;
      const steambirdEnabled = Boolean(steambirdSettings?.enabled && steambirdSettings?.autoGenerate);
      const steambirdInterval = Math.max(5, Math.min(10, Math.trunc(steambirdSettings?.generateIntervalTurns ?? 5) || 5));
      const steambirdTurn = state.turnCount + 1;
      const shouldRunOpeningSteambird = isOpeningSystemTrigger && steambirdEnabled;
      const shouldRunSteambird = steambirdEnabled && ((shouldRunOpeningSteambird && !openingSteambirdPreprocessed) || (steambirdTurn > 0 && steambirdTurn % steambirdInterval === 0));
      const irminsulBase = committedSettlementGame.世界树;
      const turnRecallSource = {
        turn: committedSettlementGame.turnCount,
        userInput,
        body: displayText,
        memory: parsedForDisplay.continuation.summary,
        worldEvents: storyProgressMemoryLine
          ? [...worldFactCandidates, storyProgressMemoryLine]
          : worldFactCandidates,
        actionOptions: parsedForDisplay.choices.map((choice) => choice.label),
        gameTime: committedSettlementGame.世界.当前日期 || undefined,
        gameClock: committedSettlementGame.世界.当前时间 || undefined,
        location: committedSettlementGame.世界.当前地点 || undefined,
      };
      let steambirdAfterGeneration: SteambirdNews | null = openingSteambirdForSave;
      let irminsulAfterTurnRecall = irminsulBase;
      let courierAfterFallbackSeed = variableOverrides?.手机 ?? state.手机;
      let finalHistoryForSave = finalHistory;

      const runSteambirdBackgroundJob = async (): Promise<void> => {
        if (!steambirdSettings?.enabled || !steambirdSettings?.autoGenerate) {
          pushQueueTask(state, 'steambird', 'skipped', {
            detail: '蒸汽鸟报未开启，已跳过。',
          });
          return;
        }
        if (!shouldRunSteambird) {
          pushQueueTask(state, 'steambird', 'skipped', {
            detail: `未到蒸汽鸟报触发间隔（每 ${steambirdInterval} 回合一次），已跳过。`,
          });
          return;
        }
        pushQueueTask(state, 'steambird', 'pending', {
          detail: shouldRunOpeningSteambird
            ? '开局首回合正在先处理一次蒸汽鸟报。'
            : `正在调用蒸汽鸟报独立 API（读取最近 ${steambirdInterval} 回合）。`,
          cancellable: true,
        });
        const steambirdGenerationResult = runSteambirdGenerationStep({
          current: committedSettlementGame.蒸汽鸟报,
          publicFacts: [{ title: `第 ${steambirdTurn} 回公开见闻`, detail: `${userInput}\n${displayText}`.trim() }],
          turnCount: steambirdTurn,
        });
        assertWorkflowActive();
        steambirdAfterGeneration = steambirdGenerationResult?.steambird ?? committedSettlementGame.蒸汽鸟报;
        if (steambirdGenerationResult?.changed) state.set蒸汽鸟报(steambirdAfterGeneration);
        pushQueueTask(state, 'steambird', 'success', {
          detail: steambirdGenerationResult?.changed
            ? `蒸汽鸟报已更新，当前共 ${steambirdAfterGeneration.articles.length} 篇报道。`
            : steambirdGenerationResult
              ? '蒸汽鸟报本回合没有可写报道变化。'
              : '蒸汽鸟报未生成有效结果。',
        });
        if (steambirdGenerationResult?.changed) {
          notifyEvent(state.gameSettings.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS, 'steambird', '蒸汽鸟报已更新', steambirdAfterGeneration.articles[0]?.title);
          if ((state.gameSettings.notificationSettings?.events.steambird) !== false) {
            pushToast({ kind: 'info', title: '蒸汽鸟报已更新', detail: steambirdAfterGeneration.articles[0]?.title });
          }
        }
      };

      const runIrminsulArchiveJob = async (): Promise<void> => {
        // 世界树归档始终执行；这里的开关只控制“是否召回并注入正文”。
        assertWorkflowActive();
        const turnRecallEntry = buildIrminsulArchiveEntry({
          id: `irminsul_${turnRecallSource.turn}_${Date.now()}`,
          title: `第 ${turnRecallSource.turn} 回记忆`,
          summary: parsedForDisplay.continuation.summary || displayText.slice(0, 360),
          sourceTurns: [turnRecallSource.turn],
          keywords: [turnRecallSource.location, ...turnRecallSource.worldEvents].filter((item): item is string => Boolean(item)).slice(0, 8),
          recordedAt: turnRecallSource.gameTime || String(turnRecallSource.turn),
          archiveType: 'short',
          sourceText: displayText,
          turn: turnRecallSource.turn,
        });
        assertWorkflowActive();
        irminsulAfterTurnRecall = mergeIrminsulMemories(irminsulBase, { entries: [turnRecallEntry] });
        const committedQuestFacts = deriveCommittedQuestArchiveFacts(
          committedSettlementGame,
          [
            ...parsedForDisplay.factCandidates.filter((candidate) => candidate.domain === 'quest').map((candidate) => candidate.fact),
          ],
          state.turnCount + 1,
        );
        irminsulAfterTurnRecall = archiveCommittedQuestSettlement(
          irminsulAfterTurnRecall,
          committedSettlementGame,
          committedQuestFacts,
          state.turnCount + 1,
        );
        state.set世界树(irminsulAfterTurnRecall);
        pushQueueTask(state, 'memory', 'success', {
          detail: '世界树纪要已使用本回合公开小结入库。',
        });
        if (!irminsulEnabled) {
          pushQueueTask(state, 'irminsul', 'skipped', {
            detail: '世界树召回已关闭，但归档仍已执行。',
          });
        } else if (!irminsulRecallEnabled) {
          pushQueueTask(state, 'irminsul', 'skipped', {
            detail: `未到第${(memorySettings.世界树召回最早触发回合 ?? 10) + 1}回合，世界树召回已跳过。`,
          });
        } else if (irminsulPreview?.entries.length) {
          pushQueueTask(state, 'irminsul', 'success', {
            detail: irminsulPreview.usedModel ? '世界树召回已由独立模型完成。' : '世界树召回已由本地摘要检索完成。',
          });
        } else {
          pushQueueTask(state, 'irminsul', 'success', {
            detail: '世界树已检索，本回合没有命中相关档案。',
          });
        }
      };

      // 信使后台共享上下文：定时投递润色与玩家来信回信共用同一套环境 / API 解析。
      const courierWeatherName = 天气列表.find((item) => item.id === committedSettlementGame.世界.当前天气)?.name;
      const courierEnvironment = {
        location: committedSettlementGame.世界.当前地点 || undefined,
        timeText: committedSettlementGame.世界.当前时间 || undefined,
        ...(courierWeatherName ? { weather: courierWeatherName } : {}),
      };
      const courierTravelerName = committedSettlementGame.旅行者.姓名 || state.旅人.姓名 || undefined;
      const courierMainApiConfig = state.apiSettings.configs.find((item) => item.id === state.apiSettings.activeConfigId)
        ?? state.apiSettings.configs[0]
        ?? null;
      const courierLetterApiConfig = resolveCourierApiConfig(state.gameSettings.手机系统?.api, courierMainApiConfig);

      const runCourierFallbackJob = async (): Promise<void> => {
        if (!state.gameSettings.手机系统.enabled) {
          pushQueueTask(state, 'courier', 'skipped', {
            detail: '手机消息已关闭，本回合已跳过。',
          });
          return;
        }
        // 低频主动来信：先生成种子，再与变量种子同一趟投递——
        // 玩家对话结束后当回合就能在信使里看到来信，不再等到下一回合。
        if (state.gameSettings.手机系统.enabled && state.gameSettings.手机系统.autoGenerateSeeds) {
          const fallbackSeed = buildFallbackCourierSeed({
            courier: courierAfterFallbackSeed,
            npcs: npcAfterCompression,
            turn: state.turnCount + 1,
            userInput,
            body: displayText,
            maxSeedsPerTurn: state.gameSettings.手机系统.maxSeedsPerTurn,
            contactCooldownTurns: state.gameSettings.手机系统.contactCooldownTurns,
          });
          if (fallbackSeed) {
            courierAfterFallbackSeed = {
              ...courierAfterFallbackSeed,
              deliverySeeds: [...courierAfterFallbackSeed.deliverySeeds, fallbackSeed],
              unreadTotal: courierAfterFallbackSeed.unreadTotal + 1,
            };
          }
        }
        const scheduledResult = processScheduledCourierSeeds(courierAfterFallbackSeed, state.turnCount + 1, Date.now(), {
          npcs: npcAfterCompression,
          environment: courierEnvironment,
          travelerName: courierTravelerName,
        });
        if (scheduledResult.due.length > 0) {
          courierAfterFallbackSeed = scheduledResult.next;
          // AI 独立来信（信使 API 覆盖 → 主接口回退）：按上下文/环境/寄件人性格改写信件，
          // 失败时保留本地改写信件（同样不照抄种子原文）。
          const polishSeeds = scheduledResult.due.slice(0, 2);
          for (const seed of polishSeeds) {
            if (!courierLetterApiConfig) break;
            const senderNpc = npcAfterCompression.find((npc) => npc.id === seed.senderId || seed.relatedNpcIds.includes(npc.id));
            const senderConversation = courierAfterFallbackSeed.conversations.find((conversation) =>
              conversation.messages.some((message) => message.sourceSeedId === seed.id)
              || conversation.participantIds.includes(seed.senderId));
            const letterContext = {
              seed,
              sender: buildCourierSenderProfile(senderNpc, senderConversation, senderNpc?.姓名?.trim() || seed.title || seed.senderId),
              environment: courierEnvironment,
              travelerName: courierTravelerName,
            } as const;
            try {
              const letter = await generateCourierLetter(courierLetterApiConfig, letterContext);
              // AI 信覆盖本地信：本地信已按句读拆成多条消息，这里必须把整组替换成
              // 重新拆条的 AI 信——若只把每条消息内容换成整封信，会重复出现多份全文。
              courierAfterFallbackSeed = {
                ...courierAfterFallbackSeed,
                conversations: courierAfterFallbackSeed.conversations.map((conversation) => {
                  if (!conversation.participantIds.includes(seed.senderId)) return conversation;
                  const firstIndex = conversation.messages.findIndex((message) => message.sourceSeedId === seed.id);
                  if (firstIndex < 0) return conversation;
                  const seedMessageCount = conversation.messages.filter((message) => message.sourceSeedId === seed.id).length;
                  const template = conversation.messages[firstIndex];
                  const rebuilt = splitLetterIntoLines(letter).map((text, lineIndex) => ({
                    ...template,
                    id: `courier_seed_message_${seed.id}_ai_${lineIndex}`,
                    content: text,
                    timestamp: (template.timestamp || 0) + lineIndex,
                  }));
                  return {
                    ...conversation,
                    messages: [
                      ...conversation.messages.slice(0, firstIndex),
                      ...rebuilt,
                      ...conversation.messages.slice(firstIndex + seedMessageCount),
                    ],
                  };
                }),
              };
            } catch {
              // 静默回退：本地改写信件已随 processScheduledCourierSeeds 落地。
            }
          }
          // 新发件人建档：来信发件人还没有 NPC 记录时，落成路人档案，
          // 让通过信使结识的新角色也能出现在同伴面板与后续剧情里。
          const newNpcRecords = buildCourierSenderNpcRecords({
            dueSeeds: scheduledResult.due,
            contacts: courierAfterFallbackSeed.contacts,
            npcs: npcAfterCompression,
            turn: state.turnCount + 1,
          });
          if (newNpcRecords.length) {
            npcAfterCompression = [...npcAfterCompression, ...newNpcRecords];
            pushQueueTask(state, 'courier', 'success', {
              detail: `已登记 ${newNpcRecords.length} 位通过手机结识的新角色：${newNpcRecords.map((npc) => npc.姓名).join('、')}。`,
            });
          }
          npcAfterCompression = appendPhoneDeliveryMemories(
            npcAfterCompression,
            courierAfterFallbackSeed,
            scheduledResult.due,
            state.turnCount + 1,
          );
          state.setNPC(npcAfterCompression);
            state.set手机(courierAfterFallbackSeed);
          pushQueueTask(state, 'courier', 'success', {
            detail: `已送达 ${scheduledResult.due.length} 条定时手机消息。`,
          });
          notifyEvent(state.gameSettings.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS, 'courier', '手机新消息', `收到 ${scheduledResult.due.length} 条新消息`);
          if ((state.gameSettings.notificationSettings?.events.courier) !== false) {
            pushToast({ kind: 'info', title: '手机新消息', detail: `收到 ${scheduledResult.due.length} 条新消息` });
          }
        } else {
          pushQueueTask(state, 'courier', 'skipped', {
            detail: '本回合没有待处理的手机消息。',
          });
        }
      };

      // 回信作业：玩家投递过的会话（最后一条仍是玩家消息）由联系人回信，
      // 回信后该会话不再命中；每回合最多 2 封。AI 优先，失败回退本地写作器。
      const runCourierReplyJob = async (): Promise<void> => {
        if (!state.gameSettings.手机系统.enabled) return;
        const candidates = findCourierReplyCandidates(courierAfterFallbackSeed, 2);
        if (!candidates.length) return;
        pushQueueTask(state, 'courier', 'pending', {
          detail: `正在生成 ${candidates.length} 个手机会话的角色回复。`,
        });
        const result = await runCourierReplyPass({
          courier: courierAfterFallbackSeed,
          npcs: npcAfterCompression,
          environment: courierEnvironment,
          travelerName: courierTravelerName,
          letterApiConfig: courierLetterApiConfig,
          turn: state.turnCount + 1,
        });
        if (!result.replied) return;
        courierAfterFallbackSeed = result.courier;
        npcAfterCompression = result.npcs;
        state.set手机(result.courier);
        state.setNPC(result.npcs);
        pushQueueTask(state, 'courier', 'success', {
          detail: `已生成 ${result.replied} 个手机会话回复。`,
        });
        notifyEvent(state.gameSettings.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS, 'courier', '手机回复', `收到 ${result.replied} 个会话回复`);
        if ((state.gameSettings.notificationSettings?.events.courier) !== false) {
          pushToast({ kind: 'info', title: '手机回复', detail: `收到 ${result.replied} 个会话回复` });
        }
      };

      const runNarrativeImageJob = async (): Promise<void> => {
        const 正文生图设置 = state.gameSettings.文生图系统?.正文生图;
        if (!正文生图设置?.enabled || 正文生图设置.mode !== 'auto') return;
        const targetMessageId = aiMsg.id;
        const tokenizerConfig = resolveNarrativeImageTokenizerConfig(state, config);
        const imageApiConfig = resolveNarrativeImageGenerationApi(state);
        if (!imageApiConfig) {
          pushQueueTask(state, 'narrative_image_generate', 'failed', {
            detail: '正文生图主文生图接口未启用，无法生成故事快照。',
            turn: state.turnCount,
            targetMessageId,
          });
          return;
        }
        const queueResult = await globalImageTaskQueue.createRunner(() => generateNarrativeImagesForMessage({
          state,
          messageId: targetMessageId,
          body: displayText,
          tokenizerConfig,
          imageApiConfig,
          turn: state.turnCount,
          signal: abortController.signal,
        }))(targetMessageId);
        const generatedImages = queueResult.status === 'success'
          ? (queueResult.value as import('@/models/chat').叙事插图[] | null)
          : null;
        assertWorkflowActive();
        if (generatedImages?.length) {
          notifyEvent(state.gameSettings.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS, 'image', '故事快照已生成', `生成了 ${generatedImages.length} 张正文插图`);
          if ((state.gameSettings.notificationSettings?.events.image) !== false) {
            pushToast({ kind: 'success', title: '故事快照已生成', detail: `生成了 ${generatedImages.length} 张正文插图` });
          }
          finalHistoryForSave = finalHistory.map((msg) =>
            msg.id === targetMessageId && msg.role === 'assistant'
              ? {
                  ...msg,
                  narrativeImages: [...(msg.narrativeImages ?? []), ...generatedImages],
                }
              : msg,
          );
        }
      };

      if ((state.gameSettings.backgroundTaskMode ?? 'sequential') === 'parallel') {
        await Promise.all([
          runSteambirdBackgroundJob(),
          runIrminsulArchiveJob(),
          // 回信依赖投递结果，必须在投递作业之后串行执行。
          (async () => {
            await runCourierFallbackJob();
            await runCourierReplyJob();
          })(),
          runNarrativeImageJob(),
        ]);
      } else {
        await runSteambirdBackgroundJob();
        await runIrminsulArchiveJob();
        await runCourierFallbackJob();
        await runCourierReplyJob();
        await runNarrativeImageJob();
      }

      // 9.5 元素附着与反应结算（G1 极简版）：从正文检测元素应用，更新场面附着并记录反应事件。
      // 熟练度只记旅行者本人施放的元素（主语过滤），避免敌人的元素攻击被算到旅行者头上。
      const appliedElementsThisTurn = detectAppliedElements(displayText);
      const SKILL_MASTERY_GAIN_PER_TURN = 2;
      const travelerForMastery = variableOverrides?.旅人 ?? state.旅人;
      const travelerAppliedElements = detectTravelerAppliedElements(displayText, [
        committedSettlementGame.旅行者.姓名,
        committedSettlementGame.旅行者.别名,
      ]);
      const masteryResult = applyTravelerSkillMastery(travelerForMastery, travelerAppliedElements, SKILL_MASTERY_GAIN_PER_TURN);
      let travelerAfterMastery = travelerForMastery;
      const masteryGains = masteryResult.gains;
      if (masteryGains.length) {
        travelerAfterMastery = masteryResult.traveler;
        state.set旅人(travelerAfterMastery);
        pushQueueTask(state, 'variable', 'success', {
          detail: `本回合使用了 ${masteryGains.map((element) => ELEMENT_NAMES[element]).join('、')}，元素熟练度 +${SKILL_MASTERY_GAIN_PER_TURN}。`,
        });
      }
      for (const appliedElement of appliedElementsThisTurn) {
        const outcome = applyElementToField(state.game.叙事.元素场面, appliedElement, state.turnCount);
        if (outcome.events.length === 0 && outcome.field === state.game.叙事.元素场面) continue;
        const mergedEvents = [...state.game.叙事.元素事件, ...outcome.events].slice(-MAX_ELEMENT_EVENTS);
        state.updateGameState((current) => ({
          ...current,
          叙事: { ...current.叙事, 元素场面: outcome.field, 元素事件: mergedEvents },
        }));
      }

      // 10. Auto-save —— 每回合只在后台队列收尾写一次，避免正文/变量阶段重复生成多条自动存档。
      if (state.gameSettings.enableAutoSaveEveryTurn) {
        pushQueueTask(state, 'autosave', 'pending', { detail: '正在写入本回合自动存档。' });
        const variableBatchesForSave = compactVariableBatchHistory(variableOverrides?.batch
          ? [...state.variableBatches, variableOverrides.batch]
          : state.variableBatches);
        const saveData = buildSavePayload(state, 'auto', {
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
        assertWorkflowActive();
        await saveGame(saveData);
        commitActiveSaveTreeMeta(saveData);
        assertWorkflowActive();
        pushQueueTask(state, 'autosave', 'success', { detail: '本回合自动存档完成。' });
        state.setHasSave(true);
      }

      recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, { phase: 'autosave_committed' });
      await persistWorkflowRecoveryJournal(recoveryJournal);

    await saveSetting('theme', state.currentTheme);
    await saveSetting('apiSettings', state.apiSettings);
    await saveSetting('gameSettings', state.gameSettings);
    await saveSetting('worldbooks', state.worldbooks);
    await clearWorkflowRecoveryJournal(recoveryJournal.workflowId);
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError' || abortController.signal.aborted) {
      const abortDisposition = await applyAbortedWorkflowPolicy({
        phase: recoveryJournal.phase,
        rollback: async () => {
          state.setChatHistory(rollbackHistoryOnAbort);
          if (rollbackSnapshotOnAbort) {
            const rollbackStoryWeaving = restorePreTurnSnapshot(state, rollbackSnapshotOnAbort);
            await saveSetting('storyWeavingSystem', buildPersistedStoryWeavingSystem(rollbackStoryWeaving));
          }
        },
        clearJournal: () => clearWorkflowRecoveryJournal(recoveryJournal.workflowId),
      });
      if (abortDisposition === 'rolled_back') {
        state.setWorkflowHint('已停止生成，本次输入已回到输入框，可修改后重新发送。');
      } else {
        state.setWorkflowHint('本回合结算已提交；后台工作已暂停，可从恢复入口继续归档与自动存档。');
      }
      state.setWorkflowStatus('');
      keepWorkflowHint = true;
    } else {
      console.error('Send workflow error:', err);
      keepWorkflowHint = true;
      const detail = err instanceof Error ? err.message : '主流程调用失败。';
      const alreadyReportedByApiLayer = Boolean(
        err && typeof err === 'object' && (err as { alreadyReportedByApiLayer?: boolean }).alreadyReportedByApiLayer,
      );
      if (!alreadyReportedByApiLayer) {
        void appendApiErrorReport({
          source: '主剧情工作流',
          config,
          requestMode: state.gameSettings.enableStreaming ? 'stream' : 'non-stream',
          error: err,
        });
      }
      state.setWorkflowHint(`主流程失败：${detail}`);
      state.setWorkflowStatus('');
      const failedTask = pushQueueTask(state, 'main_story', 'failed', {
        detail,
        failCount: state.gameSettings.autoRetryOnError ? Math.max(1, state.gameSettings.autoRetryCount) : 1,
      });
      pushToast({
        kind: 'error',
        title: '回合结算失败',
        detail,
        durationMs: 10000,
        action: {
          label: '重试本回合',
          run: () => {
            void retryQueueTask(state, () => config, failedTask, 'retry').catch(() => undefined);
          },
        },
      });
    }
  } finally {
    visibilityPublisher?.dispose();
    streamMessageSetter.cancel();
    if (isCurrentWorkflow()) {
      state.setLoading(false);
      setStreamingMessage('');
      if (!keepWorkflowHint) {
        state.setWorkflowHint('');
        state.setWorkflowStatus('');
      }
      state.setPendingVariable(false);
      if (!pendingVariableStarted) {
        pushQueueTask(state, 'memory', 'idle', { detail: '主剧情未完成，本轮后台任务未启动。' });
        pushQueueTask(state, 'variable', 'idle', { detail: '主剧情未完成，本轮后台任务未启动。' });
        pushQueueTask(state, 'steambird', 'idle', { detail: '主剧情未完成，本轮后台任务未启动。' });
        pushQueueTask(state, 'autosave', 'idle', { detail: '主剧情未完成，本轮后台任务未启动。' });
      }
      state.abortControllerRef.current = null;
      deps.onAfterSend();
    }
  }
}

// ── 变量模型校准 ──

interface VariableCalibrationParams {
  state: UseGameStateReturn;
  mainApiConfig: import('@/models/settings').API配置项;
  userInput: string;
  body: string;
  variableDraft?: string;
  /** 主流程结束后的回合数(已 +1)。 */
  turnAfter: number;
  memorySystemSnapshot: import('@/models/memory').记忆系统;
  /** 7/7a/7b 后的旅行者快照（包含元素回响结果）。 */
  travelerSnapshot?: import('@/models/character').角色数据结构;
  /** 7/7a/7b 后的世界快照（包含全局事件与元素回响状态）。 */
  worldSnapshot?: import('@/models/world').世界状态;
  signal?: AbortSignal;
  allowIrminsul?: boolean;
  shouldCommit?: () => boolean;
  baseGameSnapshot?: TeyvatGameState;
  factCandidates?: NarrativeTurn['factCandidates'];
  questUpdates?: readonly string[];
  questEnabled?: boolean;
  settlementId?: string;
}

interface VariableCalibrationOverrides {
  旅人?: import('@/models/character').角色数据结构;
  世界?: import('@/models/world').世界状态;
  记忆?: import('@/models/memory').记忆系统;
  世界树?: import('@/models/teyvat/irminsul').IrminsulMemory;
  图鉴?: import('@/models/teyvat/codex').ArchiveCodex;
  手机?: import('@/models/teyvat/courier').CourierSystem;
  NPC?: import('@/models/npc').NPC记录[];
  蒸汽鸟报?: import('@/models/teyvat/steambird').SteambirdNews;
  剧情?: import('@/models/plot').剧情节点[];
  背包?: import('@/models/teyvat/items').TeyvatInventory;
  batch?: 变量命令批次;
  npcLedgerUpdate?: NpcLedgerUpdateDebug;
  committedGame?: TeyvatGameState;
  questUpdates?: string[];
}

/** 执行一次变量模型校准：调用独立 API → 解析命令 → 落地 → 推入 variableBatches。
 *  失败不抛错（不影响主流程的存档）。 */
async function runVariableCalibrationStep(
  params: VariableCalibrationParams,
): Promise<VariableCalibrationOverrides | null> {
  const { state, mainApiConfig } = params;
  if (!params.body?.trim()) return null;

  // 选择变量模型 API：用 settings 里的 override，字段留空回退到主 API 同名字段。
  const override = state.gameSettings.variableApi;
  const overrodeAny =
    !!override.baseUrl.trim() || !!override.apiKey.trim() || !!override.model.trim();
  const variableConfig: import('@/models/settings').API配置项 = {
    ...mainApiConfig,
    provider: override.provider || mainApiConfig.provider,
    baseUrl: override.baseUrl.trim() || mainApiConfig.baseUrl,
    apiKey: override.apiKey.trim() || mainApiConfig.apiKey,
    model: override.model.trim() || mainApiConfig.model,
    maxTokens: override.maxTokens ?? mainApiConfig.maxTokens,
    temperature: override.temperature ?? mainApiConfig.temperature,
  };

  const stateSnapshot = params.baseGameSnapshot ?? state.game;

  try {
    // NSFW 基线候选：开启时，为缺少实质内容的 NPC 在变量更新那一次调用里生成基线。
    const nsfwBaselineCandidates: NsfwBaselineCandidate[] = [];
    if (state.gameSettings.enableNsfw) {
      const npcRecords = state.NPC;
      for (const npc of npcRecords) {
        if (nsfwBaselineCandidates.length >= 2) break;
        if (needsNsfwBaseline(npc, undefined, {
          nsfwEnabled: true,
          maleNsfwArchiveEnabled: state.gameSettings.enableMaleNsfwArchive,
        })) {
          nsfwBaselineCandidates.push({
            npcId: npc.id,
            npcName: npc.姓名 ?? npc.别名 ?? '',
            gender: npc.性别,
            appearance: typeof npc.外貌 === 'string' ? npc.外貌 : undefined,
            personality: typeof npc.性格 === 'string' ? npc.性格 : undefined,
            intro: typeof npc.介绍 === 'string' ? npc.介绍 : undefined,
          });
        }
      }
    }
    const rawText = (await callVariableModel(variableConfig, {
      body: params.body,
      variableDraft: params.variableDraft,
      userInput: params.userInput,
      turnCount: params.turnAfter - 1, // 这条变量是给「刚结束的那回合」用的
      state: stateSnapshot,
      nsfwEnabled: state.gameSettings.enableNsfw,
      maleNsfwArchiveEnabled: state.gameSettings.enableMaleNsfwArchive,
      nsfwBaselineCandidates,
      signal: params.signal,
      retryCount: state.gameSettings.variableApi.retryCount ?? 2,
      promptModules: state.gameSettings.promptModules,
    })).rawText;
    if (params.signal?.aborted || params.shouldCommit?.() === false) return null;

    const parsedFacts = parseVariableFacts(rawText);
    const allowedFacts = parsedFacts.facts.filter((fact) => fact.type !== 'nsfw_archive' || state.gameSettings.enableNsfw);
    const modelClock = [...allowedFacts]
      .reverse()
      .find((fact): fact is Extract<变量事实, { type: 'time' }> => fact.type === 'time');
    const narrativeClock = deriveNarrativeTimeFact(params.body, stateSnapshot.世界.当前时间, modelClock);
    const inventoryRemovalFacts = deriveNarrativeInventoryRemovalFacts(params.body, stateSnapshot.背包.items)
      .filter((derived) => !allowedFacts.some((fact) => fact.type === 'item' && fact.action === derived.action && fact.name === derived.name));
    const resolvedNpcFacts = deriveResolvedNpcLedgerFacts(params.body, stateSnapshot.NPC)
      .filter((derived) => !allowedFacts.some((fact) => fact.type === 'npc'
        && (fact.id === derived.id || fact.name === derived.name)
        && fact.resolvedItems?.some((item) => derived.resolvedItems?.includes(item))));
    const partyPresenceFacts = derivePartyPresenceFacts(params.body, stateSnapshot.NPC);
    const presenceNames = new Set(partyPresenceFacts.map((fact) => fact.name));
    const factsWithPartyPresence = [
      ...allowedFacts.filter((fact) => fact.type !== 'npc' || !presenceNames.has(fact.name) || typeof fact.following !== 'boolean'),
      ...inventoryRemovalFacts,
      ...resolvedNpcFacts,
      ...partyPresenceFacts,
    ];
    const effectiveFacts = narrativeClock
      ? [...factsWithPartyPresence.filter((fact) => fact.type !== 'time'), narrativeClock]
      : factsWithPartyPresence;
    const factCommands = factsToTeyvatDomainCommands(effectiveFacts, stateSnapshot, params.turnAfter - 1, {
      courierSeedsEnabled: state.gameSettings.手机系统.enabled && state.gameSettings.手机系统.autoGenerateSeeds,
      maxCourierSeedsPerTurn: state.gameSettings.手机系统.maxSeedsPerTurn,
    });
    const composedSettlement = composeQuestSettlementCommands({
      state: stateSnapshot,
      narrativeCommands: factCommands.commands,
      enabled: params.questEnabled === true,
      questUpdates: params.questUpdates ?? [],
      body: params.body,
      variableFacts: effectiveFacts.map((fact) => ({ 路径: fact.type, 值: JSON.stringify(fact) })),
      factCandidates: params.factCandidates ?? [],
      turn: params.turnAfter,
    });
    const questSettlement = composedSettlement.quest;
    const commands = composedSettlement.commands;
    const parseErrors = [
      ...parsedFacts.parseErrors.map((reason) => `变量事实：${reason}`),
    ];
    // 解析错误也合并进 results，让玩家在面板里看到
    const errResults = parseErrors.map((reason) => ({
      command: { action: 'set' as const, key: '(解析失败)', value: null },
      ok: false,
      kind: 'error' as const,
      reason,
    }));
    const warningResults = factCommands.warnings.map((reason) => ({
      command: { action: 'set' as const, key: '(事实忽略)', value: null },
      ok: false,
      kind: 'warning' as const,
      reason,
    }));
    const commandResults = commands.map((item) => ({
      command: { action: item.action, key: `${item.root}.${item.path}`, value: item.value ?? null },
      ok: true,
      kind: 'command' as const,
    }));
    const optimisticResults = [...errResults, ...warningResults, ...commandResults];

    // 把整个 batch 推入历史
    const batch: 变量命令批次 = {
      id: params.settlementId ? `vbatch_${params.settlementId}` : `vbatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      turn: params.turnAfter - 1,
      timestamp: Date.now(),
      source: overrodeAny ? 'calibration' : 'main',
      modelName: variableConfig.model,
      results: optimisticResults,
      report: [
        `变量事实：${effectiveFacts.length} 条，生成正式领域命令 ${factCommands.commands.length} 条；任务命令 ${questSettlement.commands.length} 条。`,
        '兼容旧命令：0 条（新回合只接受正式领域命令）。',
        factCommands.warnings.length ? `事实警告：${factCommands.warnings.length} 条。` : '事实警告：0 条。',
        ...factCommands.notes,
      ].filter(Boolean).join('\n'),
      rawText,
    };
    if (params.signal?.aborted || params.shouldCommit?.() === false) return null;
    let committedGame: TeyvatGameState | undefined;
    const evidenceContext = {
      factCandidates: params.factCandidates ?? [],
      trustedEvidence: questSettlement.commands.length ? [questSettlement.evidence] : [],
      lenientEvidence: true,
    };
    // 预演结算：剔除会被事务拒绝的个别命令（保留可见的拒绝记录），其余命令照常提交，
    // 避免单条坏命令导致整批 TEYVAT_SETTLEMENT_REJECTED 把玩家回复一并回滚。
    let pendingCommands = commands;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const dry = reduceTeyvatTurn(stateSnapshot, pendingCommands, evidenceContext);
      if (dry.status !== 'rejected' || dry.errors.length === 0) break;
      const badIndex = dry.errors[0].index;
      const before = pendingCommands.length;
      pendingCommands = pendingCommands.filter((_, index) => index !== badIndex);
      if (pendingCommands.length === before) break;
    }
    const transaction = commitTeyvatTurn(stateSnapshot, pendingCommands, (nextState) => {
      committedGame = normalizeTeyvatGameState({
        ...nextState,
        叙事: {
          ...nextState.叙事,
          variableBatches: compactVariableBatchHistory([...stateSnapshot.叙事.variableBatches, batch]),
        },
      });
      state.replaceGameState(committedGame);
    }, evidenceContext);
    const transactionErrorResults = transaction.errors.map((item) => ({
      command: { action: 'set' as const, key: `${item.root ?? '(unknown)'}.${item.path ?? ''}`, value: null },
      ok: false,
      kind: 'rejected' as const,
      reason: item.code,
    }));
    const finalBatch = transaction.status === 'committed'
      ? batch
      : { ...batch, results: [...errResults, ...warningResults, ...transactionErrorResults] };
    const npcLedgerUpdate = buildNpcLedgerUpdateDebug({
      facts: effectiveFacts,
      commands: transaction.status === 'committed' ? commandResults.map((item) => item.command) : [],
      results: finalBatch.results,
      warnings: [
        ...parseErrors,
        ...factCommands.warnings,
        ...transaction.errors.map((item) => item.code),
      ],
    });
    if (transaction.status !== 'committed' || !committedGame) return { batch: finalBatch, npcLedgerUpdate };
    const committedLegacy = toLegacyTurnCheckpoint({
      turnCount: committedGame.turnCount,
      pendingOpeningTrigger: null,
      traveler: committedGame.旅行者,
      world: committedGame.世界,
      npc: committedGame.NPC,
      inventory: committedGame.背包,
    });
    return {
      背包: committedGame.背包,
      手机: committedGame.手机,
      蒸汽鸟报: committedGame.蒸汽鸟报,
      NPC: committedLegacy.NPC as NPC记录[],
      世界: committedLegacy.世界 as import('@/models/world').世界状态,
      旅人: committedLegacy.旅人 as import('@/models/character').角色数据结构,
      batch: finalBatch,
      npcLedgerUpdate,
      committedGame,
      questUpdates: questSettlement.updates,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') return null;
    if (params.signal?.aborted || params.shouldCommit?.() === false) return null;
    console.warn('[variable-model] 校准失败：', err);
    pushQueueTask(state, 'variable', 'failed', {
      detail: (err as Error).message ?? '变量模型校准失败。',
    });
    // 失败也记一条 batch 让玩家知道
    const batch: 变量命令批次 = {
      id: `vbatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      turn: params.turnAfter - 1,
      timestamp: Date.now(),
      source: overrodeAny ? 'calibration' : 'main',
      modelName: variableConfig.model,
      results: [{
        command: { action: 'set', key: '(变量模型调用失败)', value: null },
        ok: false,
        reason: (err as Error).message ?? '未知错误',
      }],
      rawText: err instanceof Error ? err.message : String(err ?? '变量模型调用失败'),
    };
    return {
      batch,
      npcLedgerUpdate: {
        updatedNames: [],
        memoryAppended: [],
        ledgerFieldsUpdated: [],
        summaryTriggered: [],
        warnings: [(err as Error).message ?? '变量模型校准失败。'],
      },
    };
  }
}
