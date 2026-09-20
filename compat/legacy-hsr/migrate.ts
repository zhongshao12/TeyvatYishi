import {
  createEmptyElementalField,
  createEmptyTeyvatGameState,
  normalizeTeyvatGameState,
  normalizeJourneyAlbum,
  normalizeQuestJournal,
  normalizeBackgroundQueueState,
  normalizeTechnicalJsonValue,
  type ElementId,
  type StorySeriesDto,
  type TeyvatGameState,
  type TeyvatNpcRecord,
} from '@/models/teyvat';
import { classifySaveUniverse } from './classify';
import { addMigrationIssue, addMigrationMapping, createMigrationReport } from './report';
import type {
  DbSaveClassificationResult,
  MigrationResolutions,
  SaveMigrationResult,
} from './types';
import { parseStoredLegacyResponse } from '@/services/ai/responseParser';

export { classifySaveUniverse } from './classify';
export type { DbSaveClassificationResult, MigrationIssue, MigrationReport, SaveMigrationResult, SaveUniverseClass } from './types';

export const LEGACY_PATH_ELEMENT_MAP = {
  hunt: 'electro',
  destruction: 'pyro',
  preservation: 'geo',
  abundance: 'dendro',
  remembrance: 'cryo',
  erudition: 'hydro',
  elation: 'anemo',
} as const satisfies Readonly<Record<string, ElementId>>;

const ELEMENT_IDS = new Set<ElementId>(['anemo', 'geo', 'electro', 'dendro', 'hydro', 'pyro', 'cryo']);
const REGION_IDS = new Set(['mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'nod_krai']);

type RecordValue = Record<string, unknown>;

/**
 * One-way settings compatibility for image-rule keys written before the
 * journal-fantasy boundary migration. Returned objects contain native keys
 * only; historical keys are never re-emitted.
 */
export function migrateLegacyImageRuleKeys(input: unknown): RecordValue {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const {
    hsrBaseStyle,
    hsrCharacterAnchorRule,
    ...native
  } = input as RecordValue;
  return {
    ...native,
    ...(native.journalFantasyBaseStyle === undefined && typeof hsrBaseStyle === 'string'
      ? { journalFantasyBaseStyle: hsrBaseStyle }
      : {}),
    ...(native.teyvatCharacterAnchorRule === undefined && typeof hsrCharacterAnchorRule === 'string'
      ? { teyvatCharacterAnchorRule: hsrCharacterAnchorRule }
      : {}),
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function elementIdText(value: unknown): string {
  const candidate = text(value);
  return ELEMENT_IDS.has(candidate as ElementId) ? candidate : '';
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function integer(value: unknown): number {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function mapNpcSharedMemories(value: unknown): TeyvatNpcRecord['sharedMemories'] {
  if (!Array.isArray(value)) return [];
  const sourceMap: Record<string, TeyvatNpcRecord['sharedMemories'][number]['source']> = {
    正文: 'narrative', 手机: 'courier', 新闻: 'steambird', 变量: 'variable', 其他: 'other',
  };
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const rawSource = text(entry.source);
    const source = sourceMap[text(entry.来源)] ?? (rawSource === 'news' ? 'steambird' : (['narrative', 'courier', 'steambird', 'variable', 'other'].includes(rawSource) ? rawSource as NonNullable<TeyvatNpcRecord['sharedMemories'][number]['source']> : undefined));
    return [{ id: text(entry.id), turn: integer(entry.回合 ?? entry.turn), summary: text(entry.摘要 ?? entry.summary), ...(optionalText(entry.原文 ?? entry.sourceText) ? { sourceText: text(entry.原文 ?? entry.sourceText) } : {}), ...(source ? { source } : {}), relatedNpcIds: textList(entry.关联NPCID ?? entry.relatedNpcIds) }];
  });
}

function mapNpcSummaryMemories(value: unknown): TeyvatNpcRecord['relationshipLedger']['summaries'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => isRecord(entry) ? [{
    id: text(entry.id), ...(optionalText(entry.回合范围 ?? entry.turnRange) ? { turnRange: text(entry.回合范围 ?? entry.turnRange) } : {}),
    ...(Number.isFinite(Number(entry.条数 ?? entry.itemCount)) ? { itemCount: integer(entry.条数 ?? entry.itemCount) } : {}),
    summary: text(entry.摘要 ?? entry.summary), retainedFacts: textList(entry.保留事实 ?? entry.retainedFacts),
    relationshipChanges: textList(entry.关系变化 ?? entry.relationshipChanges), unfinishedBusiness: textList(entry.未完成事项 ?? entry.unfinishedBusiness),
  }] : []);
}

function mapNpcVisualArchive(value: unknown): TeyvatNpcRecord['visualArchive'] {
  const raw = isRecord(value) ? value : {};
  const slots = isRecord(raw.头像槽位) ? raw.头像槽位 : {};
  const statusMap = { none: 'none', pending: 'pending', done: 'done', failed: 'failed' } as const;
  const sourceMap = { 手动: 'manual', 原著: 'canon', 文生图: 'generated', 占位: 'placeholder' } as const;
  return {
    ...(optionalText(raw.头像) ? { profileImage: text(raw.头像) } : {}), ...(optionalText(raw.立绘) ? { fullPortrait: text(raw.立绘) } : {}),
    slotImages: { ...(optionalText(slots.档案) ? { profile: text(slots.档案) } : {}), ...(optionalText(slots.正文) ? { narrative: text(slots.正文) } : {}), ...(optionalText(slots.手机) ? { courier: text(slots.手机) } : {}) },
    ...(optionalText(raw.头像提示词) ? { profilePrompt: text(raw.头像提示词) } : {}), ...(optionalText(raw.立绘提示词) ? { portraitPrompt: text(raw.立绘提示词) } : {}),
    ...(statusMap[text(raw.状态) as keyof typeof statusMap] ? { status: statusMap[text(raw.状态) as keyof typeof statusMap] } : {}),
    ...(sourceMap[text(raw.来源) as keyof typeof sourceMap] ? { source: sourceMap[text(raw.来源) as keyof typeof sourceMap] } : {}),
  };
}

function mapNpcMatureArchive(value: unknown): TeyvatNpcRecord['matureArchive'] {
  if (!isRecord(value)) return null;
  const female = isRecord(value.女性身体档案) ? value.女性身体档案 : {};
  const male = isRecord(value.男性身体档案) ? value.男性身体档案 : {};
  const images = isRecord(value.部位图片) ? value.部位图片 : {};
  const age = value.年龄确认 === 'adult' || value.年龄确认 === 'minor_blocked' ? value.年龄确认 : value.年龄确认 === 'unknown' ? 'unknown' : undefined;
  return {
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}), ...(age ? { ageConfirmation: age } : {}),
    ...(optionalText(value.亲密阶段) ? { intimacyStage: text(value.亲密阶段) } : {}), ...(optionalText(value.边界) ? { boundaries: text(value.边界) } : {}),
    preferences: textList(value.偏好), sensitivePoints: textList(value.敏感点), taboos: textList(value.禁忌),
    femaleBodyProfile: { chest: optionalText(female.胸部), genital: optionalText(female.女性私处), rear: optionalText(female.后庭), build: optionalText(female.体态), scent: optionalText(female.体味) },
    maleBodyProfile: { genital: optionalText(male.男性器), rear: optionalText(male.后庭), build: optionalText(male.体态), scent: optionalText(male.体味) },
    experiences: textList(value.经历), longTermFacts: textList(value.长期事实), tags: textList(value.标签),
    partImages: { femaleChest: optionalText(images.女性胸部), femaleGenital: optionalText(images.女性私处), maleGenital: optionalText(images.男性器), rear: optionalText(images.后庭), bodyReference: optionalText(images.体态参考) },
    ...(optionalText(value.备注) ? { notes: text(value.备注) } : {}),
  };
}

function mapStructuredResponse(value: unknown, rawContent: string): TeyvatGameState['对话']['entries'][number]['structuredResponse'] {
  if (!isRecord(value)) {
    return /<\s*(?:正文|body|行动选项|choices?)\s*>/i.test(rawContent)
      ? parseStoredLegacyResponse(rawContent)
      : undefined;
  }
  const body = optionalText(value.body);
  const choices = textList(value.actionOptions)
    .map((label, index) => ({ id: `legacy-choice-${index + 1}`, label: label.trim() }))
    .filter((choice) => choice.label);
  const summary = optionalText(value.memory) ?? optionalText(value.storyPlan) ?? '';
  if (!body && choices.length === 0 && !summary) {
    return /<\s*(?:正文|body|行动选项|choices?)\s*>/i.test(rawContent)
      ? parseStoredLegacyResponse(rawContent)
      : undefined;
  }
  return {
    body: body ? [{ kind: 'narration', text: body }] : [],
    choices,
    factCandidates: [],
    continuation: { summary, unresolved: [] },
  };
}

function mapTurnCheckpoint(
  value: unknown,
  resolutions: MigrationResolutions,
  report: ReturnType<typeof createMigrationReport>,
): TeyvatGameState['对话']['entries'][number]['preTurnState'] {
  if (!isRecord(value)) return undefined;
  const root = migratePartial(value, resolutions, report, false);
  return {
    turnCount: root.turnCount, pendingOpeningTrigger: typeof value.pendingOpeningTrigger === 'string' ? value.pendingOpeningTrigger : null,
    traveler: root.旅行者, world: root.世界, npc: root.NPC, inventory: root.背包, courier: root.手机,
    irminsul: root.世界树, codex: root.图鉴, steambird: root.蒸汽鸟报, memory: root.记忆,
    album: root.相册, quest: root.任务, queue: root.后台队列, narrative: root.叙事,
  };
}

function mapTokenUsage(value: unknown): TeyvatGameState['对话']['entries'][number]['tokenUsage'] {
  if (!isRecord(value)) return undefined;
  const source = value.source === 'estimate' || value.source === 'mixed' ? value.source : 'api';
  return {
    inputTokens: Number(value.inputTokens) || 0, outputTokens: Number(value.outputTokens) || 0, totalTokens: Number(value.totalTokens) || 0,
    source, rawUsageKeys: textList(value.rawUsageKeys),
    ...(Number.isFinite(Number(value.cachedTokens)) ? { cachedTokens: Number(value.cachedTokens) } : {}),
    ...(Number.isFinite(Number(value.uncachedTokens)) ? { uncachedTokens: Number(value.uncachedTokens) } : {}),
    ...(Number.isFinite(Number(value.cacheHitRate)) ? { cacheHitRate: Number(value.cacheHitRate) } : {}),
    ...(optionalText(value.provider) ? { provider: text(value.provider) } : {}), ...(optionalText(value.model) ? { model: text(value.model) } : {}),
    ...(optionalText(value.usageFormat) ? { usageFormat: text(value.usageFormat) } : {}), ...(optionalText(value.usagePath) ? { usagePath: text(value.usagePath) } : {}),
    ...(optionalText(value.system) ? { system: text(value.system) } : {}), ...(optionalText(value.cacheDiagnostic) ? { cacheDiagnostic: text(value.cacheDiagnostic) } : {}),
  };
}

function mapDebugMetadata(value: unknown): TeyvatGameState['对话']['entries'][number]['debugMetadata'] {
  if (!isRecord(value)) return undefined;
  const cache = isRecord(value.cachePrefixDiagnostics) ? value.cachePrefixDiagnostics : null;
  const mode = value.deepSeekMainMode === 'off' || value.deepSeekMainMode === 'standard' || value.deepSeekMainMode === 'lock_format' ? value.deepSeekMainMode : undefined;
  const requestMode = value.mainRequestMode === 'stream' || value.mainRequestMode === 'non-stream' ? value.mainRequestMode : undefined;
  return {
    systemPrompt: text(value.systemPrompt), messages: Array.isArray(value.messages) ? value.messages.flatMap((item) => isRecord(item) ? [{ role: item.role === 'user' || item.role === 'assistant' ? item.role : 'system', content: text(item.content) }] : []) : [],
    deepSeekProtocolIssues: textList(value.deepSeekProtocolIssues),
    ...(optionalText(value.recallPreview) ? { recallPreview: text(value.recallPreview) } : {}), ...(optionalText(value.recallSummary) ? { recallSummary: text(value.recallSummary) } : {}), ...(optionalText(value.recallFullContent) ? { recallFullContent: text(value.recallFullContent) } : {}),
    ...(mode ? { deepSeekMainMode: mode } : {}), ...(typeof value.deepSeekCotFakeHistorySkipped === 'boolean' ? { deepSeekCotFakeHistorySkipped: value.deepSeekCotFakeHistorySkipped } : {}), ...(typeof value.deepSeekPrefixMode === 'boolean' ? { deepSeekPrefixMode: value.deepSeekPrefixMode } : {}),
    ...(optionalText(value.deepSeekMainOriginalModel) ? { deepSeekMainOriginalModel: text(value.deepSeekMainOriginalModel) } : {}), ...(optionalText(value.deepSeekMainAdaptedModel) ? { deepSeekMainAdaptedModel: text(value.deepSeekMainAdaptedModel) } : {}),
    ...(typeof value.stV2Attempted === 'boolean' ? { stV2Attempted: value.stV2Attempted } : {}), ...(typeof value.stV2Used === 'boolean' ? { stV2Used: value.stV2Used } : {}), ...(optionalText(value.stV2FallbackReason) ? { stV2FallbackReason: text(value.stV2FallbackReason) } : {}),
    ...(Number.isFinite(Number(value.rerollSimilarity)) ? { rerollSimilarity: Number(value.rerollSimilarity) } : {}), ...(typeof value.rerollSimilarityRetried === 'boolean' ? { rerollSimilarityRetried: value.rerollSimilarityRetried } : {}),
    ...(cache ? { cachePrefixDiagnostics: { currentPromptTokens: Number(cache.currentPromptTokens) || 0, ...(Number.isFinite(Number(cache.previousPromptTokens)) ? { previousPromptTokens: Number(cache.previousPromptTokens) } : {}), commonPrefixChars: Number(cache.commonPrefixChars) || 0, commonPrefixTokens: Number(cache.commonPrefixTokens) || 0, commonPrefixRate: Number(cache.commonPrefixRate) || 0, firstDiffCurrentSection: text(cache.firstDiffCurrentSection), ...(optionalText(cache.firstDiffPreviousSection) ? { firstDiffPreviousSection: text(cache.firstDiffPreviousSection) } : {}), firstDiffCurrentExcerpt: text(cache.firstDiffCurrentExcerpt), ...(optionalText(cache.firstDiffPreviousExcerpt) ? { firstDiffPreviousExcerpt: text(cache.firstDiffPreviousExcerpt) } : {}), changedTailTokens: Number(cache.changedTailTokens) || 0, largestChangedSections: Array.isArray(cache.largestChangedSections) ? cache.largestChangedSections.flatMap((item) => isRecord(item) ? [{ label: text(item.label), tokens: Number(item.tokens) || 0 }] : []) : [] } } : {}),
    ...(requestMode ? { mainRequestMode: requestMode } : {}), ...(optionalText(value.irminsulRecallPreview ?? value.yitingRecallPreview) ? { irminsulRecallPreview: text(value.irminsulRecallPreview ?? value.yitingRecallPreview) } : {}), ...(optionalText(value.irminsulRecallRawText ?? value.yitingRecallRawText) ? { irminsulRecallRawText: text(value.irminsulRecallRawText ?? value.yitingRecallRawText) } : {}), ...(typeof (value.irminsulRecallUsedModel ?? value.yitingRecallUsedModel) === 'boolean' ? { irminsulRecallUsedModel: (value.irminsulRecallUsedModel ?? value.yitingRecallUsedModel) as boolean } : {}),
    ...(optionalText(value.codexRecallPreview ?? value.zhikuRecallPreview) ? { codexRecallPreview: text(value.codexRecallPreview ?? value.zhikuRecallPreview) } : {}), ...(optionalText(value.codexRecallInjection ?? value.zhikuRecallInjection) ? { codexRecallInjection: text(value.codexRecallInjection ?? value.zhikuRecallInjection) } : {}), ...(optionalText(value.codexRecallRawText ?? value.zhikuRecallRawText) ? { codexRecallRawText: text(value.codexRecallRawText ?? value.zhikuRecallRawText) } : {}), ...(typeof (value.codexRecallUsedModel ?? value.zhikuRecallUsedModel) === 'boolean' ? { codexRecallUsedModel: (value.codexRecallUsedModel ?? value.zhikuRecallUsedModel) as boolean } : {}),
  };
}

function mapNarrativeImages(value: unknown): NonNullable<TeyvatGameState['对话']['entries'][number]['narrativeImages']> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const type = item.type === 'character' ? 'character' : 'scene';
    const kind = item.kind === 'snapshot' || item.kind === 'scene' || item.kind === 'character' ? item.kind : undefined;
    const status = item.status === 'generating' || item.status === 'failed' ? item.status : 'done';
    return [{ id: text(item.id), dataUrl: text(item.dataUrl), type, ...(kind ? { kind } : {}), prompt: text(item.prompt), ...(optionalText(item.negativePrompt) ? { negativePrompt: text(item.negativePrompt) } : {}), ...(optionalText(item.description) ? { description: text(item.description) } : {}), status, ...(optionalText(item.error) ? { error: text(item.error) } : {}), ...(optionalText(item.assetId) ? { assetId: text(item.assetId) } : {}) }];
  });
}

function mapAlbum(value: unknown): TeyvatGameState['相册'] {
  const raw = isRecord(value) ? value : {};
  return normalizeJourneyAlbum({
    assets: Array.isArray(raw.assets) ? raw.assets.flatMap((asset) => isRecord(asset) ? [{
      id: text(asset.id), url: optionalText(asset.url), originalUrl: optionalText(asset.originalUrl), dataUrl: optionalText(asset.dataUrl),
      localRef: optionalText(asset.localRef), contentHash: optionalText(asset.contentHash), mimeType: optionalText(asset.mimeType),
      width: Number(asset.width), height: Number(asset.height), size: Number(asset.size), source: text(asset.source), nsfw: asset.nsfw === true,
      createdAt: Number(asset.createdAt) || 0, prompt: optionalText(asset.prompt), negativePrompt: optionalText(asset.negativePrompt),
      sourcePrompt: optionalText(asset.sourcePrompt), finalPrompt: optionalText(asset.finalPrompt), finalNegativePrompt: optionalText(asset.finalNegativePrompt),
      anchorMode: asset.anchorMode === true, anchorSummary: optionalText(asset.anchorSummary), referenceImageIds: textList(asset.referenceImageIds),
      dimensions: optionalText(asset.dimensions), model: optionalText(asset.model), backend: optionalText(asset.backend), status: text(asset.status), error: optionalText(asset.error),
    }] : []) : [],
    entries: Array.isArray(raw.entries) ? raw.entries.flatMap((entry) => isRecord(entry) ? [{
      id: text(entry.id), kind: text(entry.kind), url: text(entry.url), prompt: text(entry.prompt), description: text(entry.description ?? entry.title),
      turn: integer(entry.turn), createdAt: Number(entry.createdAt) || 0, assetId: optionalText(entry.assetId), title: optionalText(entry.title),
      targetType: optionalText(entry.targetType), targetId: optionalText(entry.targetId), slot: optionalText(entry.slot), tags: textList(entry.tags),
      nsfw: entry.nsfw === true, note: optionalText(entry.note), referenceTargets: textList(entry.referenceTargets),
    }] : []) : [],
    generationTasks: Array.isArray(raw.tasks) ? raw.tasks.flatMap((task) => isRecord(task) ? [{
      id: text(task.id), targetType: text(task.targetType), targetId: optionalText(task.targetId), slot: text(task.slot), source: text(task.source),
      status: text(task.status), backend: text(task.backend), nsfw: task.nsfw === true, prompt: text(task.prompt), negativePrompt: optionalText(task.negativePrompt),
      sourcePrompt: optionalText(task.sourcePrompt), finalPrompt: optionalText(task.finalPrompt), finalNegativePrompt: optionalText(task.finalNegativePrompt),
      anchorMode: task.anchorMode === true, anchorSummary: optionalText(task.anchorSummary), referenceImageIds: textList(task.referenceImageIds), dimensions: optionalText(task.dimensions),
      resultAssetId: optionalText(task.resultAssetId), error: optionalText(task.error), retryCount: integer(task.retryCount), createdAt: Number(task.createdAt) || 0,
      startedAt: Number(task.startedAt), finishedAt: Number(task.finishedAt),
    }] : []) : [],
  });
}

function mapQuestJournal(value: unknown): TeyvatGameState['任务'] {
  const raw = isRecord(value) ? value : {};
  const sourceMap = { 主线: 'main', 支线: 'side', 自定义: 'custom', 来信: 'letter' } as const;
  const statusMap = { 未开始: 'not_started', 进行中: 'active', 已完成: 'completed', 已失败: 'failed', 已放弃: 'abandoned' } as const;
  const objectiveMap = { 达成: 'reach', 收集: 'collect', 交谈: 'talk', 前往: 'travel', 击杀: 'defeat', 时间: 'time' } as const;
  const mapList = (items: unknown): unknown[] => Array.isArray(items) ? items.flatMap((task) => {
    if (!isRecord(task)) return [];
    return [{ id: text(task.id), title: text(task.标题), description: text(task.描述), source: sourceMap[text(task.来源) as keyof typeof sourceMap] ?? 'custom', status: statusMap[text(task.状态) as keyof typeof statusMap] ?? 'not_started', objectives: Array.isArray(task.目标) ? task.目标.flatMap((objective) => isRecord(objective) ? [{ id: text(objective.id), type: objectiveMap[text(objective.类型) as keyof typeof objectiveMap] ?? 'reach', description: text(objective.描述), targetCount: integer(objective.目标数量), currentCount: integer(objective.当前数量), completed: objective.完成 === true }] : []) : [], rewards: Array.isArray(task.奖励) ? task.奖励.flatMap((reward) => isRecord(reward) ? [text(reward.内容)] : []) : [], createdAtTurn: integer(task.创建回合), updatedAt: Number(task.更新时间) || 0, completedAtTurn: Number(task.完成回合), notes: optionalText(task.备注) }];
  }) : [];
  return normalizeQuestJournal({ active: mapList(raw.进行中), completed: mapList(raw.已完成), abandoned: mapList(raw.已放弃), lastUpdates: textList(raw.上一轮任务更新) });
}

function mapQueue(value: unknown): TeyvatGameState['后台队列'] {
  return normalizeBackgroundQueueState({ tasks: Array.isArray(value) ? value.flatMap((task) => isRecord(task) ? [{ id: text(task.id), title: text(task.title), subtitle: optionalText(task.subtitle), turn: integer(task.turn), timestamp: Number(task.timestamp) || 0, status: text(task.status), detail: optionalText(task.detail), rawText: optionalText(task.rawText), targetMessageId: optionalText(task.targetMessageId), targetBatchId: optionalText(task.targetBatchId), retryHint: optionalText(task.retryHint), retryCount: integer(task.failCount ?? task.retryCount), retrying: task.retrying === true, cancellable: task.cancellable === true, cancelled: task.cancelled === true }] : []) : [] });
}

const mapPlotStatus = (value: unknown): TeyvatGameState['叙事']['plotNodes'][number]['status'] => (
  value === 'active' || value === 'completed' || value === 'failed' || value === 'abandoned' ? value : 'pending'
);

function mapPlotNodes(value: unknown): TeyvatGameState['叙事']['plotNodes'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => isRecord(item) ? [{ id: text(item.id), title: text(item.标题 ?? item.title), summary: text(item.摘要 ?? item.summary), status: mapPlotStatus(item.状态 ?? item.status), createdAtTurn: integer(item.创建回合 ?? item.createdAtTurn), updatedAtTurn: integer(item.更新回合 ?? item.updatedAtTurn), ...(optionalText(item.前置节点ID ?? item.prerequisiteNodeId) ? { prerequisiteNodeId: text(item.前置节点ID ?? item.prerequisiteNodeId) } : {}), ...(optionalText(item.AI引导 ?? item.guidance) ? { guidance: text(item.AI引导 ?? item.guidance) } : {}) }] : []);
}

function mapStoryVisibility(value: unknown) {
  const raw = isRecord(value) ? value : {};
  return { knownBy: textList(raw.谁知道), unknownBy: textList(raw.谁不知道), readerOnly: raw.是否仅读者视角可见 === true };
}

function mapStoryConstraints(value: unknown) {
  return Array.isArray(value) ? value.flatMap((entry) => isRecord(entry) ? [{ content: text(entry.内容), visibility: mapStoryVisibility(entry.信息可见性) }] : []) : [];
}

function mapStorySeries(value: unknown): StorySeriesDto | null {
  if (!isRecord(value)) return null;
  const processingMap = { 待处理: 'pending', 处理中: 'processing', 已完成: 'completed', 失败: 'failed' } as const;
  const runtimeMap = { 未开始: 'not_started', 当前: 'current', 已经历: 'experienced', 已跳过: 'skipped', 已偏离: 'diverged', 暂停: 'paused' } as const;
  return {
    id: text(value.id), title: text(value.标题), workTitle: text(value.作品名), sourceType: value.来源类型 === 'canon' ? 'canon' : 'custom', sourceCodexEntryIds: textList(value.来源智库条目ID),
    ...(optionalText(value.内置预设ID) ? { builtinPresetId: text(value.内置预设ID) } : {}), ...(optionalText(value.来源文件名) ? { sourceFileName: text(value.来源文件名) } : {}), ...(optionalText(value.原始文本) ? { sourceText: text(value.原始文本) } : {}),
    chapters: Array.isArray(value.章节列表) ? value.章节列表.flatMap((entry) => isRecord(entry) ? [{ id: text(entry.id), index: integer(entry.序号), title: text(entry.标题), content: text(entry.内容), characterCount: integer(entry.字数) }] : []) : [],
    segments: Array.isArray(value.分段列表) ? value.分段列表.flatMap((entry) => isRecord(entry) ? [{
      id: text(entry.id), group: integer(entry.组号), title: text(entry.标题), chapterRange: text(entry.章节范围), chapterTitles: textList(entry.章节标题), opening: entry.是否开局组 === true,
      startChapter: integer(entry.起始章序号), endChapter: integer(entry.结束章序号), injectionEnabled: entry.启用注入 !== false, sourceText: text(entry.原文内容), characterCount: integer(entry.字数), sourceSummary: text(entry.原文摘要), stageSummary: text(entry.本段概括), timelineStart: text(entry.时间线起点), timelineEnd: text(entry.时间线终点),
      establishedFacts: textList(entry.开局已成立事实), continuedFacts: textList(entry.前段延续事实), endState: textList(entry.本段结束状态), futureReferences: textList(entry.给后续参考), characters: textList(entry.登场角色), locations: textList(entry.涉及地点), factions: textList(entry.涉及派系),
      canonConstraints: mapStoryConstraints(entry.原著硬约束), foreshadowing: mapStoryConstraints(entry.可提前铺垫),
      characterProfiles: Array.isArray(entry.角色档案) ? entry.角色档案.flatMap((profile) => isRecord(profile) ? [{ name: text(profile.名称), identity: text(profile.身份), faction: text(profile.所属势力), initialPosition: text(profile.初始立场), relationshipSummary: textList(profile.关系摘要), stateSummary: textList(profile.状态摘要), firstAppearance: text(profile.首次出现), importance: profile.重要性 === '核心' ? 'core' as const : profile.重要性 === '重要' ? 'important' as const : 'ordinary' as const }] : []) : [],
      factionProfiles: Array.isArray(entry.势力档案) ? entry.势力档案.flatMap((profile) => isRecord(profile) ? [{ name: text(profile.名称), type: text(profile.类型), territory: text(profile.地盘), representatives: textList(profile.代表人物), goals: text(profile.立场目标), currentState: text(profile.当前状态), relationshipSummary: textList(profile.关系摘要), firstAppearance: text(profile.首次出现) }] : []) : [],
      locationProfiles: Array.isArray(entry.地图地点档案) ? entry.地图地点档案.flatMap((profile) => {
        if (!isRecord(profile)) return [];
        const levelMap = { 寰宇: 'universe', 大地点: 'major', 中地点: 'medium', 小地点: 'minor', 区地点: 'district', 子地点: 'sub_location', 未知: 'unknown' } as const;
        return [{ name: text(profile.名称), level: levelMap[text(profile.层级) as keyof typeof levelMap] ?? 'unknown', parentLocation: text(profile.上级地点), faction: text(profile.所属势力), function: text(profile.地貌功能), facilities: textList(profile.关键设施), firstAppearance: text(profile.首次出现) }];
      }) : [],
      keyEvents: Array.isArray(entry.关键事件) ? entry.关键事件.flatMap((event) => isRecord(event) ? [{ name: text(event.事件名), description: text(event.事件说明), prerequisites: textList(event.前置条件), triggers: textList(event.触发条件), blockers: textList(event.阻断条件), results: textList(event.事件结果), laterEffects: textList(event.对后续影响), visibility: mapStoryVisibility(event.信息可见性) }] : []) : [],
      timeline: Array.isArray(entry.时间线) ? entry.时间线.flatMap((event) => isRecord(event) ? [{ title: text(event.标题), timeAnchor: text(event.时间锚点), description: text(event.描述), characters: textList(event.涉及角色) }] : []) : [],
      characterProgress: Array.isArray(entry.角色推进) ? entry.角色推进.flatMap((progress) => isRecord(progress) ? [{ characterName: text(progress.角色名), beforeState: textList(progress.本段前状态), changes: textList(progress.本段变化), afterState: textList(progress.本段后状态), laterEffects: textList(progress.对后续影响) }] : []) : [],
      processingStatus: processingMap[text(entry.处理状态) as keyof typeof processingMap] ?? 'pending', runtimeStatus: runtimeMap[text(entry.运行状态) as keyof typeof runtimeMap] ?? 'not_started', ...(optionalText(entry.最近错误) ? { lastError: text(entry.最近错误) } : {}), updatedAt: Number(entry.updatedAt) || 0,
    }] : []) : [],
    chaptersPerSegment: Math.max(1, integer(value.每段章数) || 1), active: value.激活注入 !== false, currentSegmentGroup: Math.max(1, integer(value.当前分段组号) || 1),
    currentStageSummary: text(value.当前阶段概括), coreCharacterSummary: textList(value.核心角色摘要), coreCharacters: textList(value.核心角色), locationIndex: textList(value.涉及地点索引), factionIndex: textList(value.涉及派系索引), createdAt: Number(value.createdAt) || 0, updatedAt: Number(value.updatedAt) || 0,
  };
}

function mapStoryWeaving(value: unknown): TeyvatGameState['叙事']['storyWeaving'] {
  if (!isRecord(value)) return null;
  const rawProgress = isRecord(value.当前进度) ? value.当前进度 : null;
  const statusMap = { 未开始: 'not_started', 推进中: 'progressing', 已完成: 'completed', 已偏离: 'diverged', 暂停: 'paused' } as const;
  const archiveStatusMap = { 已经历: 'experienced', 已跳过: 'skipped', 已偏离: 'diverged', 已完成: 'completed' } as const;
  const gate: 'soft' | 'strong' | undefined = rawProgress?.最近门禁结果 === 'soft' || rawProgress?.最近门禁结果 === 'strong' ? rawProgress.最近门禁结果 : undefined;
  const progress = rawProgress ? {
    ...(optionalText(rawProgress.当前系列ID) ? { seriesId: text(rawProgress.当前系列ID) } : {}), ...(optionalText(rawProgress.当前分段ID) ? { segmentId: text(rawProgress.当前分段ID) } : {}), segmentGroup: integer(rawProgress.当前分段组号), status: statusMap[text(rawProgress.推进状态) as keyof typeof statusMap] ?? 'not_started',
    completedSummaries: textList(rawProgress.已完成摘要), openQuestions: textList(rawProgress.当前待解问题), switchNotes: textList(rawProgress.切换说明),
    archive: Array.isArray(rawProgress.历史归档) ? rawProgress.历史归档.flatMap((entry) => isRecord(entry) ? [{ id: text(entry.id), ...(optionalText(entry.系列ID) ? { seriesId: text(entry.系列ID) } : {}), ...(optionalText(entry.分段ID) ? { segmentId: text(entry.分段ID) } : {}), segmentGroup: integer(entry.分段组号), segmentTitle: text(entry.分段标题), ...(Number.isFinite(Number(entry.归档回合)) ? { archivedAtTurn: integer(entry.归档回合) } : {}), status: archiveStatusMap[text(entry.归档状态) as keyof typeof archiveStatusMap] ?? 'experienced', summary: text(entry.摘要), characterProgress: textList(entry.角色推进摘要), switchNotes: text(entry.切换说明), reasons: textList(entry.判定理由), createdAt: Number(entry.createdAt) || 0 }] : []) : [],
    ...(gate ? { gate } : {}), reasons: textList(rawProgress.最近判定理由), ...(Number.isFinite(Number(rawProgress.最近一次推进判定回合)) ? { lastDecisionTurn: integer(rawProgress.最近一次推进判定回合) } : {}), evidence: textList(rawProgress.推进证据), consecutiveEvidenceTurns: integer(rawProgress.连续推进证据回合), stalledTurns: integer(rawProgress.卡段回合数), updatedAt: Number(rawProgress.updatedAt) || 0,
  } : undefined;
  return { series: Array.isArray(value.系列列表) ? value.系列列表.flatMap((item) => mapStorySeries(item) ?? []) : [], ...(optionalText(value.当前系列ID) ? { activeSeriesId: text(value.当前系列ID) } : {}), ...(progress ? { progress } : {}) };
}

function mapVariableBatches(value: unknown): TeyvatGameState['叙事']['variableBatches'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((batch) => {
    if (!isRecord(batch)) return [];
    return [{ id: text(batch.id), turn: integer(batch.turn), timestamp: Number(batch.timestamp) || 0, source: batch.source === 'calibration' ? 'calibration' : 'main', ...(optionalText(batch.modelName) ? { modelName: text(batch.modelName) } : {}), results: Array.isArray(batch.results) ? batch.results.flatMap((result) => {
      if (!isRecord(result) || !isRecord(result.command)) return [];
      const action = result.command.action === 'add' || result.command.action === 'sub' || result.command.action === 'push' || result.command.action === 'delete' ? result.command.action : 'set';
      const kind = result.kind === 'warning' || result.kind === 'error' || result.kind === 'rejected' ? result.kind : result.kind === 'command' ? 'command' : undefined;
      return [{ command: { action, key: text(result.command.key), value: normalizeTechnicalJsonValue(result.command.value) }, ok: result.ok === true, ...(kind ? { kind } : {}), ...(optionalText(result.reason) ? { reason: text(result.reason) } : {}) }];
    }) : [], ...(optionalText(batch.report) ? { report: text(batch.report) } : {}), ...(optionalText(batch.rawText) ? { rawText: text(batch.rawText) } : {}), ...(isRecord(batch.retentionSummary) ? { retentionSummary: { totalResults: integer(batch.retentionSummary.totalResults), succeededResults: integer(batch.retentionSummary.succeededResults), diagnosticResults: integer(batch.retentionSummary.diagnosticResults), omittedDiagnosticResults: integer(batch.retentionSummary.omittedDiagnosticResults) } } : {}) }];
  });
}

function resolveElement(
  value: unknown,
  path: string,
  resolutions: MigrationResolutions,
  report: ReturnType<typeof createMigrationReport>,
  required = false,
): ElementId | '' {
  if (value === '' || value === undefined || value === null) {
    if (required) {
      addMigrationIssue(report, {
        code: 'UNRESOLVED_ELEMENT',
        path,
        value,
        message: `Element value at ${path} needs an explicit migration choice.`,
      });
    }
    return '';
  }
  if (typeof value === 'string' && ELEMENT_IDS.has(value as ElementId)) return value as ElementId;

  const mapped = typeof value === 'string'
    ? LEGACY_PATH_ELEMENT_MAP[value as keyof typeof LEGACY_PATH_ELEMENT_MAP] ?? resolutions.elementByLegacyPath?.[value]
    : undefined;
  if (mapped && ELEMENT_IDS.has(mapped)) {
    addMigrationMapping(report, { from: path, to: '元素', value: mapped });
    return mapped;
  }

  addMigrationIssue(report, {
    code: 'UNRESOLVED_ELEMENT',
    path,
    value,
    message: `Element value at ${path} needs an explicit migration choice.`,
  });
  return '';
}

function resolveRarity(
  value: unknown,
  path: string,
  required: boolean,
  resolutions: MigrationResolutions,
  report: ReturnType<typeof createMigrationReport>,
): void {
  if (value === undefined || value === null || value === '') {
    if (required) {
      addMigrationIssue(report, {
        code: 'UNRESOLVED_RARITY',
        path,
        value,
        message: `Rarity at ${path} cannot be determined without user input.`,
      });
    }
    return;
  }
  const qualityRarity = value === '蓝' ? 3 : value === '紫' ? 4 : value === '金' ? 5 : undefined;
  const rarity = qualityRarity ?? Number(value);
  if (Number.isInteger(rarity) && rarity >= 1 && rarity <= 5) return;
  const resolved = resolutions.rarityByLegacyValue?.[String(value)];
  if (typeof resolved === 'number' && Number.isInteger(resolved) && resolved >= 1 && resolved <= 5) {
    addMigrationMapping(report, { from: path, to: '星级', value: resolved });
    return;
  }
  addMigrationIssue(report, {
    code: 'UNRESOLVED_RARITY',
    path,
    value,
    message: `Rarity at ${path} cannot be determined without user input.`,
  });
}

function migrateNpcList(input: unknown, resolutions: MigrationResolutions, report: ReturnType<typeof createMigrationReport>): TeyvatNpcRecord[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const element = resolveElement(item.元素 ?? item.命途, `NPC[${index}].${item.元素 !== undefined ? '元素' : '命途'}`, resolutions, report);
    resolveRarity(item.星级 ?? item.稀有度, `NPC[${index}].星级`, '星级' in item || '稀有度' in item, resolutions, report);
    return [{
      id: text(item.id) || `legacy-npc-${index}`,
      姓名: text(item.姓名),
      地区: text(item.地区),
      身份: text(item.身份),
      ...(element ? { 元素: element } : {}),
      天赋: [],
      说明: text(item.说明) || text(item.介绍),
      aliases: item.别名 ? [text(item.别名)] : [], roleTier: item.阶位 === 'companion' ? 'companion' : 'extra',
      affinity: Number(item.好感度) || 0, relationship: text(item.关系), intimate: item.亲密关系 === true,
      travelingTogether: item.同行 === true, firstSeenTurn: Math.max(0, Math.trunc(Number(item.初见回合) || 0)),
      lastSeenTurn: Math.max(0, Math.trunc(Number(item.最近回合) || 0)), gender: text(item.性别),
      playerAddress: text(item.对玩家称呼), appearance: text(item.外貌), clothing: text(item.穿着),
      speechStyle: text(item.说话方式), personality: text(item.性格), equipmentSummary: text(item.装备摘要),
      sharedMemories: mapNpcSharedMemories(item.同行记忆),
      relationshipLedger: {
        recentInteraction: text(item.最近互动), longTermImpression: text(item.对玩家长期印象), currentStage: text(item.当前关系阶段),
        sharedExperiences: textList(item.共同经历), unfinishedBusiness: textList(item.未完成事项),
        unresolvedConflicts: textList(item.未解决冲突), mustRemember: textList(item.必须记得),
        protectedFacts: textList(item.禁止遗忘), summaries: mapNpcSummaryMemories(item.总结记忆),
      },
      notes: textList(item.备注), playerCorrections: textList(item.玩家纠正记录), canonical: item.原著角色 === true,
      avatar: text(item.头像), visualArchive: mapNpcVisualArchive(item.图像档案), matureArchive: mapNpcMatureArchive(item.NSFW档案),
    }];
  });
}

function findUnresolvedItemRarities(
  traveler: RecordValue,
  input: RecordValue,
  resolutions: MigrationResolutions,
  report: ReturnType<typeof createMigrationReport>,
): void {
  const items = Array.isArray(traveler.背包)
    ? traveler.背包
    : Array.isArray(input.背包)
      ? input.背包
      : [];
  items.forEach((item, index) => {
    if (!isRecord(item)) return;
    resolveRarity(item.星级 ?? item.稀有度 ?? item.品质, `旅人.背包[${index}].星级`, true, resolutions, report);
  });
}

function migratePartial(input: RecordValue, resolutions: MigrationResolutions, report: ReturnType<typeof createMigrationReport>, requireTravelerElement = true): TeyvatGameState {
  const state = createEmptyTeyvatGameState();
  const traveler = isRecord(input.旅人) ? input.旅人 : isRecord(input.旅行者) ? input.旅行者 : {};
  const world = isRecord(input.世界) ? input.世界 : {};
  const legacyPath = traveler.主命途 ?? traveler.主元素;
  const element = resolveElement(legacyPath, '旅人.主命途', resolutions, report, requireTravelerElement);
  findUnresolvedItemRarities(traveler, input, resolutions, report);

  state.旅行者 = {
    ...state.旅行者,
    id: text(traveler.id),
    姓名: text(traveler.姓名),
    别名: text(traveler.别名),
    性别: text(traveler.性别),
    年龄: Number.isFinite(Number(traveler.年龄)) ? Math.max(0, Math.trunc(Number(traveler.年龄))) : state.旅行者.年龄,
    生日: text(traveler.生日),
    身高: text(traveler.身高),
    身份: text(traveler.身份),
    外貌: text(traveler.外貌),
    性格: text(traveler.性格),
    背景: text(traveler.背景),
    专长知识: textList(traveler.专长知识),
    头像: text(traveler.头像),
    主元素: element,
    元素共鸣: element ? [{ element, source: 'traveler_resonance', mastery: 0, unlocked: true, unlockedAt: '', notes: '' }] : [],
    attributes: isRecord(traveler.属性)
      ? Object.fromEntries(Object.entries(traveler.属性).flatMap(([key, value]) => Number.isFinite(Number(value)) ? [[key, Number(value)]] : []))
      : {},
    capabilities: textList(traveler.能力),
    visualArchive: isRecord(traveler.图像档案) ? {
      profileImage: text(traveler.图像档案.头像),
      narrativeImage: text(traveler.图像档案.正文头像),
      courierImage: text(traveler.图像档案.手机头像),
      fullPortrait: text(traveler.图像档案.立绘),
    } : {},
  };
  const region = text(world.开局地区 ?? world.currentRegion);
  state.世界 = {
    ...state.世界,
    ...(REGION_IDS.has(region) ? { 当前地区: region as TeyvatGameState['世界']['当前地区'] } : {}),
    当前地点: text(world.当前地点 ?? world.currentLocation),
    当前日期: text(world.当前日期 ?? world.currentDate),
    当前时间: text(world.当前时间 ?? world.currentTime),
    当前天气: text(world.当前天气 ?? world.weather),
    世界事件: textList(world.全局事件 ?? world.worldEvents),
    氛围: text(world.氛围变化 ?? world.atmosphere),
    当前时段: isRecord(world.当前时段) ? {
      id: text(world.当前时段.id), 名称: text(world.当前时段.名称), 年代: text(world.当前时段.年代), 描述: text(world.当前时段.描述),
      氛围: text(world.当前时段.氛围), 关键事件: textList(world.当前时段.关键事件), 科技水平: text(world.当前时段.科技水平), 社会规范: text(world.当前时段.社会规范),
      派系: Array.isArray(world.当前时段.派系) ? world.当前时段.派系.flatMap((entry) => isRecord(entry) ? [{ id: text(entry.id), 名称: text(entry.名称), 描述: text(entry.描述), 影响力: Number(entry.影响力) || 0 }] : []) : [],
      人物: Array.isArray(world.当前时段.人物) ? world.当前时段.人物.flatMap((entry) => isRecord(entry) ? [{ id: text(entry.id), 姓名: text(entry.姓名), 角色: text(entry.角色), 性格: text(entry.性格), 外貌: text(entry.外貌), 与玩家关系: text(entry.与玩家关系), 记忆: textList(entry.记忆) }] : []) : [],
    } : null,
    已访问时段: textList(world.已访问时段),
    纪年名称: text(world.纪年法),
    旅程天数: Math.max(1, Math.trunc(Number(world.开拓天数) || 1)),
    活跃人物: Array.isArray(world.活跃人物) ? world.活跃人物.flatMap((entry) => isRecord(entry) ? [{ id: text(entry.id), 姓名: text(entry.姓名), 角色: text(entry.角色), 性格: text(entry.性格), 外貌: text(entry.外貌), 与玩家关系: text(entry.与玩家关系), 记忆: textList(entry.记忆) }] : []) : [],
    难度: text(world.难度),
    叙事模式: text(world.剧情模式),
    开局设定: isRecord(world.开局档案) ? {
      ...(optionalText(world.开局档案.来源) ? { 来源: text(world.开局档案.来源) } : {}),
      ...(typeof world.开局档案.主线启用 === 'boolean' ? { 主线启用: world.开局档案.主线启用 } : {}),
      ...(optionalText(world.开局档案.地区ID) ? { 地区ID: text(world.开局档案.地区ID) } : {}), ...(optionalText(world.开局档案.地区名称) ? { 地区名称: text(world.开局档案.地区名称) } : {}),
      ...(optionalText(world.开局档案.章节锚点ID) ? { 章节锚点ID: text(world.开局档案.章节锚点ID) } : {}), ...(optionalText(world.开局档案.章节锚点名称) ? { 章节锚点名称: text(world.开局档案.章节锚点名称) } : {}),
      ...(optionalText(world.开局档案.章节参考说明) ? { 章节参考说明: text(world.开局档案.章节参考说明) } : {}), ...(optionalText(world.开局档案.参考性质) ? { 参考性质: text(world.开局档案.参考性质) } : {}),
      ...(optionalText(world.开局档案.官方预设ID) ? { 官方预设ID: text(world.开局档案.官方预设ID) } : {}), ...(optionalText(world.开局档案.创意工坊模板ID) ? { 创意工坊模板ID: text(world.开局档案.创意工坊模板ID) } : {}),
      ...(optionalText(world.开局档案.玩家介入原文) ? { 玩家介入原文: text(world.开局档案.玩家介入原文) } : {}), 防回退规则: textList(world.开局档案.防回退规则),
    } : null,
    起始场景ID: text(world.起航之地ID),
    自定义开局: text(world.自定义开局),
    原著旅行者: ['荧', '空', '空荧双主角'].includes(text(world.原著主角))
      ? text(world.原著主角) as TeyvatGameState['世界']['原著旅行者']
      : '',
    元素回响邀请: elementIdText(world.元素回响邀请) || elementIdText(world.待触发狭间),
    进行中元素回响: elementIdText(world.进行中元素回响) || elementIdText(world.进行中狭间),
  };
  state.NPC = migrateNpcList(input.NPC, resolutions, report);
  const inventoryCategoryMap: Record<string, TeyvatGameState['背包']['items'][number]['category']> = {
    food: 'food', consumable: 'gadget', lightcone: 'weapon', weapon: 'weapon', clothing: 'furnishing',
    accessory: 'artifact', memento: 'material', key: 'quest',
  };
  const inventoryItems = Array.isArray(traveler.背包) ? traveler.背包 : Array.isArray(input.背包) ? input.背包 : [];
  state.背包.items = inventoryItems.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const rarity = value.品质 === '蓝' ? 3 : value.品质 === '紫' ? 4 : value.品质 === '金' ? 5 : Math.max(1, Math.min(5, Math.trunc(Number(value.星级 ?? value.稀有度) || 1)));
    const useEffects = Array.isArray(value.使用效果) ? value.使用效果.flatMap((effect) => {
      if (!isRecord(effect)) return [];
      return [{ target: text(effect.目标属性), value: Number(effect.数值) || 0, ...(effect.依据 ? { basis: text(effect.依据) } : {}) }];
    }) : undefined;
    return [{
      id: text(value.id) || `db-item-${index}`,
      category: inventoryCategoryMap[text(value.类别)] ?? 'material',
      name: text(value.名称), description: text(value.描述), quantity: Math.max(1, Math.trunc(Number(value.数量) || 1)),
      rarity: rarity as TeyvatGameState['背包']['items'][number]['rarity'],
      obtainedAtTurn: Math.max(0, Math.trunc(Number(value.获得回合) || 0)),
      stackable: value.可堆叠 !== false,
      source: text(value.来源),
      narrativeEffects: textList(value.叙事效果),
      ...(useEffects ? { useEffects } : {}),
      ...(Number.isFinite(Number(value.价值)) ? { value: Number(value.价值) } : {}),
      ...(value.来源描述 ? { sourceDetail: text(value.来源描述) } : {}),
      ...(value.获得时间 ? { obtainedAt: text(value.获得时间) } : {}),
    }];
  });
  state.turnCount = Math.max(0, Math.trunc(Number(input.turnCount) || 0));
  const chatHistory = Array.isArray(input.chatHistory) ? input.chatHistory : [];
  state.对话.entries = chatHistory.flatMap((message, index) => {
    if (!isRecord(message)) return [];
    const role = message.role === 'user' || message.role === 'assistant' || message.role === 'system'
      ? message.role
      : 'system';
    const structuredResponse = mapStructuredResponse(message.parsedResponse, text(message.content));
    const preTurnState = mapTurnCheckpoint(message.preTurnSnapshot, resolutions, report);
    const tokenUsage = mapTokenUsage(message.tokenUsage);
    const debugMetadata = mapDebugMetadata(message.debugContext);
    return [{
      id: text(message.id) || `db-message-${index}`,
      role,
      content: text(message.content),
      timestamp: Number(message.timestamp) || 0,
      ...(typeof message.gameTime === 'string' ? { gameTime: message.gameTime } : {}),
      ...(structuredResponse ? { structuredResponse } : {}),
      ...(preTurnState ? { preTurnState } : {}),
      ...(Number.isFinite(Number(message.inputTokens)) ? { inputTokens: Number(message.inputTokens) } : {}),
      ...(Number.isFinite(Number(message.outputTokens)) ? { outputTokens: Number(message.outputTokens) } : {}),
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(Number.isFinite(Number(message.responseDurationSec)) ? { responseDurationSec: Number(message.responseDurationSec) } : {}),
      ...(typeof message.isStreaming === 'boolean' ? { streaming: message.isStreaming } : {}),
      ...(isRecord(message.bookmark) ? { bookmark: { title: text(message.bookmark.title), ...(optionalText(message.bookmark.note) ? { note: text(message.bookmark.note) } : {}), createdAt: Number(message.bookmark.createdAt) || 0 } } : {}),
      ...(debugMetadata ? { debugMetadata } : {}),
      ...(Array.isArray(message.narrativeImages) ? { narrativeImages: mapNarrativeImages(message.narrativeImages) } : {}),
    }];
  });
  const memory = isRecord(input.记忆) ? input.记忆 : {};
  state.记忆 = {
    ...state.记忆,
    immediate: textList(memory.即时记忆),
    shortTerm: textList(memory.短期记忆),
    mediumTerm: textList(memory.中期记忆),
    longTerm: textList(memory.长期记忆),
    failedDrafts: Array.isArray(memory.失败草稿) ? memory.失败草稿.flatMap((draft) => {
      if (!isRecord(draft)) return [];
      const turns = isRecord(draft.sourceTurns) ? draft.sourceTurns : {};
      const snapshot = isRecord(draft.sourceSnapshot) ? draft.sourceSnapshot : {};
      const kind = draft.kind === 'middle' || draft.kind === 'long' ? draft.kind : 'short';
      const status = draft.status === 'retrying' || draft.status === 'resolved' || draft.status === 'ignored' ? draft.status : 'pending';
      const failureCode = draft.failureCode === 'unconfigured' || draft.failureCode === 'empty_output' || draft.failureCode === 'source_changed' ? draft.failureCode : 'request_failed';
      return [{ id: text(draft.id), ...(draft.origin === 'automatic' || draft.origin === 'batch_rebuild' ? { origin: draft.origin } : {}), kind, status, sourceTurns: { start: integer(turns.start), end: integer(turns.end) }, sourceSnapshot: { encoding: snapshot.encoding === 'gzip-base64' ? 'gzip-base64' : 'plain-json', payload: text(snapshot.payload), checksum: text(snapshot.checksum), itemCount: integer(snapshot.itemCount), uncompressedBytes: integer(snapshot.uncompressedBytes) }, targetLayer: draft.targetLayer === '中期记忆' || draft.targetLayer === '长期记忆' ? draft.targetLayer : '短期记忆', fallbackSummary: text(draft.fallbackSummary), failureCode, failureMessage: text(draft.failureMessage), attemptCount: integer(draft.attemptCount), createdAt: Number(draft.createdAt) || 0, updatedAt: Number(draft.updatedAt) || 0 }];
    }) : [],
  };
  const courier = isRecord(input.手机) ? input.手机 : {};
  state.手机 = {
    ...state.手机,
    contacts: Array.isArray(courier.contacts) ? courier.contacts.flatMap((value, index) => {
      if (!isRecord(value)) return [];
      return [{
        id: text(value.id) || `db-contact-${index}`, name: text(value.name ?? value.姓名),
        ...(value.npcId ? { npcId: text(value.npcId) } : {}),
        ...(value.avatar ? { avatar: text(value.avatar) } : {}),
        ...(value.relationLabel ? { relationLabel: text(value.relationLabel) } : {}),
        available: value.available !== false,
      }];
    }) : [],
    conversations: Array.isArray(courier.chats) ? courier.chats.flatMap((value, index) => {
      if (!isRecord(value)) return [];
      return [{
        id: text(value.id) || `db-conversation-${index}`, title: text(value.title),
        participantIds: textList(value.participantIds),
        type: value.type === 'group' || value.type === 'system' ? value.type : 'private',
        messages: Array.isArray(value.messages) ? value.messages.flatMap((message, messageIndex) => {
          if (!isRecord(message)) return [];
          return [{
            id: text(message.id) || `db-courier-message-${index}-${messageIndex}`,
            senderId: text(message.senderId), senderName: text(message.senderName), role: text(message.role),
            content: text(message.content), turn: Math.max(0, Math.trunc(Number(message.turn) || 0)),
            timestamp: Number(message.timestamp) || 0, readBy: textList(message.readBy),
            ...(optionalText(message.avatar) ? { avatar: text(message.avatar) } : {}),
            ...(optionalText(message.sourceSeedId) ? { sourceSeedId: text(message.sourceSeedId) } : {}),
            ...(Number.isFinite(Number(message.scheduledAtTurn)) ? { scheduledAtTurn: integer(message.scheduledAtTurn) } : {}),
            ...(Number.isFinite(Number(message.deliveredAtTurn)) ? { deliveredAtTurn: integer(message.deliveredAtTurn) } : {}),
          }];
        }) : [],
        unread: integer(value.unread), typingMemberIds: textList(value.typingMembers), updatedAt: Number(value.updatedAt) || 0,
        ...(typeof value.pinned === 'boolean' ? { pinned: value.pinned } : {}),
        ...(optionalText(value.inviteCode) ? { inviteCode: text(value.inviteCode) } : {}),
        ...(optionalText(value.announcement) ? { announcement: text(value.announcement) } : {}),
        ...(optionalText(value.creatorId) ? { creatorId: text(value.creatorId) } : {}),
      }];
    }) : [],
    deliverySeeds: Array.isArray(courier.messageSeeds) ? courier.messageSeeds.flatMap((value, index) => {
      if (!isRecord(value)) return [];
      return [{ id: text(value.id) || `db-seed-${index}`, senderId: text(value.senderId ?? value.targetId), reason: text(value.reason ?? value.context),
        turn: integer(value.turn), source: value.source === 'news' ? 'steambird' : value.source === 'main_story' || value.source === 'steambird' || value.source === 'memory' || value.source === 'plot' ? value.source : 'system',
        triggerType: value.triggerType === 'news' ? 'steambird' : ['injury', 'victory', 'defeat', 'location_change', 'important_item', 'relationship', 'steambird', 'quest', 'time'].includes(text(value.triggerType)) ? value.triggerType as TeyvatGameState['手机']['deliverySeeds'][number]['triggerType'] : 'custom',
        priority: value.priority === 'low' || value.priority === 'high' || value.priority === 'urgent' ? value.priority : 'normal',
        targetType: value.targetType === 'group' ? 'group' : 'private', targetId: text(value.targetId), title: text(value.title), context: text(value.context),
        relatedNpcIds: textList(value.relatedNpcIds), ...(Number.isFinite(Number(value.expiresAfterTurns)) ? { expiresAfterTurns: integer(value.expiresAfterTurns) } : {}),
        ...(Number.isFinite(Number(value.scheduledAtTurn)) ? { scheduledAtTurn: integer(value.scheduledAtTurn) } : {}),
        ...(value.fromEvent === 'news' ? { fromEvent: 'steambird' as const } : value.fromEvent === 'steambird' || value.fromEvent === 'plot' || value.fromEvent === 'relationship' ? { fromEvent: value.fromEvent } : {}),
        ...(optionalText(value.relatedEventId) ? { relatedEventId: text(value.relatedEventId) } : {}),
        status: value.status === 'generated' || value.status === 'dismissed' || value.status === 'expired' ? value.status : 'pending',
      }];
    }) : [],
    unreadTotal: Math.max(0, Math.trunc(Number(courier.unreadTotal) || 0)),
    wallpapers: isRecord(courier.wallpapers) ? {
      home: text(courier.wallpapers.home),
      conversation: text(courier.wallpapers.chat),
    } : {},
  };
  const archive = isRecord(input.忆庭) ? input.忆庭 : {};
  const archiveTypeMap: Record<string, TeyvatGameState['世界树']['entries'][number]['archiveType']> = {
    短期压缩: 'short', 中期压缩: 'medium', 长期压缩: 'long', 精炼纪要: 'refined',
  };
  state.世界树.entries = Array.isArray(archive.回忆档案) ? archive.回忆档案.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const turn = Math.max(0, Math.trunc(Number(value.回合) || 0));
    return [{
      id: text(value.id) || `db-memory-${index}`, title: text(value.名称), summary: text(value.摘要),
      sourceTurns: Array.isArray(value.来源回合) ? value.来源回合.map((item) => Math.max(0, Math.trunc(Number(item) || 0))) : [turn],
      keywords: textList(value.检索关键词), recordedAt: text(value.时间戳),
      archiveType: archiveTypeMap[text(value.类型)] ?? 'short', sourceText: text(value.原文), turn,
    }];
  }) : [];
  const codex = isRecord(input.智库) ? input.智库 : {};
  state.图鉴.entries = Array.isArray(codex.条目) ? codex.条目.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const injectionRaw = isRecord(value.注入内容) ? value.注入内容 : {};
    const injection: TeyvatGameState['图鉴']['entries'][number]['injection'] = {};
    if (injectionRaw.公开 !== undefined) injection.publicText = text(injectionRaw.公开);
    if (injectionRaw.类型 === 'character' || injectionRaw.类型 === 'lore') injection.type = injectionRaw.类型;
    if (injectionRaw.核心身份与阵营 !== undefined) injection.identityAndFaction = text(injectionRaw.核心身份与阵营);
    if (injectionRaw.独立人格与行为 !== undefined) injection.personalityAndBehavior = text(injectionRaw.独立人格与行为);
    if (injectionRaw.说话方式 !== undefined) injection.speechStyle = text(injectionRaw.说话方式);
    if (injectionRaw.台词语料 !== undefined) injection.dialogueSamples = text(injectionRaw.台词语料);
    if (injectionRaw.外貌锚点 !== undefined) injection.appearanceAnchor = text(injectionRaw.外貌锚点);
    if (injectionRaw.当前形态与能力边界 !== undefined) injection.currentFormAndLimits = text(injectionRaw.当前形态与能力边界);
    if (injectionRaw.精简角色故事 !== undefined) injection.conciseStory = text(injectionRaw.精简角色故事);
    if (injectionRaw.演绎红线 !== undefined) injection.portrayalBoundaries = text(injectionRaw.演绎红线);
    if (injectionRaw.核心定义 !== undefined) injection.definition = text(injectionRaw.核心定义);
    if (injectionRaw.关键事实 !== undefined) injection.facts = text(injectionRaw.关键事实);
    if (injectionRaw.叙事用途 !== undefined) injection.narrativeUse = text(injectionRaw.叙事用途);
    if (injectionRaw.演绎边界 !== undefined) injection.boundaries = text(injectionRaw.演绎边界);
    return [{
      id: text(value.id) || `db-codex-${index}`, category: text(value.分类), name: text(value.标题),
      description: text(value.摘要), unlockedAtTurn: 0, tags: textList(value.关键词), summary: text(value.摘要),
      sourceText: text(value.原文), source: text(value.来源), keywords: textList(value.关键词),
      triggerKeywords: textList(value.触发关键词), injection,
      runtimeUnlock: {
        status: text(value.运行时解锁状态 ?? value.解锁状态), note: text(value.运行时解锁备注),
        ...(value.解锁条件 ? { condition: text(value.解锁条件) } : {}),
      },
      usage: {
        narrative: value.可否主剧情注入 === true,
        courier: (value.可否信使使用 ?? value.可否手机使用) === true,
        steambird: (value.可否蒸汽鸟报使用 ?? value.可否新闻使用) === true,
        variables: value.可否变量参考 === true,
      },
      relatedEntryIds: textList(value.关联条目ID), importance: Number(value.重要度) || 0,
      linkable: value.可用于联动 === true, builtin: value.builtin === true,
      createdAt: Number(value.createdAt) || 0, updatedAt: Number(value.updatedAt) || 0,
    }];
  }) : [];
  state.图鉴.unlockedEntryIds = state.图鉴.entries.filter((entry) => entry.runtimeUnlock.status && entry.runtimeUnlock.status !== '未解锁').map((entry) => entry.id);
  const newsSectionMap: Record<string, TeyvatGameState['蒸汽鸟报']['articles'][number]['section']> = {
    plan: 'notice', chronicle: 'local', starlog: 'world', frontline: 'investigation',
  };
  const newsStatusMap: Record<string, TeyvatGameState['蒸汽鸟报']['articles'][number]['status']> = {
    upcoming: 'upcoming', ongoing: 'ongoing', completed: 'published', archived: 'archived',
  };
  state.蒸汽鸟报.articles = Array.isArray(input.新闻) ? input.新闻.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    return [{
      id: text(value.id) || `db-article-${index}`, section: newsSectionMap[text(value.类目)] ?? 'world',
      status: newsStatusMap[text(value.状态)] ?? 'published', title: text(value.标题), body: text(value.正文),
      turn: Math.max(0, Math.trunc(Number(value.回合) || 0)), timestamp: Number(value.时间戳) || 0,
      important: value.重要 === true, organizationTags: textList(value.组织标签), relatedSystems: textList(value.关联系统),
      narrativeSeriesId: text(value.关联剧情系列ID), narrativeSegmentId: text(value.关联剧情分段ID),
      createdAt: Number(value.创建时间) || 0, updatedAt: Number(value.更新时间) || 0,
    }];
  }) : [];
  state.相册 = mapAlbum(input.相册);
  state.任务 = mapQuestJournal(input.任务);
  state.后台队列 = mapQueue(input.queueTasks);
  state.叙事 = { plotNodes: mapPlotNodes(input.剧情), storyWeaving: mapStoryWeaving(input.剧情编织), variableBatches: mapVariableBatches(input.variableBatches), 元素场面: createEmptyElementalField(), 元素事件: [] };
  return normalizeTeyvatGameState(state);
}

/**
 * Converts only partial Teyvat-shaped saves. Legacy HSR saves are quarantined
 * as raw data so an import UI can ask for consent instead of overwriting them.
 */
export function migratePartialTeyvatSave(input: unknown, resolutions: MigrationResolutions): SaveMigrationResult {
  const classification = classifySaveUniverse(input);
  const report = createMigrationReport(classification);

  if (classification === 'legacy-hsr') return { status: 'legacy-universe', raw: input, report };
  if (!isRecord(input)) return { status: 'invalid', errors: ['INVALID_SAVE_SHAPE'], report };
  if (classification === 'teyvat') return { status: 'migrated', state: normalizeTeyvatGameState(input), report };

  const hasLegacyTravelerShape = isRecord(input.旅人) && ('主命途' in input.旅人 || '主元素' in input.旅人);
  if (classification !== 'partial-teyvat' && !hasLegacyTravelerShape) {
    return { status: 'invalid', errors: ['UNCLASSIFIED_SAVE_UNIVERSE'], report };
  }

  const state = migratePartial(input, resolutions, report);
  if (report.issues.length > 0) return { status: 'needs-input', issues: report.issues, report };
  if (classification !== 'partial-teyvat') {
    return { status: 'invalid', errors: ['UNCLASSIFIED_SAVE_UNIVERSE'], report };
  }
  return { status: 'migrated', state, report };
}

/** Pure IndexedDB-record boundary. Old field names are read only in this compat module. */
export function classifyAndMigrateDbSaveRecord(
  input: unknown,
  resolutions: MigrationResolutions = {},
): DbSaveClassificationResult {
  const migration = migratePartialTeyvatSave(input, resolutions);
  if (migration.status === 'migrated') return { kind: 'teyvat', state: migration.state, report: migration.report };
  if (migration.status === 'needs-input') return { kind: 'needs-input', issues: migration.issues, report: migration.report };
  if (migration.status === 'legacy-universe') return { kind: 'legacy-hsr', raw: migration.raw, report: migration.report };
  return { kind: 'invalid', errors: migration.errors, report: migration.report };
}
import { isRecord } from '@/utils/valueGuards';
