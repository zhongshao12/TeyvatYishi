import type { NPC账本选择结果 } from './npc';
import type { NarrativeTurn } from './teyvat/narrativeTurn';

export type 消息角色 = 'user' | 'assistant' | 'system';

/** 「本回合 user 发送之前」的变量切片快照。挂在 assistant message 上，用于 reroll 时回滚。
 *  保留方式：只在最近一条 assistant message 上持久化，生成新 assistant 时清掉上一条的 snapshot，
 *  避免存档体积无限膨胀。所有切片都是引用拷贝（浅拷贝顶层数组对象足够，state 内部不可变）。 */
export interface 回合快照 {
  旅人: unknown;
  背包?: unknown;
  世界: unknown;
  记忆: unknown;
  世界树?: unknown;
  图鉴?: unknown;
  手机?: unknown;
  NPC: unknown[];
  相册?: unknown;
  蒸汽鸟报?: unknown;
  剧情: unknown[];
  剧情编织?: unknown;
  variableBatches: unknown[];
  queueTasks?: unknown[];
  任务?: unknown;
  turnCount: number;
  pendingOpeningTrigger?: string | null;
}

export interface 聊天消息 {
  id: string;
  role: 消息角色;
  content: string;
  timestamp: number;
  gameTime?: string;
  parsedResponse?: NarrativeTurn;
  inputTokens?: number;
  outputTokens?: number;
  tokenUsage?: 回合Token消耗;
  responseDurationSec?: number;
  isStreaming?: boolean;
  /** 玩家标记的剧情书签。 */
  bookmark?: { title: string; note?: string; createdAt: number };
  debugContext?: {
    systemPrompt: string;
    messages: Array<{ role: 消息角色; content: string }>;
    recallPreview?: string;
    recallSummary?: string;
    recallFullContent?: string;
    deepSeekMainMode?: 'off' | 'standard' | 'lock_format';
    deepSeekCotFakeHistorySkipped?: boolean;
    deepSeekPrefixMode?: boolean;
    deepSeekProtocolIssues?: string[];
    narrativeNormalizationWarnings?: string[];
    deepSeekMainOriginalModel?: string;
    deepSeekMainAdaptedModel?: string;
    stV2Attempted?: boolean;
    stV2Used?: boolean;
    stV2FallbackReason?: string;
    rerollSimilarity?: number;
    rerollSimilarityRetried?: boolean;
    cachePrefixDiagnostics?: 缓存前缀诊断;
    mainRequestMode?: 'stream' | 'non-stream';
    irminsulRecallPreview?: string;
    irminsulRecallRawText?: string;
    irminsulRecallUsedModel?: boolean;
    codexRecallPreview?: string;
    codexRecallInjection?: string;
    codexRecallRawText?: string;
    codexRecallUsedModel?: boolean;
    npcLedgerInjection?: {
      selectedNames: string[];
      skippedNames: Array<{ name: string; reason: string }>;
      injected: Array<{
        name: string;
        reason: string[];
        fields: string[];
        hasRecentInteraction: boolean;
        hasMustRemember: boolean;
        hasUnresolvedItems: boolean;
      }>;
    };
    npcLedgerUpdate?: {
      updatedNames: string[];
      memoryAppended: string[];
      ledgerFieldsUpdated: string[];
      summaryTriggered: string[];
      warnings: string[];
    };
    npcLedgerSelectionRaw?: NPC账本选择结果;
  };
  /** 该 AI 回复对应的「user 发送前」状态快照，用于 reroll 回滚。
   *  生成新 assistant message 时会清掉上一条的 snapshot，保证存档里至多只有最新一条带 snapshot。 */
  preTurnSnapshot?: 回合快照;
  /** 本回合的故事快照（由正文生图后台生成完成后填充） */
  narrativeImages?: 叙事插图[];
}

export interface 叙事插图 {
  /** 唯一 ID */
  id: string;
  /** 图片数据 URL */
  dataUrl: string;
  /** 底层图片槽位：场景 / 角色。正文生图固定作为故事快照展示。 */
  type: 'scene' | 'character';
  /** 语义类型：用于把正文生图从普通场景图中区分出来。 */
  kind?: 'snapshot' | 'scene' | 'character';
  /** 生成用的提示词 */
  prompt: string;
  /** 负面提示词 */
  negativePrompt?: string;
  /** 中文描述（用于卡片标题） */
  description?: string;
  /** 生成状态 */
  status: 'generating' | 'done' | 'failed';
  /** 错误信息 */
  error?: string;
  /** 关联的相册资源 ID */
  assetId?: string;
}

export interface 缓存前缀诊断 {
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
  largestChangedSections: Array<{
    label: string;
    tokens: number;
  }>;
}

export interface 回合Token消耗 {
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
  rawUsageKeys?: string[];
  /** 用量来源系统：main_story / variable / steambird / courier / quest 等。 */
  system?: string;
  cacheDiagnostic?: string;
  rawUsage?: unknown;
}

let messageCounter = 0;

export function 创建聊天消息(
  role: 消息角色,
  content: string,
  extra?: Partial<聊天消息>,
): 聊天消息 {
  return {
    id: `msg_${Date.now()}_${++messageCounter}`,
    role,
    content,
    timestamp: Date.now(),
    ...extra,
  };
}
