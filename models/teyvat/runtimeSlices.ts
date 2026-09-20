export type TechnicalJsonValue = null | boolean | number | string | TechnicalJsonValue[] | TechnicalJsonObject;
import { ELEMENT_IDS, type ElementId } from './elements';
import { createEmptyElementalField, MAX_ELEMENT_EVENTS, type ElementalFieldState, type ElementalReactionEvent } from './elementalGauge';
import { readLegacyCodexDebugMetadata } from '@/compat/legacy-hsr/readOnly';
import {
  FACT_CANDIDATE_DOMAINS,
  STORY_BLOCK_KINDS,
  type NarrativeTurn,
} from './narrativeTurn';
export interface TechnicalJsonEntry { key: string; value: TechnicalJsonValue }
export interface TechnicalJsonObject { entries: TechnicalJsonEntry[] }

export type ConversationRole = 'user' | 'assistant' | 'system';

export type NarrativeTurnDto = NarrativeTurn;

export interface ConversationTurnCheckpoint {
  turnCount: number;
  pendingOpeningTrigger: string | null;
  traveler?: TravelerProfile;
  world?: TeyvatWorld;
  npc?: TeyvatNpcRecord[];
  inventory?: TeyvatInventory;
  courier?: CourierSystem;
  irminsul?: IrminsulMemory;
  codex?: ArchiveCodex;
  steambird?: SteambirdNews;
  memory?: MemoryLedger;
  album?: JourneyAlbum;
  quest?: QuestJournal;
  queue?: BackgroundQueueState;
  narrative?: NarrativeRuntime;
}

export interface TokenUsageDto {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  uncachedTokens?: number;
  cacheHitRate?: number;
  source: 'api' | 'estimate' | 'mixed';
  provider?: string;
  model?: string;
  usageFormat?: string;
  usagePath?: string;
  rawUsageKeys: string[];
  system?: string;
  cacheDiagnostic?: string;
}

export interface DebugMessageDto { role: ConversationRole; content: string }
export interface CachePrefixSectionDto { label: string; tokens: number }
export interface CachePrefixDiagnosticsDto {
  currentPromptTokens: number;
  previousPromptTokens?: number;
  commonPrefixChars: number;
  commonPrefixTokens: number;
  commonPrefixRate: number;
  firstDiffCurrentSection: string;
  firstDiffPreviousSection?: string;
  firstDiffCurrentExcerpt: string;
  firstDiffPreviousExcerpt?: string;
  changedTailTokens: number;
  largestChangedSections: CachePrefixSectionDto[];
}
export interface DebugMetadataDto {
  systemPrompt: string;
  messages: DebugMessageDto[];
  recallPreview?: string;
  recallSummary?: string;
  recallFullContent?: string;
  deepSeekMainMode?: 'off' | 'standard' | 'lock_format';
  deepSeekCotFakeHistorySkipped?: boolean;
  deepSeekPrefixMode?: boolean;
  deepSeekProtocolIssues: string[];
  deepSeekMainOriginalModel?: string;
  deepSeekMainAdaptedModel?: string;
  stV2Attempted?: boolean;
  stV2Used?: boolean;
  stV2FallbackReason?: string;
  rerollSimilarity?: number;
  rerollSimilarityRetried?: boolean;
  cachePrefixDiagnostics?: CachePrefixDiagnosticsDto;
  mainRequestMode?: 'stream' | 'non-stream';
  irminsulRecallPreview?: string;
  irminsulRecallRawText?: string;
  irminsulRecallUsedModel?: boolean;
  codexRecallPreview?: string;
  codexRecallInjection?: string;
  codexRecallRawText?: string;
  codexRecallUsedModel?: boolean;
}

export interface NarrativeImageDto {
  id: string;
  dataUrl: string;
  type: 'scene' | 'character';
  kind?: 'snapshot' | 'scene' | 'character';
  prompt: string;
  negativePrompt?: string;
  description?: string;
  status: 'generating' | 'done' | 'failed';
  error?: string;
  assetId?: string;
}

export interface ConversationEntry {
  id: string;
  role: ConversationRole;
  content: string;
  timestamp: number;
  gameTime?: string;
  bookmarked?: boolean;
  structuredResponse?: NarrativeTurnDto;
  preTurnState?: ConversationTurnCheckpoint;
  inputTokens?: number;
  outputTokens?: number;
  tokenUsage?: TokenUsageDto;
  responseDurationSec?: number;
  streaming?: boolean;
  bookmark?: { title: string; note?: string; createdAt: number };
  debugMetadata?: DebugMetadataDto;
  narrativeImages?: NarrativeImageDto[];
}

export interface ConversationLog { entries: ConversationEntry[] }

export interface MemoryRecoveryLog {
  id: string;
  sourceTurns: { start: number; end: number };
  summary: string;
  status: 'pending' | 'retrying' | 'resolved' | 'ignored';
  failureCode?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemorySourceSnapshotDto {
  encoding: 'gzip-base64' | 'plain-json';
  payload: string;
  checksum: string;
  itemCount: number;
  uncompressedBytes: number;
}

export interface MemoryFailedDraftDto {
  id: string;
  origin?: 'automatic' | 'batch_rebuild';
  kind: 'short' | 'middle' | 'long';
  status: 'pending' | 'retrying' | 'resolved' | 'ignored';
  sourceTurns: { start: number; end: number };
  sourceSnapshot: MemorySourceSnapshotDto;
  targetLayer: '短期记忆' | '中期记忆' | '长期记忆';
  fallbackSummary: string;
  failureCode: 'unconfigured' | 'request_failed' | 'empty_output' | 'source_changed';
  failureMessage: string;
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryLedger {
  immediate: string[];
  shortTerm: string[];
  mediumTerm: string[];
  longTerm: string[];
  recoveryLog: MemoryRecoveryLog[];
  failedDrafts: MemoryFailedDraftDto[];
}

export type AlbumTargetType = 'traveler' | 'npc' | 'phone' | 'scene' | 'item' | 'nsfw_part' | 'misc';
export type AlbumSlot = 'avatar_profile' | 'avatar_story' | 'avatar_phone' | 'portrait' | 'phone_wallpaper' | 'phone_chat_background' | 'group_avatar' | 'scene' | 'item_icon' | 'nsfw_female_chest' | 'nsfw_female_genital' | 'nsfw_male_genital' | 'nsfw_rear' | 'nsfw_body_reference' | 'reference_image' | 'misc';

export interface AlbumAssetDto {
  id: string;
  url?: string;
  originalUrl?: string;
  dataUrl?: string;
  localRef?: string;
  contentHash?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  size?: number;
  source: 'generated' | 'upload' | 'remote';
  nsfw: boolean;
  createdAt: number;
  prompt?: string;
  negativePrompt?: string;
  sourcePrompt?: string;
  finalPrompt?: string;
  finalNegativePrompt?: string;
  anchorMode?: boolean;
  anchorSummary?: string;
  referenceImageIds: string[];
  dimensions?: string;
  model?: string;
  backend?: string;
  status: 'ready' | 'failed' | 'pending';
  error?: string;
}

export interface JourneyAlbumEntry {
  id: string;
  kind: 'snapshot' | 'scene' | 'character';
  url: string;
  prompt: string;
  description: string;
  turn: number;
  createdAt: number;
  assetId?: string;
  title?: string;
  targetType?: AlbumTargetType;
  targetId?: string;
  slot?: AlbumSlot;
  tags?: string[];
  nsfw?: boolean;
  note?: string;
  referenceTargets?: string[];
}

export interface AlbumGenerationTaskDto {
  id: string;
  targetType: AlbumTargetType;
  targetId?: string;
  slot: AlbumSlot;
  source: 'manual' | 'auto' | 'retry';
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
  backend: string;
  nsfw: boolean;
  prompt: string;
  negativePrompt?: string;
  sourcePrompt?: string;
  finalPrompt?: string;
  finalNegativePrompt?: string;
  anchorMode?: boolean;
  anchorSummary?: string;
  referenceImageIds: string[];
  dimensions?: string;
  resultAssetId?: string;
  error?: string;
  retryCount: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface JourneyAlbum { entries: JourneyAlbumEntry[]; assets: AlbumAssetDto[]; generationTasks: AlbumGenerationTaskDto[] }

export type QuestStatus = 'not_started' | 'active' | 'completed' | 'failed' | 'abandoned';
export interface QuestObjective { id: string; type: 'reach' | 'collect' | 'talk' | 'travel' | 'defeat' | 'time'; description: string; targetCount: number; currentCount: number; completed: boolean }
export interface QuestEntry { id: string; title: string; description: string; source: 'main' | 'side' | 'custom' | 'letter'; status: QuestStatus; objectives: QuestObjective[]; rewards: string[]; createdAtTurn: number; updatedAt: number; completedAtTurn?: number; notes?: string }
export interface QuestJournal { active: QuestEntry[]; completed: QuestEntry[]; abandoned: QuestEntry[]; lastUpdates: string[] }

export type BackgroundQueueTaskStatus = 'pending' | 'success' | 'failed' | 'idle' | 'skipped' | 'cancelled';
export type BackgroundQueueTaskId = 'main_story' | 'memory' | 'variable' | 'steambird' | 'world_evolution' | 'irminsul' | 'codex' | 'courier' | 'autosave' | 'narrative_image_parse' | 'narrative_image_generate' | 'quest';
export interface BackgroundQueueTask { id: BackgroundQueueTaskId; title: string; turn: number; timestamp: number; status: BackgroundQueueTaskStatus; detail?: string; retryCount?: number; subtitle?: string; rawText?: string; targetMessageId?: string; targetBatchId?: string; retryHint?: string; retrying?: boolean; cancellable?: boolean; cancelled?: boolean }
export interface BackgroundQueueState { tasks: BackgroundQueueTask[] }

export type PlotStatus = 'pending' | 'active' | 'completed' | 'failed' | 'abandoned';
export interface PlotNodeDto { id: string; title: string; summary: string; status: PlotStatus; createdAtTurn: number; updatedAtTurn: number; prerequisiteNodeId?: string; guidance?: string }
export interface StoryChapterDto { id: string; index: number; title: string; content: string; characterCount: number }
export interface StoryVisibilityDto { knownBy: string[]; unknownBy: string[]; readerOnly: boolean }
export interface StoryConstraintDto { content: string; visibility: StoryVisibilityDto }
export interface StoryEventDto { name: string; description: string; prerequisites: string[]; triggers: string[]; blockers: string[]; results: string[]; laterEffects: string[]; visibility: StoryVisibilityDto }
export interface StoryCharacterProgressDto { characterName: string; beforeState: string[]; changes: string[]; afterState: string[]; laterEffects: string[] }
export interface StoryTimelineEventDto { title: string; timeAnchor: string; description: string; characters: string[] }
export interface StoryCharacterProfileDto { name: string; identity: string; faction: string; initialPosition: string; relationshipSummary: string[]; stateSummary: string[]; firstAppearance: string; importance: 'ordinary' | 'important' | 'core' }
export interface StoryFactionProfileDto { name: string; type: string; territory: string; representatives: string[]; goals: string; currentState: string; relationshipSummary: string[]; firstAppearance: string }
export interface StoryLocationProfileDto { name: string; level: 'universe' | 'major' | 'medium' | 'minor' | 'district' | 'sub_location' | 'unknown'; parentLocation: string; faction: string; function: string; facilities: string[]; firstAppearance: string }
export interface StorySegmentDto {
  id: string; group: number; title: string; chapterRange: string; chapterTitles: string[]; opening: boolean;
  startChapter: number; endChapter: number; injectionEnabled: boolean; sourceText: string; characterCount: number;
  sourceSummary: string; stageSummary: string; timelineStart: string; timelineEnd: string; establishedFacts: string[];
  continuedFacts: string[]; endState: string[]; futureReferences: string[]; characters: string[]; locations: string[]; factions: string[];
  canonConstraints: StoryConstraintDto[]; foreshadowing: StoryConstraintDto[]; characterProfiles: StoryCharacterProfileDto[];
  factionProfiles: StoryFactionProfileDto[]; locationProfiles: StoryLocationProfileDto[]; keyEvents: StoryEventDto[];
  timeline: StoryTimelineEventDto[]; characterProgress: StoryCharacterProgressDto[];
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'; runtimeStatus: 'not_started' | 'current' | 'experienced' | 'skipped' | 'diverged' | 'paused';
  lastError?: string; updatedAt: number;
}
export interface StorySeriesDto {
  id: string; title: string; workTitle: string; sourceType: 'canon' | 'custom'; sourceCodexEntryIds: string[];
  builtinPresetId?: string; sourceFileName?: string; sourceText?: string; chapters: StoryChapterDto[]; segments: StorySegmentDto[];
  chaptersPerSegment: number; active: boolean; currentSegmentGroup: number; currentStageSummary: string;
  coreCharacterSummary: string[]; coreCharacters: string[]; locationIndex: string[]; factionIndex: string[]; createdAt: number; updatedAt: number;
}
export interface StoryProgressArchiveDto { id: string; seriesId?: string; segmentId?: string; segmentGroup: number; segmentTitle: string; archivedAtTurn?: number; status: 'experienced' | 'skipped' | 'diverged' | 'completed'; summary: string; characterProgress: string[]; switchNotes: string; reasons: string[]; createdAt: number }
export interface StoryProgressDto { seriesId?: string; segmentId?: string; segmentGroup: number; status: 'not_started' | 'progressing' | 'completed' | 'diverged' | 'paused'; completedSummaries: string[]; openQuestions: string[]; switchNotes: string[]; archive: StoryProgressArchiveDto[]; gate?: 'soft' | 'strong'; reasons: string[]; lastDecisionTurn?: number; evidence: string[]; consecutiveEvidenceTurns: number; stalledTurns: number; updatedAt: number }
export interface StoryWeavingDto { series: StorySeriesDto[]; activeSeriesId?: string; progress?: StoryProgressDto }

export interface VariableCommandDto { action: 'set' | 'add' | 'sub' | 'push' | 'delete'; key: string; value: TechnicalJsonValue }
export interface VariableCommandResultDto { command: VariableCommandDto; ok: boolean; kind?: 'command' | 'warning' | 'error' | 'rejected'; reason?: string }
export interface VariableBatchDto { id: string; turn: number; timestamp: number; source: 'main' | 'calibration'; modelName?: string; results: VariableCommandResultDto[]; report?: string; rawText?: string; retentionSummary?: { totalResults: number; succeededResults: number; diagnosticResults: number; omittedDiagnosticResults: number } }
export interface NarrativeRuntime {
  plotNodes: PlotNodeDto[];
  storyWeaving: StoryWeavingDto | null;
  variableBatches: VariableBatchDto[];
  /** G1 场面元素附着（极简：无量槽无衰减）。 */
  元素场面: ElementalFieldState;
  /** G1 元素反应事件记录（最近 30 条）。 */
  元素事件: ElementalReactionEvent[];
}

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const elementIdText = (value: unknown): string => {
  const candidate = text(value);
  return ELEMENT_IDS.includes(candidate as ElementId) ? candidate : '';
};
const optionalText = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;
const textList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const integer = (value: unknown): number => Math.max(0, Math.trunc(Number(value) || 0));
const number = (value: unknown): number => Number(value) || 0;

export function normalizeTechnicalJsonValue(value: unknown, depth = 0): TechnicalJsonValue {
  if (depth >= 12 || value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => normalizeTechnicalJsonValue(item, depth + 1));
  if (!isRecord(value)) return null;
  return { entries: Object.entries(value).map(([key, item]) => ({ key, value: normalizeTechnicalJsonValue(item, depth + 1) })) };
}

const normalizeTechnicalEntries = (value: unknown): TechnicalJsonEntry[] => {
  if (Array.isArray(value)) return value.flatMap((item) => isRecord(item) && typeof item.key === 'string' ? [{ key: item.key, value: normalizeTechnicalJsonValue(item.value) }] : []);
  if (isRecord(value)) return Object.entries(value).map(([key, item]) => ({ key, value: normalizeTechnicalJsonValue(item) }));
  return [];
};

function normalizeStructuredResponse(value: unknown): NarrativeTurnDto | undefined {
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.body) && Array.isArray(value.choices) && Array.isArray(value.factCandidates) && isRecord(value.continuation)) {
    const body = value.body.flatMap((item) => {
      if (!isRecord(item) || !STORY_BLOCK_KINDS.includes(item.kind as NarrativeTurn['body'][number]['kind'])) return [];
      const blockText = optionalText(item.text);
      if (!blockText) return [];
      const id = optionalText(item.id);
      const speaker = optionalText(item.speaker);
      return [{ kind: item.kind as NarrativeTurn['body'][number]['kind'], text: blockText, ...(id ? { id } : {}), ...(speaker ? { speaker } : {}) }];
    });
    const seenChoiceIds = new Set<string>();
    const choices = value.choices.flatMap((item) => {
      if (!isRecord(item)) return [];
      const id = optionalText(item.id);
      const label = optionalText(item.label);
      if (!id || !label || seenChoiceIds.has(id)) return [];
      seenChoiceIds.add(id);
      return [{ id, label }];
    });
    const factCandidates = value.factCandidates.flatMap((item) => {
      if (!isRecord(item) || !FACT_CANDIDATE_DOMAINS.includes(item.domain as NarrativeTurn['factCandidates'][number]['domain'])) return [];
      const fact = optionalText(item.fact);
      const evidence = optionalText(item.evidence);
      if (!fact || !evidence || !body.some((block) => block.text.includes(evidence))) return [];
      return [{ domain: item.domain as NarrativeTurn['factCandidates'][number]['domain'], fact, evidence }];
    });
    return {
      body,
      choices,
      factCandidates,
      continuation: {
        summary: text(value.continuation.summary).trim(),
        unresolved: Array.from(new Set(textList(value.continuation.unresolved).map((item) => item.trim()).filter(Boolean))),
      },
    };
  }

  // Read-once compatibility for old saved structured response DTOs.
  const legacyBody = optionalText(value.body);
  const legacyChoices = textList(value.actionOptions).map((label, index) => ({
    id: `legacy-choice-${index + 1}`,
    label: label.trim(),
  })).filter((choice) => choice.label);
  const legacySummary = optionalText(value.memory) ?? optionalText(value.storyPlan) ?? '';
  if (!legacyBody && legacyChoices.length === 0 && !legacySummary) return undefined;
  return {
    body: legacyBody ? [{ kind: 'narration', text: legacyBody }] : [],
    choices: legacyChoices,
    factCandidates: [],
    continuation: { summary: legacySummary, unresolved: [] },
  };
}

function normalizeTokenUsage(value: unknown): TokenUsageDto | undefined {
  if (!isRecord(value)) return undefined;
  const source = value.source === 'estimate' || value.source === 'mixed' ? value.source : 'api';
  const rawSystem = optionalText(value.system);
  const system = rawSystem ? ({ news: 'steambird', phone: 'courier', yiting: 'irminsul', zhiku: 'codex' } as const)[rawSystem as 'news' | 'phone' | 'yiting' | 'zhiku'] ?? rawSystem : undefined;
  return { inputTokens: number(value.inputTokens), outputTokens: number(value.outputTokens), totalTokens: number(value.totalTokens), source, rawUsageKeys: textList(value.rawUsageKeys), ...(Number.isFinite(Number(value.cachedTokens)) ? { cachedTokens: number(value.cachedTokens) } : {}), ...(Number.isFinite(Number(value.uncachedTokens)) ? { uncachedTokens: number(value.uncachedTokens) } : {}), ...(Number.isFinite(Number(value.cacheHitRate)) ? { cacheHitRate: number(value.cacheHitRate) } : {}), ...(optionalText(value.provider) ? { provider: text(value.provider) } : {}), ...(optionalText(value.model) ? { model: text(value.model) } : {}), ...(optionalText(value.usageFormat) ? { usageFormat: text(value.usageFormat) } : {}), ...(optionalText(value.usagePath) ? { usagePath: text(value.usagePath) } : {}), ...(system ? { system } : {}), ...(optionalText(value.cacheDiagnostic) ? { cacheDiagnostic: text(value.cacheDiagnostic) } : {}) };
}

function normalizeDebugMetadata(value: unknown): DebugMetadataDto | undefined {
  if (!isRecord(value)) return undefined;
  const legacyCodex = readLegacyCodexDebugMetadata(value);
  const mode = value.deepSeekMainMode === 'standard' || value.deepSeekMainMode === 'lock_format' ? value.deepSeekMainMode : value.deepSeekMainMode === 'off' ? 'off' : undefined;
  const requestMode = value.mainRequestMode === 'stream' || value.mainRequestMode === 'non-stream' ? value.mainRequestMode : undefined;
  const cache = isRecord(value.cachePrefixDiagnostics) ? value.cachePrefixDiagnostics : null;
  const irminsulRecallPreview = optionalText(value.irminsulRecallPreview) ?? optionalText(value.yitingRecallPreview);
  const irminsulRecallRawText = optionalText(value.irminsulRecallRawText) ?? optionalText(value.yitingRecallRawText);
  const irminsulRecallUsedModel = typeof value.irminsulRecallUsedModel === 'boolean' ? value.irminsulRecallUsedModel : value.yitingRecallUsedModel;
  const codexRecallPreview = optionalText(value.codexRecallPreview) ?? optionalText(legacyCodex.preview);
  const codexRecallInjection = optionalText(value.codexRecallInjection) ?? optionalText(legacyCodex.injection);
  const codexRecallRawText = optionalText(value.codexRecallRawText) ?? optionalText(legacyCodex.rawText);
  const codexRecallUsedModel = typeof value.codexRecallUsedModel === 'boolean' ? value.codexRecallUsedModel : legacyCodex.usedModel;
  return {
    systemPrompt: text(value.systemPrompt), messages: Array.isArray(value.messages) ? value.messages.flatMap((item) => isRecord(item) ? [{ role: item.role === 'user' || item.role === 'assistant' ? item.role : 'system', content: text(item.content) }] : []) : [],
    deepSeekProtocolIssues: textList(value.deepSeekProtocolIssues),
    ...(optionalText(value.recallPreview) ? { recallPreview: text(value.recallPreview) } : {}), ...(optionalText(value.recallSummary) ? { recallSummary: text(value.recallSummary) } : {}), ...(optionalText(value.recallFullContent) ? { recallFullContent: text(value.recallFullContent) } : {}),
    ...(mode ? { deepSeekMainMode: mode } : {}), ...(typeof value.deepSeekCotFakeHistorySkipped === 'boolean' ? { deepSeekCotFakeHistorySkipped: value.deepSeekCotFakeHistorySkipped } : {}), ...(typeof value.deepSeekPrefixMode === 'boolean' ? { deepSeekPrefixMode: value.deepSeekPrefixMode } : {}),
    ...(optionalText(value.deepSeekMainOriginalModel) ? { deepSeekMainOriginalModel: text(value.deepSeekMainOriginalModel) } : {}), ...(optionalText(value.deepSeekMainAdaptedModel) ? { deepSeekMainAdaptedModel: text(value.deepSeekMainAdaptedModel) } : {}),
    ...(typeof value.stV2Attempted === 'boolean' ? { stV2Attempted: value.stV2Attempted } : {}), ...(typeof value.stV2Used === 'boolean' ? { stV2Used: value.stV2Used } : {}), ...(optionalText(value.stV2FallbackReason) ? { stV2FallbackReason: text(value.stV2FallbackReason) } : {}),
    ...(Number.isFinite(Number(value.rerollSimilarity)) ? { rerollSimilarity: number(value.rerollSimilarity) } : {}), ...(typeof value.rerollSimilarityRetried === 'boolean' ? { rerollSimilarityRetried: value.rerollSimilarityRetried } : {}),
    ...(cache ? { cachePrefixDiagnostics: { currentPromptTokens: number(cache.currentPromptTokens), ...(Number.isFinite(Number(cache.previousPromptTokens)) ? { previousPromptTokens: number(cache.previousPromptTokens) } : {}), commonPrefixChars: number(cache.commonPrefixChars), commonPrefixTokens: number(cache.commonPrefixTokens), commonPrefixRate: number(cache.commonPrefixRate), firstDiffCurrentSection: text(cache.firstDiffCurrentSection), ...(optionalText(cache.firstDiffPreviousSection) ? { firstDiffPreviousSection: text(cache.firstDiffPreviousSection) } : {}), firstDiffCurrentExcerpt: text(cache.firstDiffCurrentExcerpt), ...(optionalText(cache.firstDiffPreviousExcerpt) ? { firstDiffPreviousExcerpt: text(cache.firstDiffPreviousExcerpt) } : {}), changedTailTokens: number(cache.changedTailTokens), largestChangedSections: Array.isArray(cache.largestChangedSections) ? cache.largestChangedSections.flatMap((item) => isRecord(item) ? [{ label: text(item.label), tokens: number(item.tokens) }] : []) : [] } } : {}),
    ...(requestMode ? { mainRequestMode: requestMode } : {}), ...(irminsulRecallPreview ? { irminsulRecallPreview } : {}), ...(irminsulRecallRawText ? { irminsulRecallRawText } : {}), ...(typeof irminsulRecallUsedModel === 'boolean' ? { irminsulRecallUsedModel } : {}), ...(codexRecallPreview ? { codexRecallPreview } : {}), ...(codexRecallInjection ? { codexRecallInjection } : {}), ...(codexRecallRawText ? { codexRecallRawText } : {}), ...(typeof codexRecallUsedModel === 'boolean' ? { codexRecallUsedModel } : {}),
  };
}

function normalizeNarrativeImage(value: unknown): NarrativeImageDto | null {
  if (!isRecord(value)) return null;
  const type = value.type === 'character' ? 'character' : 'scene';
  const kind = value.kind === 'snapshot' || value.kind === 'scene' || value.kind === 'character' ? value.kind : undefined;
  const status = value.status === 'generating' || value.status === 'failed' ? value.status : 'done';
  return { id: text(value.id), dataUrl: text(value.dataUrl), type, ...(kind ? { kind } : {}), prompt: text(value.prompt), ...(optionalText(value.negativePrompt) ? { negativePrompt: text(value.negativePrompt) } : {}), ...(optionalText(value.description) ? { description: text(value.description) } : {}), status, ...(optionalText(value.error) ? { error: text(value.error) } : {}), ...(optionalText(value.assetId) ? { assetId: text(value.assetId) } : {}) };
}

export function normalizeConversationLog(value: unknown): ConversationLog {
  const raw = isRecord(value) ? value : {};
  return { entries: Array.isArray(raw.entries) ? raw.entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const role: ConversationRole = entry.role === 'user' || entry.role === 'assistant' ? entry.role : 'system';
    const structuredResponse = normalizeStructuredResponse(entry.structuredResponse);
    const tokenUsage = normalizeTokenUsage(entry.tokenUsage);
    const debugMetadata = normalizeDebugMetadata(entry.debugMetadata);
    const checkpoint = isRecord(entry.preTurnState) ? {
      turnCount: integer(entry.preTurnState.turnCount), pendingOpeningTrigger: typeof entry.preTurnState.pendingOpeningTrigger === 'string' ? entry.preTurnState.pendingOpeningTrigger : null,
      ...(isRecord(entry.preTurnState.traveler) ? { traveler: normalizeTravelerProfile(entry.preTurnState.traveler) } : {}),
      ...(isRecord(entry.preTurnState.world) ? { world: normalizeTeyvatWorld(entry.preTurnState.world) } : {}),
      ...(Array.isArray(entry.preTurnState.npc) ? { npc: normalizeTeyvatNpcRecords(entry.preTurnState.npc) } : {}),
      ...(isRecord(entry.preTurnState.inventory) ? { inventory: normalizeTeyvatInventory(entry.preTurnState.inventory) } : {}),
      ...(isRecord(entry.preTurnState.courier) ? { courier: normalizeCourierSystem(entry.preTurnState.courier) } : {}),
      ...(isRecord(entry.preTurnState.irminsul) ? { irminsul: normalizeIrminsulMemory(entry.preTurnState.irminsul) } : {}),
      ...(isRecord(entry.preTurnState.codex) ? { codex: normalizeArchiveCodex(entry.preTurnState.codex) } : {}),
      ...(isRecord(entry.preTurnState.steambird ?? entry.preTurnState.news) ? { steambird: normalizeSteambirdNews(entry.preTurnState.steambird ?? entry.preTurnState.news) } : {}),
      ...(isRecord(entry.preTurnState.memory) ? { memory: normalizeMemoryLedger(entry.preTurnState.memory) } : {}),
      ...(isRecord(entry.preTurnState.album) ? { album: normalizeJourneyAlbum(entry.preTurnState.album) } : {}),
      ...(isRecord(entry.preTurnState.quest) ? { quest: normalizeQuestJournal(entry.preTurnState.quest) } : {}),
      ...(isRecord(entry.preTurnState.queue) ? { queue: normalizeBackgroundQueueState(entry.preTurnState.queue) } : {}),
      ...(isRecord(entry.preTurnState.narrative) ? { narrative: normalizeNarrativeRuntime(entry.preTurnState.narrative) } : {}),
    } : undefined;
    const bookmark = isRecord(entry.bookmark) ? { title: text(entry.bookmark.title), ...(optionalText(entry.bookmark.note) ? { note: text(entry.bookmark.note) } : {}), createdAt: number(entry.bookmark.createdAt) } : undefined;
    return [{ id: text(entry.id), role, content: text(entry.content), timestamp: number(entry.timestamp), ...(optionalText(entry.gameTime) ? { gameTime: text(entry.gameTime) } : {}), ...(typeof entry.bookmarked === 'boolean' ? { bookmarked: entry.bookmarked } : {}), ...(structuredResponse ? { structuredResponse } : {}), ...(checkpoint ? { preTurnState: checkpoint } : {}), ...(Number.isFinite(Number(entry.inputTokens)) ? { inputTokens: number(entry.inputTokens) } : {}), ...(Number.isFinite(Number(entry.outputTokens)) ? { outputTokens: number(entry.outputTokens) } : {}), ...(tokenUsage ? { tokenUsage } : {}), ...(Number.isFinite(Number(entry.responseDurationSec)) ? { responseDurationSec: number(entry.responseDurationSec) } : {}), ...(typeof entry.streaming === 'boolean' ? { streaming: entry.streaming } : {}), ...(bookmark ? { bookmark } : {}), ...(debugMetadata ? { debugMetadata } : {}), ...(Array.isArray(entry.narrativeImages) ? { narrativeImages: entry.narrativeImages.flatMap((item) => normalizeNarrativeImage(item) ?? []) } : {}) }];
  }) : [] };
}

function normalizeTurnRange(value: unknown): { start: number; end: number } { const raw = isRecord(value) ? value : {}; return { start: integer(raw.start), end: integer(raw.end) } }
export function normalizeMemoryLedger(value: unknown): MemoryLedger {
  const raw = isRecord(value) ? value : {};
  const recoveryStatuses = ['pending', 'retrying', 'resolved', 'ignored'] as const;
  const draftKinds = ['short', 'middle', 'long'] as const;
  const failureCodes = ['unconfigured', 'request_failed', 'empty_output', 'source_changed'] as const;
  return { immediate: textList(raw.immediate), shortTerm: textList(raw.shortTerm), mediumTerm: textList(raw.mediumTerm), longTerm: textList(raw.longTerm), recoveryLog: Array.isArray(raw.recoveryLog) ? raw.recoveryLog.flatMap((entry) => isRecord(entry) ? [{ id: text(entry.id), sourceTurns: normalizeTurnRange(entry.sourceTurns), summary: text(entry.summary), status: recoveryStatuses.find((item) => item === entry.status) ?? 'pending', ...(optionalText(entry.failureCode) ? { failureCode: text(entry.failureCode) } : {}), createdAt: number(entry.createdAt), updatedAt: number(entry.updatedAt) }] : []) : [], failedDrafts: Array.isArray(raw.failedDrafts) ? raw.failedDrafts.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const snapshot = isRecord(entry.sourceSnapshot) ? entry.sourceSnapshot : {};
    return [{ id: text(entry.id), ...(entry.origin === 'automatic' || entry.origin === 'batch_rebuild' ? { origin: entry.origin } : {}), kind: draftKinds.find((item) => item === entry.kind) ?? 'short', status: recoveryStatuses.find((item) => item === entry.status) ?? 'pending', sourceTurns: normalizeTurnRange(entry.sourceTurns), sourceSnapshot: { encoding: snapshot.encoding === 'gzip-base64' ? 'gzip-base64' : 'plain-json', payload: text(snapshot.payload), checksum: text(snapshot.checksum), itemCount: integer(snapshot.itemCount), uncompressedBytes: integer(snapshot.uncompressedBytes) }, targetLayer: entry.targetLayer === '中期记忆' || entry.targetLayer === '长期记忆' ? entry.targetLayer : '短期记忆', fallbackSummary: text(entry.fallbackSummary), failureCode: failureCodes.find((item) => item === entry.failureCode) ?? 'request_failed', failureMessage: text(entry.failureMessage), attemptCount: integer(entry.attemptCount), createdAt: number(entry.createdAt), updatedAt: number(entry.updatedAt) }];
  }) : [] };
}

const TARGET_TYPES: AlbumTargetType[] = ['traveler', 'npc', 'phone', 'scene', 'item', 'nsfw_part', 'misc'];
const ALBUM_SLOTS: AlbumSlot[] = ['avatar_profile', 'avatar_story', 'avatar_phone', 'portrait', 'phone_wallpaper', 'phone_chat_background', 'group_avatar', 'scene', 'item_icon', 'nsfw_female_chest', 'nsfw_female_genital', 'nsfw_male_genital', 'nsfw_rear', 'nsfw_body_reference', 'reference_image', 'misc'];
export function normalizeJourneyAlbum(value: unknown): JourneyAlbum {
  const raw = isRecord(value) ? value : {};
  return {
    assets: Array.isArray(raw.assets) ? raw.assets.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      return [{ id: text(entry.id), ...(optionalText(entry.url) ? { url: text(entry.url) } : {}), ...(optionalText(entry.originalUrl) ? { originalUrl: text(entry.originalUrl) } : {}), ...(optionalText(entry.dataUrl) ? { dataUrl: text(entry.dataUrl) } : {}), ...(optionalText(entry.localRef) ? { localRef: text(entry.localRef) } : {}), ...(optionalText(entry.contentHash) ? { contentHash: text(entry.contentHash) } : {}), ...(optionalText(entry.mimeType) ? { mimeType: text(entry.mimeType) } : {}), ...(Number.isFinite(Number(entry.width)) ? { width: integer(entry.width) } : {}), ...(Number.isFinite(Number(entry.height)) ? { height: integer(entry.height) } : {}), ...(Number.isFinite(Number(entry.size)) ? { size: integer(entry.size) } : {}), source: entry.source === 'upload' || entry.source === 'remote' ? entry.source : 'generated', nsfw: entry.nsfw === true, createdAt: number(entry.createdAt), ...(optionalText(entry.prompt) ? { prompt: text(entry.prompt) } : {}), ...(optionalText(entry.negativePrompt) ? { negativePrompt: text(entry.negativePrompt) } : {}), ...(optionalText(entry.sourcePrompt) ? { sourcePrompt: text(entry.sourcePrompt) } : {}), ...(optionalText(entry.finalPrompt) ? { finalPrompt: text(entry.finalPrompt) } : {}), ...(optionalText(entry.finalNegativePrompt) ? { finalNegativePrompt: text(entry.finalNegativePrompt) } : {}), ...(typeof entry.anchorMode === 'boolean' ? { anchorMode: entry.anchorMode } : {}), ...(optionalText(entry.anchorSummary) ? { anchorSummary: text(entry.anchorSummary) } : {}), referenceImageIds: textList(entry.referenceImageIds), ...(optionalText(entry.dimensions) ? { dimensions: text(entry.dimensions) } : {}), ...(optionalText(entry.model) ? { model: text(entry.model) } : {}), ...(optionalText(entry.backend) ? { backend: text(entry.backend) } : {}), status: entry.status === 'failed' || entry.status === 'pending' ? entry.status : 'ready', ...(optionalText(entry.error) ? { error: text(entry.error) } : {}) }];
    }) : [],
    entries: Array.isArray(raw.entries) ? raw.entries.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const kind = entry.kind === 'snapshot' || entry.kind === 'character' ? entry.kind : 'scene';
      const targetType = TARGET_TYPES.find((item) => item === entry.targetType);
      const slot = ALBUM_SLOTS.find((item) => item === entry.slot);
      return [{ id: text(entry.id), kind, url: text(entry.url), prompt: text(entry.prompt), description: text(entry.description), turn: integer(entry.turn), createdAt: number(entry.createdAt), ...(optionalText(entry.assetId) ? { assetId: text(entry.assetId) } : {}), ...(optionalText(entry.title) ? { title: text(entry.title) } : {}), ...(targetType ? { targetType } : {}), ...(optionalText(entry.targetId) ? { targetId: text(entry.targetId) } : {}), ...(slot ? { slot } : {}), tags: textList(entry.tags), ...(typeof entry.nsfw === 'boolean' ? { nsfw: entry.nsfw } : {}), ...(optionalText(entry.note) ? { note: text(entry.note) } : {}), referenceTargets: textList(entry.referenceTargets) }];
    }) : [],
    generationTasks: Array.isArray(raw.generationTasks) ? raw.generationTasks.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const targetType = TARGET_TYPES.find((item) => item === entry.targetType) ?? 'misc';
      const slot = ALBUM_SLOTS.find((item) => item === entry.slot) ?? 'misc';
      const source = entry.source === 'auto' || entry.source === 'retry' ? entry.source : 'manual';
      const status = entry.status === 'running' || entry.status === 'success' || entry.status === 'failed' || entry.status === 'cancelled' ? entry.status : 'queued';
      return [{ id: text(entry.id), targetType, ...(optionalText(entry.targetId) ? { targetId: text(entry.targetId) } : {}), slot, source, status, backend: text(entry.backend), nsfw: entry.nsfw === true, prompt: text(entry.prompt), ...(optionalText(entry.negativePrompt) ? { negativePrompt: text(entry.negativePrompt) } : {}), ...(optionalText(entry.sourcePrompt) ? { sourcePrompt: text(entry.sourcePrompt) } : {}), ...(optionalText(entry.finalPrompt) ? { finalPrompt: text(entry.finalPrompt) } : {}), ...(optionalText(entry.finalNegativePrompt) ? { finalNegativePrompt: text(entry.finalNegativePrompt) } : {}), ...(typeof entry.anchorMode === 'boolean' ? { anchorMode: entry.anchorMode } : {}), ...(optionalText(entry.anchorSummary) ? { anchorSummary: text(entry.anchorSummary) } : {}), referenceImageIds: textList(entry.referenceImageIds), ...(optionalText(entry.dimensions) ? { dimensions: text(entry.dimensions) } : {}), ...(optionalText(entry.resultAssetId) ? { resultAssetId: text(entry.resultAssetId) } : {}), ...(optionalText(entry.error) ? { error: text(entry.error) } : {}), retryCount: integer(entry.retryCount), createdAt: number(entry.createdAt), ...(Number.isFinite(Number(entry.startedAt)) ? { startedAt: number(entry.startedAt) } : {}), ...(Number.isFinite(Number(entry.finishedAt)) ? { finishedAt: number(entry.finishedAt) } : {}) }];
    }) : [],
  };
}

const QUEST_STATUSES: QuestStatus[] = ['not_started', 'active', 'completed', 'failed', 'abandoned'];
const QUEST_SOURCES: QuestEntry['source'][] = ['main', 'side', 'custom', 'letter'];
const OBJECTIVE_TYPES: QuestObjective['type'][] = ['reach', 'collect', 'talk', 'travel', 'defeat', 'time'];
function normalizeQuestEntry(value: unknown): QuestEntry | null {
  if (!isRecord(value)) return null;
  return { id: text(value.id), title: text(value.title), description: text(value.description), source: QUEST_SOURCES.find((item) => item === value.source) ?? 'custom', status: QUEST_STATUSES.find((item) => item === value.status) ?? 'not_started', objectives: Array.isArray(value.objectives) ? value.objectives.flatMap((entry) => isRecord(entry) ? [{ id: text(entry.id), type: OBJECTIVE_TYPES.find((item) => item === entry.type) ?? 'reach', description: text(entry.description), targetCount: integer(entry.targetCount), currentCount: integer(entry.currentCount), completed: entry.completed === true }] : []) : [], rewards: textList(value.rewards), createdAtTurn: integer(value.createdAtTurn), updatedAt: number(value.updatedAt), ...(Number.isFinite(Number(value.completedAtTurn)) ? { completedAtTurn: integer(value.completedAtTurn) } : {}), ...(optionalText(value.notes) ? { notes: text(value.notes) } : {}) };
}
export function normalizeQuestJournal(value: unknown): QuestJournal { const raw = isRecord(value) ? value : {}; const list = (entry: unknown): QuestEntry[] => Array.isArray(entry) ? entry.flatMap((item) => normalizeQuestEntry(item) ?? []) : []; return { active: list(raw.active), completed: list(raw.completed), abandoned: list(raw.abandoned), lastUpdates: textList(raw.lastUpdates) } }

const QUEUE_STATUSES: BackgroundQueueTaskStatus[] = ['pending', 'success', 'failed', 'idle', 'skipped', 'cancelled'];
const QUEUE_TASK_IDS: readonly BackgroundQueueTaskId[] = ['main_story', 'memory', 'variable', 'steambird', 'world_evolution', 'irminsul', 'codex', 'courier', 'autosave', 'narrative_image_parse', 'narrative_image_generate', 'quest'];
const LEGACY_QUEUE_TASK_IDS: Readonly<Record<string, BackgroundQueueTaskId>> = { news: 'steambird', yiting: 'irminsul', zhiku: 'codex', phone: 'courier' };
export function normalizeBackgroundQueueState(value: unknown): BackgroundQueueState { const raw = isRecord(value) ? value : {}; return { tasks: Array.isArray(raw.tasks) ? raw.tasks.flatMap((entry) => { if (!isRecord(entry)) return []; const idValue = text(entry.id); const id = QUEUE_TASK_IDS.find((item) => item === idValue) ?? LEGACY_QUEUE_TASK_IDS[idValue]; if (!id) return []; return [{ id, title: text(entry.title), turn: integer(entry.turn), timestamp: number(entry.timestamp), status: QUEUE_STATUSES.find((item) => item === entry.status) ?? 'pending', ...(optionalText(entry.detail) ? { detail: text(entry.detail) } : {}), ...(Number.isFinite(Number(entry.retryCount)) ? { retryCount: integer(entry.retryCount) } : {}), ...(optionalText(entry.subtitle) ? { subtitle: text(entry.subtitle) } : {}), ...(optionalText(entry.rawText) ? { rawText: text(entry.rawText) } : {}), ...(optionalText(entry.targetMessageId) ? { targetMessageId: text(entry.targetMessageId) } : {}), ...(optionalText(entry.targetBatchId) ? { targetBatchId: text(entry.targetBatchId) } : {}), ...(optionalText(entry.retryHint) ? { retryHint: text(entry.retryHint) } : {}), ...(typeof entry.retrying === 'boolean' ? { retrying: entry.retrying } : {}), ...(typeof entry.cancellable === 'boolean' ? { cancellable: entry.cancellable } : {}), ...(typeof entry.cancelled === 'boolean' ? { cancelled: entry.cancelled } : {}) }]; }) : [] } }

function normalizePlotNode(value: unknown): PlotNodeDto | null { if (!isRecord(value)) return null; const statuses: PlotStatus[] = ['pending', 'active', 'completed', 'failed', 'abandoned']; return { id: text(value.id), title: text(value.title), summary: text(value.summary), status: statuses.find((item) => item === value.status) ?? 'pending', createdAtTurn: integer(value.createdAtTurn), updatedAtTurn: integer(value.updatedAtTurn), ...(optionalText(value.prerequisiteNodeId) ? { prerequisiteNodeId: text(value.prerequisiteNodeId) } : {}), ...(optionalText(value.guidance) ? { guidance: text(value.guidance) } : {}) } }
function normalizeStoryVisibility(value: unknown): StoryVisibilityDto {
  const raw = isRecord(value) ? value : {};
  return { knownBy: textList(raw.knownBy), unknownBy: textList(raw.unknownBy), readerOnly: raw.readerOnly === true };
}

function normalizeStoryConstraints(value: unknown): StoryConstraintDto[] {
  return Array.isArray(value) ? value.flatMap((entry) => isRecord(entry) ? [{ content: text(entry.content), visibility: normalizeStoryVisibility(entry.visibility) }] : []) : [];
}

function normalizeStorySeries(value: unknown): StorySeriesDto | null {
  if (!isRecord(value)) return null;
  return {
    id: text(value.id), title: text(value.title), workTitle: text(value.workTitle), sourceType: value.sourceType === 'canon' ? 'canon' : 'custom', sourceCodexEntryIds: textList(value.sourceCodexEntryIds),
    ...(optionalText(value.builtinPresetId) ? { builtinPresetId: text(value.builtinPresetId) } : {}), ...(optionalText(value.sourceFileName) ? { sourceFileName: text(value.sourceFileName) } : {}), ...(optionalText(value.sourceText) ? { sourceText: text(value.sourceText) } : {}),
    chapters: Array.isArray(value.chapters) ? value.chapters.flatMap((entry) => isRecord(entry) ? [{ id: text(entry.id), index: integer(entry.index), title: text(entry.title), content: text(entry.content), characterCount: integer(entry.characterCount) }] : []) : [],
    segments: Array.isArray(value.segments) ? value.segments.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const processing = entry.processingStatus === 'processing' || entry.processingStatus === 'completed' || entry.processingStatus === 'failed' ? entry.processingStatus : 'pending';
      const runtime = entry.runtimeStatus === 'current' || entry.runtimeStatus === 'experienced' || entry.runtimeStatus === 'skipped' || entry.runtimeStatus === 'diverged' || entry.runtimeStatus === 'paused' ? entry.runtimeStatus : 'not_started';
      return [{
        id: text(entry.id), group: integer(entry.group), title: text(entry.title), chapterRange: text(entry.chapterRange), chapterTitles: textList(entry.chapterTitles), opening: entry.opening === true,
        startChapter: integer(entry.startChapter), endChapter: integer(entry.endChapter), injectionEnabled: entry.injectionEnabled !== false, sourceText: text(entry.sourceText), characterCount: integer(entry.characterCount),
        sourceSummary: text(entry.sourceSummary), stageSummary: text(entry.stageSummary), timelineStart: text(entry.timelineStart), timelineEnd: text(entry.timelineEnd), establishedFacts: textList(entry.establishedFacts),
        continuedFacts: textList(entry.continuedFacts), endState: textList(entry.endState), futureReferences: textList(entry.futureReferences), characters: textList(entry.characters), locations: textList(entry.locations), factions: textList(entry.factions),
        canonConstraints: normalizeStoryConstraints(entry.canonConstraints), foreshadowing: normalizeStoryConstraints(entry.foreshadowing),
        characterProfiles: Array.isArray(entry.characterProfiles) ? entry.characterProfiles.flatMap((profile) => isRecord(profile) ? [{ name: text(profile.name), identity: text(profile.identity), faction: text(profile.faction), initialPosition: text(profile.initialPosition), relationshipSummary: textList(profile.relationshipSummary), stateSummary: textList(profile.stateSummary), firstAppearance: text(profile.firstAppearance), importance: profile.importance === 'core' || profile.importance === 'important' ? profile.importance : 'ordinary' }] : []) : [],
        factionProfiles: Array.isArray(entry.factionProfiles) ? entry.factionProfiles.flatMap((profile) => isRecord(profile) ? [{ name: text(profile.name), type: text(profile.type), territory: text(profile.territory), representatives: textList(profile.representatives), goals: text(profile.goals), currentState: text(profile.currentState), relationshipSummary: textList(profile.relationshipSummary), firstAppearance: text(profile.firstAppearance) }] : []) : [],
        locationProfiles: Array.isArray(entry.locationProfiles) ? entry.locationProfiles.flatMap((profile) => isRecord(profile) ? [{ name: text(profile.name), level: profile.level === 'universe' || profile.level === 'major' || profile.level === 'medium' || profile.level === 'minor' || profile.level === 'district' || profile.level === 'sub_location' ? profile.level : 'unknown', parentLocation: text(profile.parentLocation), faction: text(profile.faction), function: text(profile.function), facilities: textList(profile.facilities), firstAppearance: text(profile.firstAppearance) }] : []) : [],
        keyEvents: Array.isArray(entry.keyEvents) ? entry.keyEvents.flatMap((event) => isRecord(event) ? [{ name: text(event.name), description: text(event.description), prerequisites: textList(event.prerequisites), triggers: textList(event.triggers), blockers: textList(event.blockers), results: textList(event.results), laterEffects: textList(event.laterEffects), visibility: normalizeStoryVisibility(event.visibility) }] : []) : [],
        timeline: Array.isArray(entry.timeline) ? entry.timeline.flatMap((event) => isRecord(event) ? [{ title: text(event.title), timeAnchor: text(event.timeAnchor), description: text(event.description), characters: textList(event.characters) }] : []) : [],
        characterProgress: Array.isArray(entry.characterProgress) ? entry.characterProgress.flatMap((progress) => isRecord(progress) ? [{ characterName: text(progress.characterName), beforeState: textList(progress.beforeState), changes: textList(progress.changes), afterState: textList(progress.afterState), laterEffects: textList(progress.laterEffects) }] : []) : [],
        processingStatus: processing, runtimeStatus: runtime, ...(optionalText(entry.lastError) ? { lastError: text(entry.lastError) } : {}), updatedAt: number(entry.updatedAt),
      }];
    }) : [],
    chaptersPerSegment: Math.max(1, integer(value.chaptersPerSegment) || 1), active: value.active !== false, currentSegmentGroup: Math.max(1, integer(value.currentSegmentGroup) || 1), currentStageSummary: text(value.currentStageSummary), coreCharacterSummary: textList(value.coreCharacterSummary), coreCharacters: textList(value.coreCharacters), locationIndex: textList(value.locationIndex), factionIndex: textList(value.factionIndex), createdAt: number(value.createdAt), updatedAt: number(value.updatedAt),
  };
}

function normalizeStoryProgress(value: unknown): StoryProgressDto | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.status === 'progressing' || value.status === 'completed' || value.status === 'diverged' || value.status === 'paused' ? value.status : 'not_started';
  const gate = value.gate === 'soft' || value.gate === 'strong' ? value.gate : undefined;
  return {
    ...(optionalText(value.seriesId) ? { seriesId: text(value.seriesId) } : {}), ...(optionalText(value.segmentId) ? { segmentId: text(value.segmentId) } : {}), segmentGroup: integer(value.segmentGroup), status,
    completedSummaries: textList(value.completedSummaries), openQuestions: textList(value.openQuestions), switchNotes: textList(value.switchNotes),
    archive: Array.isArray(value.archive) ? value.archive.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const archiveStatus = entry.status === 'skipped' || entry.status === 'diverged' || entry.status === 'completed' ? entry.status : 'experienced';
      return [{ id: text(entry.id), ...(optionalText(entry.seriesId) ? { seriesId: text(entry.seriesId) } : {}), ...(optionalText(entry.segmentId) ? { segmentId: text(entry.segmentId) } : {}), segmentGroup: integer(entry.segmentGroup), segmentTitle: text(entry.segmentTitle), ...(Number.isFinite(Number(entry.archivedAtTurn)) ? { archivedAtTurn: integer(entry.archivedAtTurn) } : {}), status: archiveStatus, summary: text(entry.summary), characterProgress: textList(entry.characterProgress), switchNotes: text(entry.switchNotes), reasons: textList(entry.reasons), createdAt: number(entry.createdAt) }];
    }) : [],
    ...(gate ? { gate } : {}), reasons: textList(value.reasons), ...(Number.isFinite(Number(value.lastDecisionTurn)) ? { lastDecisionTurn: integer(value.lastDecisionTurn) } : {}), evidence: textList(value.evidence), consecutiveEvidenceTurns: integer(value.consecutiveEvidenceTurns), stalledTurns: integer(value.stalledTurns), updatedAt: number(value.updatedAt),
  };
}

function normalizeStoryWeaving(value: unknown): StoryWeavingDto | null {
  if (!isRecord(value)) return null;
  const progress = normalizeStoryProgress(value.progress);
  return { series: Array.isArray(value.series) ? value.series.flatMap((entry) => normalizeStorySeries(entry) ?? []) : [], ...(optionalText(value.activeSeriesId) ? { activeSeriesId: text(value.activeSeriesId) } : {}), ...(progress ? { progress } : {}) };
}
function normalizeVariableBatch(value: unknown): VariableBatchDto | null { if (!isRecord(value)) return null; return { id: text(value.id), turn: integer(value.turn), timestamp: number(value.timestamp), source: value.source === 'calibration' ? 'calibration' : 'main', ...(optionalText(value.modelName) ? { modelName: text(value.modelName) } : {}), results: Array.isArray(value.results) ? value.results.flatMap((entry) => { if (!isRecord(entry) || !isRecord(entry.command)) return []; const action = entry.command.action === 'add' || entry.command.action === 'sub' || entry.command.action === 'push' || entry.command.action === 'delete' ? entry.command.action : 'set'; const kind = entry.kind === 'warning' || entry.kind === 'error' || entry.kind === 'rejected' ? entry.kind : entry.kind === 'command' ? 'command' : undefined; return [{ command: { action, key: text(entry.command.key), value: normalizeTechnicalJsonValue(entry.command.value) }, ok: entry.ok === true, ...(kind ? { kind } : {}), ...(optionalText(entry.reason) ? { reason: text(entry.reason) } : {}) }]; }) : [], ...(optionalText(value.report) ? { report: text(value.report) } : {}), ...(optionalText(value.rawText) ? { rawText: text(value.rawText) } : {}), ...(isRecord(value.retentionSummary) ? { retentionSummary: { totalResults: integer(value.retentionSummary.totalResults), succeededResults: integer(value.retentionSummary.succeededResults), diagnosticResults: integer(value.retentionSummary.diagnosticResults), omittedDiagnosticResults: integer(value.retentionSummary.omittedDiagnosticResults) } } : {}) } }
export function normalizeNarrativeRuntime(value: unknown): NarrativeRuntime {
  const raw = isRecord(value) ? value : {};
  return {
    plotNodes: Array.isArray(raw.plotNodes) ? raw.plotNodes.flatMap((entry) => normalizePlotNode(entry) ?? []) : [],
    storyWeaving: normalizeStoryWeaving(raw.storyWeaving),
    variableBatches: Array.isArray(raw.variableBatches) ? raw.variableBatches.flatMap((entry) => normalizeVariableBatch(entry) ?? []) : [],
    元素场面: normalizeElementalField(raw.元素场面),
    元素事件: normalizeElementalEvents(raw.元素事件),
  };
}

function normalizeElementalField(value: unknown): ElementalFieldState {
  const base = createEmptyElementalField();
  if (!isRecord(value)) return base;
  const auraElement = elementIdText(value.auraElement) as ElementalFieldState['auraElement'];
  return {
    auraElement,
    updatedTurn: integer(value.updatedTurn),
    lastSummary: text(value.lastSummary),
  };
}

function normalizeElementalEvents(value: unknown): ElementalReactionEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_ELEMENT_EVENTS)
    .flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const auraElement = elementIdText(entry.auraElement);
      const appliedElement = elementIdText(entry.appliedElement);
      if (!auraElement || !appliedElement) return [];
      return [{
        id: text(entry.id),
        turn: integer(entry.turn),
        name: text(entry.name) || '元素反应',
        auraElement: auraElement as ElementalReactionEvent['auraElement'],
        appliedElement: appliedElement as ElementalReactionEvent['appliedElement'],
        narrative: text(entry.narrative),
      }];
    });
}

export function createEmptyConversationLog(): ConversationLog { return { entries: [] } }
export function createEmptyMemoryLedger(): MemoryLedger { return { immediate: [], shortTerm: [], mediumTerm: [], longTerm: [], recoveryLog: [], failedDrafts: [] } }
export function createEmptyJourneyAlbum(): JourneyAlbum { return { entries: [], assets: [], generationTasks: [] } }
export function createEmptyQuestJournal(): QuestJournal { return { active: [], completed: [], abandoned: [], lastUpdates: [] } }
export function createEmptyBackgroundQueueState(): BackgroundQueueState { return { tasks: [] } }
export function createEmptyNarrativeRuntime(): NarrativeRuntime { return { plotNodes: [], storyWeaving: null, variableBatches: [], 元素场面: createEmptyElementalField(), 元素事件: [] } }
import { normalizeTravelerProfile, normalizeTeyvatNpcRecords, type TravelerProfile, type TeyvatNpcRecord } from './character';
import { normalizeTeyvatWorld, type TeyvatWorld } from './world';
import { normalizeTeyvatInventory, type TeyvatInventory } from './items';
import { normalizeCourierSystem, type CourierSystem } from './courier';
import { normalizeIrminsulMemory, type IrminsulMemory } from './irminsul';
import { normalizeArchiveCodex, type ArchiveCodex } from './codex';
import { normalizeSteambirdNews, type SteambirdNews } from './steambird';
import { isRecord } from '@/utils/valueGuards';
