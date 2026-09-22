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
 * - `对话` 例外：见 `mergeConversation`（本回合新落的 assistant 消息只在结算结果里）。
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
  if (!currentEntries.length || !nextEntries.length) return next;
  const liveById = new Map<string, unknown>();
  for (const entry of currentEntries) {
    const id = (entry as { id?: unknown } | null | undefined)?.id;
    if (typeof id === 'string' && id) liveById.set(id, entry);
  }
  return {
    ...(next as MutableRoot),
    entries: nextEntries.map((entry) => {
      const id = (entry as { id?: unknown } | null | undefined)?.id;
      const live = typeof id === 'string' && id ? liveById.get(id) : undefined;
      return live ?? entry;
    }),
  };
}

/** 结算自身就是唯一合法写者、且活体值可能缺失本次产物的切片。 */
const SETTLEMENT_MERGED_SLICES = new Set(['对话']);

export function rebaseSettlementState(input: SettlementRebaseInput): SettlementRebaseResult {
  const { ancestor, next, current } = input;
  const nextRecord = next as unknown as MutableRoot;
  const currentRecord = current as unknown as MutableRoot;
  const ancestorRecord = ancestor as unknown as MutableRoot;
  const merged: MutableRoot = { ...nextRecord };
  const preservedSlices: string[] = [];

  for (const key of Object.keys(nextRecord)) {
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
