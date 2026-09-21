import {
  fromLegacyVariableBatches,
  mapTeyvatNpcsToLegacy,
  toLegacyTraveler,
  toLegacyVariableBatches,
  toLegacyWorld,
} from '@/hooks/useGameState';
import type { NPC记录 } from '@/models/npc';
import type { NarrativeTurn } from '@/models/teyvat/narrativeTurn';
import type { TeyvatGameState } from '@/models/teyvat/state';
import type { API配置项, 游戏设置, 变量API覆盖 } from '@/models/settings';
import type { 变量事实, 变量命令批次 } from '@/models/variableCommand';
import { callVariableModel, type NsfwBaselineCandidate } from '@/services/ai/variableModel';
import { commitPreflightedTeyvatTurn, commitTeyvatTurn, preflightTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { compactVariableBatchHistory } from '@/utils/longSessionRetention';
import { needsNsfwBaseline } from '@/utils/npcArchiveEnrichment';
import {
  deriveNarrativeCanonicalNpcFacts,
  deriveNarrativeInventoryRemovalFacts,
  deriveNarrativeTimeFact,
  derivePartyPresenceFacts,
  deriveResolvedNpcLedgerFacts,
  factsToTeyvatDomainCommands,
  parseVariableFacts,
} from '@/utils/variableFacts';
import { composeQuestSettlementCommands } from './questWorkflow';
import { buildNpcLedgerUpdateDebug, type NpcLedgerUpdateDebug } from './turnDebugContext';

export type VariableSettlementSettings = Pick<
  游戏设置,
  'variableApi' | 'enableNsfw' | 'enableMaleNsfwArchive' | 'promptModules' | '手机系统'
>;

export interface VariableSettlementParams {
  mainApiConfig: API配置项;
  currentGame: TeyvatGameState;
  settings: VariableSettlementSettings;
  npcRecords: NPC记录[];
  commitGame: (next: TeyvatGameState) => void;
  onFailure?: (detail: string) => void;
  userInput: string;
  body: string;
  variableDraft?: string;
  /** 主流程结束后的回合数（已 +1）。 */
  turnAfter: number;
  memorySystemSnapshot: import('@/models/memory').记忆系统;
  /** 世界阶段结束后的旅行者快照，包含本回合元素回响结果。 */
  travelerSnapshot?: import('@/models/character').角色数据结构;
  /** 世界阶段结束后的世界快照，包含全局事件与天气变化。 */
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

export interface VariableSettlementResult {
  旅人?: import('@/models/character').角色数据结构;
  世界?: import('@/models/world').世界状态;
  记忆?: import('@/models/memory').记忆系统;
  世界树?: import('@/models/teyvat/irminsul').IrminsulMemory;
  图鉴?: import('@/models/teyvat/codex').ArchiveCodex;
  手机?: import('@/models/teyvat/courier').CourierSystem;
  NPC?: NPC记录[];
  蒸汽鸟报?: import('@/models/teyvat/steambird').SteambirdNews;
  剧情?: import('@/models/plot').剧情节点[];
  背包?: import('@/models/teyvat/items').TeyvatInventory;
  batch?: 变量命令批次;
  npcLedgerUpdate?: NpcLedgerUpdateDebug;
  committedGame?: TeyvatGameState;
  questUpdates?: string[];
}

export function resolveVariableSettlementApiConfig(
  mainApiConfig: API配置项,
  override: 变量API覆盖,
): { config: API配置项; overrodeAny: boolean } {
  const baseUrl = override.baseUrl.trim();
  const apiKey = override.apiKey.trim();
  const model = override.model.trim();
  return {
    overrodeAny: Boolean(baseUrl || apiKey || model),
    config: {
      ...mainApiConfig,
      provider: override.provider || mainApiConfig.provider,
      baseUrl: baseUrl || mainApiConfig.baseUrl,
      apiKey: apiKey || mainApiConfig.apiKey,
      model: model || mainApiConfig.model,
      maxTokens: override.maxTokens ?? mainApiConfig.maxTokens,
      temperature: override.temperature ?? mainApiConfig.temperature,
    },
  };
}

export function excludeRejectedSettlementCommands<T>(
  commands: readonly T[],
  errors: readonly { index: number }[],
): T[] {
  if (errors.length === 0) return [...commands];
  const rejectedIndexes = new Set(errors.map((error) => error.index));
  return commands.filter((_, index) => !rejectedIndexes.has(index));
}

function collectNsfwBaselineCandidates(
  npcRecords: readonly NPC记录[],
  settings: VariableSettlementSettings,
): NsfwBaselineCandidate[] {
  if (!settings.enableNsfw) return [];
  const candidates: NsfwBaselineCandidate[] = [];
  for (const npc of npcRecords) {
    if (candidates.length >= 2) break;
    if (!needsNsfwBaseline(npc, undefined, {
      nsfwEnabled: true,
      maleNsfwArchiveEnabled: settings.enableMaleNsfwArchive,
    })) continue;
    candidates.push({
      npcId: npc.id,
      npcName: npc.姓名 ?? npc.别名 ?? '',
      gender: npc.性别,
      appearance: typeof npc.外貌 === 'string' ? npc.外貌 : undefined,
      personality: typeof npc.性格 === 'string' ? npc.性格 : undefined,
      intro: typeof npc.介绍 === 'string' ? npc.介绍 : undefined,
    });
  }
  return candidates;
}

/**
 * Runs the complete variable settlement boundary: model request, fact derivation,
 * domain-command composition, transaction preflight, commit and batch history.
 * UI queue publication stays in the caller through `onFailure`.
 */
export async function runVariableSettlementWorkflow(
  params: VariableSettlementParams,
): Promise<VariableSettlementResult | null> {
  if (!params.body.trim()) return null;

  const { config: variableConfig, overrodeAny } = resolveVariableSettlementApiConfig(
    params.mainApiConfig,
    params.settings.variableApi,
  );
  const stateSnapshot = params.baseGameSnapshot ?? params.currentGame;

  try {
    const rawText = (await callVariableModel(variableConfig, {
      body: params.body,
      variableDraft: params.variableDraft,
      userInput: params.userInput,
      turnCount: params.turnAfter - 1,
      state: stateSnapshot,
      nsfwEnabled: params.settings.enableNsfw,
      maleNsfwArchiveEnabled: params.settings.enableMaleNsfwArchive,
      nsfwBaselineCandidates: collectNsfwBaselineCandidates(params.npcRecords, params.settings),
      signal: params.signal,
      retryCount: params.settings.variableApi.retryCount ?? 2,
      promptModules: params.settings.promptModules,
    })).rawText;
    if (params.signal?.aborted || params.shouldCommit?.() === false) return null;

    const parsedFacts = parseVariableFacts(rawText);
    const allowedFacts = parsedFacts.facts.filter((fact) => fact.type !== 'nsfw_archive' || params.settings.enableNsfw);
    const modelClock = [...allowedFacts]
      .reverse()
      .find((fact): fact is Extract<变量事实, { type: 'time' }> => fact.type === 'time');
    const narrativeClock = deriveNarrativeTimeFact(params.body, stateSnapshot.世界.当前时间, modelClock);
    const inventoryRemovalFacts = deriveNarrativeInventoryRemovalFacts(params.body, stateSnapshot.背包.items)
      .filter((derived) => !allowedFacts.some((fact) => fact.type === 'item'
        && fact.action === derived.action
        && fact.name === derived.name));
    const resolvedNpcFacts = deriveResolvedNpcLedgerFacts(params.body, stateSnapshot.NPC)
      .filter((derived) => !allowedFacts.some((fact) => fact.type === 'npc'
        && (fact.id === derived.id || fact.name === derived.name)
        && fact.resolvedItems?.some((item) => derived.resolvedItems?.includes(item))));
    const narrativeCanonicalNpcFacts = deriveNarrativeCanonicalNpcFacts(params.body)
      .filter((derived) => !allowedFacts.some((fact) => fact.type === 'npc'
        && (fact.id === derived.id || fact.name === derived.name)));
    const partyPresenceFacts = derivePartyPresenceFacts(params.body, stateSnapshot.NPC);
    const presenceNames = new Set(partyPresenceFacts.map((fact) => fact.name));
    const factsWithPartyPresence = [
      ...allowedFacts.filter((fact) => fact.type !== 'npc'
        || !presenceNames.has(fact.name)
        || typeof fact.following !== 'boolean'),
      ...inventoryRemovalFacts,
      ...resolvedNpcFacts,
      ...narrativeCanonicalNpcFacts,
      ...partyPresenceFacts,
    ];
    const effectiveFacts = narrativeClock
      ? [...factsWithPartyPresence.filter((fact) => fact.type !== 'time'), narrativeClock]
      : factsWithPartyPresence;
    const factCommands = factsToTeyvatDomainCommands(effectiveFacts, stateSnapshot, params.turnAfter - 1, {
      courierSeedsEnabled: params.settings.手机系统.enabled && params.settings.手机系统.autoGenerateSeeds,
      maxCourierSeedsPerTurn: params.settings.手机系统.maxSeedsPerTurn,
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
    const parseErrors = parsedFacts.parseErrors.map((reason) => `变量事实：${reason}`);
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
      ...(item.evidence ? { evidence: item.evidence } : {}),
    }));
    const batch: 变量命令批次 = {
      id: params.settlementId
        ? `vbatch_${params.settlementId}`
        : `vbatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      turn: params.turnAfter - 1,
      timestamp: Date.now(),
      source: overrodeAny ? 'calibration' : 'main',
      modelName: variableConfig.model,
      results: [...errResults, ...warningResults, ...commandResults],
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
    const dry = preflightTeyvatTurn(stateSnapshot, commands, evidenceContext);
    const pendingCommands = dry.status === 'rejected'
      ? excludeRejectedSettlementCommands(commands, dry.errors)
      : [...commands];
    const commitGameState = (nextState: TeyvatGameState) => {
      committedGame = {
        ...nextState,
        叙事: {
          ...nextState.叙事,
          variableBatches: fromLegacyVariableBatches(compactVariableBatchHistory([
            ...toLegacyVariableBatches(stateSnapshot.叙事.variableBatches),
            batch,
          ])),
        },
      };
      params.commitGame(committedGame);
    };
    const transaction = dry.status === 'accepted'
      ? commitPreflightedTeyvatTurn(stateSnapshot, dry, commitGameState)
      : commitTeyvatTurn(stateSnapshot, pendingCommands, commitGameState, evidenceContext);
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
    return {
      背包: committedGame.背包,
      手机: committedGame.手机,
      蒸汽鸟报: committedGame.蒸汽鸟报,
      NPC: mapTeyvatNpcsToLegacy(committedGame),
      世界: toLegacyWorld(committedGame),
      旅人: toLegacyTraveler(committedGame),
      batch: finalBatch,
      npcLedgerUpdate,
      committedGame,
      questUpdates: questSettlement.updates,
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError') return null;
    if (params.signal?.aborted || params.shouldCommit?.() === false) return null;
    const detail = (error as Error).message ?? '变量模型校准失败。';
    console.warn('[variable-model] 校准失败：', error);
    params.onFailure?.(detail);
    return {
      batch: {
        id: `vbatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        turn: params.turnAfter - 1,
        timestamp: Date.now(),
        source: overrodeAny ? 'calibration' : 'main',
        modelName: variableConfig.model,
        results: [{
          command: { action: 'set', key: '(变量模型调用失败)', value: null },
          ok: false,
          reason: detail,
        }],
        rawText: error instanceof Error ? error.message : String(error ?? '变量模型调用失败'),
      },
      npcLedgerUpdate: {
        updatedNames: [],
        memoryAppended: [],
        ledgerFieldsUpdated: [],
        summaryTriggered: [],
        warnings: [detail],
      },
    };
  }
}
