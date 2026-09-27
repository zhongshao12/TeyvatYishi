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
import type { 变量事实, 变量命令批次, 变量命令结果 } from '@/models/variableCommand';
import { callVariableModel, type NsfwBaselineCandidate } from '@/services/ai/variableModel';
import { commitPreflightedTeyvatTurn, commitTeyvatTurn, preflightTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { compactVariableBatchHistory } from '@/utils/longSessionRetention';
import { projectCommittedSettlementChanges } from '@/utils/committedSettlementChanges';
import { needsNsfwBaseline } from '@/utils/npcArchiveEnrichment';
import {
  deriveNarrativeCanonicalNpcFacts,
  deriveNarrativeInventoryGainFacts,
  deriveNarrativeIntimacyFacts,
  deriveNarrativeInventoryRemovalFacts,
  deriveNarrativeTimeFact,
  derivePartyPresenceFacts,
  deriveResolvedNpcLedgerFacts,
  factsToTeyvatDomainCommands,
  mergeNarrativeInventoryFacts,
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
  commitGame: (next: TeyvatGameState) => boolean;
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

/** Keep the persisted diagnostic batch aligned with commands actually accepted by preflight. */
export function markRejectedSettlementResults(
  results: readonly 变量命令结果[],
  errors: readonly { index: number; code: string }[],
): 变量命令结果[] {
  const rejectedByIndex = new Map(errors.map((error) => [error.index, error.code]));
  return results.map((result, index) => {
    const code = rejectedByIndex.get(index);
    return code ? { ...result, ok: false, kind: 'rejected', reason: code } : result;
  });
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
    const derivedGains = deriveNarrativeInventoryGainFacts(params.body, stateSnapshot.背包.items);
    const inventoryFacts = mergeNarrativeInventoryFacts(allowedFacts, [
      ...derivedGains.facts,
      ...deriveNarrativeInventoryRemovalFacts(params.body, stateSnapshot.背包.items),
    ]);
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
      ...inventoryFacts.filter((fact) => fact.type !== 'npc'
        || !presenceNames.has(fact.name)
        || typeof fact.following !== 'boolean'),
      ...resolvedNpcFacts,
      ...narrativeCanonicalNpcFacts,
      ...partyPresenceFacts,
    ];
    // 亲密事件的固定好感度由系统结算（亲吻/性爱/暧昧/肢体接触），同一角色同一回合只算最高一档。
    // 命中的角色，其模型自报的 affinityDelta/affinitySet 会被丢掉（记忆与账本字段照常保留），
    // 否则「亲吻 +5」会变成「+5 加上模型自己给的 +3」。这与上面 following 的处理是同一套约定：
    // 正文证据能确定的事情以系统派生为准。
    const intimacyFacts = deriveNarrativeIntimacyFacts(params.body, stateSnapshot.NPC, {
      nsfwEnabled: params.settings.enableNsfw,
    });
    const factsWithIntimacy = [
      ...factsWithPartyPresence.filter((fact) => fact.type !== 'npc'
        || !intimacyFacts.some((derived) => derived.type === 'npc' && derived.name === fact.name)
        || (typeof fact.affinityDelta !== 'number' && typeof fact.affinitySet !== 'number')),
      ...intimacyFacts,
    ];
    const effectiveFacts = narrativeClock
      ? [...factsWithIntimacy.filter((fact) => fact.type !== 'time'), narrativeClock]
      : factsWithIntimacy;
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
    const allWarnings = [...derivedGains.warnings, ...factCommands.warnings];
    const warningResults = allWarnings.map((reason) => ({
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
    let batch: 变量命令批次 = {
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
        allWarnings.length ? `事实警告：${allWarnings.length} 条。` : '事实警告：0 条。',
        ...factCommands.notes,
      ].filter(Boolean).join('\n'),
      rawText,
    };
    if (params.signal?.aborted || params.shouldCommit?.() === false) return null;

    let committedGame: TeyvatGameState | undefined;
    /** 提交是否真的落到活体根上。CAS 拒绝（等待期间换存档）时为 false，此时绝不能把结算结果当已生效。 */
    let committedApplied = false;
    const evidenceContext = {
      factCandidates: params.factCandidates ?? [],
      trustedEvidence: questSettlement.commands.length ? [questSettlement.evidence] : [],
      lenientEvidence: true,
    };
    const dry = preflightTeyvatTurn(stateSnapshot, commands, evidenceContext);
    if (dry.status === 'rejected') {
      batch = {
        ...batch,
        results: [...errResults, ...warningResults, ...markRejectedSettlementResults(commandResults, dry.errors)],
      };
    }
    const pendingCommands = dry.status === 'rejected'
      ? excludeRejectedSettlementCommands(commands, dry.errors)
      : [...commands];
    const commitGameState = (nextState: TeyvatGameState) => {
      const projection = projectCommittedSettlementChanges(stateSnapshot, nextState);
      const candidateBatch: 变量命令批次 = {
        ...batch,
        committedChanges: projection.changes,
        ...(projection.omitted > 0 ? { omittedCommittedChanges: projection.omitted } : {}),
      };
      committedGame = {
        ...nextState,
        叙事: {
          ...nextState.叙事,
          variableBatches: fromLegacyVariableBatches(compactVariableBatchHistory([
            ...toLegacyVariableBatches(stateSnapshot.叙事.variableBatches),
            candidateBatch,
          ])),
        },
      };
      committedApplied = params.commitGame(committedGame) !== false;
      if (committedApplied) batch = candidateBatch;
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
    const actuallyCommitted = transaction.status === 'committed' && committedApplied;
    const finalBatch = actuallyCommitted
      ? batch
      : {
          ...batch,
          committedChanges: undefined,
          omittedCommittedChanges: undefined,
          results: [...batch.results.map((item): 变量命令结果 => item.ok
            ? { ...item, ok: false, kind: 'rejected', reason: 'COMMIT_NOT_APPLIED' }
            : item), ...transactionErrorResults],
        };
    const npcLedgerUpdate = buildNpcLedgerUpdateDebug({
      facts: effectiveFacts,
      commands: actuallyCommitted ? batch.results.filter((item) => item.ok).map((item) => item.command) : [],
      results: finalBatch.results,
      warnings: [
        ...parseErrors,
        ...allWarnings,
        ...transaction.errors.map((item) => item.code),
      ],
    });
    // `committedApplied === false`：CAS 判定等待期间换了存档，提交被整体拒绝。
    // 这里必须把 `committedGame` 一起丢掉 —— 否则上游会拿一份**没有落到活体根**的结算
    // 去跑元素结算 / 后台任务 / 自动存档，把旧档的结算写进玩家刚读入的新档。
    if (transaction.status !== 'committed' || !committedGame || !committedApplied) {
      return { batch: finalBatch, npcLedgerUpdate };
    }
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
