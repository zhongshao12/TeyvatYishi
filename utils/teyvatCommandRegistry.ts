import type { FactCandidate } from '@/models/teyvat/narrativeTurn';
import {
  TEYVAT_DOMAIN_ACTIONS,
  TEYVAT_DOMAIN_ROOTS,
  isTeyvatStableId,
  type TeyvatDomainAction,
  type TeyvatDomainCommand,
  type TeyvatDomainRoot,
  type TeyvatTurnError,
  type TeyvatTurnErrorCode,
} from '@/models/teyvat/domainCommand';
import type { TeyvatGameState } from '@/models/teyvat/state';
import { ITEM_CATEGORIES, ITEM_RARITIES, normalizeTeyvatItem } from '@/models/teyvat/items';
import { normalizeTeyvatNpcMatureArchive, normalizeTeyvatNpcRecords, normalizeTeyvatNpcSharedMemory } from '@/models/teyvat/character';
import { normalizeCourierSystem } from '@/models/teyvat/courier';
import { normalizeCanonDeviation } from '@/services/canonDeviationService';
import { NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD, 获取NPC关系阶段, 获取NPC兼容关系, 限制NPC好感度 } from '@/models/npc';
import { isLegacyTravelerCommandPath } from '@/compat/legacy-hsr/readOnly';

export interface TeyvatEvidenceContext {
  factCandidates?: readonly FactCandidate[];
  trustedEvidence?: readonly string[];
  /** 变量结算专用：放宽证据比对（接受非逐字的改写型证据），跳过而非整批拒绝。 */
  lenientEvidence?: boolean;
}

type RegistryResult =
  | { ok: true; command: TeyvatDomainCommand }
  | { ok: false; error: TeyvatTurnError };

type ApplyResult =
  | { ok: true; state: TeyvatGameState }
  | { ok: false; error: TeyvatTurnError };

const ROOT_SET = new Set<string>(TEYVAT_DOMAIN_ROOTS);
const ACTION_SET = new Set<string>(TEYVAT_DOMAIN_ACTIONS);
const UNSAFE_PATH_RE = /(?:^|\.)(?:__proto__|prototype|constructor)(?:\.|$)/;
const ID_SELECTOR_RE = /^\[id=([^\]]+)\]\.(.+)$/;
const ITEM_QUANTITY_RE = /^items\[id=([^\]]+)\]\.quantity$/;
const QUEST_OBJECTIVE_RE = /^active\[id=([^\]]+)\]\.objectives\[id=([^\]]+)\]\.currentCount$/;
const QUEST_OBJECTIVES_RE = /^active\[id=([^\]]+)\]\.objectives$/;
const QUEST_STATUS_RE = /^active\[id=([^\]]+)\]\.status$/;
const TALENT_LEVEL_RE = /^天赋\[id=([^\]]+)\]\.等级$/;
/** 天赋等级上限（与技能面板手动调整保持一致）。 */
const TALENT_LEVEL_MAX = 20;

function error(index: number, code: TeyvatTurnErrorCode, root?: string, path?: string): TeyvatTurnError {
  return { index, code, ...(root ? { root } : {}), ...(path !== undefined ? { path } : {}) };
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function integer(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value);
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function matchesEvidence(evidence: string, context: TeyvatEvidenceContext): boolean {
  if (context.trustedEvidence?.some((item) => item.trim() === evidence)) return true;
  if (context.factCandidates?.some((candidate) =>
    candidate.evidence.trim() === evidence || candidate.fact.trim() === evidence)) return true;
  // 变量结算宽松模式：改写型证据（非逐字引用）也接受，只要不是占位文案。
  if (context.lenientEvidence && evidence.replace(/正文(写明|写到|显示|提及)/g, '').trim().length >= 8) return true;
  return false;
}

function validatePathSurface(root: string, path: string, index: number): TeyvatTurnError | null {
  if (!path) return error(index, 'EMPTY_PATH', root, path);
  if (path === '$' || path === '.' || path === root) return error(index, 'WHOLE_DOMAIN_REPLACE', root, path);
  if (UNSAFE_PATH_RE.test(path)) return error(index, 'UNSAFE_PATH', root, path);
  if (path.includes('*') || path.includes('[]')) return error(index, 'WILDCARD_PATH', root, path);
  if (/\[[^\]]+\]/.test(path)) {
    const segments = [...path.matchAll(/\[([^\]]+)\]/g)];
    if (segments.some((segment) => {
      const selector = segment[1] ?? '';
      return !selector.startsWith('id=') || !isTeyvatStableId(selector.slice(3));
    })) {
      return error(index, 'DYNAMIC_SELECTOR', root, path);
    }
  }
  if (root === '旅行者' && (isLegacyTravelerCommandPath(path) || path.startsWith('背包'))) {
    return error(index, 'LEGACY_PATH', root, path);
  }
  return null;
}

export function rebuildTeyvatDomainCommand(
  raw: unknown,
  index: number,
  evidenceContext: TeyvatEvidenceContext,
): RegistryResult {
  if (!isRecord(raw)) return { ok: false, error: error(index, 'INVALID_COMMAND') };
  if (typeof raw.action !== 'string' || !ACTION_SET.has(raw.action)) {
    return { ok: false, error: error(index, 'INVALID_ACTION', typeof raw.root === 'string' ? raw.root : undefined, typeof raw.path === 'string' ? raw.path : undefined) };
  }
  if (typeof raw.root !== 'string' || !ROOT_SET.has(raw.root)) {
    return { ok: false, error: error(index, 'UNKNOWN_ROOT', typeof raw.root === 'string' ? raw.root : undefined, typeof raw.path === 'string' ? raw.path : undefined) };
  }
  const root = raw.root as TeyvatDomainRoot;
  if (typeof raw.path !== 'string') return { ok: false, error: error(index, 'EMPTY_PATH', root, '') };
  const path = raw.path.trim();
  const surfaceError = validatePathSurface(root, path, index);
  if (surfaceError) return { ok: false, error: surfaceError };

  const evidence = typeof raw.evidence === 'string' ? raw.evidence.trim() : '';
  if (!evidence || evidence === '无' || evidence === 'none' || evidence === 'N/A') {
    return { ok: false, error: error(index, 'MISSING_EVIDENCE', root, path) };
  }
  if (!matchesEvidence(evidence, evidenceContext)) {
    return { ok: false, error: error(index, 'UNMATCHED_EVIDENCE', root, path) };
  }

  const action = raw.action as TeyvatDomainAction;
  return {
    ok: true,
    command: {
      action,
      root,
      path,
      ...(action === 'delete' ? {} : { value: cloneValue(raw.value) }),
      evidence,
    },
  };
}

function validateAction(command: TeyvatDomainCommand, allowed: readonly TeyvatDomainAction[], index: number): TeyvatTurnError | null {
  return allowed.includes(command.action) ? null : error(index, 'UNKNOWN_PATH', command.root, command.path);
}

function nextNumber(current: number, command: TeyvatDomainCommand, minimum: number, index: number): number | TeyvatTurnError {
  if (!finiteNumber(command.value)) return error(index, 'INVALID_VALUE', command.root, command.path);
  const result = command.action === 'add'
    ? current + command.value
    : command.action === 'sub'
      ? current - command.value
      : command.value;
  if (!Number.isFinite(result) || result < minimum) return error(index, 'INVALID_NUMERIC_RESULT', command.root, command.path);
  return result;
}

function pushUnique<T>(items: readonly T[], value: T, identity: (item: T) => string): T[] {
  const id = identity(value);
  if (items.some((item) => identity(item) === id)) return [...items];
  return [...items, value];
}

function applyTraveler(state: TeyvatGameState, command: TeyvatDomainCommand, index: number): ApplyResult {
  if (command.path === 'capabilities') {
    const invalidAction = validateAction(command, ['push', 'delete'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    if (!nonEmptyText(command.value)) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    const capability = command.value.trim();
    const capabilities = command.action === 'delete'
      ? state.旅行者.capabilities.filter((item) => item !== capability)
      : pushUnique(state.旅行者.capabilities, capability, (item) => item);
    return { ok: true, state: { ...state, 旅行者: { ...state.旅行者, capabilities } } };
  }
  const talentLevel = command.path.match(TALENT_LEVEL_RE);
  if (talentLevel) {
    const invalidAction = validateAction(command, ['set', 'add'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    const targetIndex = state.旅行者.天赋.findIndex((item) => item.id === talentLevel[1]);
    if (targetIndex < 0) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
    const targetTalent = state.旅行者.天赋[targetIndex];
    if (!targetTalent) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
    const next = nextNumber(targetTalent.等级, command, 0, index);
    if (typeof next !== 'number' || !Number.isInteger(next) || next > TALENT_LEVEL_MAX) {
      return { ok: false, error: error(index, 'INVALID_NUMERIC_RESULT', command.root, command.path) };
    }
    const 天赋 = state.旅行者.天赋.map((item, itemIndex) => itemIndex === targetIndex ? { ...item, 等级: next } : item);
    return { ok: true, state: { ...state, 旅行者: { ...state.旅行者, 天赋 } } };
  }
  return { ok: false, error: error(index, 'UNKNOWN_PATH', command.root, command.path) };
}

function applyWorld(state: TeyvatGameState, command: TeyvatDomainCommand, index: number): ApplyResult {
  const textPaths = new Set(['当前地点', '当前日期', '当前时间', '当前天气', '氛围']);
  if (textPaths.has(command.path)) {
    const invalidAction = validateAction(command, ['set'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    if (!nonEmptyText(command.value)) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    return { ok: true, state: { ...state, 世界: { ...state.世界, [command.path]: command.value.trim() } } };
  }
  if (command.path === '旅程天数') {
    const invalidAction = validateAction(command, ['set', 'add', 'sub'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    const next = nextNumber(state.世界.旅程天数, command, 1, index);
    if (typeof next !== 'number') return { ok: false, error: next };
    if (!Number.isInteger(next)) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    return { ok: true, state: { ...state, 世界: { ...state.世界, 旅程天数: next } } };
  }
  if (command.path === '世界事件') {
    const invalidAction = validateAction(command, ['push', 'delete'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    if (!nonEmptyText(command.value)) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    const text = command.value.trim();
    const 世界事件 = command.action === 'delete'
      ? state.世界.世界事件.filter((item) => item !== text)
      : pushUnique(state.世界.世界事件, text, (item) => item);
    return { ok: true, state: { ...state, 世界: { ...state.世界, 世界事件 } } };
  }
  return { ok: false, error: error(index, 'UNKNOWN_PATH', command.root, command.path) };
}

function applyNpc(state: TeyvatGameState, command: TeyvatDomainCommand, index: number): ApplyResult {
  if (command.path === 'records') {
    const invalidAction = validateAction(command, ['push'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    if (!isRecord(command.value) || !isTeyvatStableId(command.value.id) || !nonEmptyText(command.value.姓名)) {
      return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    }
    const normalized = normalizeTeyvatNpcRecords([command.value])[0];
    if (!normalized?.id) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    return { ok: true, state: { ...state, NPC: pushUnique(state.NPC, normalized, (item) => item.id) } };
  }
  const selected = command.path.match(ID_SELECTOR_RE);
  if (!selected) return { ok: false, error: error(index, 'UNKNOWN_PATH', command.root, command.path) };
  const id = selected[1] ?? '';
  const field = selected[2] ?? '';
  if (!isTeyvatStableId(id)) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
  if (field === 'affinity' && !finiteNumber(command.value)) {
    return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
  }
  const targetIndex = state.NPC.findIndex((item) => item.id === id);
  if (targetIndex < 0) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
  const target = state.NPC[targetIndex];
  if (!target) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
  let nextTarget = target;
  if (field === 'affinity') {
    const invalidAction = validateAction(command, ['set', 'add', 'sub'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    // 下限交给 限制NPC好感度 夹取，所以这里用 -Infinity 让 nextNumber 只做有限性检查。
    const next = nextNumber(target.affinity, command, Number.NEGATIVE_INFINITY, index);
    if (typeof next !== 'number') return { ok: false, error: next };
    // 夹取，而不是在越界时报错把整条命令丢掉：
    // 好感度是长期累计值，临近上限（或下限）时每回合的 +N 都被拒绝，
    // 玩家看到的是「一直在互动，好感度却停住」，而且回执里只有一条 INVALID_NUMERIC_RESULT。
    // 限制NPC好感度 同时负责取整，避免 add 1.5 累加出 41.49999999999999 这类值。
    //
    // 另外：一旦到了「生死挚友」（> NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD），下调一律按
    // 「保持当前值」处理 —— 玩家要求「达到该等级后不会再掉好感度」。
    // 注意这不是夹到门槛值，而是完全不掉：130 被 -20 后仍然是 130。
    const protectedByDearestFriend = target.affinity > NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD;
    const nextAffinity = protectedByDearestFriend ? Math.max(target.affinity, next) : next;
    const affinity = 限制NPC好感度(nextAffinity);
    nextTarget = {
      ...target,
      affinity,
      relationship: 获取NPC兼容关系(affinity),
      relationshipLedger: {
        ...target.relationshipLedger,
        currentStage: 获取NPC关系阶段(affinity),
      },
    };
  } else if (field === 'lastSeenTurn') {
    const invalidAction = validateAction(command, ['set'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    if (!integer(command.value) || command.value < 0) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    nextTarget = { ...target, lastSeenTurn: command.value };
  } else if (['relationship', 'playerAddress', 'appearance', 'clothing', 'speechStyle'].includes(field)) {
    const invalidAction = validateAction(command, ['set'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    if (!nonEmptyText(command.value)) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    nextTarget = { ...target, [field]: command.value.trim() };
  } else if (field === 'intimate' || field === 'travelingTogether') {
    const invalidAction = validateAction(command, ['set'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    if (typeof command.value !== 'boolean') return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    nextTarget = { ...target, [field]: command.value };
  } else if (field === 'sharedMemories') {
    if (command.action !== 'push' || !isRecord(command.value) || !isTeyvatStableId(command.value.id)
      || !nonEmptyText(command.value.summary) || !integer(command.value.turn) || command.value.turn < 0
      || !Array.isArray(command.value.relatedNpcIds) || !command.value.relatedNpcIds.every(isTeyvatStableId)
      || (command.value.source !== undefined && !['narrative', 'courier', 'steambird', 'variable', 'other'].includes(String(command.value.source)))
      || (command.value.sourceText !== undefined && typeof command.value.sourceText !== 'string')) {
      return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    }
    const memory = normalizeTeyvatNpcSharedMemory(command.value);
    if (!memory) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    nextTarget = { ...target, sharedMemories: pushUnique(target.sharedMemories, memory, (item) => item.id) };
  } else if (field === 'matureArchive') {
    const value = command.value;
    const textArrays = ['preferences', 'sensitivePoints', 'taboos', 'experiences', 'longTermFacts', 'tags'] as const;
    if (command.action !== 'set' || !isRecord(value)
      || textArrays.some((key) => !Array.isArray(value[key]) || !(value[key] as unknown[]).every((item) => typeof item === 'string'))
      || !isRecord(value.femaleBodyProfile) || !isRecord(value.maleBodyProfile) || !isRecord(value.partImages)
      || (value.enabled !== undefined && typeof value.enabled !== 'boolean')
      || (value.intimacyStage !== undefined && typeof value.intimacyStage !== 'string')
      || (value.boundaries !== undefined && typeof value.boundaries !== 'string')
      || (value.notes !== undefined && typeof value.notes !== 'string')
      || (value.ageConfirmation !== undefined && !['adult', 'unknown', 'minor_blocked'].includes(String(value.ageConfirmation)))) {
      return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    }
    const nestedTextOnly = (record: Record<string, unknown>) => Object.values(record).every((item) => item === undefined || typeof item === 'string');
    if (!nestedTextOnly(value.femaleBodyProfile) || !nestedTextOnly(value.maleBodyProfile) || !nestedTextOnly(value.partImages)) {
      return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    }
    const matureArchive = normalizeTeyvatNpcMatureArchive(value);
    if (!matureArchive) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    nextTarget = { ...target, matureArchive };
  } else if (field.startsWith('relationshipLedger.')) {
    const ledgerField = field.slice('relationshipLedger.'.length) as keyof typeof target.relationshipLedger;
    const textFields = new Set(['recentInteraction', 'longTermImpression', 'currentStage']);
    const listFields = new Set(['sharedExperiences', 'unfinishedBusiness', 'unresolvedConflicts', 'mustRemember', 'protectedFacts']);
    if (textFields.has(ledgerField)) {
      if (command.action !== 'set' || !nonEmptyText(command.value)) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
      nextTarget = { ...target, relationshipLedger: { ...target.relationshipLedger, [ledgerField]: command.value.trim() } };
    } else if (listFields.has(ledgerField)) {
      if (!['push', 'delete'].includes(command.action) || !nonEmptyText(command.value)) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
      const current = target.relationshipLedger[ledgerField] as string[];
      const text = command.value.trim();
      const next = command.action === 'delete' ? current.filter((item) => item !== text) : pushUnique(current, text, (item) => item);
      nextTarget = { ...target, relationshipLedger: { ...target.relationshipLedger, [ledgerField]: next } };
    } else {
      return { ok: false, error: error(index, 'UNKNOWN_PATH', command.root, command.path) };
    }
  } else {
    return { ok: false, error: error(index, 'UNKNOWN_PATH', command.root, command.path) };
  }
  const NPC = state.NPC.map((item, itemIndex) => itemIndex === targetIndex ? nextTarget : item);
  return { ok: true, state: { ...state, NPC } };
}

function applyInventory(state: TeyvatGameState, command: TeyvatDomainCommand, index: number): ApplyResult {
  if (command.path === 'items') {
    const invalidAction = validateAction(command, ['push'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    try {
      const item = normalizeTeyvatItem(command.value);
      if (!isTeyvatStableId(item.id)) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
      return { ok: true, state: { ...state, 背包: { ...state.背包, items: pushUnique(state.背包.items, item, (entry) => entry.id) } } };
    } catch {
      return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    }
  }
  if (command.path === 'mora') {
    const invalidAction = validateAction(command, ['set', 'add', 'sub'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    const next = nextNumber(state.背包.mora, command, 0, index);
    if (typeof next !== 'number' || !Number.isInteger(next)) return { ok: false, error: typeof next === 'number' ? error(index, 'INVALID_VALUE', command.root, command.path) : next };
    return { ok: true, state: { ...state, 背包: { ...state.背包, mora: next } } };
  }
  const quantity = command.path.match(ITEM_QUANTITY_RE);
  if (quantity) {
    const invalidAction = validateAction(command, ['set', 'add', 'sub'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    const targetIndex = state.背包.items.findIndex((item) => item.id === quantity[1]);
    if (targetIndex < 0) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
    const targetItem = state.背包.items[targetIndex];
    if (!targetItem) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
    const next = nextNumber(targetItem.quantity, command, 0, index);
    if (typeof next !== 'number' || !Number.isInteger(next)) return { ok: false, error: typeof next === 'number' ? error(index, 'INVALID_VALUE', command.root, command.path) : next };
    const items = next === 0
      ? state.背包.items.filter((_, itemIndex) => itemIndex !== targetIndex)
      : state.背包.items.map((item, itemIndex) => itemIndex === targetIndex ? { ...item, quantity: next } : item);
    return { ok: true, state: { ...state, 背包: { ...state.背包, items } } };
  }
  return { ok: false, error: error(index, 'UNKNOWN_PATH', command.root, command.path) };
}

function normalizeQuestEntry(value: unknown): TeyvatGameState['任务']['active'][number] | null {
  if (!isRecord(value) || !isTeyvatStableId(value.id) || !nonEmptyText(value.title) || typeof value.description !== 'string') return null;
  if (!['main', 'side', 'custom', 'letter'].includes(String(value.source))) return null;
  if (value.status !== 'active') return null;
  if (!Array.isArray(value.objectives) || !Array.isArray(value.rewards)) return null;
  if (!integer(value.createdAtTurn) || value.createdAtTurn < 0 || !integer(value.updatedAt) || value.updatedAt < value.createdAtTurn) return null;
  if (!value.rewards.every((reward) => nonEmptyText(reward))) return null;
  const objectives = value.objectives.map(rebuildQuestObjective);
  if (objectives.some((objective) => objective === null)) return null;
  if (value.completedAtTurn !== undefined) return null;
  if (value.notes !== undefined && typeof value.notes !== 'string') return null;
  return {
    id: value.id,
    title: value.title.trim(),
    description: value.description,
    source: value.source as TeyvatGameState['任务']['active'][number]['source'],
    status: value.status as TeyvatGameState['任务']['active'][number]['status'],
    objectives: objectives as TeyvatGameState['任务']['active'][number]['objectives'],
    rewards: value.rewards.map((reward) => reward.trim()),
    createdAtTurn: value.createdAtTurn,
    updatedAt: value.updatedAt,
    ...(value.notes !== undefined ? { notes: value.notes } : {}),
  };
}

function rebuildQuestObjective(value: unknown): TeyvatGameState['任务']['active'][number]['objectives'][number] | null {
  if (!isRecord(value) || !isTeyvatStableId(value.id)
    || !['reach', 'collect', 'talk', 'travel', 'defeat', 'time'].includes(String(value.type))
    || !nonEmptyText(value.description) || !integer(value.targetCount) || value.targetCount < 1
    || !integer(value.currentCount) || value.currentCount < 0 || value.currentCount > value.targetCount
    || typeof value.completed !== 'boolean' || value.completed !== (value.currentCount >= value.targetCount)) return null;
  return {
    id: value.id,
    type: value.type as TeyvatGameState['任务']['active'][number]['objectives'][number]['type'],
    description: value.description.trim(),
    targetCount: value.targetCount,
    currentCount: value.currentCount,
    completed: value.completed,
  };
}

function applyQuest(state: TeyvatGameState, command: TeyvatDomainCommand, index: number): ApplyResult {
  if (command.path === 'active') {
    const invalidAction = validateAction(command, ['push'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    const quest = normalizeQuestEntry(command.value);
    if (!quest) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    return { ok: true, state: { ...state, 任务: { ...state.任务, active: pushUnique(state.任务.active, quest, (entry) => entry.id) } } };
  }
  const objectives = command.path.match(QUEST_OBJECTIVES_RE);
  if (objectives) {
    const questIndex = state.任务.active.findIndex((entry) => entry.id === objectives[1]);
    if (questIndex < 0) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
    const rebuiltObjective = rebuildQuestObjective(command.value);
    if (command.action !== 'push' || !rebuiltObjective) {
      return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    }
    const active = state.任务.active.map((quest, qIndex) => qIndex !== questIndex ? quest : {
      ...quest,
      objectives: pushUnique(quest.objectives, rebuiltObjective, (entry) => entry.id),
    });
    return { ok: true, state: { ...state, 任务: { ...state.任务, active } } };
  }
  const objective = command.path.match(QUEST_OBJECTIVE_RE);
  if (objective) {
    const questId = objective[1] ?? '';
    const objectiveId = objective[2] ?? '';
    const questIndex = state.任务.active.findIndex((entry) => entry.id === questId);
    if (questIndex < 0) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
    const quest = state.任务.active[questIndex];
    if (!quest) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
    const objectiveIndex = quest.objectives.findIndex((entry) => entry.id === objectiveId);
    if (objectiveIndex < 0) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
    const target = quest.objectives[objectiveIndex];
    if (!target) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
    const invalidAction = validateAction(command, ['set', 'add'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    const next = nextNumber(target.currentCount, command, 0, index);
    if (typeof next !== 'number' || !Number.isInteger(next) || next > target.targetCount) return { ok: false, error: typeof next === 'number' ? error(index, 'INVALID_NUMERIC_RESULT', command.root, command.path) : next };
    const active = state.任务.active.map((quest, qIndex) => qIndex !== questIndex ? quest : {
      ...quest,
      objectives: quest.objectives.map((item, oIndex) => oIndex === objectiveIndex ? { ...item, currentCount: next, completed: next >= item.targetCount } : item),
    });
    return { ok: true, state: { ...state, 任务: { ...state.任务, active } } };
  }
  const status = command.path.match(QUEST_STATUS_RE);
  if (status) {
    const questIndex = state.任务.active.findIndex((entry) => entry.id === status[1]);
    if (questIndex < 0) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
    if (command.action !== 'set' || !['active', 'completed', 'abandoned', 'failed'].includes(String(command.value))) {
      return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    }
    const target = state.任务.active[questIndex];
    if (!target) return { ok: false, error: error(index, 'MISSING_TARGET_ID', command.root, command.path) };
    const nextStatus = command.value as typeof target.status;
    const updated = {
      ...target,
      status: nextStatus,
      updatedAt: state.turnCount,
      ...(nextStatus === 'completed' ? { completedAtTurn: state.turnCount } : {}),
    };
    if (nextStatus === 'completed') {
      return { ok: true, state: { ...state, 任务: {
        ...state.任务,
        active: state.任务.active.filter((_, itemIndex) => itemIndex !== questIndex),
        completed: pushUnique(state.任务.completed, updated, (entry) => entry.id),
      } } };
    }
    if (nextStatus === 'abandoned') {
      return { ok: true, state: { ...state, 任务: {
        ...state.任务,
        active: state.任务.active.filter((_, itemIndex) => itemIndex !== questIndex),
        abandoned: pushUnique(state.任务.abandoned, updated, (entry) => entry.id),
      } } };
    }
    const active = state.任务.active.map((quest, qIndex) => qIndex === questIndex ? updated : quest);
    return { ok: true, state: { ...state, 任务: { ...state.任务, active } } };
  }
  if (command.path === 'lastUpdates') {
    if (command.action !== 'push' || !nonEmptyText(command.value)) {
      return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    }
    return { ok: true, state: { ...state, 任务: {
      ...state.任务,
      lastUpdates: [...state.任务.lastUpdates, command.value.trim()].slice(-5),
    } } };
  }
  return { ok: false, error: error(index, 'UNKNOWN_PATH', command.root, command.path) };
}

function applyCourier(state: TeyvatGameState, command: TeyvatDomainCommand, index: number): ApplyResult {
  if (command.path === 'contacts') {
    if (command.action !== 'push' || !isRecord(command.value) || !nonEmptyText(command.value.id) || !nonEmptyText(command.value.name)) {
      return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    }
    const contact = normalizeCourierSystem({ contacts: [command.value] }).contacts[0];
    if (!contact) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    return { ok: true, state: { ...state, 手机: { ...state.手机, contacts: pushUnique(state.手机.contacts, contact, (entry) => entry.id) } } };
  }
  if (command.path === 'deliverySeeds') {
    if (command.action !== 'push' || !isRecord(command.value) || !nonEmptyText(command.value.id)) {
      return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    }
    const seed = normalizeCourierSystem({ deliverySeeds: [command.value] }).deliverySeeds[0];
    if (!seed?.id || !seed.targetId || !seed.title || !seed.context) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    return { ok: true, state: { ...state, 手机: { ...state.手机, deliverySeeds: pushUnique(state.手机.deliverySeeds, seed, (entry) => entry.id) } } };
  }
  if (command.path === 'unreadTotal') {
    const invalidAction = validateAction(command, ['set', 'add', 'sub'], index);
    if (invalidAction) return { ok: false, error: invalidAction };
    const next = nextNumber(state.手机.unreadTotal, command, 0, index);
    if (typeof next !== 'number' || !Number.isInteger(next)) return { ok: false, error: typeof next === 'number' ? error(index, 'INVALID_VALUE', command.root, command.path) : next };
    return { ok: true, state: { ...state, 手机: { ...state.手机, unreadTotal: next } } };
  }
  return { ok: false, error: error(index, 'UNKNOWN_PATH', command.root, command.path) };
}

function applyCanon(state: TeyvatGameState, command: TeyvatDomainCommand, index: number): ApplyResult {
  if (command.path === 'currentAnchor') {
    if (command.action !== 'set' || !nonEmptyText(command.value)) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    return { ok: true, state: { ...state, 原著轨道: { ...state.原著轨道, currentAnchor: command.value.trim() } } };
  }
  if (command.path === 'notes') {
    if (!['push', 'delete'].includes(command.action) || !nonEmptyText(command.value)) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    const note = command.value.trim();
    const notes = command.action === 'delete' ? state.原著轨道.notes.filter((item) => item !== note) : pushUnique(state.原著轨道.notes, note, (item) => item);
    return { ok: true, state: { ...state, 原著轨道: { ...state.原著轨道, notes } } };
  }
  if (command.path === 'deviations') {
    if (command.action !== 'push' || !isRecord(command.value) || !nonEmptyText(command.value.id)) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    const deviation = normalizeCanonDeviation(command.value);
    if (!deviation || deviation.id !== command.value.id) return { ok: false, error: error(index, 'INVALID_VALUE', command.root, command.path) };
    return { ok: true, state: { ...state, 原著轨道: { ...state.原著轨道, deviations: pushUnique(state.原著轨道.deviations, deviation, (entry) => entry.id) } } };
  }
  return { ok: false, error: error(index, 'UNKNOWN_PATH', command.root, command.path) };
}

export function applyRegisteredTeyvatCommand(state: TeyvatGameState, command: TeyvatDomainCommand, index: number): ApplyResult {
  switch (command.root) {
    case '旅行者': return applyTraveler(state, command, index);
    case '世界': return applyWorld(state, command, index);
    case 'NPC': return applyNpc(state, command, index);
    case '背包': return applyInventory(state, command, index);
    case '任务': return applyQuest(state, command, index);
    case '信使': return applyCourier(state, command, index);
    case '原著轨道': return applyCanon(state, command, index);
  }
}

export function buildTeyvatCommandRegistryPrompt(): string {
  return [
    '# Teyvat 领域命令白名单',
    '命令字段仅允许 action/root/path/value/evidence；root 固定为 旅行者/世界/NPC/背包/任务/信使/原著轨道。',
    '证据必须逐字匹配本回合 factCandidates 的 fact 或 evidence；禁止 evidence=无。',
    '旅行者：push/delete capabilities；set/add 天赋[id=稳定ID].等级（0-20，仅技能面板已登记的天赋）。禁止旧版能力列表、旅行者侧背包和整根替换。',
    '世界：set 当前地点/当前日期/当前时间/当前天气/氛围；set/add/sub 旅程天数；push/delete 世界事件。',
    'NPC：push records；用 [id=稳定ID].affinity/lastSeenTurn/relationship/playerAddress/appearance/clothing/speechStyle/intimate/travelingTogether 更新。',
    '队伍规则：travelingTogether 表示与旅行者同行，由玩家在同伴面板主动邀请入队或请离队伍。剧情只有在明确发生加入或离开（对方正式答应同行、或正式告别离队）时才允许更新该字段；同行同伴最多 3 名，不要批量改变。',
    `背包：push items（category=${ITEM_CATEGORIES.join('|')}，rarity=${ITEM_RARITIES.join('|')}，必须有稳定 id）；set/add/sub mora；set/add/sub items[id=稳定ID].quantity。`,
    '任务：push active；push active[id=稳定ID].objectives；用 active[id=稳定ID].objectives[id=稳定ID].currentCount 或 active[id=稳定ID].status 更新；push lastUpdates。',
    '信使：push contacts/deliverySeeds；set/add/sub unreadTotal。',
    '原著轨道：set currentAnchor；push/delete notes；push deviations（必须有稳定 id）。',
    '禁止空路径、*、[]、动态 selector、__proto__/prototype/constructor 和整域替换。',
  ].join('\n');
}
import { isRecord } from '@/utils/valueGuards';
