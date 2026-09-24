import type { TeyvatGameState } from '@/models/teyvat/state';

/**
 * 变量结算提交时的并发写保护（第二轮审计 A3）。
 *
 * 背景：`runVariableCalibrationStep` 原先的 `commitGame` 是
 * `state.updateGameState(() => next)` —— updater **忽略 current**，整根替换。
 * 而变量模型调用可能持续数十秒（含重试），这期间右侧面板仍然可写
 * （背包 / NPC / 任务 / 相册都没有被 `pendingVariable` 禁用），
 * 玩家在等待期间做的操作会在提交时被静默回退。
 *
 * 判定只做一次引用比较：`current` 与 `ancestor` 是不是同一个切片引用。
 * - `ancestor` = 结算**开始那一刻的活体根**（`readLiveGameState` 同步探测得到）。
 *   本仓库所有写入都是整切片替换（`state.set背包(next)` / `updateTeyvatState`），
 *   不会就地改数组或对象，所以「引用变了」⇔「这份切片在结算期间被人写过」。
 * - **不能用归一化过的快照当基准**（`baseGameSnapshot` / `applyLegacyGameStateOverrides` 的产物）：
 *   `normalizeTeyvatGameState` 会重建每一个切片，引用必然不等，于是全部切片都被误判成
 *   「并发修改」→ 结算结果整体被丢弃。
 * - **更不能用 `state.game` 当基准**：它是渲染快照，比活体根少一条本回合 user 消息，
 *   会让**每一次**提交都判成冲突（第一版实现的真实缺陷：settlement 全部被丢弃 →
 *   `turnCount` 不再增长、聊天与自动存档的回合数卡住、手机回合分割线消失）。
 *
 * 规则：
 * - 引用没变 → 用结算结果（等价于修复前的整根替换，绝不丢结算）；
 * - 引用变了 → 保留活体值，并记录冲突（不静默丢玩家的操作）；
 * - `对话` 例外：见 `mergeConversation`（本回合新落的 assistant 消息只在结算结果里）；
 * - `universe` / `schemaVersion` / `turnCount` 例外：见 `NON_SLICE_KEYS`。
 */
export interface SettlementRebaseInput {
  /** 结算开始那一刻的活体根。必须与 `current` 同一血缘（未经归一化重建），引用才可比较。 */
  ancestor: TeyvatGameState;
  /** 结算产出的新根状态。 */
  next: TeyvatGameState;
  /** 提交那一刻的活体状态。 */
  current: TeyvatGameState;
}

export interface SettlementRebaseResult {
  state: TeyvatGameState;
  /** 等待期间被改过、因而以活体值为准的顶层切片名；非空时调用方必须让它可见。 */
  preservedSlices: string[];
}

/**
 * 结算基线是否属于**当前活体存档**。
 *
 * `baseGameSnapshot` 可能是另一份存档的冻结根：恢复路径会把 journal 里那一回合的快照传进来，
 * 而那份快照属于**它当时那份存档**。若玩家在这之后已经读入别的存档，
 * 只比较「活体根 vs 活体根」的 CAS 是拦不住的（两次读取都是新档，必然相等）→
 * 旧档整根被写进新档（跨存档数据损坏，对抗审查 2026-09-20 的 B 项）。
 *
 * 判定：同一份存档的时间线 ⇒ 活体对话的最后一条必须仍出现在基线对话里。
 * 用「最后一条」而不是「严格前缀」，是因为长会话会裁剪最早的消息：
 * 严格前缀会把合法恢复判成不合法（假阴性 → 玩家丢掉本可恢复的回合）。
 * 活体对话为空（新局开场）时不设限；基线对话为空则一律不兼容（fail-closed）。
 */
export function isSettlementBaseCompatibleWithLiveRoot(base: TeyvatGameState, live: TeyvatGameState): boolean {
  const baseEntries = base.对话.entries;
  if (baseEntries.length === 0) return false;
  // 结算基线必然是「这一回合的冻结根」：两条合法路径都满足回合数 = 活体 + 1
  // （正常流程的 frozenSettlementState，与恢复流程 journal 里的 source）。
  if (base.turnCount !== live.turnCount + 1) return false;
  const lastLiveId = live.对话.entries.at(-1)?.id;
  if (!lastLiveId) return true;
  return baseEntries.some((entry) => entry.id === lastLiveId);
}

type MutableRoot = Record<string, unknown>;

/** 变量批次是追加式诊断日志：即便叙事切片冲突，也不能丢掉本次结算的批次。 */
function mergeVariableBatches(current: unknown, next: unknown): unknown {
  const currentBatches = Array.isArray((current as { variableBatches?: unknown[] } | undefined)?.variableBatches)
    ? ((current as { variableBatches: Array<{ id?: unknown }> }).variableBatches)
    : [];
  const nextBatches = Array.isArray((next as { variableBatches?: unknown[] } | undefined)?.variableBatches)
    ? ((next as { variableBatches: Array<{ id?: unknown }> }).variableBatches)
    : [];
  const seen = new Set(currentBatches.map((batch) => String(batch?.id ?? '')));
  const appended = nextBatches.filter((batch) => !seen.has(String(batch?.id ?? '')));
  return [...currentBatches, ...appended];
}

/**
 * 对话**不能**走「冲突就保留活体值」：本回合新落的 assistant 消息只存在于结算结果里，
 * 一旦被活体值顶掉，玩家会看到「回复消失」。反过来，等待期间的并发对话写入
 * （消息书签、正文生图挂图）动的都是**已有条目**，按 id 取活体版本即可两者都保住：
 * 顺序与新增条目用结算结果，已有条目用活体版本。
 */
function mergeConversation(current: unknown, next: unknown): unknown {
  const currentEntries = Array.isArray((current as { entries?: unknown[] } | undefined)?.entries)
    ? (current as { entries: unknown[] }).entries
    : [];
  const nextEntries = Array.isArray((next as { entries?: unknown[] } | undefined)?.entries)
    ? (next as { entries: unknown[] }).entries
    : [];
  if (!nextEntries.length) return next;
  const seenNextIds = new Set<string>();
  const uniqueNextEntries = nextEntries.filter((entry) => {
    const id = (entry as { id?: unknown } | null | undefined)?.id;
    if (typeof id !== 'string' || !id) return true;
    if (seenNextIds.has(id)) return false;
    seenNextIds.add(id);
    return true;
  });
  if (!currentEntries.length) return { ...(next as MutableRoot), entries: uniqueNextEntries };
  const liveById = new Map<string, unknown>();
  for (const entry of currentEntries) {
    const id = (entry as { id?: unknown } | null | undefined)?.id;
    if (typeof id === 'string' && id) liveById.set(id, entry);
  }
  return {
    ...(next as MutableRoot),
    entries: uniqueNextEntries.map((entry) => {
      const id = (entry as { id?: unknown } | null | undefined)?.id;
      const live = typeof id === 'string' && id ? liveById.get(id) : undefined;
      return live ?? entry;
    }),
  };
}

/** 结算自身就是唯一合法写者、且活体值可能缺失本次产物的切片。 */
const SETTLEMENT_MERGED_SLICES = new Set(['对话']);

/**
 * 这三个由存档 / 结算机制统一维护，不参与「等待期间被改过」判定，一律取结算结果：
 * 结算提交的 CAS 已经把这些字段纳入令牌（任一不等即整体拒绝），所以走到合并时它们必然未被改过；
 * 万一将来多出别的写者，也不该让「等待期间被改动的 turnCount」把本回合的 +1 丢掉，
 * 更不该把内部键名当成切片名弹给玩家（对抗审查 2026-09-20 的疑点 1）。
 */
const NON_SLICE_KEYS = new Set(['universe', 'schemaVersion', 'turnCount']);

export function rebaseSettlementState(input: SettlementRebaseInput): SettlementRebaseResult {
  const { ancestor, next, current } = input;
  const nextRecord = next as unknown as MutableRoot;
  const currentRecord = current as unknown as MutableRoot;
  const ancestorRecord = ancestor as unknown as MutableRoot;
  const merged: MutableRoot = { ...nextRecord };
  const preservedSlices: string[] = [];

  for (const key of Object.keys(nextRecord)) {
    if (NON_SLICE_KEYS.has(key)) continue;
    const currentSlice = currentRecord[key];
    if (currentSlice === ancestorRecord[key]) continue;
    if (SETTLEMENT_MERGED_SLICES.has(key)) {
      merged[key] = mergeConversation(currentSlice, nextRecord[key]);
      continue;
    }
    preservedSlices.push(key);
    merged[key] = currentSlice;
  }

  // 叙事冲突时，用批次并集补回本次结算的变量批次（关系图「最近好感变化」依赖它）。
  if (preservedSlices.includes('叙事')) {
    const currentNarrative = currentRecord.叙事;
    const nextNarrative = nextRecord.叙事;
    if (currentNarrative && nextNarrative) {
      merged.叙事 = {
        ...(currentNarrative as MutableRoot),
        variableBatches: mergeVariableBatches(currentNarrative, nextNarrative),
      };
    }
  }

  return { state: merged as unknown as TeyvatGameState, preservedSlices };
}
