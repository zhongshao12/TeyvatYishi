import type { TeyvatGameState } from '@/models/teyvat/state';

/**
 * 变量结算提交时的并发写保护。
 *
 * 背景（第二轮审计 A3）：`runVariableCalibrationStep` 的 `commitGame` 原先是
 * `state.updateGameState(() => next)` —— updater **忽略 current**，整根替换。
 * 而 `next` 来自变量模型调用**之前**的冻结快照（调用可能持续数十秒，含重试），
 * 这期间右侧面板仍然可写（背包/NPC/任务/相册都没有被 `pendingVariable` 禁用）。
 * 结果是玩家在等待期间做的任何操作在提交时被静默回退。
 *
 * 这里用三路合并解决：
 * - `trueBase`：结算开始时主流程看到的真实根状态；
 * - `frozenBase`：结算实际读到的基线快照（可能已带上主流程本回合累积的覆盖）；
 * - `next`：结算产出的新根状态；
 * - `current`：提交那一刻的活体状态。
 *
 * 判定规则（按顶层切片）：
 * - 结算改了、玩家也改了 → **以玩家为准**并记录冲突（不静默丢玩家的操作）；
 * - 只有玩家改了 → 保留玩家的值；
 * - 只有结算改了 / 都没改 → 用结算结果。
 *
 * 用引用相等判断"是否被改过"是这个仓库的既定做法：所有写入都是**整切片替换**
 * （`state.set背包(next)` / `updateTeyvatState`），不会就地修改数组或对象。
 */

/** 这些字段由结算或存档机制统一维护，不参与并发判定。 */
const NON_SLICE_KEYS = new Set(['universe', 'schemaVersion', 'turnCount']);

export interface SettlementRebaseInput {
  trueBase: TeyvatGameState;
  frozenBase: TeyvatGameState;
  next: TeyvatGameState;
  current: TeyvatGameState;
}

export interface SettlementRebaseResult {
  state: TeyvatGameState;
  /** 因玩家在结算期间改过而被保留的顶层切片名；非空时调用方必须让它可见。 */
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

export function rebaseSettlementState(input: SettlementRebaseInput): SettlementRebaseResult {
  const { trueBase, frozenBase, next, current } = input;
  const merged: MutableRoot = { ...(next as unknown as MutableRoot) };
  const preservedSlices: string[] = [];

  for (const key of Object.keys(next as unknown as MutableRoot)) {
    if (NON_SLICE_KEYS.has(key)) continue;
    const nextSlice = (next as unknown as MutableRoot)[key];
    const frozenSlice = (frozenBase as unknown as MutableRoot)[key];
    const currentSlice = (current as unknown as MutableRoot)[key];
    const baseSlice = (trueBase as unknown as MutableRoot)[key];

    const settlementTouched = nextSlice !== frozenSlice;
    const playerTouched = currentSlice !== baseSlice;

    if (playerTouched && settlementTouched) {
      preservedSlices.push(key);
      merged[key] = currentSlice;
      continue;
    }
    if (playerTouched) {
      merged[key] = currentSlice;
      continue;
    }
    merged[key] = nextSlice;
  }

  // 叙事冲突时，用批次并集补回本次结算的变量批次（关系图「最近好感变化」依赖它）。
  if (preservedSlices.includes('叙事')) {
    const currentNarrative = (current as unknown as MutableRoot).叙事;
    const nextNarrative = (next as unknown as MutableRoot).叙事;
    if (currentNarrative && nextNarrative) {
      merged.叙事 = {
        ...(currentNarrative as MutableRoot),
        variableBatches: mergeVariableBatches(currentNarrative, nextNarrative),
      };
    }
  }

  return { state: merged as unknown as TeyvatGameState, preservedSlices };
}
